/** "Did you mean …?" matching for unknown types, ports, props and ids. */

/** Optimal-string-alignment edit distance (Levenshtein plus adjacent transpositions). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j++) d[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

export interface SuggestCandidate {
  /** The value suggested back (e.g. a patch type key). */
  value: string;
  /** Other strings that should match this value (display name, aliases). */
  aliases?: readonly string[];
}

const normalize = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function score(input: string, key: string): number | undefined {
  const a = normalize(input);
  const b = normalize(key);
  if (!a || !b) return undefined;
  if (a === b) return 0;
  if (b.startsWith(a) || a.startsWith(b)) return 1 + Math.abs(a.length - b.length) / 100;
  if (b.includes(a) && a.length >= 3) return 1.5;
  const dist = editDistance(a, b);
  const limit = Math.max(2, Math.ceil(a.length * 0.4));
  return dist <= limit ? dist : undefined;
}

/** Up to `max` closest candidates, best first. */
export function didYouMean(input: string, candidates: Iterable<string | SuggestCandidate>, max = 3): string[] {
  const best = new Map<string, number>();
  for (const c of candidates) {
    const cand = typeof c === "string" ? { value: c } : c;
    for (const key of [cand.value, ...(cand.aliases ?? [])]) {
      const s = score(input, key);
      if (s === undefined) continue;
      const prev = best.get(cand.value);
      if (prev === undefined || s < prev) best.set(cand.value, s);
    }
  }
  return [...best.entries()]
    .sort((x, y) => x[1] - y[1] || x[0].localeCompare(y[0]))
    .slice(0, max)
    .map(([value]) => value);
}

/** Formats suggestions as ` Did you mean "a" or "b"?` (with a leading space), or "". */
export function didYouMeanText(suggestions: readonly string[]): string {
  if (!suggestions.length) return "";
  const quoted = suggestions.map((s) => `"${s}"`);
  const list = quoted.length === 1 ? quoted[0] : `${quoted.slice(0, -1).join(", ")} or ${quoted.at(-1)}`;
  return ` Did you mean ${list}?`;
}
