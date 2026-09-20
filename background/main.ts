/**
 * 后台入口：处理「本条 DeepSeek 费用」消息动作（mode: "background"）。
 * 宿主按需在隐藏 iframe 中加载本页，执行完 onAction 即销毁。
 * 结果通过 persistent + copy 的 toast 展示，不打开面板。
 * 语言跟随宿主 locale（onReady），拿不到时退回 navigator.language。
 */
import { connectHost, isGuestMessageItem } from '@openchamber/sdk';

type Lang = 'zh' | 'en';

function detect(locale?: string | null): Lang {
  return locale && locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

let lang: Lang = detect(navigator.language);

const L = {
  zh: {
    onlyMessages: '「本条 DeepSeek 费用」只支持消息。',
    header: (model: string) => `本条 ${model} 费用`,
    price: (cny: string, peak: boolean) => `官方价 ${cny}（${peak ? '峰时' : '谷时'}）`,
    tokens: (input: string, cache: string, output: string) => `输入 ${input} · 缓存命中 ${cache} · 输出 ${output}`,
    recorded: (cny: string) => `OpenCode 记账 ${cny}`,
    failed: (msg: string) => `查询失败：${msg}`,
  },
  en: {
    onlyMessages: '“Message DeepSeek cost” works on messages only.',
    header: (model: string) => `This message · ${model}`,
    price: (cny: string, peak: boolean) => `official ${cny} (${peak ? 'peak' : 'off-peak'})`,
    tokens: (input: string, cache: string, output: string) => `input ${input} · cache hit ${cache} · output ${output}`,
    recorded: (cny: string) => `OpenCode recorded ${cny}`,
    failed: (msg: string) => `Request failed: ${msg}`,
  },
} as const;

const host = connectHost();

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

interface MessageUsage {
  ok: boolean;
  error?: string;
  model?: string;
  peak?: boolean;
  official?: number;
  cost?: number;
  tokens?: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number };
}

host.onReady((ctx) => {
  lang = detect(ctx.locale);
});

host.onAction(async (item) => {
  const t = L[lang];
  if (!isGuestMessageItem(item)) {
    await host.toast({ kind: 'error', message: t.onlyMessages, dismiss: true });
    return;
  }

  try {
    const res = await host.serviceRequest({ method: 'GET', path: '/message', query: { id: item.messageId } });
    const data = JSON.parse(res.body) as MessageUsage;
    if (!data.ok || !data.tokens) {
      await host.toast({ kind: 'error', message: t.failed(data.error ?? `HTTP ${res.status}`), dismiss: true });
      return;
    }

    const tokens = data.tokens;
    const text = [
      t.header(data.model ?? 'DeepSeek'),
      t.price(fmtCny(data.official ?? 0), Boolean(data.peak)),
      t.tokens(fmtTokens(tokens.input), fmtTokens(tokens.cacheRead), fmtTokens(tokens.output + tokens.reasoning)),
      t.recorded(fmtCny(data.cost ?? 0)),
    ].join('\n');

    await host.toast({ kind: 'info', message: text, copy: { text }, persistent: true });
  } catch (error) {
    await host.toast({
      kind: 'error',
      message: t.failed(error instanceof Error ? error.message : String(error)),
      dismiss: true,
    });
  }
});
