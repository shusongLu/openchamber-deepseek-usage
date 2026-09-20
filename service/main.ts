/**
 * DeepSeek 用量扩展 —— 本地服务
 *
 * 职责：
 *  1. 只读打开本机 OpenCode 的 opencode.db（SQLite），聚合所有 DeepSeek 消息的 token / cost
 *  2. 按官方峰谷时段重算费用（峰时 = 周一至周五 01:00-04:00、06:00-10:00 UTC）
 *  3. 读取本机 DeepSeek API key（secrets 文件 / auth.json），查询官方余额接口
 *
 * 运行方式：由 OpenChamber host 以 Electron-as-Node 启动，
 * 端口与鉴权 token 来自 OPENCHAMBER_SERVICE_PORT / OPENCHAMBER_SERVICE_TOKEN。
 */
import { createServer, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PORT = Number(process.env.OPENCHAMBER_SERVICE_PORT || 0);
const TOKEN = process.env.OPENCHAMBER_SERVICE_TOKEN || '';

// ---------------------------------------------------------------- 价目与时段

type Tier = 'flash' | 'pro';

interface TierPrice {
  hitOff: number;
  hitPeak: number;
  missOff: number;
  missPeak: number;
  outOff: number;
  outPeak: number;
}

/** 元 / 1M tokens，来自 DeepSeek 官方中文价目（2026-09） */
const PRICING: Record<Tier, TierPrice> = {
  flash: { hitOff: 0.02, hitPeak: 0.04, missOff: 1, missPeak: 2, outOff: 4, outPeak: 8 },
  pro: { hitOff: 0.15, hitPeak: 0.3, missOff: 4.5, missPeak: 9, outOff: 13.5, outPeak: 27 },
};

const PEAK_WINDOW_UTC = '周一至周五 01:00–04:00、06:00–10:00 UTC';
const PEAK_WINDOW_LOCAL = '北京时间 09:00–12:00、14:00–18:00';

function tierOf(model: string): Tier | null {
  const m = model.toLowerCase();
  if (!m.startsWith('deepseek')) return null;
  return m.includes('pro') ? 'pro' : 'flash';
}

function isPeak(date: Date): boolean {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  const h = date.getUTCHours();
  return (h >= 1 && h < 4) || (h >= 6 && h < 10);
}

function nextChange(fromMs: number): { at: number; phase: 'peak' | 'offpeak' } {
  const current = isPeak(new Date(fromMs));
  let t = Math.ceil(fromMs / 60_000) * 60_000;
  for (let i = 0; i < 8 * 24 * 60; i += 1) {
    t += 60_000;
    const phase = isPeak(new Date(t));
    if (phase !== current) return { at: t, phase: phase ? 'peak' : 'offpeak' };
  }
  return { at: fromMs, phase: current ? 'peak' : 'offpeak' };
}

// ---------------------------------------------------------------- 工具函数

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function localDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface Tokens {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

function emptyTokens(): Tokens {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
}

function addTokens(a: Tokens, b: Tokens): Tokens {
  a.input += b.input;
  a.output += b.output;
  a.reasoning += b.reasoning;
  a.cacheRead += b.cacheRead;
  a.cacheWrite += b.cacheWrite;
  return a;
}

// ---------------------------------------------------------------- 数据源定位

function findDb(): string | null {
  const candidates = [
    process.env.OPENCODE_DB,
    join(homedir(), '.local', 'share', 'opencode', 'opencode.db'),
  ].filter((x): x is string => Boolean(x));
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

function resolveApiKey(): { key: string | null; source: string | null } {
  const env = (process.env.DEEPSEEK_API_KEY || '').trim();
  if (env) return { key: env, source: 'env' };

  const secretFile = join(homedir(), '.config', 'opencode', 'secrets', 'deepseek-api-key');
  try {
    const v = readFileSync(secretFile, 'utf8').trim();
    if (v) return { key: v, source: 'secrets/deepseek-api-key' };
  } catch {
    /* ignore */
  }

  const authFile = join(homedir(), '.local', 'share', 'opencode', 'auth.json');
  try {
    const auth = JSON.parse(readFileSync(authFile, 'utf8')) as Record<string, { key?: string }>;
    const entry = auth.deepseek;
    if (entry && typeof entry.key === 'string' && entry.key.trim()) {
      return { key: entry.key.trim(), source: 'auth.json' };
    }
  } catch {
    /* ignore */
  }

  return { key: null, source: null };
}

// ---------------------------------------------------------------- 用量聚合

interface DayAgg {
  date: string;
  requests: number;
  tokens: Tokens;
  cost: number; // OpenCode 记账（USD）
  official: number; // 按官方峰谷价重算（USD）
  peakOfficial: number;
  offOfficial: number;
}

interface ModelAgg {
  model: string;
  tier: Tier | null;
  requests: number;
  tokens: Tokens;
  cost: number;
  official: number;
  peakOfficial: number;
  offOfficial: number;
}

interface UsageSnapshot {
  generatedAt: number;
  dbPath: string;
  messageTotal: number;
  firstTs: number | null;
  lastTs: number | null;
  totals: {
    requests: number;
    tokens: Tokens;
    cost: number;
    official: number;
    peakOfficial: number;
    offOfficial: number;
  };
  days: Map<string, DayAgg>;
  models: Map<string, ModelAgg>;
}

function messageOfficialCost(tokens: Tokens, tier: Tier | null, peak: boolean): number {
  if (!tier) return 0;
  const p = PRICING[tier];
  const hit = peak ? p.hitPeak : p.hitOff;
  const miss = peak ? p.missPeak : p.missOff;
  const out = peak ? p.outPeak : p.outOff;
  return (tokens.input * miss + tokens.cacheRead * hit + (tokens.output + tokens.reasoning) * out) / 1e6;
}

function aggregate(dbPath: string): UsageSnapshot {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db
    .prepare(
      `SELECT time_created AS ts,
              json_extract(data,'$.modelID') AS model,
              json_extract(data,'$.tokens.input') AS input,
              json_extract(data,'$.tokens.output') AS output,
              json_extract(data,'$.tokens.reasoning') AS reasoning,
              json_extract(data,'$.tokens.cache.read') AS cache_read,
              json_extract(data,'$.tokens.cache.write') AS cache_write,
              json_extract(data,'$.cost') AS cost
       FROM message
       WHERE json_extract(data,'$.role') = 'assistant'
         AND json_extract(data,'$.modelID') LIKE 'deepseek%'`,
    )
    .all() as Array<Record<string, unknown>>;
  db.close();

  const snapshot: UsageSnapshot = {
    generatedAt: Date.now(),
    dbPath,
    messageTotal: rows.length,
    firstTs: null,
    lastTs: null,
    totals: { requests: 0, tokens: emptyTokens(), cost: 0, official: 0, peakOfficial: 0, offOfficial: 0 },
    days: new Map(),
    models: new Map(),
  };

  for (const row of rows) {
    const ts = num(row.ts);
    if (!ts) continue;
    const model = String(row.model ?? 'deepseek-未知');
    const tier = tierOf(model);
    const tokens: Tokens = {
      input: num(row.input),
      output: num(row.output),
      reasoning: num(row.reasoning),
      cacheRead: num(row.cache_read),
      cacheWrite: num(row.cache_write),
    };
    const cost = num(row.cost);
    const peak = isPeak(new Date(ts));
    const official = messageOfficialCost(tokens, tier, peak);

    snapshot.messageTotal += 0;
    if (snapshot.firstTs === null || ts < snapshot.firstTs) snapshot.firstTs = ts;
    if (snapshot.lastTs === null || ts > snapshot.lastTs) snapshot.lastTs = ts;

    const totals = snapshot.totals;
    totals.requests += 1;
    addTokens(totals.tokens, tokens);
    totals.cost += cost;
    totals.official += official;
    if (peak) totals.peakOfficial += official;
    else totals.offOfficial += official;

    const dk = localDate(ts);
    let day = snapshot.days.get(dk);
    if (!day) {
      day = {
        date: dk,
        requests: 0,
        tokens: emptyTokens(),
        cost: 0,
        official: 0,
        peakOfficial: 0,
        offOfficial: 0,
      };
      snapshot.days.set(dk, day);
    }
    day.requests += 1;
    addTokens(day.tokens, tokens);
    day.cost += cost;
    day.official += official;
    if (peak) day.peakOfficial += official;
    else day.offOfficial += official;

    let agg = snapshot.models.get(model);
    if (!agg) {
      agg = {
        model,
        tier,
        requests: 0,
        tokens: emptyTokens(),
        cost: 0,
        official: 0,
        peakOfficial: 0,
        offOfficial: 0,
      };
      snapshot.models.set(model, agg);
    }
    agg.requests += 1;
    addTokens(agg.tokens, tokens);
    agg.cost += cost;
    agg.official += official;
    if (peak) agg.peakOfficial += official;
    else agg.offOfficial += official;
  }

  return snapshot;
}

// ---------------------------------------------------------------- 单会话聚合（含子代理）

interface SessionSide {
  requests: number;
  tokens: Tokens;
  official: number;
  cost: number;
}

interface SessionAgg extends SessionSide {
  id: string;
  startedAt: number;
  lastMessageAt: number | null;
  peakOfficial: number;
  offOfficial: number;
  main: SessionSide;
  children: SessionSide;
}

function emptySide(): SessionSide {
  return { requests: 0, tokens: emptyTokens(), official: 0, cost: 0 };
}

function aggregateSession(dbPath: string, sessionId: string): SessionAgg | null {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const meta = db
      .prepare('SELECT time_created AS created, time_updated AS updated FROM session WHERE id = ?')
      .get(sessionId) as { created?: unknown; updated?: unknown } | undefined;
    if (!meta) return null;

    const rows = db
      .prepare(
        `WITH RECURSIVE tree(id) AS (
           SELECT id FROM session WHERE id = ?
           UNION ALL
           SELECT s.id FROM session s JOIN tree t ON s.parent_id = t.id
         )
         SELECT m.session_id AS sid,
                m.time_created AS ts,
                json_extract(m.data,'$.modelID') AS model,
                json_extract(m.data,'$.tokens.input') AS input,
                json_extract(m.data,'$.tokens.output') AS output,
                json_extract(m.data,'$.tokens.reasoning') AS reasoning,
                json_extract(m.data,'$.tokens.cache.read') AS cache_read,
                json_extract(m.data,'$.tokens.cache.write') AS cache_write,
                json_extract(m.data,'$.cost') AS cost
         FROM message m
         WHERE m.session_id IN (SELECT id FROM tree)
           AND json_extract(m.data,'$.role') = 'assistant'`,
      )
      .all(sessionId) as Array<Record<string, unknown>>;

    const agg: SessionAgg = {
      id: sessionId,
      startedAt: num(meta.created),
      lastMessageAt: null,
      ...emptySide(),
      peakOfficial: 0,
      offOfficial: 0,
      main: emptySide(),
      children: emptySide(),
    };

    for (const row of rows) {
      const ts = num(row.ts);
      const peak = ts ? isPeak(new Date(ts)) : false;
      const tokens: Tokens = {
        input: num(row.input),
        output: num(row.output),
        reasoning: num(row.reasoning),
        cacheRead: num(row.cache_read),
        cacheWrite: num(row.cache_write),
      };
      const cost = num(row.cost);
      const official = messageOfficialCost(tokens, tierOf(String(row.model ?? '')), peak);
      const side = String(row.sid) === sessionId ? agg.main : agg.children;

      if (ts && (agg.lastMessageAt === null || ts > agg.lastMessageAt)) agg.lastMessageAt = ts;

      agg.requests += 1;
      addTokens(agg.tokens, tokens);
      agg.cost += cost;
      agg.official += official;
      if (peak) agg.peakOfficial += official;
      else agg.offOfficial += official;

      side.requests += 1;
      addTokens(side.tokens, tokens);
      side.official += official;
      side.cost += cost;
    }

    return agg;
  } finally {
    db.close();
  }
}

function sessionToCny(agg: SessionAgg, fxRate: number): Record<string, unknown> {
  return {
    ...agg,
    cost: agg.cost * fxRate,
    main: { ...agg.main, cost: agg.main.cost * fxRate },
    children: { ...agg.children, cost: agg.children.cost * fxRate },
  };
}

// ---------------------------------------------------------------- 会话排行（按根会话归并子代理）

interface SessionRankRow {
  id: string;
  title: string;
  official: number;
  cost: number;
  requests: number;
  tokens: Tokens;
  startedAt: number;
  lastMessageAt: number;
}

function rankSessions(dbPath: string, days: number, limit: number): { sessions: SessionRankRow[] } {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const meta = db
      .prepare('SELECT id, parent_id AS parentId, title, time_created AS created FROM session')
      .all() as Array<Record<string, unknown>>;
    const parentOf = new Map<string, string | null>();
    const titleOf = new Map<string, string>();
    const createdOf = new Map<string, number>();
    for (const m of meta) {
      const id = String(m.id);
      parentOf.set(id, m.parentId ? String(m.parentId) : null);
      titleOf.set(id, String(m.title ?? ''));
      createdOf.set(id, num(m.created));
    }

    const cutoff = Date.now() - days * 86_400_000;
    const rows = db
      .prepare(
        `SELECT session_id AS sid,
                time_created AS ts,
                json_extract(data,'$.modelID') AS model,
                json_extract(data,'$.tokens.input') AS input,
                json_extract(data,'$.tokens.output') AS output,
                json_extract(data,'$.tokens.reasoning') AS reasoning,
                json_extract(data,'$.tokens.cache.read') AS cache_read,
                json_extract(data,'$.tokens.cache.write') AS cache_write,
                json_extract(data,'$.cost') AS cost
         FROM message
         WHERE json_extract(data,'$.role') = 'assistant'
           AND json_extract(data,'$.modelID') LIKE 'deepseek%'
           AND time_created >= ?`,
      )
      .all(cutoff) as Array<Record<string, unknown>>;

    const roots = new Map<string, SessionRankRow>();

    for (const row of rows) {
      let sid = String(row.sid);
      let parent = parentOf.get(sid) ?? null;
      let guard = 0;
      while (parent && guard < 64) {
        sid = parent;
        parent = parentOf.get(sid) ?? null;
        guard += 1;
      }

      const ts = num(row.ts);
      const peak = ts ? isPeak(new Date(ts)) : false;
      const tokens: Tokens = {
        input: num(row.input),
        output: num(row.output),
        reasoning: num(row.reasoning),
        cacheRead: num(row.cache_read),
        cacheWrite: num(row.cache_write),
      };
      const official = messageOfficialCost(tokens, tierOf(String(row.model ?? '')), peak);
      const cost = num(row.cost);

      let agg = roots.get(sid);
      if (!agg) {
        agg = {
          id: sid,
          title: titleOf.get(sid) ?? sid,
          official: 0,
          cost: 0,
          requests: 0,
          tokens: emptyTokens(),
          startedAt: createdOf.get(sid) ?? ts,
          lastMessageAt: 0,
        };
        roots.set(sid, agg);
      }
      agg.requests += 1;
      addTokens(agg.tokens, tokens);
      agg.official += official;
      agg.cost += cost;
      if (ts > agg.lastMessageAt) agg.lastMessageAt = ts;
    }

    const sessions = [...roots.values()].sort((a, b) => b.official - a.official).slice(0, limit);
    return { sessions };
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------- 缓存

let usageCache: { at: number; snapshot: UsageSnapshot } | null = null;
const USAGE_TTL_MS = 30_000;

function getUsage(): UsageSnapshot | { dbPath: null; error: string } {
  const dbPath = findDb();
  if (!dbPath) return { dbPath: null, error: 'opencode.db not found' };
  if (usageCache && usageCache.snapshot.dbPath === dbPath && Date.now() - usageCache.at < USAGE_TTL_MS) {
    return usageCache.snapshot;
  }
  const snapshot = aggregate(dbPath);
  usageCache = { at: Date.now(), snapshot };
  return snapshot;
}

interface BalanceResult {
  ok: boolean;
  source?: string | null;
  isAvailable?: boolean;
  currency?: string | null;
  total?: string | null;
  granted?: string | null;
  toppedUp?: string | null;
  at?: number;
  reason?: string;
  message?: string;
}

let balanceCache: { at: number; data: BalanceResult } | null = null;
const BALANCE_TTL_MS = 60_000;

/** USD→CNY 汇率（用于折算 OpenCode 自身的美元记账） */
const FX_FALLBACK = 6.72;
let fxCache: { at: number; rate: number; source: string } | null = null;

async function getFxRate(): Promise<{ at: number; rate: number; source: string }> {
  if (fxCache && Date.now() - fxCache.at < (fxCache.source === 'fallback' ? 3_600_000 : 12 * 3_600_000)) {
    return fxCache;
  }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(10_000) });
    const body = (await res.json()) as { rates?: Record<string, unknown> };
    const rate = Number(body?.rates?.CNY);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('bad rates');
    fxCache = { at: Date.now(), rate, source: 'open.er-api.com' };
  } catch {
    fxCache = { at: Date.now(), rate: FX_FALLBACK, source: 'fallback' };
  }
  return fxCache;
}

async function getBalance(): Promise<BalanceResult> {
  const now = Date.now();
  if (balanceCache && now - balanceCache.at < BALANCE_TTL_MS) return balanceCache.data;

  const { key, source } = resolveApiKey();
  if (!key) {
    const data: BalanceResult = { ok: false, reason: 'no-key' };
    balanceCache = { at: now, data };
    return data;
  }
  try {
    const res = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {
      is_available?: boolean;
      balance_infos?: Array<Record<string, unknown>>;
    };
    const info = Array.isArray(body.balance_infos) && body.balance_infos.length > 0 ? body.balance_infos[0] : null;
    const data: BalanceResult = {
      ok: true,
      source,
      isAvailable: Boolean(body.is_available),
      currency: info ? String(info.currency ?? '') : null,
      total: info ? String(info.total_balance ?? '') : null,
      granted: info ? String(info.granted_balance ?? '') : null,
      toppedUp: info ? String(info.topped_up_balance ?? '') : null,
      at: now,
    };
    balanceCache = { at: now, data };
    return data;
  } catch (error) {
    const data: BalanceResult = {
      ok: false,
      reason: 'request-failed',
      message: error instanceof Error ? error.message : String(error),
      at: now,
    };
    balanceCache = { at: now, data };
    return data;
  }
}

// ---------------------------------------------------------------- 响应组装

function serializeDays(snapshot: UsageSnapshot, days: number, fxRate: number): unknown[] {
  const out: unknown[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const agg = snapshot.days.get(key);
    out.push(
      agg
        ? { ...agg, cost: agg.cost * fxRate }
        : {
            date: key,
            requests: 0,
            tokens: emptyTokens(),
            cost: 0,
            official: 0,
            peakOfficial: 0,
            offOfficial: 0,
          },
    );
  }
  return out;
}

async function buildSummary(days: number, sessionId?: string | null): Promise<Record<string, unknown>> {
  const usage = getUsage();
  const now = Date.now();
  const phase: 'peak' | 'offpeak' = isPeak(new Date(now)) ? 'peak' : 'offpeak';
  const change = nextChange(now);
  const balance = await getBalance();
  const fx = await getFxRate();
  const fxInfo = { usdCny: Number(fx.rate.toFixed(4)), source: fx.source, at: fx.at };

  if ('error' in usage) {
    return {
      ok: false,
      generatedAt: now,
      error: usage.error,
      balance,
      fx: fxInfo,
      now: {
        utc: new Date(now).toISOString(),
        isPeak: phase === 'peak',
        phase,
        nextChangeAt: change.at,
        nextPhase: change.phase,
      },
      window: { utc: PEAK_WINDOW_UTC, local: PEAK_WINDOW_LOCAL },
      pricing: PRICING,
    };
  }

  const snapshot = usage;
  const todayAgg = snapshot.days.get(localDate(now)) ?? null;
  const sessionAgg = sessionId ? aggregateSession(snapshot.dbPath, sessionId) : null;
  return {
    ok: true,
    generatedAt: now,
    now: {
      utc: new Date(now).toISOString(),
      local: new Date(now).toLocaleString('zh-CN', { hour12: false }),
      isPeak: phase === 'peak',
      phase,
      nextChangeAt: change.at,
      nextPhase: change.phase,
    },
    window: { utc: PEAK_WINDOW_UTC, local: PEAK_WINDOW_LOCAL },
    pricing: PRICING,
    balance,
    fx: fxInfo,
    session: sessionAgg ? sessionToCny(sessionAgg, fx.rate) : null,
    db: {
      path: snapshot.dbPath,
      messages: snapshot.messageTotal,
      firstTs: snapshot.firstTs,
      lastTs: snapshot.lastTs,
      cachedAt: snapshot.generatedAt,
    },
    totals: { ...snapshot.totals, cost: snapshot.totals.cost * fx.rate },
    today: todayAgg ? { ...todayAgg, cost: todayAgg.cost * fx.rate } : null,
    models: [...snapshot.models.values()]
      .sort((a, b) => b.official - a.official || b.requests - a.requests)
      .map((m) => ({ ...m, cost: m.cost * fx.rate })),
    days: serializeDays(snapshot, days, fx.rate),
    notes: ['官方价按人民币价目与峰谷时段逐条重算；缓存写入不计费；OpenCode 记账按 USD→CNY 折算'],
  };
}

// ---------------------------------------------------------------- HTTP 服务

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

const server = createServer((req, res) => {
  const auth = req.headers.authorization || '';
  if (TOKEN && auth !== `Bearer ${TOKEN}`) {
    res.writeHead(401, { 'content-type': 'text/plain' });
    res.end('unauthorized');
    return;
  }

  const url = new URL(req.url || '/', 'http://127.0.0.1');

  void (async () => {
    try {
      if (url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
        return;
      }
      if (url.pathname === '/summary') {
        const days = Math.min(Math.max(Number(url.searchParams.get('days') || 30) || 30, 1), 365);
        const sessionRaw = url.searchParams.get('session') || '';
        const sessionId = /^[A-Za-z0-9_-]{1,80}$/.test(sessionRaw) ? sessionRaw : null;
        sendJson(res, 200, await buildSummary(days, sessionId));
        return;
      }
      if (url.pathname === '/message') {
        const id = (url.searchParams.get('id') || '').trim();
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) {
          sendJson(res, 400, { ok: false, error: 'bad-id' });
          return;
        }
        const dbPath = findDb();
        if (!dbPath) {
          sendJson(res, 404, { ok: false, error: 'db-not-found' });
          return;
        }
        const db = new DatabaseSync(dbPath, { readOnly: true });
        let row: Record<string, unknown> | undefined;
        try {
          row = db
            .prepare(
              `SELECT session_id AS sid,
                      time_created AS ts,
                      json_extract(data,'$.role') AS role,
                      json_extract(data,'$.modelID') AS model,
                      json_extract(data,'$.providerID') AS provider,
                      json_extract(data,'$.tokens.input') AS input,
                      json_extract(data,'$.tokens.output') AS output,
                      json_extract(data,'$.tokens.reasoning') AS reasoning,
                      json_extract(data,'$.tokens.cache.read') AS cache_read,
                      json_extract(data,'$.tokens.cache.write') AS cache_write,
                      json_extract(data,'$.cost') AS cost
               FROM message WHERE id = ?`,
            )
            .get(id) as Record<string, unknown> | undefined;
        } finally {
          db.close();
        }
        if (!row || row.role !== 'assistant' || !row.model) {
          sendJson(res, 404, { ok: false, error: 'not-found' });
          return;
        }
        const ts = num(row.ts);
        const tokens: Tokens = {
          input: num(row.input),
          output: num(row.output),
          reasoning: num(row.reasoning),
          cacheRead: num(row.cache_read),
          cacheWrite: num(row.cache_write),
        };
        const peak = ts ? isPeak(new Date(ts)) : false;
        const tier = tierOf(String(row.model));
        const official = messageOfficialCost(tokens, tier, peak);
        const fx = await getFxRate();
        sendJson(res, 200, {
          ok: true,
          id,
          sessionId: row.sid,
          ts,
          model: String(row.model),
          provider: row.provider ?? null,
          tier,
          peak,
          tokens,
          official,
          cost: num(row.cost) * fx.rate,
          fx: { usdCny: Number(fx.rate.toFixed(4)), source: fx.source },
        });
        return;
      }
      if (url.pathname === '/sessions') {
        const daysParam = Math.min(Math.max(Number(url.searchParams.get('days') || 30) || 30, 1), 365);
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 20) || 20, 1), 100);
        const dbPath = findDb();
        if (!dbPath) {
          sendJson(res, 404, { ok: false, error: 'db-not-found' });
          return;
        }
        const { sessions } = rankSessions(dbPath, daysParam, limit);
        const fx = await getFxRate();
        sendJson(res, 200, {
          ok: true,
          days: daysParam,
          sessions: sessions.map((s) => ({ ...s, cost: s.cost * fx.rate })),
          fx: { usdCny: Number(fx.rate.toFixed(4)), source: fx.source },
        });
        return;
      }
      if (url.pathname === '/balance') {
        sendJson(res, 200, await getBalance());
        return;
      }
      sendJson(res, 404, { error: 'not-found' });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  })();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[deepseek-usage] service listening on 127.0.0.1:${PORT}`);
});
