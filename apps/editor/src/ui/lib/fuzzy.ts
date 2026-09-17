/**
 * Fuzzy matching tuned for short UI labels: patch names, aliases, commands, layer names.
 *
 * A query matches when its characters appear in order. The best alignment is found with dynamic
 * programming and scored by: start-of-string and word-boundary hits (spaces, punctuation,
 * camelCase), consecutive runs, small gap penalties, plus bonuses for exact, prefix, and substring
 * matches. Shorter targets win ties.
 */

const SCORE_MATCH = 1;
const BONUS_START = 8;
const BONUS_BOUNDARY = 6;
const BONUS_CONSECUTIVE = 5;
const PENALTY_GAP = 0.5;
const PENALTY_GAP_MAX = 3;
const PENALTY_LEADING = 0.15;
const PENALTY_LEADING_MAX = 3;
const BONUS_EXACT = 100;
const BONUS_PREFIX = 30;
const BONUS_SUBSTRING = 12;
const PENALTY_LENGTH = 0.02;

export interface FuzzyMatch {
  score: number;
  /** Indices into the target string of matched characters. */
  indices: number[];
}

const SEPARATOR = /[\s\-_./:()[\]#@,]/;

function boundaryFlags(target: string): boolean[] {
  const flags: boolean[] = [];
  for (let i = 0; i < target.length; i++) {
    if (i === 0) {
      flags.push(true);
      continue;
    }
    const prev = target.charAt(i - 1);
    const cur = target.charAt(i);
    flags.push(
      SEPARATOR.test(prev) ||
        (/[a-z]/.test(prev) && /[A-Z]/.test(cur)) ||
        (/[a-z]/i.test(prev) && /\d/.test(cur)),
    );
  }
  return flags;
}

export interface FuzzyMatchOptions {
  /**
   * Every run of matched characters must start a word: "tu" finds "Tidy Up", but "copy" doesn't find
   * "Close Prototype" (c, o, p, y scattered inside words). For command titles, where scattered letters
   * surface unrelated results.
   */
  wordStart?: boolean;
}

/** Match one query against one string. Whitespace in the query is ignored. */
export function fuzzyMatch(query: string, target: string, options: FuzzyMatchOptions = {}): FuzzyMatch | null {
  const q = query.replace(/\s+/g, "").toLowerCase();
  if (q.length === 0) return { score: 0, indices: [] };
  const t = target.toLowerCase();
  const n = q.length;
  const m = t.length;
  if (n > m) return null;

  for (let i = 0, j = 0; j < n; i++) {
    if (i >= m) return null;
    if (t.charAt(i) === q.charAt(j)) j++;
  }

  const boundary = boundaryFlags(target);
  const charScore = (j: number) => SCORE_MATCH + (j === 0 ? BONUS_START : boundary[j] ? BONUS_BOUNDARY : 0);
  const NEG = Number.NEGATIVE_INFINITY;
  const score = new Float64Array(n * m).fill(NEG);
  const from = new Int32Array(n * m).fill(-1);

  for (let j = 0; j < m; j++) {
    if (t.charAt(j) === q.charAt(0)) {
      score[j] = charScore(j) - Math.min(j * PENALTY_LEADING, PENALTY_LEADING_MAX);
    }
  }

  for (let i = 1; i < n; i++) {
    const prevRow = (i - 1) * m;
    const row = i * m;
    // Best previous-row cell k <= j-2, under linear and capped gap penalties.
    let linBest = NEG;
    let linArg = -1;
    let capBest = NEG;
    let capArg = -1;
    for (let j = 0; j < m; j++) {
      if (j >= 2) {
        const k = j - 2;
        const candidate = score[prevRow + k]!;
        linBest -= PENALTY_GAP;
        if (candidate - PENALTY_GAP > linBest) {
          linBest = candidate - PENALTY_GAP;
          linArg = k;
        }
        if (candidate > capBest) {
          capBest = candidate;
          capArg = k;
        }
      }
      if (j < i || t.charAt(j) !== q.charAt(i)) continue;
      let best = NEG;
      let arg = -1;
      const consecutive = j >= 1 ? score[prevRow + j - 1]! : NEG;
      if (consecutive + BONUS_CONSECUTIVE > best) {
        best = consecutive + BONUS_CONSECUTIVE;
        arg = j - 1;
      }
      if (linBest > best) {
        best = linBest;
        arg = linArg;
      }
      if (capBest - PENALTY_GAP_MAX > best) {
        best = capBest - PENALTY_GAP_MAX;
        arg = capArg;
      }
      if (best > NEG) {
        score[row + j] = best + charScore(j);
        from[row + j] = arg;
      }
    }
  }

  const lastRow = (n - 1) * m;
  let bestEnd = -1;
  let bestScore = NEG;
  for (let j = 0; j < m; j++) {
    if (score[lastRow + j]! > bestScore) {
      bestScore = score[lastRow + j]!;
      bestEnd = j;
    }
  }
  if (bestEnd < 0) return null;

  const indices = new Array<number>(n);
  for (let i = n - 1, j = bestEnd; i >= 0; i--) {
    indices[i] = j;
    j = from[i * m + j]!;
  }
  if (options.wordStart) {
    for (let i = 0; i < n; i++) {
      const startsRun = i === 0 || indices[i] !== indices[i - 1]! + 1;
      if (startsRun && !boundary[indices[i]!]) return null;
    }
  }

  const compactTarget = t.replace(/\s+/g, "");
  const trimmedQuery = query.trim().toLowerCase();
  let total = bestScore - m * PENALTY_LENGTH;
  if (compactTarget === q) total += BONUS_EXACT;
  else if (t.startsWith(trimmedQuery)) total += BONUS_PREFIX;
  else {
    // Substrings only count when they start a word ("switch" in "Option Switch", not "ca" in "Scale").
    for (let at = t.indexOf(trimmedQuery); at !== -1; at = t.indexOf(trimmedQuery, at + 1)) {
      if (boundary[at]) {
        total += BONUS_SUBSTRING;
        break;
      }
    }
  }
  return { score: total, indices };
}

export interface FuzzyKey<T> {
  /** Key name used in `FuzzyResult.matches`. */
  name: string;
  get: (item: T) => string | readonly string[] | null | undefined;
  /** Score multiplier (default 1). Use < 1 for secondary fields like descriptions. */
  weight?: number;
  /** Only word-start matches count (see FuzzyMatchOptions.wordStart). */
  wordStart?: boolean;
}

export interface FieldMatch {
  /** The matched string (for array fields, the specific alias that matched). */
  value: string;
  indices: number[];
}

export interface FuzzyResult<T> {
  item: T;
  score: number;
  /** Position in the input list (stable tie-breaker). */
  index: number;
  matches: Record<string, FieldMatch>;
}

export interface FuzzySearchOptions {
  limit?: number;
}

function bestFieldMatch<T>(item: T, query: string, keys: readonly FuzzyKey<T>[]) {
  let best: { key: string; score: number; match: FieldMatch } | null = null;
  for (const key of keys) {
    const raw = key.get(item);
    if (raw == null) continue;
    const values: readonly string[] = typeof raw === "string" ? [raw] : raw;
    const weight = key.weight ?? 1;
    for (const value of values) {
      const match = fuzzyMatch(query, value, key.wordStart ? { wordStart: true } : {});
      if (!match) continue;
      const weighted = match.score * weight;
      if (!best || weighted > best.score) best = { key: key.name, score: weighted, match: { value, indices: match.indices } };
    }
  }
  return best;
}

/**
 * Rank items by their best-matching field. If the whole query matches no single field and it
 * contains spaces, each word must match some field ("switch flip" → name + port). An empty query
 * returns every item in its original order.
 */
export function fuzzySearch<T>(
  items: readonly T[],
  query: string,
  keys: readonly FuzzyKey<T>[],
  options: FuzzySearchOptions = {},
): FuzzyResult<T>[] {
  const trimmed = query.trim();
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  if (trimmed.length === 0) {
    return items.slice(0, Number.isFinite(limit) ? limit : undefined).map((item, index) => ({ item, score: 0, index, matches: {} }));
  }
  const tokens = trimmed.split(/\s+/);
  const results: FuzzyResult<T>[] = [];
  items.forEach((item, index) => {
    const whole = bestFieldMatch(item, trimmed, keys);
    if (whole) {
      results.push({ item, score: whole.score, index, matches: { [whole.key]: whole.match } });
      return;
    }
    if (tokens.length < 2) return;
    let total = 0;
    const matches: Record<string, FieldMatch> = {};
    for (const token of tokens) {
      const hit = bestFieldMatch(item, token, keys);
      if (!hit) return;
      total += hit.score;
      if (!matches[hit.key]) matches[hit.key] = hit.match;
    }
    results.push({ item, score: total * 0.9, index, matches });
  });
  results.sort((a, b) => b.score - a.score || a.index - b.index);
  return Number.isFinite(limit) ? results.slice(0, limit) : results;
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/** Split text into matched and unmatched runs for rendering highlights. */
export function highlightSegments(text: string, indices: readonly number[] | undefined): HighlightSegment[] {
  if (!indices || indices.length === 0) return [{ text, match: false }];
  const marked = new Set(indices);
  const segments: HighlightSegment[] = [];
  for (let i = 0; i < text.length; i++) {
    const match = marked.has(i);
    const last = segments[segments.length - 1];
    if (last && last.match === match) last.text += text.charAt(i);
    else segments.push({ text: text.charAt(i), match });
  }
  return segments;
}
