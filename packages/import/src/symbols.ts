/**
 * SF Symbols in design imports. HTML marks a symbol with `<svg data-sf-symbol="heart.fill"></svg>`, sized,
 * weighted and colored by CSS. Before the walker reads the page, `walkPage` lists those placeholders in
 * the page (SYMBOL_COLLECT_SOURCE), has the host's SymbolRenderer draw them (the sfsymbol helper on a
 * Mac, see sfsymbol.ts), and puts the drawings in (SYMBOL_APPLY_SOURCE), so they import as ordinary SVG
 * image layers named after the symbol. A host that can't draw them leaves gray placeholders and a note
 * saying why. Browser-safe.
 */

import type { DesignCapture } from "./capture.ts";
import { SYMBOL_APPLY_SOURCE, SYMBOL_COLLECT_SOURCE } from "./dom/symbolSource.ts";
import type { WalkOptions } from "./dom/walk.ts";
import { WALKER_SOURCE } from "./dom/walkerSource.ts";
import { CAPTURE_BUDGETS, StepTimeoutError, type CaptureRun } from "./run.ts";

export type SymbolWeight = "ultralight" | "thin" | "light" | "regular" | "medium" | "semibold" | "bold" | "heavy" | "black";

/** One symbol to draw, the way SwiftUI's Image(systemName:) draws it. */
export interface SymbolRequest {
  name: string;
  /** Point size: the placeholder's font-size. */
  size: number;
  /** From the placeholder's font-weight. */
  weight: SymbolWeight;
  /** SwiftUI's imageScale, from data-sf-scale. */
  scale: "small" | "medium" | "large";
  /** "#RRGGBBAA": the placeholder's color, or data-sf-palette's colors (the palette rendering mode). */
  colors: string[];
}

export type SymbolResult =
  | {
      ok: true;
      /** SVG markup, or a PNG (base64, 3x) for symbols the SVG conversion can't express. */
      svg?: string;
      png?: string;
      /** The symbol's frame in points. */
      width: number;
      height: number;
      /** Why it's a PNG ("masks inside masks"). */
      fallback?: string;
      /** Apple's usage restriction for this symbol. */
      restriction?: string;
    }
  | { ok: false; error: string; suggestions?: string[] };

export interface SymbolRenderOptions {
  /** Stops drawing (the helper process ends). */
  signal?: AbortSignal;
  onDrawn?(done: number, total: number): void;
}

/** How a host draws SF Symbols. */
export interface SymbolRenderer {
  /** Set when this host can't draw them, saying why; render then answers every request with it. */
  readonly unavailable?: string;
  /** One result per request, in order. Rejects when the renderer itself fails. */
  render(requests: readonly SymbolRequest[], options?: SymbolRenderOptions): Promise<SymbolResult[]>;
}

/** A renderer for hosts that can't draw SF Symbols: placeholders stay gray, and the note gives `reason`. */
export function unavailableSymbols(reason: string): SymbolRenderer {
  return { unavailable: reason, render: async (requests) => requests.map(() => ({ ok: false, error: reason })) };
}

/** Why a host without a renderer leaves placeholders. */
export const NO_SYMBOLS = "Sonobe draws SF Symbols when it imports in the app on a Mac with macOS 13 or later.";

/** A placeholder in the page (collectSymbols in dom/symbols.ts). */
export interface SymbolSlot {
  slot: number;
  request: SymbolRequest;
}

/** A drawing for one placeholder (applySymbols). Without svg or png it stays a placeholder of that size. */
export interface SymbolPaint {
  slot: number;
  width: number;
  height: number;
  svg?: string;
  png?: string;
}

/** Evaluate a script in the captured page and resolve to its value (awaiting a promise). */
export type PageEvaluate = (script: string) => Promise<unknown>;

const firstLine = (err: unknown) => (err instanceof Error ? err.message.split("\n")[0]! : String(err));

/** “a”, “b” and “c”, or “a”, “b”, “c”, “d”, “e” and 3 more. */
function quoted(names: readonly string[]): string {
  const shown = names.slice(0, 5).map((n) => `“${n}”`);
  if (names.length > shown.length) return `${shown.join(", ")} and ${names.length - shown.length} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : (shown[0] ?? "");
}

const orList = (names: readonly string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : (names[0] ?? ""));

/** Notes for the import: placeholders and why, bitmaps instead of vectors, Apple's restrictions. */
export function symbolNotes(requests: readonly SymbolRequest[], results: readonly (SymbolResult | undefined)[], failure?: string): string[] {
  const placeholders = new Map<string, { names: string[]; suggestions?: string[] }>();
  const bitmaps = new Map<string, string[]>();
  const restricted = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, name: string) => {
    const names = map.get(key) ?? [];
    if (!names.includes(name)) names.push(name);
    map.set(key, names);
  };
  requests.forEach((request, i) => {
    const result = results[i];
    if (!result || !result.ok) {
      const error = failure ?? (result && !result.ok ? result.error : "Sonobe couldn't draw it.");
      const group = placeholders.get(error) ?? { names: [], ...(result && !result.ok && result.suggestions?.length ? { suggestions: result.suggestions } : {}) };
      if (!group.names.includes(request.name)) group.names.push(request.name);
      placeholders.set(error, group);
      return;
    }
    if (result.png) add(bitmaps, result.fallback ?? "drawing Sonobe can't convert", request.name);
    if (result.restriction) add(restricted, result.restriction, request.name);
  });
  const notes: string[] = [];
  for (const [error, { names, suggestions }] of placeholders) {
    const one = names.length === 1;
    const guess = suggestions ? ` Did you mean ${orList(suggestions)}?` : "";
    // An error that names the symbol ("“hart” isn't an SF Symbol on this Mac") reads on its own.
    if (one && error.includes(`“${names[0]}”`)) notes.push(`${error} It's a gray placeholder.${guess}`);
    else notes.push(`The SF Symbol${one ? "" : "s"} ${quoted(names)} ${one ? "is a gray placeholder" : "are gray placeholders"}: ${error}${guess}`);
  }
  for (const [reason, names] of bitmaps) {
    const one = names.length === 1;
    notes.push(`${quoted(names)} ${one ? "is a 3x bitmap rather than a vector (it uses" : "are 3x bitmaps rather than vectors (they use"} ${reason}), so ${one ? "it blurs" : "they blur"} when scaled up.`);
  }
  for (const [restriction, names] of restricted) notes.push(`Apple restricts ${quoted(names)}: ${restriction}`);
  return notes;
}

/** The symbols stage: draw the placeholders the page listed, put the drawings in, and say what's missing. */
async function drawSymbols(evaluate: PageEvaluate, run: CaptureRun, slots: readonly SymbolSlot[], renderer: SymbolRenderer): Promise<string[]> {
  // Identical placeholders (a heart on every card) are drawn once.
  const keys = slots.map((s) => JSON.stringify(s.request));
  const unique = [...new Set(keys)];
  const requests = unique.map((key) => slots[keys.indexOf(key)]!.request);
  let results: (SymbolResult | undefined)[] = [];
  let failure: string | undefined;
  if (!renderer.unavailable) run.report({ stage: "symbols", message: `Drawing SF Symbols: 0 of ${requests.length}`, done: 0, total: requests.length });
  const stop = new AbortController();
  const onAbort = () => stop.abort();
  run.signal.addEventListener("abort", onAbort, { once: true });
  try {
    results = await run.step(
      renderer.render(requests, { signal: stop.signal, onDrawn: (done, total) => run.report({ stage: "symbols", message: `Drawing SF Symbols: ${done} of ${total}`, done, total }) }),
      CAPTURE_BUDGETS.symbols,
    );
  } catch (err) {
    run.throwIfAborted();
    stop.abort();
    failure = err instanceof StepTimeoutError ? `Sonobe couldn't draw SF Symbols within ${Math.round(CAPTURE_BUDGETS.symbols / 1000)} seconds. Try the import again.` : `Sonobe couldn't draw SF Symbols (${firstLine(err)}). Try the import again.`;
  } finally {
    run.signal.removeEventListener("abort", onAbort);
  }
  const paints: SymbolPaint[] = slots.map((s, i) => {
    const result = results[unique.indexOf(keys[i]!)];
    if (result?.ok && (result.svg || result.png)) return { slot: s.slot, width: result.width, height: result.height, ...(result.svg ? { svg: result.svg } : { png: result.png! }) };
    return { slot: s.slot, width: s.request.size, height: s.request.size };
  });
  await run.step(evaluate(`${SYMBOL_APPLY_SOURCE};window.__sonobeApplySymbols(${JSON.stringify(paints)})`), CAPTURE_BUDGETS.symbols);
  return symbolNotes(requests, results, failure);
}

export interface WalkPageOptions {
  run: CaptureRun;
  /** The walker's options (a host's waitFor, waitMs, selector...). */
  walk: WalkOptions;
  /** Draws SF Symbol placeholders. Default: none, so they stay gray placeholders with a note. */
  symbols?: SymbolRenderer;
}

/**
 * The walking and symbols stages of a capture, shared by the hosts: wait for the page the way the
 * walker does, draw its SF Symbol placeholders, then run the walker. Each part is a step with the walk
 * budget (45 s plus waitMs); drawing has its own budget, and a drawing that fails becomes a note.
 * Rejects with StepTimeoutError or the page's own error, which hosts turn into their capture errors.
 */
export async function walkPage(evaluate: PageEvaluate, options: WalkPageOptions): Promise<{ capture: DesignCapture; notes: string[] }> {
  const { run, walk } = options;
  const budget = CAPTURE_BUDGETS.walk + (walk.waitMs ?? 0);
  const listed = (async () => {
    await evaluate(SYMBOL_COLLECT_SOURCE);
    return (await evaluate(`window.__sonobeCollectSymbols(${JSON.stringify(walk)})`)) as SymbolSlot[];
  })();
  const slots = await run.step(listed, budget);
  const notes = slots.length ? await drawSymbols(evaluate, run, slots, options.symbols ?? unavailableSymbols(NO_SYMBOLS)) : [];
  if (slots.length) run.report({ stage: "walking", message: "Reading the page's layers" });
  // The page has settled (collectSymbols waited for it); only the drawings just put in need a moment.
  const { waitFor: _waitFor, waitMs: _waitMs, ...rest } = walk;
  const walked = (async () => {
    await evaluate(WALKER_SOURCE);
    return (await evaluate(`window.__sonobeCapture(${JSON.stringify({ ...rest, settleMs: slots.length ? 50 : 0 })})`)) as DesignCapture;
  })();
  return { capture: await run.step(walked, budget), notes };
}
