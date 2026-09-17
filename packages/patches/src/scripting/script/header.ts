/**
 * The static script header (the javascript patch's dynamicPortsRule). Ports come from literal
 * `export const inputs/outputs/variants/alwaysEvaluate` declarations at the top of a script, or
 * from Origami-style `new PatchInput(...)` lists, read with the tokenizer and never by running code,
 * so core can validate ops headlessly and synchronously.
 */

import { didYouMean, didYouMeanText, parseColor } from "@sonobe/core";
import type { EnumOption, PortSpec, ValueSubtype, ValueType } from "@sonobe/core";
import { ScriptSyntaxError, tokenize, type Lexer, type Token } from "../sandbox/lexer.ts";

/** Scripts larger than this can't be read. */
export const MAX_SCRIPT_BYTES = 1024 * 1024;
/** Most ports a script may declare on each side. */
export const MAX_SCRIPT_PORTS = 32;

const HEADER_NAMES = ["inputs", "outputs", "variants", "alwaysEvaluate"] as const;
type HeaderName = (typeof HEADER_NAMES)[number];

const PORT_FIELDS = ["key", "name", "type", "subtype", "default", "min", "max", "step", "enumOptions", "description", "wholeLoop", "advanced"];
const PORT_TYPES: readonly ValueType[] = [
  "number", "boolean", "pulse", "text", "color", "point", "point3d", "point4d", "size", "anchor", "index", "enum", "json", "layer",
  "image", "video", "sound", "gradient", "shape", "textStyle", "layerEffect", "transform",
];
const SUBTYPES: readonly ValueSubtype[] = ["progress", "angle", "duration", "percent", "distance", "velocity", "multiline", "code", "url"];
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VECTOR_LENGTHS: Partial<Record<ValueType, number>> = { point: 2, size: 2, anchor: 2, point3d: 3, point4d: 4, transform: 16 };
const NULL_TYPES: ReadonlySet<ValueType> = new Set(["layer", "image", "video", "sound", "shape", "layerEffect"]);

/** Origami `types.X` constants and the Sonobe port they become. */
export const ORIGAMI_TYPES: Readonly<Record<string, { type: ValueType | "variant"; subtype?: ValueSubtype; step?: number }>> = {
  NUMBER: { type: "number" },
  PROGRESS: { type: "number", subtype: "progress" },
  INTEGER: { type: "number", step: 1 },
  POSITION: { type: "point" },
  SIZE: { type: "size" },
  ANCHOR: { type: "anchor" },
  POINT3D: { type: "point3d" },
  POINT4D: { type: "point4d" },
  COLOR: { type: "color" },
  BOOLEAN: { type: "boolean" },
  PULSE: { type: "pulse" },
  ENUM: { type: "index" },
  STRING: { type: "text" },
  JSON: { type: "json" },
  IMAGE: { type: "image" },
  VARIANT: { type: "variant" },
};

/** One declared port, before the active variant is applied. */
export interface HeaderPort {
  key: string;
  name: string;
  type: ValueType | "variant";
  subtype?: ValueSubtype;
  /** Document-encoded default (CONVENTIONS §7), when declared. */
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  enumOptions?: EnumOption[];
  description: string;
  wholeLoop: boolean;
  advanced: boolean;
  /** Origami-style scripts: the `types.X` constant name, for `patch.type` and value conversion. */
  origamiType?: string;
}

export interface ScriptHeader {
  mode: "native" | "compat";
  inputs: HeaderPort[];
  outputs: HeaderPort[];
  /** Allowed variants when a port uses "variant"; null otherwise. */
  variants: ValueType[] | null;
  alwaysEvaluate: boolean;
  /** Any port is wholeLoop (or an Origami script sets loopAware). */
  wholeLoop: boolean;
  /** Origami scripts: the variant constant names in declaration order. */
  origamiVariants?: string[];
}

class HeaderError extends Error {}

function fail(lexer: Lexer, file: string, offset: number, message: string): never {
  const { line, column } = lexer.position(offset);
  throw new HeaderError(`scripts/${file}:${line}:${column} ${message}`);
}

// ---------------------------------------------------------------------------
// Literals
// ---------------------------------------------------------------------------

interface Lit {
  kind: "object" | "array" | "string" | "number" | "boolean" | "null";
  value: unknown;
  start: number;
  members?: Map<string, { keyStart: number; value: Lit }>;
  items?: Lit[];
}

class TokenReader {
  readonly tokens: readonly Token[];
  readonly lexer: Lexer;
  readonly file: string;
  i: number;
  private readonly tokenizeError: ScriptSyntaxError | undefined;

  constructor(tokens: readonly Token[], lexer: Lexer, file: string, error: ScriptSyntaxError | undefined, start = 0) {
    this.tokens = tokens;
    this.lexer = lexer;
    this.file = file;
    this.tokenizeError = error;
    this.i = start;
  }

  peek(offset = 0): Token | undefined {
    const t = this.tokens[this.i + offset];
    if (!t && this.tokenizeError && offset === 0) throw new HeaderError(`scripts/${this.file}:${this.tokenizeError.line}:${this.tokenizeError.column} ${this.tokenizeError.message}`);
    return t;
  }

  isPunct(value: string, offset = 0): boolean {
    const t = this.tokens[this.i + offset];
    return t?.type === "punct" && t.value === value;
  }

  isName(value: string, offset = 0): boolean {
    const t = this.tokens[this.i + offset];
    return t?.type === "name" && t.value === value;
  }

  notPlain(token: Token | undefined): never {
    if (!token) {
      const end = this.lexer.src.length;
      return fail(this.lexer, this.file, end, "Write the port list as plain values. The script ended before the list did.");
    }
    const { line } = this.lexer.position(token.start);
    const text = this.lexer.src.slice(token.start, Math.min(token.end, token.start + 24));
    return fail(this.lexer, this.file, token.start, `Write the port list as plain values. ${text} at line ${line} isn't allowed here.`);
  }

  literal(): Lit {
    const t = this.peek();
    if (!t) return this.notPlain(t);
    const start = t.start;
    if (t.type === "punct" && t.value === "{") {
      this.i++;
      const members = new Map<string, { keyStart: number; value: Lit }>();
      const value: Record<string, unknown> = {};
      while (!this.isPunct("}")) {
        const key = this.peek();
        if (!key || (key.type !== "name" && key.type !== "string")) return this.notPlain(key);
        this.i++;
        if (!this.isPunct(":")) return this.notPlain(this.peek());
        this.i++;
        const member = this.literal();
        if (members.has(key.value)) fail(this.lexer, this.file, key.start, `The field "${key.value}" appears twice.`);
        members.set(key.value, { keyStart: key.start, value: member });
        value[key.value] = member.value;
        if (this.isPunct(",")) this.i++;
        else if (!this.isPunct("}")) return this.notPlain(this.peek());
      }
      this.i++;
      return { kind: "object", value, start, members };
    }
    if (t.type === "punct" && t.value === "[") {
      this.i++;
      const items: Lit[] = [];
      while (!this.isPunct("]")) {
        items.push(this.literal());
        if (this.isPunct(",")) this.i++;
        else if (!this.isPunct("]")) return this.notPlain(this.peek());
      }
      this.i++;
      return { kind: "array", value: items.map((item) => item.value), start, items };
    }
    if (t.type === "string") {
      this.i++;
      return { kind: "string", value: t.value, start };
    }
    if (t.type === "template") {
      if (t.hasSubstitutions || t.cooked === undefined) return this.notPlain(t);
      this.i++;
      return { kind: "string", value: t.cooked, start };
    }
    if (t.type === "num" && typeof t.number === "number") {
      this.i++;
      return { kind: "number", value: t.number, start };
    }
    if (t.type === "punct" && t.value === "-") {
      const next = this.tokens[this.i + 1];
      if (next?.type === "num" && typeof next.number === "number") {
        this.i += 2;
        return { kind: "number", value: -next.number, start };
      }
      return this.notPlain(t);
    }
    if (t.type === "name" && (t.value === "true" || t.value === "false")) {
      this.i++;
      return { kind: "boolean", value: t.value === "true", start };
    }
    if (t.type === "name" && t.value === "null") {
      this.i++;
      return { kind: "null", value: null, start };
    }
    return this.notPlain(t);
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** "itemCount" → "Item Count", "max_speed" → "Max Speed". */
export function titleCaseKey(key: string): string {
  const words = key
    .replace(/_+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Whether a document-encoded literal fits a port type (CONVENTIONS §7). */
export function literalFitsType(value: unknown, type: ValueType, enumOptions?: readonly EnumOption[]): boolean {
  switch (type) {
    case "number":
      return isFiniteNumber(value);
    case "index":
      return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
    case "boolean":
      return typeof value === "boolean";
    case "text":
      return typeof value === "string";
    case "enum":
      return typeof value === "string" && (enumOptions ?? []).some((o) => o.key === value);
    case "color":
      return typeof value === "string" && parseColor(value) !== undefined;
    case "point":
    case "size":
    case "anchor":
    case "point3d":
    case "point4d":
    case "transform":
      return Array.isArray(value) && value.length === VECTOR_LENGTHS[type] && value.every(isFiniteNumber);
    case "json":
      return true;
    case "gradient":
      return value === null || (typeof value === "object" && !Array.isArray(value) && Array.isArray((value as { stops?: unknown }).stops));
    case "textStyle":
      return value === null || (typeof value === "object" && !Array.isArray(value));
    case "pulse":
      return false;
    default:
      return NULL_TYPES.has(type) ? value === null : false;
  }
}

/** The zero value of a type in document encoding (CONVENTIONS §8). */
export function zeroLiteral(type: ValueType, enumOptions?: readonly EnumOption[]): unknown {
  switch (type) {
    case "number":
    case "index":
      return 0;
    case "boolean":
      return false;
    case "text":
      return "";
    case "enum":
      return enumOptions?.[0]?.key ?? "";
    case "color":
      return "#00000000";
    case "point":
    case "size":
    case "anchor":
      return [0, 0];
    case "point3d":
      return [0, 0, 0];
    case "point4d":
      return [0, 0, 0, 0];
    case "transform":
      return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    case "textStyle":
      return {};
    default:
      return null;
  }
}

function validatePort(reader: TokenReader, lit: Lit, side: "input" | "output"): HeaderPort {
  const { lexer, file } = reader;
  if (lit.kind !== "object") fail(lexer, file, lit.start, `Each ${side} is an object like { key: "count", type: "number" }.`);
  const members = lit.members!;
  for (const [field, { keyStart }] of members) {
    if (!PORT_FIELDS.includes(field)) fail(lexer, file, keyStart, `"${field}" isn't a port field.${didYouMeanText(didYouMean(field, PORT_FIELDS))} Fields: ${PORT_FIELDS.join(", ")}.`);
  }
  const field = (name: string) => members.get(name)?.value;
  const keyLit = field("key");
  if (!keyLit) fail(lexer, file, lit.start, `This ${side} needs a key, like key: "count".`);
  if (keyLit.kind !== "string" || !KEY_PATTERN.test(keyLit.value as string)) fail(lexer, file, keyLit.start, `A port key starts with a letter or _ and uses only letters, digits, and _.`);
  const key = keyLit.value as string;
  const typeLit = field("type");
  if (!typeLit) fail(lexer, file, lit.start, `The ${side} "${key}" needs a type, like type: "number".`);
  if (typeLit.kind !== "string") fail(lexer, file, typeLit.start, `A port type is text, like "number".`);
  const rawType = typeLit.value as string;
  if (rawType === "any") fail(lexer, file, typeLit.start, `"any" isn't a port type. Use "json" for data, or "variant" with export const variants for several types.`);
  if (rawType !== "variant" && !(PORT_TYPES as readonly string[]).includes(rawType)) {
    fail(lexer, file, typeLit.start, `"${rawType}" isn't a port type.${didYouMeanText(didYouMean(rawType, [...PORT_TYPES, "variant"]))}`);
  }
  const type = rawType as ValueType | "variant";
  const port: HeaderPort = { key, name: titleCaseKey(key), type, description: "", wholeLoop: false, advanced: false };
  const text = (name: string): string | undefined => {
    const v = field(name);
    if (!v) return undefined;
    if (v.kind !== "string") fail(lexer, file, v.start, `${name} is text.`);
    return v.value as string;
  };
  const flag = (name: string): boolean => {
    const v = field(name);
    if (!v) return false;
    if (v.kind !== "boolean") fail(lexer, file, v.start, `${name} is true or false.`);
    return v.value as boolean;
  };
  const num = (name: string): number | undefined => {
    const v = field(name);
    if (!v) return undefined;
    if (v.kind !== "number" || !Number.isFinite(v.value)) fail(lexer, file, v.start, `${name} is a finite number.`);
    return v.value as number;
  };
  port.name = text("name") || port.name;
  port.description = text("description") ?? "";
  const subtype = text("subtype");
  if (subtype !== undefined) {
    if (!(SUBTYPES as readonly string[]).includes(subtype)) fail(lexer, file, field("subtype")!.start, `"${subtype}" isn't a subtype.${didYouMeanText(didYouMean(subtype, SUBTYPES))}`);
    port.subtype = subtype as ValueSubtype;
  }
  const min = num("min");
  const max = num("max");
  const step = num("step");
  if (min !== undefined) port.min = min;
  if (max !== undefined) port.max = max;
  if (min !== undefined && max !== undefined && min > max) fail(lexer, file, field("min")!.start, `min (${min}) is larger than max (${max}).`);
  if (step !== undefined) {
    if (step <= 0) fail(lexer, file, field("step")!.start, "step must be larger than 0.");
    port.step = step;
  }
  port.wholeLoop = flag("wholeLoop");
  port.advanced = flag("advanced");
  const optionsLit = field("enumOptions");
  if (type === "enum" || optionsLit) {
    if (!optionsLit) fail(lexer, file, lit.start, `The enum port "${key}" needs enumOptions, like enumOptions: ["small", "large"].`);
    if (optionsLit.kind !== "array" || optionsLit.items!.length < 1 || optionsLit.items!.length > 256) fail(lexer, file, optionsLit.start, "enumOptions is a list of 1 to 256 options.");
    const options: EnumOption[] = [];
    for (const item of optionsLit.items!) {
      let option: EnumOption;
      if (item.kind === "string") option = { key: item.value as string, name: item.value as string };
      else if (item.kind === "object") {
        const optKey = item.members!.get("key")?.value;
        if (!optKey || optKey.kind !== "string") fail(lexer, file, item.start, `An option object needs a key, like { key: "small", name: "Small" }.`);
        for (const [f, { keyStart }] of item.members!) if (!["key", "name", "description"].includes(f)) fail(lexer, file, keyStart, `"${f}" isn't an option field. Options take key, name, and description.`);
        const optName = item.members!.get("name")?.value;
        const optDescription = item.members!.get("description")?.value;
        option = { key: optKey.value as string, name: optName?.kind === "string" ? (optName.value as string) : (optKey.value as string) };
        if (optDescription?.kind === "string") option.description = optDescription.value as string;
      } else fail(lexer, file, item.start, "Each option is text or { key, name }.");
      if (!KEY_PATTERN.test(option.key)) fail(lexer, file, item.start, `The option key "${option.key}" starts with a letter or _ and uses only letters, digits, and _.`);
      if (options.some((o) => o.key === option.key)) fail(lexer, file, item.start, `The option "${option.key}" appears twice.`);
      options.push(option);
    }
    if (type === "enum") port.enumOptions = options;
  }
  const defaultLit = field("default");
  if (defaultLit) {
    if (type === "pulse") fail(lexer, file, defaultLit.start, "Pulse ports don't take a default.");
    let value = defaultLit.value;
    if (type !== "variant") {
      const loop = port.wholeLoop && defaultLit.kind === "object" && defaultLit.members!.size === 1 && defaultLit.members!.has("loop") ? defaultLit.members!.get("loop")!.value : null;
      const check = (v: unknown, at: number) => {
        if (!literalFitsType(v, type, port.enumOptions)) fail(lexer, file, at, `The default for "${key}" doesn't fit its type ${type}.${type === "color" ? ' Write colors as "#RRGGBBAA".' : ""}`);
      };
      if (loop) {
        if (loop.kind !== "array") fail(lexer, file, loop.start, `A loop default is { loop: [ ... ] }.`);
        for (const item of loop.items!) check(item.value, item.start);
        value = { loop: loop.items!.map((item) => normalizeLiteral(item.value, type)) };
      } else {
        check(value, defaultLit.start);
        value = normalizeLiteral(value, type);
      }
    }
    port.default = value;
  }
  return port;
}

function normalizeLiteral(value: unknown, type: ValueType): unknown {
  if (type === "color" && typeof value === "string") {
    const c = parseColor(value)!;
    const hex = (n: number) => Math.round(n * 255).toString(16).toUpperCase().padStart(2, "0");
    return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}${hex(c.a)}`;
  }
  return value;
}

function validateVariants(reader: TokenReader, lit: Lit): ValueType[] {
  const { lexer, file } = reader;
  if (lit.kind !== "array") fail(lexer, file, lit.start, 'variants is a list of types, like ["number", "point"].');
  const out: ValueType[] = [];
  for (const item of lit.items!) {
    if (item.kind !== "string") fail(lexer, file, item.start, "Each variant is a type name.");
    const t = item.value as string;
    if (t === "pulse" || t === "enum" || t === "variant" || t === "any") fail(lexer, file, item.start, `"${t}" can't be a variant.`);
    if (!(PORT_TYPES as readonly string[]).includes(t)) fail(lexer, file, item.start, `"${t}" isn't a type.${didYouMeanText(didYouMean(t, PORT_TYPES))}`);
    if (out.includes(t as ValueType)) fail(lexer, file, item.start, `The variant "${t}" appears twice.`);
    out.push(t as ValueType);
  }
  if (out.length < 2) fail(lexer, file, lit.start, "variants lists at least 2 types.");
  return out;
}

function finishHeader(reader: TokenReader, header: ScriptHeader, variantsLit: Lit | null): ScriptHeader {
  const { lexer, file } = reader;
  const keys = new Set<string>();
  for (const port of [...header.inputs, ...header.outputs]) {
    if (keys.has(port.key)) fail(lexer, file, 0, `The key "${port.key}" is used twice. Keys must be unique across inputs and outputs.`);
    keys.add(port.key);
  }
  const hasVariantPort = [...header.inputs, ...header.outputs].some((p) => p.type === "variant");
  if (hasVariantPort && !header.variants) fail(lexer, file, variantsLit?.start ?? 0, 'A "variant" port needs export const variants, like ["number", "point"].');
  if (!hasVariantPort) header.variants = null;
  header.wholeLoop ||= [...header.inputs, ...header.outputs].some((p) => p.wholeLoop);
  return header;
}

function readPortList(reader: TokenReader, lit: Lit, side: "input" | "output"): HeaderPort[] {
  if (lit.kind !== "array") fail(reader.lexer, reader.file, lit.start, `${side}s is a list of ports, like [{ key: "count", type: "number" }].`);
  if (lit.items!.length > MAX_SCRIPT_PORTS) fail(reader.lexer, reader.file, lit.start, `A script can declare at most ${MAX_SCRIPT_PORTS} ${side}s.`);
  return lit.items!.map((item) => validatePort(reader, item, side));
}

// ---------------------------------------------------------------------------
// Native headers
// ---------------------------------------------------------------------------

function readNative(reader: TokenReader): ScriptHeader {
  const { lexer, file, tokens } = reader;
  const header: ScriptHeader = { mode: "native", inputs: [], outputs: [], variants: null, alwaysEvaluate: false, wholeLoop: false };
  const declared = new Set<HeaderName>();
  let variantsLit: Lit | null = null;
  if (reader.peek()?.type === "string" && reader.peek()!.value === "use strict") {
    reader.i++;
    if (reader.isPunct(";")) reader.i++;
  }
  while (reader.isName("export") && reader.isName("const", 1) && HEADER_NAMES.includes(tokens[reader.i + 2]?.value as HeaderName) && tokens[reader.i + 2]?.type === "name" && reader.isPunct("=", 3)) {
    const nameToken = tokens[reader.i + 2]!;
    const name = nameToken.value as HeaderName;
    if (declared.has(name)) fail(lexer, file, nameToken.start, `export const ${name} appears twice.`);
    declared.add(name);
    reader.i += 4;
    const lit = reader.literal();
    if (reader.isPunct(";")) reader.i++;
    else {
      const next = reader.peek();
      if (next && !next.nl) reader.notPlain(next);
    }
    switch (name) {
      case "inputs":
        header.inputs = readPortList(reader, lit, "input");
        break;
      case "outputs":
        header.outputs = readPortList(reader, lit, "output");
        break;
      case "variants":
        variantsLit = lit;
        header.variants = validateVariants(reader, lit);
        break;
      case "alwaysEvaluate":
        if (lit.kind !== "boolean") fail(lexer, file, lit.start, "alwaysEvaluate is true or false.");
        header.alwaysEvaluate = lit.value as boolean;
        break;
    }
  }
  let depth = 0;
  for (let i = reader.i; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type === "punct" && (t.value === "{" || t.value === "(" || t.value === "[")) depth++;
    else if (t.type === "punct" && (t.value === "}" || t.value === ")" || t.value === "]")) depth--;
    else if (depth === 0 && t.type === "name" && t.value === "export") {
      const kw = tokens[i + 1];
      const target = tokens[i + 2];
      if (kw?.type === "name" && (kw.value === "const" || kw.value === "let" || kw.value === "var") && target?.type === "name" && HEADER_NAMES.includes(target.value as HeaderName)) {
        fail(lexer, file, t.start, `Move export const ${target.value} above the other code so Sonobe can read the ports without running the script.`);
      }
    }
  }
  return finishHeader(reader, header, variantsLit);
}

// ---------------------------------------------------------------------------
// Origami-style headers
// ---------------------------------------------------------------------------

/** "Email Address" → "emailAddress"; a leading digit gets the prefix "port". */
export function camelCaseName(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!words.length) return "";
  const out = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase())).join("");
  return /^[0-9]/.test(out) ? `port${out[0]!.toUpperCase()}${out.slice(1)}` : out;
}

function origamiDefault(reader: TokenReader, lit: Lit, type: ValueType | "variant", origamiType: string): unknown {
  const { lexer, file } = reader;
  const v = lit.value;
  if (type === "variant") return v;
  if (VECTOR_LENGTHS[type] && lit.kind === "object") {
    const keys = ["x", "y", "z", "w"].slice(0, VECTOR_LENGTHS[type]);
    const out = keys.map((k) => (v as Record<string, unknown>)[k] ?? 0);
    if (!out.every(isFiniteNumber)) fail(lexer, file, lit.start, `The default for a ${origamiType} port is { ${keys.join(", ")} } with numbers.`);
    return out;
  }
  if (type === "color" && lit.kind === "object") {
    const c = v as Record<string, unknown>;
    const channels = ["x", "y", "z", "w"].map((k, i) => (c[k] ?? (i === 3 ? 1 : 0)) as unknown);
    if (!channels.every(isFiniteNumber)) fail(lexer, file, lit.start, "The default for a COLOR port is { x, y, z, w } with numbers from 0 to 1.");
    const hex = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).toUpperCase().padStart(2, "0");
    return `#${(channels as number[]).map(hex).join("")}`;
  }
  if (type === "index" && isFiniteNumber(v)) return Math.max(0, Math.floor(v));
  if (!literalFitsType(v, type)) fail(lexer, file, lit.start, `The default doesn't fit a ${origamiType} port.`);
  return normalizeLiteral(v, type);
}

function readOrigamiTypeRef(reader: TokenReader): { name: string; start: number } {
  const t = reader.peek();
  if (!t || !reader.isName("types") || !reader.isPunct(".", 1) || reader.tokens[reader.i + 2]?.type !== "name") return reader.notPlain(t);
  const nameToken = reader.tokens[reader.i + 2]!;
  reader.i += 3;
  if (!ORIGAMI_TYPES[nameToken.value]) fail(reader.lexer, reader.file, nameToken.start, `types.${nameToken.value} isn't a port type.${didYouMeanText(didYouMean(nameToken.value, Object.keys(ORIGAMI_TYPES)))}`);
  return { name: nameToken.value, start: t.start };
}

function readOrigamiPorts(reader: TokenReader, side: "input" | "output", taken: Set<string>): HeaderPort[] {
  const { lexer, file } = reader;
  const ctor = side === "input" ? "PatchInput" : "PatchOutput";
  if (!reader.isPunct("[")) reader.notPlain(reader.peek());
  reader.i++;
  const ports: HeaderPort[] = [];
  while (!reader.isPunct("]")) {
    if (!reader.isName("new") || !reader.isName(ctor, 1) || !reader.isPunct("(", 2)) reader.notPlain(reader.peek());
    reader.i += 3;
    const nameLit = reader.literal();
    if (nameLit.kind !== "string") fail(lexer, file, nameLit.start, `The first argument to new ${ctor} is the port name.`);
    if (!reader.isPunct(",")) reader.notPlain(reader.peek());
    reader.i++;
    const typeRef = readOrigamiTypeRef(reader);
    const mapped = ORIGAMI_TYPES[typeRef.name]!;
    let defaultLit: Lit | null = null;
    if (reader.isPunct(",") && !reader.isPunct(")", 1)) {
      reader.i++;
      defaultLit = reader.literal();
    }
    if (reader.isPunct(",")) reader.i++;
    if (!reader.isPunct(")")) reader.notPlain(reader.peek());
    reader.i++;
    const position = ports.length + 1;
    const displayName = nameLit.value as string;
    let key = camelCaseName(displayName);
    if (!key || taken.has(key)) key = `${side}${position}`;
    taken.add(key);
    const port: HeaderPort = { key, name: displayName || `${side === "input" ? "Input" : "Output"} ${position}`, type: mapped.type, description: "", wholeLoop: false, advanced: false, origamiType: typeRef.name };
    if (mapped.subtype) port.subtype = mapped.subtype;
    if (mapped.step) port.step = mapped.step;
    if (defaultLit && mapped.type !== "pulse") port.default = origamiDefault(reader, defaultLit, mapped.type, typeRef.name);
    ports.push(port);
    if (reader.isPunct(",")) reader.i++;
    else if (!reader.isPunct("]")) reader.notPlain(reader.peek());
  }
  reader.i++;
  if (ports.length > MAX_SCRIPT_PORTS) fail(lexer, file, 0, `A script can declare at most ${MAX_SCRIPT_PORTS} ${side}s.`);
  return ports;
}

function readCompat(reader: TokenReader): ScriptHeader {
  const { lexer, file, tokens } = reader;
  const header: ScriptHeader = { mode: "compat", inputs: [], outputs: [], variants: null, alwaysEvaluate: false, wholeLoop: false };
  let patchName: string | null = null;
  let loopAware = false;
  let depth = 0;
  let variantsStart = 0;
  const taken = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type === "punct" && (t.value === "{" || t.value === "(" || t.value === "[")) {
      depth++;
      continue;
    }
    if (t.type === "punct" && (t.value === "}" || t.value === ")" || t.value === "]")) {
      depth--;
      continue;
    }
    if (depth !== 0 || t.type !== "name") continue;
    const at = (k: number) => tokens[i + k];
    if (!patchName && (t.value === "var" || t.value === "let" || t.value === "const") && at(1)?.type === "name" && at(2)?.value === "=" && at(3)?.value === "new" && at(4)?.value === "Patch" && at(5)?.value === "(") {
      patchName = at(1)!.value;
      continue;
    }
    if (!patchName || t.value !== patchName || at(1)?.value !== "." || at(2)?.type !== "name" || at(3)?.value !== "=") continue;
    const property = at(2)!.value;
    reader.i = i + 4;
    switch (property) {
      case "inputs":
        header.inputs = readOrigamiPorts(reader, "input", taken);
        break;
      case "outputs":
        header.outputs = readOrigamiPorts(reader, "output", taken);
        break;
      case "variants": {
        variantsStart = reader.peek()?.start ?? 0;
        if (!reader.isPunct("[")) reader.notPlain(reader.peek());
        reader.i++;
        const names: string[] = [];
        while (!reader.isPunct("]")) {
          names.push(readOrigamiTypeRef(reader).name);
          if (reader.isPunct(",")) reader.i++;
          else if (!reader.isPunct("]")) reader.notPlain(reader.peek());
        }
        reader.i++;
        const types = names.map((n) => ORIGAMI_TYPES[n]!.type);
        if (types.some((ty) => ty === "pulse" || ty === "variant") || new Set(types).size < 2) fail(lexer, file, variantsStart, "patch.variants lists at least 2 different types, and not PULSE or VARIANT.");
        header.variants = types as ValueType[];
        header.origamiVariants = names;
        break;
      }
      case "loopAware":
      case "alwaysNeedsToEvaluate": {
        const lit = reader.literal();
        if (lit.kind !== "boolean") fail(lexer, file, lit.start, `patch.${property} is true or false.`);
        if (property === "loopAware") loopAware = lit.value as boolean;
        else header.alwaysEvaluate = lit.value as boolean;
        break;
      }
      default:
        continue;
    }
    i = reader.i - 1;
  }
  if (loopAware) {
    header.wholeLoop = true;
    for (const p of [...header.inputs, ...header.outputs]) p.wholeLoop = true;
  }
  return finishHeader(reader, header, null);
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

const cache = new Map<string, ScriptHeader | HeaderError>();
const CACHE_SIZE = 64;

/** True when a source is an Origami-style script (no top-level export, and it builds `new Patch(`). */
export function isCompatSource(tokens: readonly Token[], source: string): boolean {
  if (!source.includes("new Patch(")) return false;
  let depth = 0;
  for (const t of tokens) {
    if (t.type === "punct" && t.value === "{") depth++;
    else if (t.type === "punct" && t.value === "}") depth--;
    else if (depth === 0 && t.type === "name" && t.value === "export") return false;
  }
  return true;
}

/**
 * Read a script's header without running it. Throws `Error("scripts/<file>:<line>:<column> <message>")`.
 * Results are memoized by file and source.
 */
export function readScriptHeader(source: string, file: string): ScriptHeader {
  const cacheKey = `${file} ${source}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    if (cached instanceof HeaderError) throw cached;
    return cached;
  }
  let result: ScriptHeader | HeaderError;
  try {
    if (source.length > MAX_SCRIPT_BYTES) throw new HeaderError(`scripts/${file} is larger than 1 MB, so Sonobe can't read its ports.`);
    const { tokens, lexer, error } = tokenize(source, { stopOnError: true });
    const reader = new TokenReader(tokens, lexer, file, error);
    result = isCompatSource(tokens, source) ? readCompat(reader) : readNative(reader);
  } catch (err) {
    if (!(err instanceof HeaderError)) throw err;
    result = err;
  }
  cache.set(cacheKey, result);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  if (result instanceof HeaderError) throw result;
  return result;
}

/** The active variant: `typeParam` when the header lists it, else the first variant; null without variants. */
export function activeVariant(header: ScriptHeader, typeParam: string | undefined): ValueType | null {
  if (!header.variants?.length) return null;
  return typeParam !== undefined && (header.variants as string[]).includes(typeParam) ? (typeParam as ValueType) : header.variants[0]!;
}

/** A header port's concrete type for the active variant. */
export function portType(port: HeaderPort, variant: ValueType | null): ValueType {
  return port.type === "variant" ? (variant ?? "json") : port.type;
}

function toPortSpec(port: HeaderPort, variant: ValueType | null, side: "input" | "output"): PortSpec {
  const type = portType(port, variant);
  const spec: PortSpec = { key: port.key, name: port.name, type, description: port.description };
  if (port.subtype) spec.subtype = port.subtype;
  if (side === "input" && type !== "pulse") {
    let value = port.default;
    const fits = value !== undefined && (port.wholeLoop && isLoopLiteral(value) ? value.loop.every((item) => literalFitsType(item, type, port.enumOptions)) : literalFitsType(value, type, port.enumOptions));
    if (!fits) value = port.wholeLoop ? { loop: [] } : zeroLiteral(type, port.enumOptions);
    spec.default = value;
  }
  if (port.min !== undefined) spec.min = port.min;
  if (port.max !== undefined) spec.max = port.max;
  if (port.step !== undefined) spec.step = port.step;
  if (port.enumOptions) spec.enumOptions = port.enumOptions.map((o) => ({ ...o }));
  if (port.wholeLoop) spec.wholeLoop = true;
  if (port.advanced) spec.advanced = true;
  return spec;
}

function isLoopLiteral(value: unknown): value is { loop: unknown[] } {
  return typeof value === "object" && value !== null && Array.isArray((value as { loop?: unknown }).loop);
}

/** PortSpecs for a header and variant, in declaration order. */
export function headerPortSpecs(header: ScriptHeader, typeParam: string | undefined): { inputs: PortSpec[]; outputs: PortSpec[] } {
  const variant = activeVariant(header, typeParam);
  return {
    inputs: header.inputs.map((p) => toPortSpec(p, variant, "input")),
    outputs: header.outputs.map((p) => toPortSpec(p, variant, "output")),
  };
}
