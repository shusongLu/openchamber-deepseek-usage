/**
 * 后台入口：处理「本条 DeepSeek 费用」消息动作（mode: "background"）。
 * 宿主按需在隐藏 iframe 中加载本页，执行完 onAction 即销毁。
 * 结果通过 persistent + copy 的 toast 展示，不打开面板。
 */
import { connectHost, isGuestMessageItem } from '@openchamber/sdk';

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

host.onAction(async (item) => {
  if (!isGuestMessageItem(item)) {
    await host.toast({ kind: 'error', message: '「本条 DeepSeek 费用」只支持消息。', dismiss: true });
    return;
  }

  try {
    const res = await host.serviceRequest({ method: 'GET', path: '/message', query: { id: item.messageId } });
    const data = JSON.parse(res.body) as MessageUsage;
    if (!data.ok || !data.tokens) {
      await host.toast({ kind: 'error', message: `查询失败：${data.error ?? `HTTP ${res.status}`}`, dismiss: true });
      return;
    }

    const t = data.tokens;
    const text = [
      `本条 ${data.model ?? 'DeepSeek'} 费用`,
      `官方价 ${fmtCny(data.official ?? 0)}（${data.peak ? '峰时' : '谷时'}）`,
      `输入 ${fmtTokens(t.input)} · 缓存命中 ${fmtTokens(t.cacheRead)} · 输出 ${fmtTokens(t.output + t.reasoning)}`,
      `OpenCode 记账 ${fmtCny(data.cost ?? 0)}`,
    ].join('\n');

    await host.toast({ kind: 'info', message: text, copy: { text }, persistent: true });
  } catch (error) {
    await host.toast({
      kind: 'error',
      message: `查询失败：${error instanceof Error ? error.message : String(error)}`,
      dismiss: true,
    });
  }
});
