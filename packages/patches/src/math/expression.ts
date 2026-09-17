/**
 * Math Expression's formula language: a numeric subset of JavaScript expressions compiled into
 * closures (never eval or new Function), the ports a formula derives, friendly errors with 1-based
 * columns, and the lenient port scan used when stored text doesn't parse. Compiled formulas are
 * cached by text.
 */

import { didYouMean } from "@sonobe/core";
import type { PortSpec } from "@sonobe/core";

export const MAX_EXPRESSION_LENGTH = 10_000;
/** Most inputs, and most results, one formula may have. */
export const MAX_EXPRESSION_PORTS = 32;
export const MAX_EXPRESSION_DEPTH = 64;

/** A parse problem: a human message plus where it starts (0-based index, 1-based line and column). */
export interface ExpressionError {
  message: string;
  index: number;
  line: number;
  column: number;
}

/** A result port: `name = expr` statements use the name; others take output, output2, …. */
export interface ExpressionOutput {
  key: string;
  name: string;
  named: boolean;
}

type Evaluate = (env: number[]) => number;

export interface CompiledStatement extends ExpressionOutput {
  evaluate: Evaluate;
  /** Environment slot later statements read this result from, or -1 for an unnamed result. */
  slot: number;
}

export interface ValidExpression {
  ok: true;
  /** Input keys in order of first appearance. */
  inputs: readonly string[];
  /** Environment slot of each input, parallel to `inputs`. */
  inputSlots: readonly number[];
  outputs: readonly ExpressionOutput[];
  statements: readonly CompiledStatement[];
  /** Environment size: every input and named result. */
  slotCount: number;
}

export interface InvalidExpression {
  ok: false;
  error: ExpressionError;
  /** Lenient ports, so existing wires stay attached while the formula gets fixed. */
  inputs: readonly string[];
  outputs: readonly ExpressionOutput[];
}

export type CompiledExpression = ValidExpression | InvalidExpression;

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const UNARY_FUNCTIONS: Readonly<Record<string, (x: number) => number>> = {
  abs: Math.abs,
  acos: Math.acos,
  acosh: Math.acosh,
  asin: Math.asin,
  asinh: Math.asinh,
  atan: Math.atan,
  atanh: Math.atanh,
  cbrt: Math.cbrt,
  ceil: Math.ceil,
  cos: Math.cos,
  cosh: Math.cosh,
  exp: Math.exp,
  expm1: Math.expm1,
  floor: Math.floor,
  log: Math.log,
  log10: Math.log10,
  log1p: Math.log1p,
  log2: Math.log2,
  round: Math.round,
  sign: Math.sign,
  sin: Math.sin,
  sinh: Math.sinh,
  sqrt: Math.sqrt,
  tan: Math.tan,
  tanh: Math.tanh,
  trunc: Math.trunc,
};

const BINARY_FUNCTIONS: Readonly<Record<string, (a: number, b: number) => number>> = { atan2: Math.atan2, pow: Math.pow };

const VARIADIC_FUNCTIONS: Readonly<Record<string, (...values: number[]) => number>> = { hypot: Math.hypot, max: Math.max, min: Math.min };

/** Sonobe helpers, callable bare only. */
const HELPERS: Readonly<Record<string, { arity: number; fn: (...values: number[]) => number }>> = {
  radians: { arity: 1, fn: (deg) => (deg! * Math.PI) / 180 },
  degrees: { arity: 1, fn: (rad) => (rad! * 180) / Math.PI },
  clamp: { arity: 3, fn: (value, a, b) => Math.min(Math.max(value!, Math.min(a!, b!)), Math.max(a!, b!)) },
  lerp: { arity: 3, fn: (start, end, progress) => start! + (end! - start!) * progress! },
};

const MATH_CONSTANTS: Readonly<Record<string, number>> = {
  E: Math.E,
  LN2: Math.LN2,
  LN10: Math.LN10,
  LOG2E: Math.LOG2E,
  LOG10E: Math.LOG10E,
  PI: Math.PI,
  SQRT1_2: Math.SQRT1_2,
  SQRT2: Math.SQRT2,
};

const MATH_FUNCTION_NAMES = [...Object.keys(UNARY_FUNCTIONS), ...Object.keys(BINARY_FUNCTIONS), ...Object.keys(VARIADIC_FUNCTIONS)];
const HELPER_NAMES = Object.keys(HELPERS);

const LITERALS: Readonly<Record<string, number>> = { PI: Math.PI, true: 1, false: 0, Infinity: Number.POSITIVE_INFINITY, NaN: Number.NaN };

/** Names that are never variables or result names. */
export const RESERVED_NAMES: ReadonlySet<string> = new Set(
  (
    "Math PI true false Infinity NaN undefined null break case catch class const continue debugger default delete do else export " +
    "extends finally for function if import in instanceof let new of return super switch this throw try typeof var void while with yield await"
  ).split(" "),
);

const has = (table: object, name: string) => Object.hasOwn(table, name);
const isMathFunction = (name: string) => has(UNARY_FUNCTIONS, name) || has(BINARY_FUNCTIONS, name) || has(VARIADIC_FUNCTIONS, name);

function suggest(name: string, candidates: readonly string[], prefix = ""): string {
  const [best] = didYouMean(name, candidates, 1);
  return best === undefined ? "" : ` Did you mean \`${prefix}${best}\`?`;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

interface Token {
  kind: "number" | "ident" | "op" | "eof";
  text: string;
  value: number;
  index: number;
}

class ExpressionParseError extends Error {
  readonly index: number;
  constructor(message: string, index: number) {
    super(message);
    this.index = index;
  }
}

function fail(message: string, index: number): never {
  throw new ExpressionParseError(message, index);
}

const SUPPORTED_OPERATORS = ["===", "!==", "**", "==", "!=", "<=", ">=", "&&", "||", "+", "-", "*", "/", "%", "(", ")", ",", ";", "=", "<", ">", "!", "?", ":", "."];
/** Operators outside the grammar, matched longest first so each gets a precise message. */
const UNSUPPORTED_OPERATORS = [">>>=", "**=", ">>>", "<<=", ">>=", "&&=", "||=", "??=", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "=>", "<<", ">>", "??", "&", "|", "~", "[", "]", "{", "}", "#", "@", "\\"];
const OPERATORS = [...SUPPORTED_OPERATORS, ...UNSUPPORTED_OPERATORS].sort((a, b) => b.length - a.length);
const SUPPORTED_SET: ReadonlySet<string> = new Set(SUPPORTED_OPERATORS);

const NUMBER_RE = /0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/y;

const unsupported = (text: string) => `\`${text}\` isn't supported in Math Expression.`;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (text.startsWith("//", i) || text.startsWith("/*", i)) fail(unsupported(text.slice(i, i + 2)), i);
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = text.indexOf(ch, i + 1);
      const line = text.indexOf("\n", i + 1);
      const stop = end >= 0 && (line < 0 || end < line) ? end + 1 : i + 1;
      fail(unsupported(text.slice(i, stop)), i);
    }
    if (/[0-9.]/.test(ch)) {
      NUMBER_RE.lastIndex = i;
      const m = NUMBER_RE.exec(text);
      if (m) {
        const end = i + m[0].length;
        const after = text[end];
        if (after !== undefined && /[A-Za-z_$]/.test(after)) fail(`Put \`*\` between a number and a name, like \`2 * x\`.`, i);
        if (after === "." || (after !== undefined && /[0-9]/.test(after))) fail(unsupported(text.slice(i, end + 1)), i);
        const body = m[0];
        const value = /^0[xX]/.test(body) ? Number.parseInt(body.slice(2), 16) : Number(body);
        tokens.push({ kind: "number", text: body, value, index: i });
        i = end;
        continue;
      }
    }
    if (/[A-Za-z_$]/.test(ch)) {
      IDENT_RE.lastIndex = i;
      const word = IDENT_RE.exec(text)![0];
      if (word.includes("$")) fail(unsupported(word), i);
      tokens.push({ kind: "ident", text: word, value: 0, index: i });
      i += word.length;
      continue;
    }
    if (ch === "^") fail("Use `**` for powers, like `x ** 2`.", i);
    const op = OPERATORS.find((o) => text.startsWith(o, i));
    if (op === undefined) fail(unsupported(String.fromCodePoint(text.codePointAt(i)!)), i);
    if (!SUPPORTED_SET.has(op)) fail(unsupported(op), i);
    tokens.push({ kind: "op", text: op, value: 0, index: i });
    i += op.length;
  }
  tokens.push({ kind: "eof", text: "", value: 0, index: text.length });
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface Node {
  fn: Evaluate;
  /** "pow" marks an unparenthesized `**`, which a unary sign may not sit directly before. */
  kind: "pow" | "group" | "value";
}

const value = (fn: Evaluate): Node => ({ fn, kind: "value" });
const truthy = (x: number) => x !== 0 && !Number.isNaN(x);

const EQUALITY = new Map<string, (a: number, b: number) => number>([
  ["==", (a, b) => (a === b ? 1 : 0)],
  ["===", (a, b) => (a === b ? 1 : 0)],
  ["!=", (a, b) => (a !== b ? 1 : 0)],
  ["!==", (a, b) => (a !== b ? 1 : 0)],
]);
const RELATIONAL = new Map<string, (a: number, b: number) => number>([
  ["<", (a, b) => (a < b ? 1 : 0)],
  ["<=", (a, b) => (a <= b ? 1 : 0)],
  [">", (a, b) => (a > b ? 1 : 0)],
  [">=", (a, b) => (a >= b ? 1 : 0)],
]);
const ADDITIVE = new Map<string, (a: number, b: number) => number>([
  ["+", (a, b) => a + b],
  ["-", (a, b) => a - b],
]);
const MULTIPLICATIVE = new Map<string, (a: number, b: number) => number>([
  ["*", (a, b) => a * b],
  ["/", (a, b) => a / b],
  ["%", (a, b) => a % b],
]);

const alreadyInput = (name: string) =>
  `\`${name}\` is already an input, so it can't also name a result. Math Expression has no memory; use Counter or Delay One Frame to build on the previous value.`;

function parseProgram(text: string): ValidExpression {
  if (text.length > MAX_EXPRESSION_LENGTH) fail(`The formula is longer than ${MAX_EXPRESSION_LENGTH.toLocaleString("en-US")} characters.`, MAX_EXPRESSION_LENGTH);
  const tokens = tokenize(text);
  let pos = 0;
  let depth = 0;
  let slotCount = 0;
  const inputs: string[] = [];
  const inputSlots: number[] = [];
  const names = new Map<string, { slot: number; kind: "input" | "result" }>();
  const parsed: { name: string | null; evaluate: Evaluate; slot: number }[] = [];

  const peek = (offset = 0): Token => tokens[Math.min(pos + offset, tokens.length - 1)]!;
  const next = (): Token => tokens[Math.min(pos++, tokens.length - 1)]!;
  const isOp = (token: Token, text: string) => token.kind === "op" && token.text === text;
  const enter = (token: Token) => {
    if (++depth > MAX_EXPRESSION_DEPTH) fail(`The formula nests more than ${MAX_EXPRESSION_DEPTH} levels deep. Split it into several statements.`, token.index);
  };

  function unexpectedAfterValue(token: Token): never {
    if (isOp(token, ")")) fail("There's an extra `)`.", token.index);
    if (isOp(token, "(")) fail("Put an operator like `*` before `(`.", token.index);
    if (isOp(token, ":")) fail("`:` needs a `?` before it, like `a > b ? a : b`.", token.index);
    if (isOp(token, ",")) fail("`,` only separates values inside a function call, like `max(a, b)`.", token.index);
    if (isOp(token, ".")) fail(unsupported("."), token.index);
    fail(`Expected an operator or \`;\` before \`${token.text}\`.`, token.index);
  }

  function statement(): void {
    const start = peek();
    let nameToken: Token | undefined;
    if (start.kind === "ident" && isOp(peek(1), "=")) {
      nameToken = next();
      next();
      const name = nameToken.text;
      if (RESERVED_NAMES.has(name)) fail(`\`${name}\` is a reserved word, so it can't name a result.`, nameToken.index);
      const existing = names.get(name);
      if (existing?.kind === "input") fail(alreadyInput(name), nameToken.index);
      if (existing?.kind === "result") fail(`\`${name}\` names two results. Give each result its own name.`, nameToken.index);
    }
    if (parsed.length >= MAX_EXPRESSION_PORTS) fail(`A formula can have at most ${MAX_EXPRESSION_PORTS} results.`, start.index);
    const node = expression();
    const after = peek();
    if (isOp(after, "=")) {
      if (nameToken) fail("A statement can name only one result. Write `a = 1; b = a` instead of `a = b = 1`.", after.index);
      fail("Only a name can go on the left of `=`, like `total = a + b`.", after.index);
    }
    if (after.kind !== "eof" && !isOp(after, ";")) unexpectedAfterValue(after);
    if (!nameToken) {
      parsed.push({ name: null, evaluate: node.fn, slot: -1 });
      return;
    }
    const name = nameToken.text;
    if (names.get(name)?.kind === "input") fail(alreadyInput(name), nameToken.index);
    const slot = slotCount++;
    names.set(name, { slot, kind: "result" });
    parsed.push({ name, evaluate: node.fn, slot });
  }

  function expression(): Node {
    enter(peek());
    const condition = or();
    let result = condition;
    if (isOp(peek(), "?")) {
      next();
      const whenTrue = expression();
      if (!isOp(peek(), ":")) {
        const at = peek();
        fail(at.kind === "eof" ? "`?` needs a `:` after it, like `a > b ? a : b`." : `Expected \`:\` before \`${at.text}\`.`, at.index);
      }
      next();
      const whenFalse = expression();
      const c = condition.fn;
      const t = whenTrue.fn;
      const f = whenFalse.fn;
      result = value((env) => (truthy(c(env)) ? t(env) : f(env)));
    }
    depth--;
    return result;
  }

  function or(): Node {
    let left = and();
    while (isOp(peek(), "||")) {
      next();
      const l = left.fn;
      const r = and().fn;
      left = value((env) => {
        const a = l(env);
        return truthy(a) ? a : r(env);
      });
    }
    return left;
  }

  function and(): Node {
    let left = binary(equality, EQUALITY);
    while (isOp(peek(), "&&")) {
      next();
      const l = left.fn;
      const r = binary(equality, EQUALITY).fn;
      left = value((env) => {
        const a = l(env);
        return truthy(a) ? r(env) : a;
      });
    }
    return left;
  }

  function equality(): Node {
    return binary(relational, RELATIONAL);
  }

  function relational(): Node {
    return binary(additive, ADDITIVE);
  }

  function additive(): Node {
    return binary(unary, MULTIPLICATIVE);
  }

  /** Left-associative operators from `ops` over operands parsed by `operand`. */
  function binary(operand: () => Node, ops: ReadonlyMap<string, (a: number, b: number) => number>): Node {
    let left = operand();
    for (;;) {
      const token = peek();
      const op = token.kind === "op" ? ops.get(token.text) : undefined;
      if (!op) return left;
      next();
      const l = left.fn;
      const r = operand().fn;
      left = value((env) => op(l(env), r(env)));
    }
  }

  function unary(): Node {
    const token = peek();
    if (token.kind === "op" && (token.text === "-" || token.text === "+" || token.text === "!")) {
      next();
      enter(token);
      const operand = unary();
      depth--;
      if (operand.kind === "pow") fail("A sign can't sit directly before `**`. Write `(-2) ** 2` or `-(2 ** 2)`.", token.index);
      const f = operand.fn;
      if (token.text === "-") return value((env) => -f(env));
      if (token.text === "+") return value(f);
      return value((env) => (truthy(f(env)) ? 0 : 1));
    }
    return power();
  }

  function power(): Node {
    const base = primary();
    if (!isOp(peek(), "**")) return base;
    next();
    const b = base.fn;
    const e = unary().fn;
    return { kind: "pow", fn: (env) => b(env) ** e(env) };
  }

  function primary(): Node {
    const token = next();
    if (token.kind === "number") {
      const n = token.value;
      return value(() => n);
    }
    if (token.kind === "ident") return identifier(token);
    if (isOp(token, "(")) {
      const inner = expression();
      if (!isOp(peek(), ")")) {
        const at = peek();
        fail(at.kind === "eof" ? "This `(` needs a matching `)`." : `Expected \`)\` before \`${at.text}\`.`, at.kind === "eof" ? token.index : at.index);
      }
      next();
      return { kind: "group", fn: inner.fn };
    }
    if (token.kind === "eof") fail("The formula ends before it's finished.", token.index);
    fail(`Expected a value before \`${token.text}\`.`, token.index);
  }

  function identifier(token: Token): Node {
    const name = token.text;
    if (name === "Math") {
      if (!isOp(peek(), ".")) fail("`Math` is a reserved word, so it can't be a variable.", token.index);
      next();
      const member = next();
      if (member.kind !== "ident") fail("`Math.` needs a name after it, like `Math.PI`.", member.index);
      const full = `Math.${member.text}`;
      if (member.text === "random") fail("Random numbers come from the Random patch, so restarts are reproducible. Wire one into an input.", token.index);
      if (isOp(peek(), "(")) {
        if (isMathFunction(member.text)) return call(full, member.text, token);
        if (has(HELPERS, member.text)) fail(`\`${full}\` isn't a function. Write \`${member.text}(…)\` without \`Math.\`.`, token.index);
        fail(`\`${full}\` isn't a function.${suggest(member.text, MATH_FUNCTION_NAMES, "Math.")}`, token.index);
      }
      if (has(MATH_CONSTANTS, member.text)) {
        const n = MATH_CONSTANTS[member.text]!;
        return value(() => n);
      }
      if (isMathFunction(member.text)) fail(`\`${full}\` is a function, so it needs values in parentheses, like \`${full}(x)\`.`, token.index);
      fail(`${unsupported(full)}${suggest(member.text, Object.keys(MATH_CONSTANTS), "Math.")}`, token.index);
    }
    if (isOp(peek(), "(")) {
      if (RESERVED_NAMES.has(name)) fail(unsupported(name), token.index);
      if (isMathFunction(name) || has(HELPERS, name)) return call(name, name, token);
      fail(`\`${name}\` isn't a function.${suggest(name, [...MATH_FUNCTION_NAMES, ...HELPER_NAMES])}`, token.index);
    }
    if (has(LITERALS, name)) {
      const n = LITERALS[name]!;
      return value(() => n);
    }
    if (RESERVED_NAMES.has(name)) fail(`\`${name}\` is a reserved word, so it can't be a variable.`, token.index);
    if (isOp(peek(), ".")) {
      const member = peek(1);
      fail(unsupported(`${name}.${member.kind === "ident" ? member.text : ""}`), token.index);
    }
    const known = names.get(name);
    if (known) {
      const slot = known.slot;
      return value((env) => env[slot]!);
    }
    if (inputs.length >= MAX_EXPRESSION_PORTS) fail(`A formula can have at most ${MAX_EXPRESSION_PORTS} inputs.`, token.index);
    const slot = slotCount++;
    names.set(name, { slot, kind: "input" });
    inputs.push(name);
    inputSlots.push(slot);
    return value((env) => env[slot]!);
  }

  function call(display: string, name: string, token: Token): Node {
    next();
    const args: Evaluate[] = [];
    if (!isOp(peek(), ")")) {
      for (;;) {
        args.push(expression().fn);
        if (!isOp(peek(), ",")) break;
        next();
      }
    }
    if (!isOp(peek(), ")")) {
      const at = peek();
      fail(at.kind === "eof" ? `\`${display}(\` needs a matching \`)\`.` : `Expected \`,\` or \`)\` before \`${at.text}\`.`, at.kind === "eof" ? token.index : at.index);
    }
    next();
    const count = args.length;
    const unaryFn = UNARY_FUNCTIONS[name];
    if (has(UNARY_FUNCTIONS, name) && unaryFn) {
      if (count !== 1) {
        const hint = name === "round" ? ` To round to 2 decimals, write \`${display}(x * 100) / 100\`.` : "";
        fail(`\`${display}\` takes 1 value.${hint}`, token.index);
      }
      const a = args[0]!;
      return value((env) => unaryFn(a(env)));
    }
    const binaryFn = BINARY_FUNCTIONS[name];
    if (has(BINARY_FUNCTIONS, name) && binaryFn) {
      if (count !== 2) fail(`\`${display}\` takes 2 values.`, token.index);
      const a = args[0]!;
      const b = args[1]!;
      return value((env) => binaryFn(a(env), b(env)));
    }
    const variadicFn = VARIADIC_FUNCTIONS[name];
    if (has(VARIADIC_FUNCTIONS, name) && variadicFn) {
      if (count < 1) fail(`\`${display}\` takes at least 1 value.`, token.index);
      if (count === 1) {
        const a = args[0]!;
        return value((env) => variadicFn(a(env)));
      }
      if (count === 2) {
        const a = args[0]!;
        const b = args[1]!;
        return value((env) => variadicFn(a(env), b(env)));
      }
      return value((env) => variadicFn(...args.map((a) => a(env))));
    }
    const helper = HELPERS[name]!;
    if (count !== helper.arity) fail(`\`${display}\` takes ${helper.arity} ${helper.arity === 1 ? "value" : "values"}.`, token.index);
    return value((env) => helper.fn(...args.map((a) => a(env))));
  }

  while (peek().kind !== "eof") {
    if (isOp(peek(), ";")) {
      next();
      continue;
    }
    statement();
  }

  const outputs = assignOutputKeys(parsed.map((s) => s.name), inputs);
  return {
    ok: true,
    inputs,
    inputSlots,
    outputs,
    statements: parsed.map((s, i) => ({ ...outputs[i]!, evaluate: s.evaluate, slot: s.slot })),
    slotCount,
  };
}

/** Output ports for statements (a name, or null for unnamed): unnamed ones take the first free `output`, `output2`, …. */
function assignOutputKeys(names: readonly (string | null)[], inputs: readonly string[]): ExpressionOutput[] {
  const taken = new Set<string>([...inputs, ...names.filter((n): n is string => n !== null)]);
  let n = 1;
  return names.map((name) => {
    if (name !== null) return { key: name, name, named: true };
    for (;;) {
      const key = n === 1 ? "output" : `output${n}`;
      const label = n === 1 ? "Output" : `Output ${n}`;
      n++;
      if (!taken.has(key)) {
        taken.add(key);
        return { key, name: label, named: false };
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Lenient ports
// ---------------------------------------------------------------------------

const SCAN_RE = /0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`[^`]*`?|[A-Za-z_$][A-Za-z0-9_$]*/g;
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SEGMENT_NAME_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/;

/**
 * Ports for text that doesn't parse, so wires stay attached: identifiers used as values become
 * inputs (skipping reserved names, names after `Math.`, calls, and result names), and each
 * non-empty `;` segment becomes an output (its `name =` or the next free `output…` key).
 */
export function lenientPorts(text: string): { inputs: string[]; outputs: ExpressionOutput[] } {
  const source = text.slice(0, MAX_EXPRESSION_LENGTH);
  const segments = source.split(";").filter((s) => s.trim() !== "");
  const segmentNames: (string | null)[] = [];
  const named = new Set<string>();
  for (const segment of segments) {
    const m = SEGMENT_NAME_RE.exec(segment);
    const name = m && !RESERVED_NAMES.has(m[1]!) && !named.has(m[1]!) ? m[1]! : null;
    if (name !== null) named.add(name);
    segmentNames.push(name);
  }
  const inputs: string[] = [];
  for (const match of source.matchAll(SCAN_RE)) {
    const word = match[0];
    const start = match.index;
    if (!KEY_RE.test(word) || RESERVED_NAMES.has(word) || named.has(word) || inputs.includes(word)) continue;
    if (/Math\s*\.\s*$/.test(source.slice(Math.max(0, start - 16), start))) continue;
    if (/^\s*\(/.test(source.slice(start + word.length, start + word.length + 16))) continue;
    inputs.push(word);
    if (inputs.length >= MAX_EXPRESSION_PORTS) break;
  }
  return { inputs, outputs: assignOutputKeys(segmentNames.slice(0, MAX_EXPRESSION_PORTS), inputs) };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function locate(text: string, index: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  const end = Math.min(index, text.length);
  for (let i = 0; i < end; i++) {
    if (text[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: index - lineStart + 1 };
}

const CACHE_LIMIT = 256;
const cache = new Map<string, CompiledExpression>();

/** Compile formula text (cached by text). Invalid text returns the error plus lenient ports; it never throws. */
export function compileExpression(text: string): CompiledExpression {
  const hit = cache.get(text);
  if (hit) return hit;
  let result: CompiledExpression;
  try {
    result = parseProgram(text);
  } catch (err) {
    if (!(err instanceof ExpressionParseError)) throw err;
    const { line, column } = locate(text, err.index);
    const lenient = lenientPorts(text);
    result = { ok: false, error: { message: err.message, index: err.index, line, column }, inputs: lenient.inputs, outputs: lenient.outputs };
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(text, result);
  return result;
}

/** The parse problem in `text`, or null when it's a valid formula (empty text is valid). */
export function validateExpression(text: string): ExpressionError | null {
  const program = compileExpression(text);
  return program.ok ? null : program.error;
}

/** The ports a formula derives: number inputs by first appearance and one number output per statement. */
export function expressionPorts(text: string): { inputs: PortSpec[]; outputs: PortSpec[] } {
  const program = compileExpression(text);
  let statement = 0;
  return {
    inputs: program.inputs.map((key): PortSpec => ({ key, name: key, type: "number", default: 0, description: `Value of ${key} in the formula.` })),
    outputs: program.outputs.map((o): PortSpec => {
      statement++;
      return { key: o.key, name: o.name, type: "number", description: o.named ? `The value the formula gives ${o.key}.` : `The value of statement ${statement} in the formula.` };
    }),
  };
}
