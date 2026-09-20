/**
 * DeepSeek 用量扩展 —— 全屏看板页
 *
 * 数据来自本地 service：/summary（余额、峰谷、日用量）与 /sessions（会话排行）。
 * 点击排行里的会话可跳转到该会话（需要 sessions 能力）。
 * 语言跟随宿主 locale；预览用 ?mock=1&lang=zh|en&theme=dark|light。
 */
import { connectHost } from '@openchamber/sdk';

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

interface SessionRank {
  id: string;
  title: string;
  official: number;
  cost: number;
  requests: number;
  tokens: Tokens;
  startedAt: number;
  lastMessageAt: number;
}

interface Summary {
  ok: boolean;
  generatedAt: number;
  error?: string;
  now: { isPeak: boolean; nextChangeAt: number; nextPhase: 'peak' | 'offpeak' };
  balance: {
    ok: boolean;
    currency?: string | null;
    total?: string | null;
    reason?: string;
  };
  fx?: { usdCny: number; source: string };
  totals?: { requests: number; tokens: Tokens; cost: number; official: number };
  today?: DayAgg | null;
  days?: DayAgg[];
}

interface SessionsResponse {
  ok: boolean;
  error?: string;
  sessions: SessionRank[];
}

// ---------------------------------------------------------------- 语言

type Lang = 'zh' | 'en';

const L = {
  zh: {
    title: 'DeepSeek 用量看板',
    refresh: '刷新',
    peak: '峰时',
    offpeak: '谷时',
    switchesIn: (time: string, next: string) => `距切换 ${time} → ${next}`,
    balance: '余额',
    today: '今日费用（官方价）',
    d30: '近 30 天（官方价）',
    d30recorded: '近 30 天（OpenCode 记账）',
    allTime: '累计（官方价）',
    calls: (n: string) => `${n} 次`,
    calendar: '每日费用（近 12 周）',
    less: '少',
    more: '多',
    ranking: '会话排行（近 30 天，含子代理）',
    noData: '暂无数据',
    openFailed: (msg: string) => `打开会话失败：${msg}`,
    updatedAt: (time: string) => `更新于 ${time}`,
    loadFailed: (msg: string) => `加载失败：${msg}`,
    retry: '重试',
    fxNote: (rate: string, src: string) => `OpenCode 记账按汇率 1 USD = ¥${rate} 折算（${src}）`,
    note: '官方价按人民币价目与峰谷时段逐条重算；点击会话行可跳转到该会话',
  },
  en: {
    title: 'DeepSeek Usage Dashboard',
    refresh: 'Refresh',
    peak: 'peak',
    offpeak: 'off-peak',
    switchesIn: (time: string, next: string) => `switches in ${time} → ${next}`,
    balance: 'Balance',
    today: "Today's cost (official)",
    d30: 'Last 30 days (official)',
    d30recorded: 'Last 30 days (OpenCode recorded)',
    allTime: 'All time (official)',
    calls: (n: string) => `${n} calls`,
    calendar: 'Daily cost (last 12 weeks)',
    less: 'less',
    more: 'more',
    ranking: 'Sessions by cost (last 30 days, incl. subagents)',
    noData: 'No data',
    openFailed: (msg: string) => `Could not open session: ${msg}`,
    updatedAt: (time: string) => `updated ${time}`,
    loadFailed: (msg: string) => `Load failed: ${msg}`,
    retry: 'Retry',
    fxNote: (rate: string, src: string) => `OpenCode recorded converted at 1 USD = ¥${rate} (${src})`,
    note: 'Official cost recomputed per message using the CNY price list and peak windows; click a session row to open it.',
  },
} as const;

const MOCK = new URLSearchParams(location.search).has('mock');

function detectLang(locale?: string | null): Lang {
  return locale && locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

let lang: Lang = detectLang(MOCK ? new URLSearchParams(location.search).get('lang') ?? navigator.language : navigator.language);
const T = () => L[lang];

// ---------------------------------------------------------------- 环境

const host = connectHost();
const root = document.querySelector('#root') as HTMLElement;
let mounted = false;
let lastSummary: Summary | null = null;
let lastSessions: SessionRank[] = [];

// ---------------------------------------------------------------- 工具

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

function localDateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------------------------------------------------------------- 骨架

const page = el('div', 'page');
const head = el('div', 'head');
const title = el('div', 'title', T().title);
const headRight = el('div', 'head-right');
const peakBadge = el('div', 'peak-badge');
const updated = el('div', 'small muted');
const headSpacer = el('div', 'small muted');
const cards = el('div', 'cards');
const calendarSection = el('div', 'section', T().calendar);
const heatWrap = el('div', 'heat-wrap');
const heat = el('div', 'heat');
const legend = el('div', 'legend');
const rankingSection = el('div', 'section', T().ranking);
const rows = el('div', 'rows');
const foot = el('div', 'foot');

headRight.append(peakBadge, updated);
head.append(title, headRight);
heatWrap.append(heat, legend);
page.append(head, cards, calendarSection, heatWrap, rankingSection, rows, foot);
root.append(page);

// ---------------------------------------------------------------- 数据

async function loadData(): Promise<{ summary: Summary; sessions: SessionRank[] }> {
  if (MOCK) {
    const summary = mockSummary();
    return { summary, sessions: mockSessions() };
  }
  const [summaryRes, sessionsRes] = await Promise.all([
    host.serviceRequest({ method: 'GET', path: '/summary', query: { days: '90' } }),
    host.serviceRequest({ method: 'GET', path: '/sessions', query: { days: '30', limit: '15' } }),
  ]);
  const summary = JSON.parse(summaryRes.body) as Summary;
  const sessions = JSON.parse(sessionsRes.body) as SessionsResponse;
  return { summary, sessions: sessions.ok ? sessions.sessions : [] };
}

// ---------------------------------------------------------------- 渲染

function statCard(label: string, value: string, sub?: string): HTMLElement {
  const card = el('div', 'card');
  card.append(el('div', 'k', label), el('div', 'v', value));
  if (sub) card.append(el('div', 'sub', sub));
  return card;
}

function sumDays(list: DayAgg[]): { official: number; cost: number; requests: number } {
  let official = 0;
  let cost = 0;
  let requests = 0;
  for (const d of list) {
    official += d.official;
    cost += d.cost;
    requests += d.requests;
  }
  return { official, cost, requests };
}

function renderHead(s: Summary): void {
  const t = T();
  peakBadge.textContent = `${s.now.isPeak ? t.peak : t.offpeak} · ${t.switchesIn(countdown(s.now.nextChangeAt - Date.now()), s.now.nextPhase === 'peak' ? t.peak : t.offpeak)}`;
  updated.textContent = t.updatedAt(new Date(s.generatedAt).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-GB', { hour12: false }));
}

function renderCards(s: Summary): void {
  const t = T();
  const last30 = (s.days ?? []).slice(-30);
  const agg30 = sumDays(last30);
  const balance = s.balance?.ok ? `${s.balance.currency === 'CNY' ? '¥' : ''}${s.balance.total ?? '—'}` : '—';
  cards.replaceChildren(
    statCard(t.balance, balance, s.balance?.ok ? undefined : s.balance?.reason === 'no-key' ? 'no key' : undefined),
    statCard(t.today, fmtCny(s.today?.official ?? 0), s.today ? t.calls(fmtInt(s.today.requests)) : t.noData),
    statCard(t.d30, fmtCny(agg30.official), t.calls(fmtInt(agg30.requests))),
    statCard(t.d30recorded, fmtCny(agg30.cost)),
    statCard(t.allTime, fmtCny(s.totals?.official ?? 0), s.totals ? `${fmtTokens(totalTokens(s.totals.tokens))} tokens` : undefined),
  );
}

function renderHeat(s: Summary): void {
  const t = T();
  const days = s.days ?? [];
  const map = new Map(days.map((d) => [d.date, d.official]));
  const max = Math.max(1e-9, ...days.map((d) => d.official));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const mondayOffset = (today.getDay() + 6) % 7;
  const start = new Date(today);
  start.setDate(start.getDate() - mondayOffset - 11 * 7);

  const cells: HTMLElement[] = [];
  for (let i = 0; i < 12 * 7; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = localDateStr(d);
    const cost = map.get(key) ?? 0;
    const cell = el('div', 'cell');
    if (cost > 0) {
      const level = Math.min(4, 1 + Math.floor((cost / max) * 3.999));
      cell.classList.add(`l${level}`);
    }
    if (d.getTime() > today.getTime()) cell.style.visibility = 'hidden';
    cell.title = `${key} · ${fmtCny(cost)}`;
    cells.push(cell);
  }
  heat.replaceChildren(...cells);

  legend.replaceChildren(
    el('span', undefined, t.less),
    ...['', 'l1', 'l2', 'l3', 'l4'].map((lv) => {
      const sw = el('span', `swatch ${lv}`.trim());
      sw.style.background = `color-mix(in srgb, currentColor ${['8', '24', '38', '54', '74'][['', 'l1', 'l2', 'l3', 'l4'].indexOf(lv)]}%, transparent)`;
      return sw;
    }),
    el('span', undefined, t.more),
  );
}

function renderRanking(): void {
  const t = T();
  if (lastSessions.length === 0) {
    rows.replaceChildren(el('div', 'small muted', t.noData));
    return;
  }
  rows.replaceChildren(
    ...lastSessions.map((s, index) => {
      const row = el('div', 'rank');
      row.title = s.id;
      const name = el('div', 'name', s.title || s.id);
      row.append(
        el('div', 'no', String(index + 1)),
        name,
        el('div', 'meta', `${fmtInt(s.requests)} · ${fmtTokens(totalTokens(s.tokens))} · ${fmtDateTime(s.lastMessageAt || s.startedAt)}`),
        el('div', 'val', fmtCny(s.official)),
      );
      row.addEventListener('click', () => {
        void (async () => {
          try {
            await host.openSession(s.id);
          } catch (error) {
            await host.toast({
              kind: 'error',
              message: t.openFailed(error instanceof Error ? error.message : String(error)),
              dismiss: true,
            });
          }
        })();
      });
      return row;
    }),
  );
}

function renderFoot(s: Summary): void {
  const t = T();
  const bits: string[] = [];
  if (s.fx) bits.push(t.fxNote(String(s.fx.usdCny), s.fx.source));
  bits.push(t.note);
  foot.replaceChildren(...bits.map((b) => el('div', undefined, b)));
}

function renderAll(summary: Summary, sessions: SessionRank[]): void {
  lastSummary = summary;
  lastSessions = sessions;
  renderHead(summary);
  renderCards(summary);
  renderHeat(summary);
  renderRanking();
  renderFoot(summary);
}

function showError(error: unknown): void {
  const t = T();
  cards.replaceChildren(
    statCard(
      t.loadFailed(error instanceof Error ? error.message : String(error)),
      '',
    ),
  );
  const btn = el('div', 'card');
  btn.style.cursor = 'pointer';
  btn.textContent = t.retry;
  btn.addEventListener('click', () => void refresh());
  cards.append(btn);
}

let loading = false;

async function refresh(): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    const { summary, sessions } = await loadData();
    renderAll(summary, sessions);
  } catch (error) {
    showError(error);
  } finally {
    loading = false;
  }
}

function applyLocale(): void {
  const t = T();
  title.textContent = t.title;
  calendarSection.textContent = t.calendar;
  rankingSection.textContent = t.ranking;
  refreshButton.textContent = `↻ ${t.refresh}`;
  if (lastSummary) renderAll(lastSummary, lastSessions);
}

const refreshButton = el('button', 'peak-badge');
refreshButton.textContent = `↻ ${T().refresh}`;
refreshButton.style.cursor = 'pointer';
refreshButton.addEventListener('click', () => void refresh());
headRight.append(refreshButton);

function boot(): void {
  void refresh();
  setInterval(() => {
    if (document.hidden) return;
    void refresh();
  }, 120_000);
  setInterval(() => {
    if (lastSummary) renderHead(lastSummary);
  }, 1_000);
}

if (MOCK) {
  const dark = new URLSearchParams(location.search).get('theme') !== 'light';
  const html = document.documentElement;
  html.style.colorScheme = dark ? 'dark' : 'light';
  html.style.background = dark ? '#15171c' : '#ffffff';
  html.style.color = dark ? '#e8e8ea' : '#1b1b1f';
  html.style.minHeight = '100vh';
  boot();
} else {
  host.onReady((ctx) => {
    const next = detectLang(ctx.locale);
    if (next !== lang) {
      lang = next;
      applyLocale();
    }
    if (mounted) return;
    mounted = true;
    boot();
  });
}

// ---------------------------------------------------------------- 预览数据

function mockSummary(): Summary {
  const now = Date.now();
  const days: DayAgg[] = [];
  for (let i = 89; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const factor = 0.25 + ((i * 41) % 100) / 110;
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
  return {
    ok: true,
    generatedAt: now,
    now: { isPeak: true, nextChangeAt: now + 1_500_000, nextPhase: 'offpeak' },
    balance: { ok: true, currency: 'CNY', total: '263.85' },
    fx: { usdCny: 6.7223, source: 'open.er-api.com' },
    totals: {
      requests: days.reduce((a, d) => a + d.requests, 0),
      tokens: { input: 20_000_000, output: 4_000_000, reasoning: 1_600_000, cacheRead: 900_000_000, cacheWrite: 0 },
      cost: days.reduce((a, d) => a + d.cost, 0) * 1.4,
      official: days.reduce((a, d) => a + d.official, 0) * 1.4,
    },
    today: days[days.length - 1] ?? null,
    days,
  };
}

function mockSessions(): SessionRank[] {
  const now = Date.now();
  const titles = [
    'OpenChamber 扩展清单查看',
    '重新审查现有 BUG',
    '中文道路运输证 OCR 识别失败排查',
    'BillController 需补充修改接口',
    'UserController 新增修改自身密码接口',
    '项目审查与可改进项',
    '项目全流程分支报告',
    'PdaCargoController 加白提货…',
  ];
  return titles.map((title, i) => {
    const official = [16.9, 12.4, 9.8, 7.1, 5.6, 4.2, 3.1, 2.4][i];
    const requests = [1133, 842, 611, 488, 402, 291, 233, 175][i];
    return {
      id: `ses_mock_${i}`,
      title,
      official,
      cost: official * 0.62,
      requests,
      tokens: { input: requests * 3200, output: requests * 1200, reasoning: requests * 500, cacheRead: requests * 90_000, cacheWrite: 0 },
      startedAt: now - (i + 1) * 3600_000 * 5,
      lastMessageAt: now - (i + 1) * 3600_000,
    };
  });
}
