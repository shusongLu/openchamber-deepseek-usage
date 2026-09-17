/**
 * DeepSeek 用量扩展 —— 面板（沙箱 iframe）
 *
 * 数据来自本扩展的本地 service（/summary）：
 *  - 余额：DeepSeek 官方 /user/balance（service 读本机 key）
 *  - 用量：本机 opencode.db 中所有 DeepSeek 消息，按峰谷价重算
 */
import { connectHost } from '@openchamber/sdk';
import { applyHostReady, mountBanner, mountButton, mountEmpty, mountTabs } from '@openchamber/sdk/ui';

// ---------------------------------------------------------------- 类型

interface Tokens {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

interface DayAgg {
  date: string;
  requests: number;
  tokens: Tokens;
  cost: number;
  official: number;
  peakOfficial: number;
  offOfficial: number;
}

interface ModelAgg extends DayAgg {
  model: string;
  tier: 'flash' | 'pro' | null;
}

interface SessionSide {
  requests: number;
  tokens: Tokens;
  official: number;
  cost: number;
}

interface SessionAgg extends SessionSide {
  id: string;
  peakOfficial: number;
  offOfficial: number;
  main: SessionSide;
  children: SessionSide;
}

interface Balance {
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

interface Summary {
  ok: boolean;
  generatedAt: number;
  error?: string;
  now: {
    utc: string;
    local?: string;
    isPeak: boolean;
    phase: 'peak' | 'offpeak';
    nextChangeAt: number;
    nextPhase: 'peak' | 'offpeak';
  };
  window: { utc: string; local: string };
  pricing: Record<'flash' | 'pro', Record<string, number>>;
  balance: Balance;
  fx?: { usdCny: number; source: string; at: number };
  session?: SessionAgg | null;
  db?: { path: string; messages: number; firstTs: number | null; lastTs: number | null; cachedAt: number };
  totals?: { requests: number; tokens: Tokens; cost: number; official: number };
  today?: DayAgg | null;
  models?: ModelAgg[];
  days?: DayAgg[];
  notes?: string[];
}

// ---------------------------------------------------------------- 环境

const MOCK = new URLSearchParams(location.search).has('mock');
const host = connectHost();
const root = document.querySelector('#root') as HTMLElement;
const days = 30;

let mounted = false;
let loading = false;
let lastSummary: Summary | null = null;
let activeTab = '7d';
let countdownTarget: number | null = null;
let currentSessionId: string | null = null;

// ---------------------------------------------------------------- 骨架

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const wrap = el('div', 'wrap');
const head = el('div', 'head');
const title = el('div', 'title', 'DeepSeek 用量');
const headRight = el('div', 'row');
const updated = el('div', 'small muted');
const refreshSlot = el('div');
const bannerSlot = el('div');
const countdownEl = el('div', 'small muted');
const cards = el('div', 'cards');
const sessionCard = el('div', 'card wide');
const sessionK = el('div', 'k', '当前会话');
const sessionV = el('div', 'v', '—');
const sessionS = el('div', 'sub');
const balCard = el('div', 'card');
const balK = el('div', 'k', '余额');
const balV = el('div', 'v', '—');
const balS = el('div', 'sub');
const todayCard = el('div', 'card');
const todayK = el('div', 'k', '今日费用（官方价）');
const todayV = el('div', 'v', '—');
const todayS = el('div', 'sub');
const tabsSlot = el('div');
const stats = el('div', 'grid');
const daysSection = el('div', 'section', '按日');
const daysList = el('div', 'days');
const modelsSection = el('div', 'section', '按模型');
const modelsList = el('div', 'days');
const pricing = el('details', 'pricing');
const pricingSummary = el('summary', undefined, '谷峰价目（元 / 1M tokens）');
const pricingBody = el('div');
const foot = el('div', 'foot small muted');

balCard.append(balK, balV, balS);
todayCard.append(todayK, todayV, todayS);
sessionCard.append(sessionK, sessionV, sessionS);
cards.append(sessionCard, balCard, todayCard);
headRight.append(updated, refreshSlot);
head.append(title, headRight);
pricing.append(pricingSummary, pricingBody);
wrap.append(head, bannerSlot, countdownEl, cards, tabsSlot, stats, daysSection, daysList, modelsSection, modelsList, pricing, foot);
root.append(wrap);

let bannerHandle: ReturnType<typeof mountBanner> | null = null;
let tabsHandle: ReturnType<typeof mountTabs> | null = null;

// ---------------------------------------------------------------- 格式化

const totalTokens = (t: Tokens): number => t.input + t.output + t.reasoning + t.cacheRead + t.cacheWrite;

function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function fmtCny(n: number): string {
  if (n >= 100) return `¥${n.toFixed(1)}`;
  if (n >= 1) return `¥${n.toFixed(2)}`;
  return `¥${n.toFixed(3)}`;
}

const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US');

function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

const symbolOf = (currency?: string | null): string =>
  currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : currency ? `${currency} ` : '';

function localDateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------------------------------------------------------------- 数据

async function loadData(): Promise<Summary> {
  if (MOCK) return mockSummary();
  const query: Record<string, string> = { days: String(days) };
  if (currentSessionId) query.session = currentSessionId;
  const res = await host.serviceRequest({ method: 'GET', path: '/summary', query });
  return JSON.parse(res.body) as Summary;
}

function sumDays(list: DayAgg[]): {
  requests: number;
  tokens: Tokens;
  cost: number;
  official: number;
  peak: number;
  off: number;
} {
  const tokens: Tokens = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  let requests = 0;
  let cost = 0;
  let official = 0;
  let peak = 0;
  let off = 0;
  for (const d of list) {
    requests += d.requests;
    tokens.input += d.tokens.input;
    tokens.output += d.tokens.output;
    tokens.reasoning += d.tokens.reasoning;
    tokens.cacheRead += d.tokens.cacheRead;
    tokens.cacheWrite += d.tokens.cacheWrite;
    cost += d.cost;
    official += d.official;
    peak += d.peakOfficial;
    off += d.offOfficial;
  }
  return { requests, tokens, cost, official, peak, off };
}

function windowDays(s: Summary): DayAgg[] {
  const all = s.days ?? [];
  if (activeTab === 'today') return all.slice(-1);
  if (activeTab === '7d') return all.slice(-7);
  return all;
}

// ---------------------------------------------------------------- 渲染

function statCell(label: string, value: string): HTMLElement {
  const box = el('div', 'stat');
  box.append(el('div', 'v', value), el('div', 'k', label));
  return box;
}

function renderBanner(s: Summary): void {
  const peak = s.now.isPeak;
  const body =
    s.ok === false
      ? `用量数据不可用：${s.error ?? '未知错误'}`
      : `峰时窗口：${s.window.local}；其余时间为谷时（半价）`;
  if (!bannerHandle) {
    bannerHandle = mountBanner(bannerSlot, {
      tone: peak ? 'warning' : 'success',
      title: peak ? '当前：峰时（标准价）' : '当前：谷时（半价）',
      body,
    });
    return;
  }
  bannerHandle.update({
    tone: peak ? 'warning' : 'success',
    title: peak ? '当前：峰时（标准价）' : '当前：谷时（半价）',
    body,
  });
}

function renderBalance(s: Summary): void {
  const b = s.balance;
  if (b?.ok) {
    const sym = symbolOf(b.currency);
    balV.textContent = `${sym}${b.total ?? '—'}`;
    balS.textContent =
      `充值 ${sym}${b.toppedUp ?? '—'} · 赠送 ${sym}${b.granted ?? '—'}` +
      (b.isAvailable === false ? ' · 余额不足' : '') +
      (b.source ? ` · key: ${b.source}` : '');
    return;
  }
  balV.textContent = '—';
  balS.textContent =
    b?.reason === 'no-key'
      ? '未找到本机 DeepSeek key（secrets / auth.json）'
      : b?.message
        ? `余额查询失败：${b.message}`
        : '余额不可用';
}

function renderStats(s: Summary): void {
  const list = windowDays(s);
  const agg = sumDays(list);
  stats.replaceChildren(
    statCell('请求数', fmtInt(agg.requests)),
    statCell('输入（未命中）', fmtTokens(agg.tokens.input)),
    statCell('缓存命中', fmtTokens(agg.tokens.cacheRead)),
    statCell('输出（含推理）', fmtTokens(agg.tokens.output + agg.tokens.reasoning)),
    statCell('官方价估算', fmtCny(agg.official)),
    statCell('其中峰时', fmtCny(agg.peak)),
    statCell('其中谷时', fmtCny(agg.off)),
    statCell('OpenCode 记账', fmtCny(agg.cost)),
  );

  const today = s.today ?? null;
  if (today) {
    todayV.textContent = fmtCny(today.official);
    todayS.textContent = `${fmtInt(today.requests)} 次 · ${fmtTokens(totalTokens(today.tokens))} tokens`;
  } else {
    todayV.textContent = '¥0.000';
    todayS.textContent = '今日暂无调用';
  }
}

function renderDays(s: Summary): void {
  const list = (s.days ?? []).slice(-14);
  const max = Math.max(1e-9, ...list.map((d) => d.official));
  const todayKey = localDateStr(new Date());
  daysList.replaceChildren(
    ...list.map((d) => {
      const row = el('div', `day${d.date === todayKey ? ' today' : ''}`);
      const track = el('div', 'bar-track');
      const bar = el('div', 'bar');
      bar.style.width = `${Math.max(2, Math.round((d.official / max) * 100))}%`;
      track.append(bar);
      row.append(
        el('div', 'small muted', d.date.slice(5)),
        track,
        el('div', 'val', `${fmtCny(d.official)} · ${fmtTokens(totalTokens(d.tokens))}`),
      );
      return row;
    }),
  );
}

function renderModels(s: Summary): void {
  const list = (s.models ?? []).slice(0, 8);
  if (list.length === 0) {
    modelsList.replaceChildren(el('div', 'small muted', '暂无数据'));
    return;
  }
  modelsList.replaceChildren(
    ...list.map((m) => {
      const row = el('div', 'day');
      row.append(
        el('div', 'small', m.model.replace(/^deepseek-/, '')),
        el('div', 'small muted', m.tier ? `${m.tier} · ${fmtInt(m.requests)} 次` : `${fmtInt(m.requests)} 次`),
        el('div', 'val', fmtCny(m.official)),
      );
      return row;
    }),
  );
}

function renderPricing(s: Summary): void {
  if (pricingBody.childElementCount > 0) return;
  const table = el('table');
  const thead = el('thead');
  const hr = el('tr');
  ['档位', '缓存命中', '缓存未命中', '输出'].forEach((t) => hr.append(el('th', undefined, t)));
  thead.append(hr);
  const tbody = el('tbody');
  (['flash', 'pro'] as const).forEach((tier) => {
    const p = s.pricing?.[tier];
    if (!p) return;
    const tr = el('tr');
    tr.append(
      el('td', undefined, tier === 'flash' ? 'flash' : 'v4-pro'),
      el('td', undefined, `¥${p.hitOff} / ¥${p.hitPeak}`),
      el('td', undefined, `¥${p.missOff} / ¥${p.missPeak}`),
      el('td', undefined, `¥${p.outOff} / ¥${p.outPeak}`),
    );
    tbody.append(tr);
  });
  table.append(thead, tbody);
  pricingBody.append(el('div', 'small muted', '格式：谷时 / 峰时；输出含推理 tokens'), table);
}

function renderFooter(s: Summary): void {
  const bits: string[] = [];
  if (s.db) {
    bits.push(`opencode.db · ${fmtInt(s.db.messages)} 条消息`);
  }
  if (s.totals) {
    bits.push(`累计 ${fmtTokens(totalTokens(s.totals.tokens))} tokens · ${fmtCny(s.totals.official)}`);
  }
  bits.push(`采样 ${new Date(s.generatedAt).toLocaleTimeString('zh-CN', { hour12: false })}`);
  if (s.fx) {
    bits.push(`OpenCode 记账按汇率 1 USD = ¥${s.fx.usdCny} 折算（${s.fx.source}）`);
  }
  foot.replaceChildren(el('div', undefined, bits.join(' · ')));
  if (s.notes && s.notes.length > 0) foot.append(el('div', undefined, s.notes.join('；')));
}

function renderSession(s: Summary): void {
  const sess = s.session ?? null;
  if (!sess) {
    sessionV.textContent = '—';
    sessionS.textContent = '未在会话中';
    return;
  }
  if (sess.requests === 0) {
    sessionV.textContent = '¥0';
    sessionS.textContent = '本会话暂无 DeepSeek 调用';
    return;
  }
  sessionV.textContent = fmtCny(sess.official);
  sessionS.textContent =
    `主会话 ${fmtCny(sess.main.official)} · 子代理 ${fmtCny(sess.children.official)} · ` +
    `${fmtInt(sess.requests)} 次 · ${fmtTokens(totalTokens(sess.tokens))} tokens`;
}

function renderAll(s: Summary): void {
  lastSummary = s;
  countdownTarget = s.now?.nextChangeAt ?? null;
  renderBanner(s);
  renderSession(s);
  renderBalance(s);
  renderStats(s);
  renderDays(s);
  renderModels(s);
  renderPricing(s);
  renderFooter(s);
  updated.textContent = `更新于 ${new Date(s.generatedAt).toLocaleTimeString('zh-CN', { hour12: false })}`;
}

function renderError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  bannerHandle?.dispose();
  bannerHandle = mountBanner(bannerSlot, {
    tone: 'error',
    title: '本地服务不可用',
    body: `${message}。请确认扩展已允许本地服务，然后重试。`,
    action: { label: '重试', onClick: () => void refresh() },
  });
}

// ---------------------------------------------------------------- 刷新

async function refresh(): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    const summary = await loadData();
    renderAll(summary);
  } catch (error) {
    renderError(error);
  } finally {
    loading = false;
  }
}

function renderTabs(): void {
  const items = [
    { id: 'today', label: '今日' },
    { id: '7d', label: '近 7 天' },
    { id: '30d', label: '近 30 天' },
  ];
  if (!tabsHandle) {
    tabsHandle = mountTabs(tabsSlot, {
      items,
      activeId: activeTab,
      onChange: (next: string) => {
        activeTab = next;
        tabsHandle?.update({ activeId: next });
        if (lastSummary) renderStats(lastSummary);
      },
    });
    return;
  }
  tabsHandle.update({ items, activeId: activeTab });
}

function boot(): void {
  renderTabs();
  mountButton(refreshSlot, {
    label: '刷新',
    size: 'xs',
    variant: 'outline',
    onClick: () => void refresh(),
  });
  void refresh();
  setInterval(() => {
    if (document.hidden) return;
    void refresh();
  }, 60_000);
  setInterval(() => {
    if (countdownTarget) {
      const to = lastSummary?.now.nextPhase === 'peak' ? '峰时' : '谷时';
      countdownEl.textContent = `距切换 ${countdown(countdownTarget - Date.now())} → ${to}`;
    }
  }, 1_000);
}

if (MOCK) {
  // 预览模式：宿主外没有主题变量，显式注入一套配色
  const dark = new URLSearchParams(location.search).get('theme') !== 'light';
  const html = document.documentElement;
  html.style.colorScheme = dark ? 'dark' : 'light';
  html.style.background = dark ? '#15171c' : '#ffffff';
  html.style.color = dark ? '#e8e8ea' : '#1b1b1f';
  html.style.minHeight = '100vh';
  boot();
} else {
  host.onReady((ctx) => {
    applyHostReady(ctx, document.documentElement);
    const sid = ctx.session?.id ?? null;
    if (sid !== currentSessionId) {
      currentSessionId = sid;
      if (mounted) void refresh();
    }
    if (mounted) return;
    mounted = true;
    boot();
  });
  host.onSession((snapshot) => {
    const sid = snapshot?.id ?? null;
    if (sid === currentSessionId) return;
    currentSessionId = sid;
    if (mounted) void refresh();
  });
  setTimeout(() => {
    if (!mounted) {
      mountEmpty(root, {
        title: '未连接到 OpenChamber',
        body: '请在 OpenChamber 的扩展面板中打开此页面；开发预览可加 ?mock=1。',
      });
    }
  }, 1_500);
}

// ---------------------------------------------------------------- 预览数据

function mockSummary(): Summary {
  const now = Date.now();
  const days: DayAgg[] = [];
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const factor = 0.35 + ((i * 37) % 100) / 130;
    const input = Math.round(180_000 * factor);
    const output = Math.round(45_000 * factor);
    const reasoning = Math.round(output * 0.4);
    const cacheRead = Math.round(9_000_000 * factor);
    const tokens: Tokens = { input, output, reasoning, cacheRead, cacheWrite: 0 };
    const official = (input * 1 + cacheRead * 0.02 + (output + reasoning) * 4) / 1e6;
    days.push({
      date: localDateStr(d),
      requests: Math.round(14 * factor),
      tokens,
      cost: official * 0.92,
      official,
      peakOfficial: official * 0.55,
      offOfficial: official * 0.45,
    });
  }
  const totals = sumDays(days);
  const isPeakUtc = (date: Date): boolean => {
    const day = date.getUTCDay();
    if (day === 0 || day === 6) return false;
    const h = date.getUTCHours();
    return (h >= 1 && h < 4) || (h >= 6 && h < 10);
  };
  const peak = isPeakUtc(new Date(now));
  const next = new Date(now);
  const cur = peak;
  while (isPeakUtc(next) === cur) next.setMinutes(next.getMinutes() + 1);
  return {
    ok: true,
    generatedAt: now,
    now: {
      utc: new Date(now).toISOString(),
      isPeak: peak,
      phase: peak ? 'peak' : 'offpeak',
      nextChangeAt: next.getTime(),
      nextPhase: cur ? 'offpeak' : 'peak',
    },
    window: { utc: '周一至周五 01:00–04:00、06:00–10:00 UTC', local: '北京时间 09:00–12:00、14:00–18:00' },
    pricing: {
      flash: { hitOff: 0.02, hitPeak: 0.04, missOff: 1, missPeak: 2, outOff: 4, outPeak: 8 },
      pro: { hitOff: 0.15, hitPeak: 0.3, missOff: 4.5, missPeak: 9, outOff: 13.5, outPeak: 27 },
    },
    fx: { usdCny: 6.7223, source: 'open.er-api.com', at: now },
    balance: {
      ok: true,
      source: 'auth.json',
      isAvailable: true,
      currency: 'CNY',
      total: '263.85',
      granted: '0.00',
      toppedUp: '263.85',
      at: now,
    },
    session: {
      id: 'ses_mock',
      requests: 38,
      tokens: { input: 20_700, output: 7_000, reasoning: 2_400, cacheRead: 2_000_000, cacheWrite: 0 },
      official: 4.1,
      cost: 3.0,
      peakOfficial: 1.9,
      offOfficial: 2.2,
      main: {
        requests: 22,
        tokens: { input: 12_300, output: 4_100, reasoning: 1_500, cacheRead: 1_200_000, cacheWrite: 0 },
        official: 2.86,
        cost: 2.1,
      },
      children: {
        requests: 16,
        tokens: { input: 8_400, output: 2_900, reasoning: 900, cacheRead: 800_000, cacheWrite: 0 },
        official: 1.24,
        cost: 0.9,
      },
    },
    db: { path: '~/.local/share/opencode/opencode.db', messages: 16970, firstTs: now - 86400000 * 30, lastTs: now, cachedAt: now },
    totals: { requests: totals.requests, tokens: totals.tokens, cost: totals.cost, official: totals.official },
    today: days[days.length - 1] ?? null,
    models: [
      { model: 'deepseek-flash', tier: 'flash', requests: 144, tokens: totals.tokens, cost: totals.cost * 0.7, official: totals.official * 0.7, peakOfficial: 0, offOfficial: 0, date: '' },
      { model: 'deepseek-v4-pro', tier: 'pro', requests: 13, tokens: totals.tokens, cost: totals.cost * 0.3, official: totals.official * 0.3, peakOfficial: 0, offOfficial: 0, date: '' },
    ],
    days,
    notes: ['官方价按人民币价目与峰谷时段逐条重算；缓存写入不计费；OpenCode 记账按 USD→CNY 折算'],
  };
}
