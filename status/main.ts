/**
 * DeepSeek 用量扩展 —— Work Status 区块（聊天右侧状态卡里的一节）
 *
 * 数据来自本扩展的本地 service（/summary）：
 *  - 本会话：当前会话（含子代理）的官方价估算
 *  - 今日：本机 opencode.db 中今日全部 DeepSeek 调用
 *  - 余额：DeepSeek 官方 /user/balance（service 读本机 key）
 *
 * 这一节只做"一眼看数"：三行读数 + 峰谷状态，不做图表（那是面板和看板的事）。
 * 帧高度由宿主按 setHeight 调整，上限 320px，所以内容要能纵向省略。
 *
 * 语言跟随宿主（HostReadyContext.locale），zh-* → 中文，其余 → English。
 * 预览：node tools/preview.mjs 后打开 /status/index.html?mock=1（可加 &lang=zh|en）
 */
import { connectHost } from '@openchamber/sdk';
import { applyHostReady, mountBadge, mountBanner, mountButton, mountEmpty } from '@openchamber/sdk/ui';

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
  official: number;
}

interface SessionSide {
  requests: number;
  official: number;
}

interface SessionAgg {
  requests: number;
  official: number;
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
  reason?: string;
  message?: string;
}

interface Summary {
  ok: boolean;
  generatedAt: number;
  error?: string;
  now: {
    isPeak: boolean;
    phase: 'peak' | 'offpeak';
    nextChangeAt: number;
    nextPhase: 'peak' | 'offpeak';
  };
  balance: Balance;
  session?: SessionAgg | null;
  today?: DayAgg | null;
}

// ---------------------------------------------------------------- 语言

type Lang = 'zh' | 'en';

const L = {
  zh: {
    session: '本会话',
    sessionNone: '未在会话中',
    sessionEmpty: '本会话暂无 DeepSeek 调用',
    sessionSub: (main: string, children: string, calls: string) => `主 ${main} · 子代理 ${children} · ${calls} 次`,
    today: '今日',
    todayNone: '今日暂无调用',
    todaySub: (calls: string, tokens: string) => `${calls} 次 · ${tokens} tokens`,
    balance: '余额',
    balanceSub: (top: string, granted: string) => `充值 ${top} · 赠送 ${granted}`,
    lowBalance: '余额不足',
    noKey: '未找到本机 DeepSeek key',
    balanceFailed: (msg: string) => `余额查询失败：${msg}`,
    balanceUnavailable: '余额不可用',
    peak: '峰时',
    offpeak: '谷时',
    countdown: (time: string, next: string) => `距切换 ${time} → ${next}`,
    peakStopped: '峰时（标准价）',
    refresh: '刷新',
    serviceDown: '本地服务不可用',
    serviceDownBody: (msg: string) => `${msg}。请确认扩展已允许本地服务，然后重试。`,
    retry: '重试',
    notConnected: '未连接到 OpenChamber',
    notConnectedBody: '请在 OpenChamber 里打开此扩展；开发预览可加 ?mock=1。',
  },
  en: {
    session: 'Session',
    sessionNone: 'No session open',
    sessionEmpty: 'No DeepSeek calls in this session yet',
    sessionSub: (main: string, children: string, calls: string) => `main ${main} · subagents ${children} · ${calls} calls`,
    today: 'Today',
    todayNone: 'No calls today',
    todaySub: (calls: string, tokens: string) => `${calls} calls · ${tokens} tokens`,
    balance: 'Balance',
    balanceSub: (top: string, granted: string) => `topped-up ${top} · granted ${granted}`,
    lowBalance: 'insufficient balance',
    noKey: 'No local DeepSeek key found',
    balanceFailed: (msg: string) => `Balance request failed: ${msg}`,
    balanceUnavailable: 'Balance unavailable',
    peak: 'peak',
    offpeak: 'off-peak',
    countdown: (time: string, next: string) => `switches in ${time} → ${next}`,
    peakStopped: 'peak hours (standard price)',
    refresh: 'Refresh',
    serviceDown: 'Local service unavailable',
    serviceDownBody: (msg: string) => `${msg} Check that the extension is allowed to run its local service, then retry.`,
    retry: 'Retry',
    notConnected: 'Not connected to OpenChamber',
    notConnectedBody: 'Open this extension inside OpenChamber. For a dev preview add ?mock=1.',
  },
} as const;

const params = new URLSearchParams(location.search);
const MOCK = params.has('mock');

function detectLang(locale?: string | null): Lang {
  return locale && locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

let lang: Lang = detectLang(MOCK ? params.get('lang') ?? navigator.language : navigator.language);
const T = () => L[lang];

// ---------------------------------------------------------------- 环境

const host = connectHost();
const root = document.querySelector('#root') as HTMLElement;
const days = 30;

let mounted = false;
let loading = false;
let lastSummary: Summary | null = null;
let countdownTarget: number | null = null;
let currentSessionId: string | null = null;
let statusControlsSupported = false;

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

interface Row {
  row: HTMLElement;
  k: HTMLElement;
  v: HTMLElement;
  s: HTMLElement;
}

function makeRow(label: string): Row {
  const row = el('div', 'row');
  const k = el('div', 'k', label);
  const v = el('div', 'v', '—');
  const s = el('div', 's');
  row.append(k, v, s);
  return { row, k, v, s };
}

const wrap = el('div', 'wrap');
const bannerSlot = el('div', 'banner-slot');
const rowsSlot = el('div', 'wrap');
const sessionRow = makeRow(T().session);
const todayRow = makeRow(T().today);
const balanceRow = makeRow(T().balance);
const phaseRow = el('div', 'phase');
const phaseBadgeSlot = el('span');
const phaseText = el('span', 'phase-text');
const fallbackRefreshSlot = el('div', 'phase');
phaseRow.append(phaseBadgeSlot, phaseText);
rowsSlot.append(sessionRow.row, todayRow.row, balanceRow.row, phaseRow);
wrap.append(bannerSlot, rowsSlot, fallbackRefreshSlot);
root.append(wrap);

let badgeHandle: ReturnType<typeof mountBadge> | null = null;
let bannerHandle: ReturnType<typeof mountBanner> | null = null;
let fallbackRefresh: ReturnType<typeof mountButton> | null = null;

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

// ---------------------------------------------------------------- 数据

async function loadData(): Promise<Summary> {
  if (MOCK) return mockSummary();
  const query: Record<string, string> = { days: String(days) };
  if (currentSessionId) query.session = currentSessionId;
  const res = await host.serviceRequest({ method: 'GET', path: '/summary', query });
  return JSON.parse(res.body) as Summary;
}

// ---------------------------------------------------------------- 渲染

function setValue(row: Row, value: string, sub: string, low = false): void {
  row.v.textContent = value;
  row.v.classList.toggle('val-low', low);
  row.s.textContent = sub;
}

function renderSession(s: Summary): void {
  const t = T();
  const sess = s.session ?? null;
  if (!sess) {
    setValue(sessionRow, '—', t.sessionNone);
    return;
  }
  if (sess.requests === 0) {
    setValue(sessionRow, '¥0', t.sessionEmpty);
    return;
  }
  setValue(
    sessionRow,
    fmtCny(sess.official),
    t.sessionSub(fmtCny(sess.main.official), fmtCny(sess.children.official), fmtInt(sess.requests)),
  );
}

function renderToday(s: Summary): void {
  const t = T();
  const today = s.today ?? null;
  if (!today) {
    setValue(todayRow, '¥0', t.todayNone);
    return;
  }
  setValue(todayRow, fmtCny(today.official), t.todaySub(fmtInt(today.requests), fmtTokens(totalTokens(today.tokens))));
}

function renderBalance(s: Summary): void {
  const t = T();
  const b = s.balance;
  if (b?.ok) {
    const sym = symbolOf(b.currency);
    const low = b.isAvailable === false;
    setValue(
      balanceRow,
      `${sym}${b.total ?? '—'}`,
      t.balanceSub(`${sym}${b.toppedUp ?? '—'}`, `${sym}${b.granted ?? '—'}`) + (low ? ` · ${t.lowBalance}` : ''),
      low,
    );
    return;
  }
  setValue(balanceRow, '—', b?.reason === 'no-key' ? t.noKey : b?.message ? t.balanceFailed(b.message) : t.balanceUnavailable);
}

function renderPhase(): void {
  const t = T();
  const peak = lastSummary?.now.isPeak ?? false;
  if (!badgeHandle) {
    badgeHandle = mountBadge(phaseBadgeSlot, { label: peak ? t.peak : t.offpeak, tone: peak ? 'warning' : 'success' });
  } else {
    badgeHandle.update({ label: peak ? t.peak : t.offpeak, tone: peak ? 'warning' : 'success' });
  }
  tickCountdown();
}

function tickCountdown(): void {
  if (!countdownTarget) {
    phaseText.textContent = T().peakStopped;
    return;
  }
  const t = T();
  const next = lastSummary?.now.nextPhase === 'peak' ? t.peak : t.offpeak;
  phaseText.textContent = t.countdown(countdown(countdownTarget - Date.now()), next);
}

function syncHeight(): void {
  if (MOCK) return;
  const h = Math.ceil(wrap.getBoundingClientRect().height) + 14; // body 上下内边距
  void host.setHeight(h);
}

function renderAll(s: Summary): void {
  lastSummary = s;
  countdownTarget = s.now?.nextChangeAt ?? null;
  bannerHandle?.dispose();
  bannerHandle = null;
  bannerSlot.replaceChildren();
  renderSession(s);
  renderToday(s);
  renderBalance(s);
  renderPhase();
  requestAnimationFrame(syncHeight);
}

function renderError(error: unknown): void {
  const t = T();
  const message = error instanceof Error ? error.message : String(error);
  bannerHandle?.dispose();
  bannerHandle = mountBanner(bannerSlot, {
    tone: 'error',
    title: t.serviceDown,
    body: t.serviceDownBody(message),
    action: { label: t.retry, onClick: () => void refresh() },
  });
  rowsSlot.style.display = 'none';
  requestAnimationFrame(syncHeight);
}

// ---------------------------------------------------------------- 刷新

async function refresh(): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    const summary = await loadData();
    rowsSlot.style.display = '';
    renderAll(summary);
  } catch (error) {
    renderError(error);
  } finally {
    loading = false;
  }
}

// ---------------------------------------------------------------- 宿主表头控件

/**
 * 状态区块的表头由宿主画，按钮要经 setStatusControls 发布。
 * 老宿主（无 features.statusControls）没有这个口子，退回帧内的刷新按钮。
 */
function publishStatusControls(): void {
  if (MOCK) return;
  const publish = (): void => {
    host
      .setStatusControls([{ kind: 'button', id: 'refresh', label: T().refresh }])
      .catch(() => {
        statusControlsSupported = false;
        showFallbackRefresh();
      });
  };
  publish();
}

function showFallbackRefresh(): void {
  if (fallbackRefresh) return;
  fallbackRefresh = mountButton(fallbackRefreshSlot, {
    label: T().refresh,
    size: 'xs',
    variant: 'outline',
    onClick: () => void refresh(),
  });
  requestAnimationFrame(syncHeight);
}

function applyLocale(): void {
  const t = T();
  sessionRow.k.textContent = t.session;
  todayRow.k.textContent = t.today;
  balanceRow.k.textContent = t.balance;
  fallbackRefresh?.update({ label: t.refresh });
  if (lastSummary) renderAll(lastSummary);
  else tickCountdown();
  if (statusControlsSupported) publishStatusControls();
}

// ---------------------------------------------------------------- 启动

function boot(): void {
  if (statusControlsSupported) publishStatusControls();
  else showFallbackRefresh(); // 老宿主（无 features.statusControls）与预览：刷新按钮放在帧内
  void refresh();
  setInterval(() => {
    if (document.hidden) return;
    void refresh();
  }, 60_000);
  setInterval(() => {
    if (!document.hidden) tickCountdown();
  }, 1_000);
}

if (MOCK) {
  // 预览模式：宿主外没有主题变量，显式注入一套配色
  const dark = params.get('theme') !== 'light';
  const html = document.documentElement;
  html.style.colorScheme = dark ? 'dark' : 'light';
  html.style.background = dark ? '#15171c' : '#ffffff';
  html.style.color = dark ? '#e8e8ea' : '#1b1b1f';
  html.style.minHeight = '100vh';
  boot();
} else {
  // 控件事件只在发布过控件时才到达；同步注册，别等 onReady
  host.onStatusControl((event) => {
    if (event.id === 'refresh') void refresh();
  });
  host.onReady((ctx) => {
    applyHostReady(ctx, document.documentElement);
    const next = detectLang(ctx.locale);
    const changed = next !== lang;
    lang = next;
    statusControlsSupported = ctx.features?.statusControls === true;
    if (changed && mounted) applyLocale();
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
  // 项目/目录变化会清掉表头控件，需要重新发布（工作区订阅不受影响）
  host.onDirectory(() => {
    if (mounted && statusControlsSupported) publishStatusControls();
  });
  setTimeout(() => {
    if (!mounted) {
      wrap.style.display = 'none';
      mountEmpty(root, { title: T().notConnected, body: T().notConnectedBody });
    }
  }, 1_500);
}

// ---------------------------------------------------------------- 预览数据

function mockSummary(): Summary {
  const now = Date.now();
  const t: Tokens = { input: 412_300, output: 96_400, reasoning: 38_200, cacheRead: 8_120_000, cacheWrite: 0 };
  const isPeakUtc = (date: Date): boolean => {
    const day = date.getUTCDay();
    if (day === 0 || day === 6) return false;
    const h = date.getUTCHours();
    return (h >= 1 && h < 4) || (h >= 6 && h < 10);
  };
  const peak = isPeakUtc(new Date(now));
  const next = new Date(now);
  while (isPeakUtc(next) === peak) next.setMinutes(next.getMinutes() + 1);
  return {
    ok: true,
    generatedAt: now,
    now: {
      isPeak: peak,
      phase: peak ? 'peak' : 'offpeak',
      nextChangeAt: next.getTime(),
      nextPhase: peak ? 'offpeak' : 'peak',
    },
    balance: {
      ok: true,
      source: 'opencode.db',
      isAvailable: true,
      currency: 'CNY',
      total: '48.63',
      granted: '0.00',
      toppedUp: '50.00',
    },
    session: {
      requests: 37,
      official: 0.4126,
      main: { requests: 29, official: 0.3881 },
      children: { requests: 8, official: 0.0245 },
    },
    today: { date: '2026-10-14', requests: 128, tokens: t, official: 22.2868 },
  };
}
