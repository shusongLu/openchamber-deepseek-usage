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
function messageOfficialCost(tokens, tier, peak) {
  if (!tier) return 0;
  const p = PRICING[tier];
  const hit = peak ? p.hitPeak : p.hitOff;
  const miss = peak ? p.missPeak : p.missOff;
  const out = peak ? p.outPeak : p.outOff;
  return (tokens.input * miss + tokens.cacheRead * hit + (tokens.output + tokens.reasoning) * out) / 1e6;
}
function aggregate(dbPath) {
  const db = new import_node_sqlite.DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare(
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
         AND json_extract(data,'$.modelID') LIKE 'deepseek%'`
  ).all();
  db.close();
  const snapshot = {
    generatedAt: Date.now(),
    dbPath,
    messageTotal: rows.length,
    firstTs: null,
    lastTs: null,
    totals: { requests: 0, tokens: emptyTokens(), cost: 0, official: 0, peakOfficial: 0, offOfficial: 0 },
    days: /* @__PURE__ */ new Map(),
    models: /* @__PURE__ */ new Map()
  };
  for (const row of rows) {
    const ts = num(row.ts);
    if (!ts) continue;
    const model = String(row.model ?? "deepseek-\u672A\u77E5");
    const tier = tierOf(model);
    const tokens = {
      input: num(row.input),
      output: num(row.output),
      reasoning: num(row.reasoning),
      cacheRead: num(row.cache_read),
      cacheWrite: num(row.cache_write)
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
        offOfficial: 0
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
        offOfficial: 0
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
function emptySide() {
  return { requests: 0, tokens: emptyTokens(), official: 0, cost: 0 };
}
function aggregateSession(dbPath, sessionId) {
  const db = new import_node_sqlite.DatabaseSync(dbPath, { readOnly: true });
  try {
    const exists = db.prepare("SELECT 1 AS ok FROM session WHERE id = ?").get(sessionId);
    if (!exists) return null;
    const rows = db.prepare(
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
           AND json_extract(m.data,'$.role') = 'assistant'`
    ).all(sessionId);
    const agg = {
      id: sessionId,
      ...emptySide(),
      peakOfficial: 0,
      offOfficial: 0,
      main: emptySide(),
      children: emptySide()
    };
    for (const row of rows) {
      const ts = num(row.ts);
      const peak = ts ? isPeak(new Date(ts)) : false;
      const tokens = {
        input: num(row.input),
        output: num(row.output),
        reasoning: num(row.reasoning),
        cacheRead: num(row.cache_read),
        cacheWrite: num(row.cache_write)
      };
      const cost = num(row.cost);
      const official = messageOfficialCost(tokens, tierOf(String(row.model ?? "")), peak);
      const side = String(row.sid) === sessionId ? agg.main : agg.children;
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
function sessionToCny(agg, fxRate) {
  return {
    ...agg,
    cost: agg.cost * fxRate,
    main: { ...agg.main, cost: agg.main.cost * fxRate },
    children: { ...agg.children, cost: agg.children.cost * fxRate }
  };
}
var usageCache = null;
var USAGE_TTL_MS = 3e4;
function getUsage() {
  const dbPath = findDb();
  if (!dbPath) return { dbPath: null, error: "opencode.db not found" };
  if (usageCache && usageCache.snapshot.dbPath === dbPath && Date.now() - usageCache.at < USAGE_TTL_MS) {
    return usageCache.snapshot;
  }
  const snapshot = aggregate(dbPath);
  usageCache = { at: Date.now(), snapshot };
  return snapshot;
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
      agg ? { ...agg, cost: agg.cost * fxRate } : {
        date: key,
        requests: 0,
        tokens: emptyTokens(),
        cost: 0,
        official: 0,
        peakOfficial: 0,
        offOfficial: 0
      }
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
  const snapshot = usage;
  const todayAgg = snapshot.days.get(localDate(now)) ?? null;
  const sessionAgg = sessionId ? aggregateSession(snapshot.dbPath, sessionId) : null;
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
      messages: snapshot.messageTotal,
      firstTs: snapshot.firstTs,
      lastTs: snapshot.lastTs,
      cachedAt: snapshot.generatedAt
    },
    totals: { ...snapshot.totals, cost: snapshot.totals.cost * fx.rate },
    today: todayAgg ? { ...todayAgg, cost: todayAgg.cost * fx.rate } : null,
    models: [...snapshot.models.values()].sort((a, b) => b.official - a.official || b.requests - a.requests).map((m) => ({ ...m, cost: m.cost * fx.rate })),
    days: serializeDays(snapshot, days, fx.rate),
    notes: ["\u5B98\u65B9\u4EF7\u6309\u4EBA\u6C11\u5E01\u4EF7\u76EE\u4E0E\u5CF0\u8C37\u65F6\u6BB5\u9010\u6761\u91CD\u7B97\uFF1B\u7F13\u5B58\u5199\u5165\u4E0D\u8BA1\u8D39\uFF1BOpenCode \u8BB0\u8D26\u6309 USD\u2192CNY \u6298\u7B97"]
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
