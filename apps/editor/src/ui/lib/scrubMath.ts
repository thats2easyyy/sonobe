/**
 * Number-field math shared by ScrubNumberField and anything else that edits numbers:
 * modifier steps (Shift ×10, Alt ×0.1), drag-scrub sessions, float-safe rounding,
 * display formatting, and a small arithmetic parser for typed values like `667-49-64.5`.
 */

export interface ModifierState {
  shiftKey?: boolean;
  altKey?: boolean;
}

export interface NumberBounds {
  min?: number;
  max?: number;
}

/** Most decimals the editor keeps (matches canonical serialization). */
export const MAX_DECIMALS = 6;

/** Step multiplier for held modifiers: Shift ×10, Alt ×0.1. Holding both cancels out (×1). */
export function stepMultiplier(mods: ModifierState): number {
  const shift = Boolean(mods.shiftKey);
  const alt = Boolean(mods.altKey);
  if (shift === alt) return 1;
  return shift ? 10 : 0.1;
}

/** Decimal places in a number's shortest representation (1 → 0, 0.25 → 2), capped at MAX_DECIMALS. */
export function decimalsOf(n: number): number {
  if (!Number.isFinite(n) || Number.isInteger(n)) return 0;
  const text = Math.abs(n).toString();
  const [mantissa = "", exponent] = text.split("e");
  const dot = mantissa.indexOf(".");
  const mantissaDecimals = dot === -1 ? 0 : mantissa.length - dot - 1;
  const shift = exponent ? -Number(exponent) : 0;
  return Math.min(MAX_DECIMALS, Math.max(0, mantissaDecimals + shift));
}

/** Round half away from zero to `decimals` places without float noise; never returns -0. */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;
  const d = Math.max(0, Math.min(MAX_DECIMALS, Math.floor(decimals)));
  const factor = 10 ** d;
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * factor + 1e-9)) / factor;
  return rounded === 0 ? 0 : rounded;
}

export function clamp(value: number, bounds: NumberBounds): number {
  let v = value;
  if (bounds.min !== undefined && v < bounds.min) v = bounds.min;
  if (bounds.max !== undefined && v > bounds.max) v = bounds.max;
  return v;
}

export interface NudgeOptions extends NumberBounds {
  /** Base step at ×1. Defaults to 1. */
  step?: number;
  modifiers?: ModifierState;
}

/**
 * Keyboard nudge (arrow keys): ±step, Shift ±10×, Alt ±0.1×. Keeps the value's own precision
 * (12.345 + 1 → 13.345) and clamps to bounds.
 */
export function nudgeValue(value: number, direction: 1 | -1, options: NudgeOptions = {}): number {
  const delta = direction * (options.step ?? 1) * stepMultiplier(options.modifiers ?? {});
  const decimals = Math.max(decimalsOf(roundTo(value, MAX_DECIMALS)), decimalsOf(roundTo(delta, MAX_DECIMALS)));
  return clamp(roundTo(value + delta, decimals), options);
}

export interface ScrubSessionOptions extends NumberBounds {
  startValue: number;
  /** Value change per `pixelsPerStep` of pointer travel at ×1. Defaults to 1. */
  step?: number;
  /** Pointer travel in CSS px for one step at ×1. Defaults to 2. */
  pixelsPerStep?: number;
}

export interface ScrubSession {
  readonly value: number;
  /** Feed horizontal pointer travel since the last call; returns the new value. */
  move(dx: number, modifiers?: ModifierState): number;
}

/**
 * A drag-to-scrub session. Travel accumulates into an unrounded value that is clamped to the
 * bounds (so reversing direction past a bound responds immediately), and the reported value snaps
 * to multiples of the effective step (Shift snaps to 10s, Alt to tenths).
 */
export function createScrubSession(options: ScrubSessionOptions): ScrubSession {
  const step = options.step ?? 1;
  const pixelsPerStep = options.pixelsPerStep ?? 2;
  let raw = options.startValue;
  let value = options.startValue;
  return {
    get value() {
      return value;
    },
    move(dx, modifiers = {}) {
      if (dx === 0) return value;
      const effective = step * stepMultiplier(modifiers);
      raw = clamp(raw + (dx / pixelsPerStep) * effective, options);
      const snapped = Math.round(raw / effective) * effective;
      value = clamp(roundTo(snapped, decimalsOf(effective)), options);
      return value;
    },
  };
}

/** Format a number for display: rounded to `maxDecimals`, trailing zeros dropped, no -0. */
export function formatNumber(value: number, maxDecimals = 3): string {
  if (Number.isNaN(value)) return "NaN";
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "-∞";
  return String(roundTo(value, maxDecimals));
}

const NUMBER_TOKEN = /(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/iy;

/**
 * Parse what someone typed into a number field. Accepts plain numbers, arithmetic with
 * `+ - * / % ^ ×÷` and parentheses, a unicode minus, and a trailing unit (`12pt`, `45°`, `50%`).
 * Returns null for anything that isn't a finite number.
 */
export function parseNumberInput(input: string): number | null {
  const text = input
    .replace(/[−–]/g, "-")
    .replace(/\s+/g, "")
    .replace(/(?<=[\d.)])[a-z°%]+$/i, "");
  if (text.length === 0) return null;

  let pos = 0;
  const fail = (): never => {
    throw new SyntaxError("invalid number");
  };
  const peek = (): string => text.charAt(pos);

  function parseExpression(): number {
    let value = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = text.charAt(pos++);
      const rhs = parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parseUnary();
    while ("*/%×÷".includes(peek()) && peek() !== "") {
      const op = text.charAt(pos++);
      const rhs = parseUnary();
      if (op === "*" || op === "×") value *= rhs;
      else if (op === "%") value %= rhs;
      else value /= rhs;
    }
    return value;
  }

  function parseUnary(): number {
    if (peek() === "-") {
      pos++;
      return -parseUnary();
    }
    if (peek() === "+") {
      pos++;
      return parseUnary();
    }
    return parsePower();
  }

  function parsePower(): number {
    const base = parsePrimary();
    if (peek() === "^") {
      pos++;
      return base ** parseUnary();
    }
    return base;
  }

  function parsePrimary(): number {
    if (peek() === "(") {
      pos++;
      const value = parseExpression();
      if (peek() !== ")") fail();
      pos++;
      return value;
    }
    NUMBER_TOKEN.lastIndex = pos;
    const match = NUMBER_TOKEN.exec(text);
    if (!match) return fail();
    pos += match[0].length;
    return Number(match[0]);
  }

  try {
    const value = parseExpression();
    if (pos !== text.length || !Number.isFinite(value)) return null;
    return value === 0 ? 0 : value;
  } catch {
    return null;
  }
}
