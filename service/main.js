"use strict";

// service/main.ts
var import_node_http = require("node:http");
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path = require("node:path");
var import_node_sqlite = require("node:sqlite");
var PORT = Number(process.env.OPENCHAMBER_SERVICE_PORT || 0);
var TOKEN = process.env.OPENCHAMBER_SERVICE_TOKEN || "";
var PRICING = {
  flash: { hitOff: 0.02, hitPeak: 0.04, missOff: 1, missPeak: 2, outOff: 4, outPeak: 8 },
  pro: { hitOff: 0.15, hitPeak: 0.3, missOff: 4.5, missPeak: 9, outOff: 13.5, outPeak: 27 }
};
var PEAK_WINDOW_UTC = "\u5468\u4E00\u81F3\u5468\u4E94 01:00\u201304:00\u300106:00\u201310:00 UTC";
var PEAK_WINDOW_LOCAL = "\u5317\u4EAC\u65F6\u95F4 09:00\u201312:00\u300114:00\u201318:00";
function tierOf(model) {
  const m = model.toLowerCase();
  if (!m.startsWith("deepseek")) return null;
  return m.includes("pro") ? "pro" : "flash";
}
function isPeak(date) {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  const h = date.getUTCHours();
  return h >= 1 && h < 4 || h >= 6 && h < 10;
}
function nextChange(fromMs) {
  const current = isPeak(new Date(fromMs));
  let t = Math.ceil(fromMs / 6e4) * 6e4;
  for (let i = 0; i < 8 * 24 * 60; i += 1) {
    t += 6e4;
    const phase = isPeak(new Date(t));
    if (phase !== current) return { at: t, phase: phase ? "peak" : "offpeak" };
  }
  return { at: fromMs, phase: current ? "peak" : "offpeak" };
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function localDate(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function emptyTokens() {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
}
function addTokens(a, b) {
  a.input += b.input;
  a.output += b.output;
  a.reasoning += b.reasoning;
  a.cacheRead += b.cacheRead;
  a.cacheWrite += b.cacheWrite;
  return a;
}
function messageOfficialCost(tokens, tier, peak) {
  if (!tier) return 0;
  const p = PRICING[tier];
  const hit = peak ? p.hitPeak : p.hitOff;
  const miss = peak ? p.missPeak : p.missOff;
  const out = peak ? p.outPeak : p.outOff;
  return (tokens.input * miss + tokens.cacheRead * hit + (tokens.output + tokens.reasoning) * out) / 1e6;
}
function findDb() {
  const candidates = [
    process.env.OPENCODE_DB,
    (0, import_node_path.join)((0, import_node_os.homedir)(), ".local", "share", "opencode", "opencode.db")
  ].filter((x) => Boolean(x));
  for (const c of candidates) if ((0, import_node_fs.existsSync)(c)) return c;
  return null;
}
function resolveApiKey() {
  const env = (process.env.DEEPSEEK_API_KEY || "").trim();
  if (env) return { key: env, source: "env" };
  const secretFile = (0, import_node_path.join)((0, import_node_os.homedir)(), ".config", "opencode", "secrets", "deepseek-api-key");
  try {
    const v = (0, import_node_fs.readFileSync)(secretFile, "utf8").trim();
    if (v) return { key: v, source: "secrets/deepseek-api-key" };
  } catch {
  }
  const authFile = (0, import_node_path.join)((0, import_node_os.homedir)(), ".local", "share", "opencode", "auth.json");
  try {
    const auth = JSON.parse((0, import_node_fs.readFileSync)(authFile, "utf8"));
    const entry = auth.deepseek;
    if (entry && typeof entry.key === "string" && entry.key.trim()) {
      return { key: entry.key.trim(), source: "auth.json" };
    }
  } catch {
  }
  return { key: null, source: null };
}
function detectSchema(db) {
  try {
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('session_v2','session_message')`).all();
    if (tables.length === 2) {
      const count = db.prepare("SELECT COUNT(*) AS n FROM session_message").get();
      if (num(count?.n) > 0) return "v2";
    }
  } catch {
  }
  return "v1";
}
function rowToUsage(row) {
  const ts = num(row.ts);
  const tokens = {
    input: num(row.input),
    output: num(row.output),
    reasoning: num(row.reasoning),
    cacheRead: num(row.cache_read),
    cacheWrite: num(row.cache_write)
  };
  const model = row.model ? String(row.model) : "";
  return {
    id: String(row.id ?? ""),
    sid: String(row.sid ?? ""),
    ts,
    model,
    provider: row.provider ? String(row.provider) : null,
    tokens,
    cost: num(row.cost)
  };
}
function loadUsage(dbPath) {
  const db = new import_node_sqlite.DatabaseSync(dbPath, { readOnly: true });
  try {
    const schema = detectSchema(db);
    const data = {
      schema,
      dbPath,
      generatedAt: Date.now(),
      rows: [],
      byId: /* @__PURE__ */ new Map(),
      meta: /* @__PURE__ */ new Map(),
      children: /* @__PURE__ */ new Map()
    };
    if (schema === "v2") {
      const rows = db.prepare(
        `SELECT id,
                  session_id AS sid,
                  time_created AS ts,
                  json_extract(data,'$.model.id') AS model,
                  json_extract(data,'$.model.providerID') AS provider,
                  json_extract(data,'$.tokens.input') AS input,
                  json_extract(data,'$.tokens.output') AS output,
                  json_extract(data,'$.tokens.reasoning') AS reasoning,
                  json_extract(data,'$.tokens.cache.read') AS cache_read,
                  json_extract(data,'$.tokens.cache.write') AS cache_write,
                  json_extract(data,'$.cost') AS cost
           FROM session_message
           WHERE type = 'assistant'
             AND json_extract(data,'$.model.id') LIKE 'deepseek%'`
      ).all();
      for (const r of rows) {
        const row = rowToUsage(r);
        if (!row.id || !row.model) continue;
        data.rows.push(row);
        data.byId.set(row.id, row);
      }
      const sessions = db.prepare("SELECT id, parent_id AS parentId, title, time_created AS created FROM session_v2").all();
      for (const s of sessions) {
        data.meta.set(String(s.id), {
          parentId: s.parentId ? String(s.parentId) : null,
          title: String(s.title ?? ""),
          created: num(s.created)
        });
      }
    } else {
      const rows = db.prepare(
        `SELECT id,
                  session_id AS sid,
                  time_created AS ts,
                  json_extract(data,'$.modelID') AS model,
                  json_extract(data,'$.providerID') AS provider,
                  json_extract(data,'$.tokens.input') AS input,
                  json_extract(data,'$.tokens.output') AS output,
                  json_extract(data,'$.tokens.reasoning') AS reasoning,
                  json_extract(data,'$.tokens.cache.read') AS cache_read,
                  json_extract(data,'$.tokens.cache.write') AS cache_write,
                  json_extract(data,'$.cost') AS cost
           FROM message
           WHERE json_extract(data,'$.role') = 'assistant'
             AND json_extract(data,'$.modelID') LIKE 'deepseek%'`
      ).all();
      for (const r of rows) {
        const row = rowToUsage(r);
        if (!row.id || !row.model) continue;
        data.rows.push(row);
        data.byId.set(row.id, row);
      }
      const sessions = db.prepare("SELECT id, parent_id AS parentId, title, time_created AS created FROM session").all();
      for (const s of sessions) {
        data.meta.set(String(s.id), {
          parentId: s.parentId ? String(s.parentId) : null,
          title: String(s.title ?? ""),
          created: num(s.created)
        });
      }
    }
    for (const [id, m] of data.meta) {
      if (!m.parentId) continue;
      const list = data.children.get(m.parentId);
      if (list) list.push(id);
      else data.children.set(m.parentId, [id]);
    }
    data.rows.sort((a, b) => a.ts - b.ts);
    return data;
  } finally {
    db.close();
  }
}
function buildSnapshot(data) {
  const snapshot = {
    generatedAt: data.generatedAt,
    schema: data.schema,
    dbPath: data.dbPath,
    messageTotal: data.rows.length,
    firstTs: null,
    lastTs: null,
    totals: { requests: 0, tokens: emptyTokens(), cost: 0, official: 0, peakOfficial: 0, offOfficial: 0 },
    days: /* @__PURE__ */ new Map(),
    models: /* @__PURE__ */ new Map()
  };
  for (const row of data.rows) {
    const ts = row.ts;
    if (!ts) continue;
    const model = row.model;
    const tier = tierOf(model);
    const tokens = row.tokens;
    const cost = row.cost;
    const peak = isPeak(new Date(ts));
    const official = messageOfficialCost(tokens, tier, peak);
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
      day = { date: dk, requests: 0, tokens: emptyTokens(), cost: 0, official: 0, peakOfficial: 0, offOfficial: 0 };
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
      agg = { model, tier, requests: 0, tokens: emptyTokens(), cost: 0, official: 0, peakOfficial: 0, offOfficial: 0 };
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
function emptySide() {
  return { requests: 0, tokens: emptyTokens(), official: 0, cost: 0 };
}
function subtreeIds(data, sessionId) {
  const ids = /* @__PURE__ */ new Set([sessionId]);
  const queue = [sessionId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const child of data.children.get(current) ?? []) {
      if (!ids.has(child)) {
        ids.add(child);
        queue.push(child);
      }
    }
  }
  return ids;
}
function aggregateSession(data, sessionId) {
  const meta = data.meta.get(sessionId);
  if (!meta) return null;
  const ids = subtreeIds(data, sessionId);
  const agg = {
    id: sessionId,
    startedAt: meta.created,
    lastMessageAt: null,
    ...emptySide(),
    peakOfficial: 0,
    offOfficial: 0,
    main: emptySide(),
    children: emptySide()
  };
  for (const row of data.rows) {
    if (!ids.has(row.sid)) continue;
    const peak = row.ts ? isPeak(new Date(row.ts)) : false;
    const official = messageOfficialCost(row.tokens, tierOf(row.model), peak);
    const side = row.sid === sessionId ? agg.main : agg.children;
    agg.requests += 1;
    addTokens(agg.tokens, row.tokens);
    agg.cost += row.cost;
    agg.official += official;
    if (peak) agg.peakOfficial += official;
    else agg.offOfficial += official;
    if (row.ts && (agg.lastMessageAt === null || row.ts > agg.lastMessageAt)) agg.lastMessageAt = row.ts;
    side.requests += 1;
    addTokens(side.tokens, row.tokens);
    side.official += official;
    side.cost += row.cost;
  }
  return agg;
}
function sessionToCny(agg, fxRate) {
  return {
    ...agg,
    cost: agg.cost * fxRate,
    main: { ...agg.main, cost: agg.main.cost * fxRate },
    children: { ...agg.children, cost: agg.children.cost * fxRate }
  };
}
function rankSessions(data, days, limit) {
  const cutoff = Date.now() - days * 864e5;
  const roots = /* @__PURE__ */ new Map();
  for (const row of data.rows) {
    if (row.ts < cutoff) continue;
    let sid = row.sid;
    let parent = data.meta.get(sid)?.parentId ?? null;
    let guard = 0;
    while (parent && guard < 64) {
      sid = parent;
      parent = data.meta.get(sid)?.parentId ?? null;
      guard += 1;
    }
    const meta = data.meta.get(sid);
    const peak = isPeak(new Date(row.ts));
    const official = messageOfficialCost(row.tokens, tierOf(row.model), peak);
    let agg = roots.get(sid);
    if (!agg) {
      agg = {
        id: sid,
        title: meta?.title || sid,
        official: 0,
        cost: 0,
        requests: 0,
        tokens: emptyTokens(),
        startedAt: meta?.created ?? row.ts,
        lastMessageAt: 0
      };
      roots.set(sid, agg);
    }
    agg.requests += 1;
    addTokens(agg.tokens, row.tokens);
    agg.official += official;
    agg.cost += row.cost;
    if (row.ts > agg.lastMessageAt) agg.lastMessageAt = row.ts;
  }
  const sessions = [...roots.values()].sort((a, b) => b.official - a.official).slice(0, limit);
  return { sessions };
}
var usageCache = null;
var USAGE_TTL_MS = 3e4;
function getUsage() {
  const dbPath = findDb();
  if (!dbPath) return { error: "opencode.db not found" };
  if (usageCache && usageCache.data.dbPath === dbPath && Date.now() - usageCache.at < USAGE_TTL_MS) {
    return { data: usageCache.data, snapshot: usageCache.snapshot };
  }
  const data = loadUsage(dbPath);
  const snapshot = buildSnapshot(data);
  usageCache = { at: Date.now(), data, snapshot };
  return { data, snapshot };
}
function findMessageOnce(dbPath, id) {
  const db = new import_node_sqlite.DatabaseSync(dbPath, { readOnly: true });
  try {
    const schema = detectSchema(db);
    if (schema === "v2") {
      const row2 = db.prepare(
        `SELECT id,
                  session_id AS sid,
                  time_created AS ts,
                  json_extract(data,'$.model.id') AS model,
                  json_extract(data,'$.model.providerID') AS provider,
                  json_extract(data,'$.tokens.input') AS input,
                  json_extract(data,'$.tokens.output') AS output,
                  json_extract(data,'$.tokens.reasoning') AS reasoning,
                  json_extract(data,'$.tokens.cache.read') AS cache_read,
                  json_extract(data,'$.tokens.cache.write') AS cache_write,
                  json_extract(data,'$.cost') AS cost
           FROM session_message
           WHERE id = ? AND type = 'assistant'`
      ).get(id);
      if (!row2) return null;
      const parsed2 = rowToUsage(row2);
      return parsed2.model ? parsed2 : null;
    }
    const row = db.prepare(
      `SELECT id,
                session_id AS sid,
                time_created AS ts,
                json_extract(data,'$.modelID') AS model,
                json_extract(data,'$.providerID') AS provider,
                json_extract(data,'$.tokens.input') AS input,
                json_extract(data,'$.tokens.output') AS output,
                json_extract(data,'$.tokens.reasoning') AS reasoning,
                json_extract(data,'$.tokens.cache.read') AS cache_read,
                json_extract(data,'$.tokens.cache.write') AS cache_write,
                json_extract(data,'$.cost') AS cost
         FROM message
         WHERE id = ? AND json_extract(data,'$.role') = 'assistant'`
    ).get(id);
    if (!row) return null;
    const parsed = rowToUsage(row);
    return parsed.model ? parsed : null;
  } finally {
    db.close();
  }
}
function messageExists(dbPath, id) {
  const db = new import_node_sqlite.DatabaseSync(dbPath, { readOnly: true });
  try {
    const schema = detectSchema(db);
    const table = schema === "v2" ? "session_message" : "message";
    const row = db.prepare(`SELECT 1 AS ok FROM ${table} WHERE id = ?`).get(id);
    return Boolean(row);
  } finally {
    db.close();
  }
}
var balanceCache = null;
var BALANCE_TTL_MS = 6e4;
var FX_FALLBACK = 6.72;
var fxCache = null;
async function getFxRate() {
  if (fxCache && Date.now() - fxCache.at < (fxCache.source === "fallback" ? 36e5 : 12 * 36e5)) {
    return fxCache;
  }
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(1e4) });
    const body = await res.json();
    const rate = Number(body?.rates?.CNY);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("bad rates");
    fxCache = { at: Date.now(), rate, source: "open.er-api.com" };
  } catch {
    fxCache = { at: Date.now(), rate: FX_FALLBACK, source: "fallback" };
  }
  return fxCache;
}
async function getBalance() {
  const now = Date.now();
  if (balanceCache && now - balanceCache.at < BALANCE_TTL_MS) return balanceCache.data;
  const { key, source } = resolveApiKey();
  if (!key) {
    const data = { ok: false, reason: "no-key" };
    balanceCache = { at: now, data };
    return data;
  }
  try {
    const res = await fetch("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15e3)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const info = Array.isArray(body.balance_infos) && body.balance_infos.length > 0 ? body.balance_infos[0] : null;
    const data = {
      ok: true,
      source,
      isAvailable: Boolean(body.is_available),
      currency: info ? String(info.currency ?? "") : null,
      total: info ? String(info.total_balance ?? "") : null,
      granted: info ? String(info.granted_balance ?? "") : null,
      toppedUp: info ? String(info.topped_up_balance ?? "") : null,
      at: now
    };
    balanceCache = { at: now, data };
    return data;
  } catch (error) {
    const data = {
      ok: false,
      reason: "request-failed",
      message: error instanceof Error ? error.message : String(error),
      at: now
    };
    balanceCache = { at: now, data };
    return data;
  }
}
function serializeDays(snapshot, days, fxRate) {
  const out = [];
  const today = /* @__PURE__ */ new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const agg = snapshot.days.get(key);
    out.push(
      agg ? { ...agg, cost: agg.cost * fxRate } : { date: key, requests: 0, tokens: emptyTokens(), cost: 0, official: 0, peakOfficial: 0, offOfficial: 0 }
    );
  }
  return out;
}
async function buildSummary(days, sessionId) {
  const usage = getUsage();
  const now = Date.now();
  const phase = isPeak(new Date(now)) ? "peak" : "offpeak";
  const change = nextChange(now);
  const balance = await getBalance();
  const fx = await getFxRate();
  const fxInfo = { usdCny: Number(fx.rate.toFixed(4)), source: fx.source, at: fx.at };
  if ("error" in usage) {
    return {
      ok: false,
      generatedAt: now,
      error: usage.error,
      balance,
      fx: fxInfo,
      now: {
        utc: new Date(now).toISOString(),
        isPeak: phase === "peak",
        phase,
        nextChangeAt: change.at,
        nextPhase: change.phase
      },
      window: { utc: PEAK_WINDOW_UTC, local: PEAK_WINDOW_LOCAL },
      pricing: PRICING
    };
  }
  const { data, snapshot } = usage;
  const todayAgg = snapshot.days.get(localDate(now)) ?? null;
  const sessionAgg = sessionId ? aggregateSession(data, sessionId) : null;
  return {
    ok: true,
    generatedAt: now,
    now: {
      utc: new Date(now).toISOString(),
      local: new Date(now).toLocaleString("zh-CN", { hour12: false }),
      isPeak: phase === "peak",
      phase,
      nextChangeAt: change.at,
      nextPhase: change.phase
    },
    window: { utc: PEAK_WINDOW_UTC, local: PEAK_WINDOW_LOCAL },
    pricing: PRICING,
    balance,
    fx: fxInfo,
    session: sessionAgg ? sessionToCny(sessionAgg, fx.rate) : null,
    db: {
      path: snapshot.dbPath,
      schema: snapshot.schema,
      messages: snapshot.messageTotal,
      firstTs: snapshot.firstTs,
      lastTs: snapshot.lastTs,
      cachedAt: snapshot.generatedAt
    },
    totals: { ...snapshot.totals, cost: snapshot.totals.cost * fx.rate },
    today: todayAgg ? { ...todayAgg, cost: todayAgg.cost * fx.rate } : null,
    models: [...snapshot.models.values()].sort((a, b) => b.official - a.official || b.requests - a.requests).map((m) => ({ ...m, cost: m.cost * fx.rate })),
    days: serializeDays(snapshot, days, fx.rate),
    notes: ["\u5B98\u65B9\u4EF7\u6309\u4EBA\u6C11\u5E01\u4EF7\u76EE\u4E0E\u5CF0\u8C37\u65F6\u6BB5\u9010\u6761\u91CD\u7B97\uFF1B\u7F13\u5B58\u4E0D\u8BA1\u5199\u5165\u8D39\uFF1BOpenCode \u8BB0\u8D26\u6309 USD\u2192CNY \u6298\u7B97"]
  };
}
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
}
var server = (0, import_node_http.createServer)((req, res) => {
  const auth = req.headers.authorization || "";
  if (TOKEN && auth !== `Bearer ${TOKEN}`) {
    res.writeHead(401, { "content-type": "text/plain" });
    res.end("unauthorized");
    return;
  }
  const url = new URL(req.url || "/", "http://127.0.0.1");
  void (async () => {
    try {
      if (url.pathname === "/health") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
        return;
      }
      if (url.pathname === "/summary") {
        const days = Math.min(Math.max(Number(url.searchParams.get("days") || 30) || 30, 1), 365);
        const sessionRaw = url.searchParams.get("session") || "";
        const sessionId = /^[A-Za-z0-9_-]{1,80}$/.test(sessionRaw) ? sessionRaw : null;
        sendJson(res, 200, await buildSummary(days, sessionId));
        return;
      }
      if (url.pathname === "/message") {
        const id = (url.searchParams.get("id") || "").trim();
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) {
          sendJson(res, 400, { ok: false, error: "bad-id" });
          return;
        }
        const dbPath = findDb();
        if (!dbPath) {
          sendJson(res, 404, { ok: false, error: "db-not-found" });
          return;
        }
        const row = findMessageOnce(dbPath, id);
        if (!row) {
          sendJson(res, 404, { ok: false, error: messageExists(dbPath, id) ? "not-deepseek" : "not-found" });
          return;
        }
        const peak = row.ts ? isPeak(new Date(row.ts)) : false;
        const tier = tierOf(row.model);
        const official = messageOfficialCost(row.tokens, tier, peak);
        const fx = await getFxRate();
        sendJson(res, 200, {
          ok: true,
          id,
          sessionId: row.sid,
          ts: row.ts,
          model: row.model,
          provider: row.provider,
          tier,
          peak,
          tokens: row.tokens,
          official,
          cost: row.cost * fx.rate,
          fx: { usdCny: Number(fx.rate.toFixed(4)), source: fx.source }
        });
        return;
      }
      if (url.pathname === "/sessions") {
        const daysParam = Math.min(Math.max(Number(url.searchParams.get("days") || 30) || 30, 1), 365);
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 20) || 20, 1), 100);
        const usage = getUsage();
        if ("error" in usage) {
          sendJson(res, 404, { ok: false, error: usage.error });
          return;
        }
        const { sessions } = rankSessions(usage.data, daysParam, limit);
        const fx = await getFxRate();
        sendJson(res, 200, {
          ok: true,
          days: daysParam,
          sessions: sessions.map((s) => ({ ...s, cost: s.cost * fx.rate })),
          fx: { usdCny: Number(fx.rate.toFixed(4)), source: fx.source }
        });
        return;
      }
      if (url.pathname === "/balance") {
        sendJson(res, 200, await getBalance());
        return;
      }
      sendJson(res, 404, { error: "not-found" });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  })();
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`[deepseek-usage] service listening on 127.0.0.1:${PORT}`);
});
