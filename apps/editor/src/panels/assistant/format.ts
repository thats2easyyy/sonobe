/** Small formatting and validation helpers for the Assistant drawer. */

/** "950", "12.3K", "1.5M". */
export function formatTokens(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "0";
  if (count < 1000) return String(Math.round(count));
  if (count < 1_000_000) {
    const k = count / 1000;
    return `${k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}K`;
  }
  const m = count / 1_000_000;
  return `${m < 10 ? m.toFixed(1).replace(/\.0$/, "") : Math.round(m)}M`;
}

/** "$0.00", "<$0.01", "$0.42", "$12". */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  if (usd < 10) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd)}`;
}

/** Share of the budget used, 0–1. */
export function budgetFraction(used: number, budget: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(budget) || budget <= 0) return 0;
  return Math.min(1, Math.max(0, used / budget));
}

export interface KeyValidation {
  ok: boolean;
  /** Why it can't be saved. */
  error?: string;
  /** Saved anyway, but worth a second look. */
  warning?: string;
  /** The trimmed key. */
  value: string;
}

/** Check a pasted API key before storing it. Anthropic keys start with "sk-ant-"; Admin keys can't call the Messages API. */
export function validateApiKey(raw: string): KeyValidation {
  const value = raw.trim();
  if (!value) return { ok: false, error: "Paste your API key.", value };
  if (/\s/.test(value)) return { ok: false, error: "That doesn't look like an API key: it contains spaces or line breaks.", value };
  if (value.length > 512) return { ok: false, error: "That's too long to be an API key.", value };
  if (value.startsWith("sk-ant-admin")) return { ok: false, error: "That's an Admin API key. Create a regular API key in the Anthropic Console.", value };
  if (!value.startsWith("sk-ant-")) return { ok: true, warning: "Anthropic API keys usually start with sk-ant-. Double-check you copied the whole key.", value };
  return { ok: true, value };
}
