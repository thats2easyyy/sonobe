/**
 * Validates the built-in patch catalog against CONVENTIONS.md: index.json,
 * census-decisions.json, and any chunk files (<category>-<n>.json).
 *
 * Node-only dev script:
 *   node packages/patches/catalog/validate.ts                  index, decisions, every chunk present
 *   node packages/patches/catalog/validate.ts state-1.json     index, decisions, and the named chunks
 */

import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LAYER_TYPES } from "@sonobe/core";
import type { PatchCategory, ValueSubtype, ValueType } from "@sonobe/core";

export interface CatalogIssue {
  severity: "error" | "warning";
  where: string;
  message: string;
}

export interface IndexEntry {
  type: string;
  name: string;
  category: PatchCategory;
  tier: 1 | 2 | 3;
  origami_id: string | null;
  origami_name: string | null;
  file: string;
}

type Json = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Contract mirrors (kept exhaustive by the type checks below)
// ---------------------------------------------------------------------------

const CATEGORIES = [
  "interaction", "animation", "state", "logic", "math", "loops", "text", "color",
  "data", "device", "media", "shapes", "layers", "utility", "components", "scripting",
] as const satisfies readonly PatchCategory[];

const VALUE_TYPES = [
  "number", "boolean", "pulse", "text", "color", "point", "point3d", "point4d", "size", "anchor",
  "index", "enum", "json", "layer", "image", "video", "sound", "gradient", "shape", "textStyle",
  "layerEffect", "transform", "connection", "any",
] as const satisfies readonly ValueType[];

const SUBTYPES = [
  "progress", "angle", "duration", "percent", "distance", "velocity", "multiline", "code", "url",
] as const satisfies readonly ValueSubtype[];

type Exhaustive<Union, Listed> = [Exclude<Union, Listed>] extends [never] ? true : never;
const categoriesExhaustive: Exhaustive<PatchCategory, (typeof CATEGORIES)[number]> = true;
const valueTypesExhaustive: Exhaustive<ValueType, (typeof VALUE_TYPES)[number]> = true;
const subtypesExhaustive: Exhaustive<ValueSubtype, (typeof SUBTYPES)[number]> = true;
void [categoriesExhaustive, valueTypesExhaustive, subtypesExhaustive];

// ---------------------------------------------------------------------------
// Conventions
// ---------------------------------------------------------------------------

const MAX_CHUNK = 18;
const KEY_RE = /^[a-z][a-zA-Z0-9]*$/;
const STATUSES = ["supported", "web-limited", "unsupported-web"];
const PLATFORMS = ["desktop", "web", "mobile"];
const SETTING_TYPES = ["text", "number", "boolean", "enum", "json"];
const NOTE_RE = /^(verified|legacy|inferred|sonobe): \S/;

const ENTRY_KEYS = [
  "type", "name", "category", "tier", "status", "statusReason", "platforms", "aliases", "summary", "docs",
  "behavior", "inputs", "outputs", "variadic", "variants", "variantDefaults", "inputCountRange", "settings",
  "dynamicPortsRule", "alwaysEvaluate", "shortcut", "pairsWellWith", "commonMistakes", "examples", "origami",
  "importAliases", "origamiPorts", "defaultNotes",
];
const REQUIRED_ENTRY_KEYS = [
  "type", "name", "category", "tier", "status", "aliases", "summary", "docs", "behavior", "inputs", "outputs",
  "alwaysEvaluate", "pairsWellWith", "commonMistakes", "examples", "origami",
];
const PORT_KEYS = ["key", "name", "type", "subtype", "default", "min", "max", "step", "enumOptions", "description", "wholeLoop", "advanced", "acceptsPulse"];
const VARIADIC_KEYS = ["key", "name", "type", "default", "min", "max", "defaultCount", "startIndex", "direction", "description"];
const SETTING_KEYS = ["key", "name", "type", "default", "enumOptions", "description"];
const EXAMPLE_KEYS = ["title", "description", "outline"];
const INDEX_KEYS = ["type", "name", "category", "tier", "origami_id", "origami_name", "file"];
const DECISION_KEYS = ["census_name", "census_id", "census_category", "source", "decision", "type", "note", "reason"];

const EQUATABLE = ["number", "boolean", "text", "color", "point", "point3d", "point4d", "size", "anchor", "index", "enum", "json"];
const VARIANT_SETS: Record<string, readonly string[]> = {
  INTERPOLABLE: ["number", "point", "point3d", "point4d", "size", "anchor", "color"],
  ARITHMETIC: ["number", "point", "point3d", "point4d", "size"],
  ADDABLE: ["number", "point", "point3d", "point4d", "size", "text"],
  ORDERED: ["number", "index", "boolean"],
  EQUATABLE,
  VALUE: [...EQUATABLE, "image", "video", "sound", "gradient", "shape", "layerEffect", "layer"],
};

const SHORTCUTS: Record<string, string> = {
  interaction: "I", switch: "S", popAnimation: "A", classicAnimation: "C", transition: "T", keyboard: "K",
  delay: "D", optionSwitch: "Shift+I", optionPicker: "O", splitter: "X", variableBroadcaster: "W",
  variableReceiver: "Shift+W", pulse: "U", add: "+", subtract: "-", multiply: "*", divide: "/", modulo: "%",
  and: "Shift+A", or: "Shift+O", not: "Shift+N", equals: "E", greaterThan: ">", lessThan: "<",
  progress: "Shift+R", reverseProgress: "R",
};

const NULL_DEFAULT_TYPES = new Set(["layer", "image", "video", "sound", "shape", "layerEffect", "connection"]);
const VECTOR_LENGTH: Record<string, number> = { point: 2, size: 2, anchor: 2, point3d: 3, point4d: 4 };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

class Report {
  readonly issues: CatalogIssue[] = [];
  error(where: string, message: string): void {
    this.issues.push({ severity: "error", where, message });
  }
  warn(where: string, message: string): void {
    this.issues.push({ severity: "warning", where, message });
  }
}

const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);

function readJson(path: string, report: Report): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    report.error(basename(path), `cannot read JSON: ${(err as Error).message}`);
    return undefined;
  }
}

/** Unknown keys are errors; known keys out of canonical order are warnings. */
function checkKeys(obj: Json, canonical: readonly string[], where: string, report: Report): void {
  const keys = Object.keys(obj);
  for (const k of keys) if (!canonical.includes(k)) report.error(where, `unknown field "${k}"`);
  const known = keys.filter((k) => canonical.includes(k));
  const sorted = [...known].sort((a, b) => canonical.indexOf(a) - canonical.indexOf(b));
  if (known.join() !== sorted.join()) report.warn(where, `fields out of order; expected ${sorted.join(", ")}`);
}

function isSubsequence(list: readonly string[], of: readonly string[]): boolean {
  let i = 0;
  for (const item of of) if (item === list[i]) i++;
  return i === list.length;
}

// ---------------------------------------------------------------------------
// index.json
// ---------------------------------------------------------------------------

function validateIndex(raw: unknown, report: Report): IndexEntry[] {
  const where = "index.json";
  if (!Array.isArray(raw)) {
    report.error(where, "must be an array");
    return [];
  }
  const layerTypes = new Set(LAYER_TYPES.map((t) => t.type));
  const entries: IndexEntry[] = [];
  const types = new Set<string>();
  const names = new Set<string>();
  const fileCounts = new Map<string, number>();
  let previousFile = "";
  const closedFiles = new Set<string>();

  raw.forEach((item: unknown, i) => {
    const at = `${where}[${i}]`;
    if (!isRecord(item)) return report.error(at, "entry must be an object");
    for (const k of INDEX_KEYS) if (!(k in item)) report.error(at, `missing "${k}"`);
    checkKeys(item, INDEX_KEYS, at, report);
    const { type, name, category, tier, origami_id, origami_name, file } = item;
    if (!isString(type) || !KEY_RE.test(type)) return report.error(at, `invalid type key ${JSON.stringify(type)}`);
    const here = `${where} ${type}`;
    if (types.has(type)) report.error(here, "duplicate type");
    types.add(type);
    if (layerTypes.has(type)) report.error(here, "type key collides with a layer type key");
    if (!isNonEmptyString(name)) report.error(here, "name must be a non-empty string");
    else if (names.has(name)) report.error(here, `duplicate name "${name}"`);
    else names.add(name);
    if (!CATEGORIES.includes(category as PatchCategory)) report.error(here, `invalid category ${JSON.stringify(category)}`);
    if (tier !== 1 && tier !== 2 && tier !== 3) report.error(here, "tier must be 1, 2, or 3");
    if (origami_id !== null && !isNonEmptyString(origami_id)) report.error(here, "origami_id must be a string or null");
    if (origami_name !== null && !isNonEmptyString(origami_name)) report.error(here, "origami_name must be a string or null");
    if (origami_id !== null && origami_name === null) report.error(here, "origami_id requires origami_name");
    if (!isString(file) || !new RegExp(`^${String(category)}-[1-9]\\d*\\.json$`).test(file)) {
      report.error(here, `file must be "<category>-<n>.json" for category ${String(category)}`);
    } else {
      if (file !== previousFile) {
        if (closedFiles.has(file)) report.error(here, `entries for ${file} must be contiguous in index.json`);
        if (previousFile) closedFiles.add(previousFile);
        previousFile = file;
      }
      fileCounts.set(file, (fileCounts.get(file) ?? 0) + 1);
    }
    entries.push(item as unknown as IndexEntry);
  });

  for (const [file, count] of fileCounts) if (count > MAX_CHUNK) report.error(where, `${file} has ${count} patches (max ${MAX_CHUNK})`);
  for (const category of CATEGORIES) {
    const numbers = [...fileCounts.keys()]
      .filter((f) => f.startsWith(`${category}-`))
      .map((f) => Number(f.slice(category.length + 1, -".json".length)))
      .sort((a, b) => a - b);
    numbers.forEach((n, i) => {
      if (n !== i + 1) report.error(where, `${category} chunk files must be numbered 1..${numbers.length} without gaps`);
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// census-decisions.json
// ---------------------------------------------------------------------------

function validateDecisions(raw: unknown, index: IndexEntry[], censusPath: string, report: Report): void {
  const where = "census-decisions.json";
  if (!isRecord(raw) || !Array.isArray(raw.decisions)) return report.error(where, 'must be { "sources", "decisions": [...] }');
  const types = new Set(index.map((e) => e.type));
  const censusKeys: string[] = [];
  const includedTypes = new Set<string>();

  raw.decisions.forEach((d: unknown, i) => {
    const at = `${where}[${i}]`;
    if (!isRecord(d)) return report.error(at, "decision must be an object");
    checkKeys(d, DECISION_KEYS, at, report);
    if (!isNonEmptyString(d.census_name)) report.error(at, "census_name required");
    if (d.source !== "census" && d.source !== "gap-fill") report.error(at, 'source must be "census" or "gap-fill"');
    if (d.source === "census") censusKeys.push(isNonEmptyString(d.census_id) ? d.census_id : String(d.census_name));
    const label = `${where} ${String(d.census_name)}`;
    if (d.decision === "include" || d.decision === "merge") {
      if (!isString(d.type) || !types.has(d.type)) report.error(label, `${String(d.decision)} must name a type from index.json`);
      if (d.decision === "include" && isString(d.type)) includedTypes.add(d.type);
      if (d.decision === "merge" && !isNonEmptyString(d.reason)) report.error(label, "merge needs a reason");
    } else if (d.decision === "exclude") {
      if (d.type !== null) report.error(label, "exclude must have type null");
      if (!isNonEmptyString(d.reason)) report.error(label, "exclude needs a reason");
    } else {
      report.error(label, 'decision must be "include", "merge", or "exclude"');
    }
  });

  for (const e of index) {
    const claimed = includedTypes.has(e.type);
    if (e.origami_name === null && claimed) report.error(`${where} ${e.type}`, "Sonobe-native patch must not be claimed by an include decision");
    if (e.origami_id !== null && !claimed) report.error(`${where} ${e.type}`, "patch with an origami_id has no include decision");
  }

  if (!existsSync(censusPath)) return report.warn(where, `census not found at ${censusPath}; coverage not checked`);
  const census = readJson(censusPath, report);
  if (!isRecord(census) || !Array.isArray(census.patches)) return report.error(where, "census index has no patches array");
  const expected = census.patches.map((p: unknown) => (isRecord(p) ? (isNonEmptyString(p.id) ? p.id : String(p.name)) : ""));
  const seen = new Map<string, number>();
  for (const k of censusKeys) seen.set(k, (seen.get(k) ?? 0) + 1);
  for (const k of expected) if (!seen.has(k)) report.error(where, `census row "${k}" has no decision`);
  for (const [k, n] of seen) {
    if (!expected.includes(k)) report.error(where, `decision "${k}" matches no census row`);
    if (n > 1) report.error(where, `census row "${k}" has ${n} decisions`);
  }
}

// ---------------------------------------------------------------------------
// Chunk files
// ---------------------------------------------------------------------------

interface LoadedEntry {
  entry: Json;
  where: string;
  inputKeys: Set<string>;
  outputKeys: Set<string>;
  variants: string[];
  dynamic: boolean;
}

function literalProblem(type: string, value: unknown, firstVariant: string | undefined, wholeLoop: boolean): string | null {
  if (wholeLoop && isRecord(value) && "loop" in value) {
    return Array.isArray(value.loop) ? null : '"loop" literal must hold an array';
  }
  const t = type === "variant" ? firstVariant : type;
  if (t === undefined) return 'variant port needs "variants"';
  if (t === "number") return typeof value === "number" && Number.isFinite(value) ? null : "expected a finite number";
  if (t === "index") return Number.isInteger(value) ? null : "expected an integer";
  if (t === "boolean") return typeof value === "boolean" ? null : "expected a boolean";
  if (t === "text" || t === "enum") return isString(value) ? null : "expected a string";
  if (t === "color") return isString(value) && /^#[0-9A-Fa-f]{8}$/.test(value) ? null : 'expected "#RRGGBBAA"';
  const length = VECTOR_LENGTH[t];
  if (length !== undefined) {
    return Array.isArray(value) && value.length === length && value.every((n) => typeof n === "number") ? null : `expected [${length} numbers]`;
  }
  if (NULL_DEFAULT_TYPES.has(t)) return value === null ? null : "expected null";
  if (t === "gradient" || t === "textStyle") return value === null || isRecord(value) ? null : "expected an object or null";
  if (t === "transform") return value === null || (Array.isArray(value) && value.length === 16) ? null : "expected 16 numbers or null";
  return null; // json, any
}

function validatePorts(ports: unknown, side: "inputs" | "outputs", entry: Json, where: string, report: Report, allKeys: Set<string>): Set<string> {
  const keys = new Set<string>();
  if (!Array.isArray(ports)) {
    report.error(where, `${side} must be an array`);
    return keys;
  }
  const variants = isStringArray(entry.variants) ? entry.variants : [];
  ports.forEach((p: unknown, i) => {
    const at = `${where} ${side}[${i}]`;
    if (!isRecord(p)) return report.error(at, "port must be an object");
    checkKeys(p, PORT_KEYS, at, report);
    const key = p.key;
    if (!isString(key) || !KEY_RE.test(key)) return report.error(at, `invalid port key ${JSON.stringify(key)}`);
    const pw = `${where} ${side}.${key}`;
    if (allKeys.has(key)) report.error(pw, "port key must be unique across inputs and outputs");
    allKeys.add(key);
    keys.add(key);
    if (!isNonEmptyString(p.name)) report.error(pw, "name required");
    if (!isNonEmptyString(p.description)) report.error(pw, "description required");
    const type = p.type;
    if (!isString(type) || !(type === "variant" || (VALUE_TYPES as readonly string[]).includes(type))) {
      return report.error(pw, `invalid type ${JSON.stringify(type)}`);
    }
    if (type === "variant" && variants.length === 0) report.error(pw, 'variant port requires "variants"');
    if (p.subtype !== undefined && !(SUBTYPES as readonly string[]).includes(String(p.subtype))) report.error(pw, `invalid subtype ${JSON.stringify(p.subtype)}`);
    for (const n of ["min", "max", "step"] as const) {
      if (p[n] !== undefined && (typeof p[n] !== "number" || !Number.isFinite(p[n]))) report.error(pw, `${n} must be a finite number`);
    }
    if (typeof p.min === "number" && typeof p.max === "number" && p.min > p.max) report.error(pw, "min must not exceed max");
    if (typeof p.step === "number" && p.step <= 0) report.error(pw, "step must be positive");
    for (const flag of ["wholeLoop", "advanced", "acceptsPulse"] as const) {
      if (p[flag] !== undefined && typeof p[flag] !== "boolean") report.error(pw, `${flag} must be a boolean`);
    }

    const optionKeys: string[] = [];
    if (type === "enum") {
      if (!Array.isArray(p.enumOptions) || p.enumOptions.length === 0) report.error(pw, "enum port needs enumOptions");
      else {
        p.enumOptions.forEach((o: unknown, j) => {
          if (!isRecord(o) || !isString(o.key) || !KEY_RE.test(o.key) || !isNonEmptyString(o.name)) {
            report.error(pw, `enumOptions[${j}] needs a camelCase key and a name`);
          } else if (optionKeys.includes(o.key)) report.error(pw, `duplicate enum option "${o.key}"`);
          else optionKeys.push(o.key);
        });
      }
    } else if (p.enumOptions !== undefined) report.error(pw, "enumOptions only belong on enum ports");

    if (side === "outputs") {
      if ("default" in p) report.error(pw, "outputs don't declare a default");
      return;
    }
    if (type === "pulse") {
      if ("default" in p) report.error(pw, "pulse inputs omit default");
      return;
    }
    if (!("default" in p)) return report.error(pw, "input needs a default (§7)");
    const problem = literalProblem(type, p.default, variants[0], p.wholeLoop === true);
    if (problem) report.error(pw, `default: ${problem}`);
    if (type === "enum" && isString(p.default) && optionKeys.length > 0 && !optionKeys.includes(p.default)) {
      report.error(pw, `default "${p.default}" is not an enum option`);
    }
  });
  return keys;
}

function expandVariadic(v: Json): string[] {
  const start = v.startIndex === 0 ? 0 : 1;
  const max = typeof v.max === "number" ? Math.min(v.max, 256) : 0;
  return Array.from({ length: max }, (_, i) => `${String(v.key)}${start + i}`);
}

function validateEntry(entry: Json, index: IndexEntry, where: string, typesInIndex: Set<string>, report: Report): LoadedEntry {
  checkKeys(entry, ENTRY_KEYS, where, report);
  for (const k of REQUIRED_ENTRY_KEYS) if (!(k in entry)) report.error(where, `missing "${k}"`);
  for (const k of ["type", "name", "category", "tier"] as const) {
    if (entry[k] !== index[k]) report.error(where, `${k} ${JSON.stringify(entry[k])} doesn't match index.json (${JSON.stringify(index[k])})`);
  }

  // Status and platforms.
  const status = entry.status;
  if (!STATUSES.includes(String(status))) report.error(where, `invalid status ${JSON.stringify(status)}`);
  if (status === "supported") {
    if (entry.statusReason !== undefined) report.error(where, "supported patches omit statusReason");
    if (entry.platforms !== undefined) report.error(where, "supported patches omit platforms");
  } else if (STATUSES.includes(String(status))) {
    if (!isNonEmptyString(entry.statusReason)) report.error(where, `${String(status)} needs statusReason`);
    if (!isStringArray(entry.platforms) || !entry.platforms.every((p) => PLATFORMS.includes(p))) {
      report.error(where, `${String(status)} needs platforms (subset of ${PLATFORMS.join(", ")})`);
    } else if (status === "unsupported-web" && entry.platforms.length > 0) report.warn(where, "unsupported-web usually has platforms: []");
  }
  if (index.tier === 1 && status !== "supported") report.error(where, "tier 1 patches must be supported");

  // Text fields.
  if (!isNonEmptyString(entry.summary)) report.error(where, "summary required");
  else {
    const s = entry.summary;
    if (s.length > 140) report.error(where, `summary is ${s.length} characters (max 140)`);
    if (!s.endsWith(".")) report.error(where, "summary must end with a period");
    if (/[.!?]\s+[A-Z]/.test(s)) report.warn(where, "summary looks like more than one sentence");
  }
  if (!isNonEmptyString(entry.docs) || !entry.docs.startsWith("## How it works")) report.error(where, 'docs must start with "## How it works"');
  if (!isNonEmptyString(entry.behavior) || entry.behavior.length < 40) report.error(where, "behavior must describe evaluation (§16)");
  if (!isStringArray(entry.aliases)) report.error(where, "aliases must be a string array");
  else {
    if (entry.aliases.length < 3 || entry.aliases.length > 10) report.warn(where, `aliases has ${entry.aliases.length} items (aim for 3–10)`);
    for (const a of entry.aliases) {
      if (a !== a.toLowerCase()) report.error(where, `alias "${a}" must be lowercase`);
      if (a === String(entry.name).toLowerCase()) report.error(where, `alias "${a}" repeats the name`);
    }
    if (new Set(entry.aliases).size !== entry.aliases.length) report.error(where, "duplicate aliases");
  }

  // Ports.
  const allKeys = new Set<string>();
  const inputKeys = validatePorts(entry.inputs, "inputs", entry, where, report, allKeys);
  const outputKeys = validatePorts(entry.outputs, "outputs", entry, where, report, allKeys);

  const variants = isStringArray(entry.variants) ? entry.variants : [];
  if (entry.variants !== undefined) {
    if (!isStringArray(entry.variants) || entry.variants.length === 0) report.error(where, "variants must be a non-empty string array");
    else {
      for (const v of entry.variants) if (!(VALUE_TYPES as readonly string[]).includes(v)) report.error(where, `invalid variant "${v}"`);
      if (new Set(entry.variants).size !== entry.variants.length) report.error(where, "duplicate variants");
      if (!Object.values(VARIANT_SETS).some((set) => isSubsequence(variants, set))) report.warn(where, "variants aren't an ordered subset of a named set (§8)");
      const ports = [...(Array.isArray(entry.inputs) ? entry.inputs : []), ...(Array.isArray(entry.outputs) ? entry.outputs : [])];
      const hasVariantPort = ports.some((p) => isRecord(p) && p.type === "variant") || (isRecord(entry.variadic) && entry.variadic.type === "variant");
      if (!hasVariantPort) report.error(where, 'variants declared but no port has type "variant"');
    }
  }
  if (entry.variantDefaults !== undefined) {
    if (!isRecord(entry.variantDefaults)) report.error(where, "variantDefaults must be an object");
    else {
      for (const [variant, defaults] of Object.entries(entry.variantDefaults)) {
        if (!variants.includes(variant)) report.error(where, `variantDefaults.${variant} isn't a declared variant`);
        if (!isRecord(defaults)) continue;
        for (const [key, value] of Object.entries(defaults)) {
          const port = Array.isArray(entry.inputs) ? entry.inputs.find((p) => isRecord(p) && p.key === key) : undefined;
          if (!isRecord(port) || port.type !== "variant") report.error(where, `variantDefaults.${variant}.${key} must name a variant input`);
          const problem = literalProblem(variant, value, undefined, false);
          if (problem) report.error(where, `variantDefaults.${variant}.${key}: ${problem}`);
        }
      }
    }
  }

  const variadicInputs: string[] = [];
  const variadicOutputs: string[] = [];
  if (entry.variadic !== undefined) {
    const v = entry.variadic;
    const vw = `${where} variadic`;
    if (!isRecord(v)) report.error(vw, "must be an object");
    else {
      checkKeys(v, VARIADIC_KEYS, vw, report);
      if (!isString(v.key) || !KEY_RE.test(v.key)) report.error(vw, "invalid key");
      if (!isNonEmptyString(v.name) || !isNonEmptyString(v.description)) report.error(vw, "name and description required");
      if (!isString(v.type) || !(v.type === "variant" || (VALUE_TYPES as readonly string[]).includes(v.type))) report.error(vw, "invalid type");
      const { min, max, defaultCount } = v;
      if (!Number.isInteger(min) || !Number.isInteger(max) || !Number.isInteger(defaultCount)) report.error(vw, "min, max, and defaultCount must be integers");
      else if (!((min as number) >= 1 && (min as number) <= (defaultCount as number) && (defaultCount as number) <= (max as number))) {
        report.error(vw, "need 1 ≤ min ≤ defaultCount ≤ max");
      } else if ((max as number) > 32) report.warn(vw, "max above 32 needs a justification");
      if (v.startIndex !== undefined && v.startIndex !== 0 && v.startIndex !== 1) report.error(vw, "startIndex must be 0 or 1");
      if (v.direction !== undefined && v.direction !== "inputs" && v.direction !== "outputs") report.error(vw, 'direction must be "inputs" or "outputs"');
      if (v.type === "pulse" || v.direction === "outputs") {
        if ("default" in v) report.error(vw, "pulse or output variadics omit default");
      } else if ("default" in v && isString(v.type)) {
        const problem = literalProblem(v.type, v.default, variants[0], false);
        if (problem) report.error(vw, `default: ${problem}`);
      }
      const expanded = expandVariadic(v);
      for (const k of expanded) if (allKeys.has(k)) report.error(vw, `expanded key "${k}" collides with a fixed port`);
      (v.direction === "outputs" ? variadicOutputs : variadicInputs).push(...expanded);
    }
  }
  if (entry.inputCountRange !== undefined) {
    const r = entry.inputCountRange;
    const rw = `${where} inputCountRange`;
    if (!isRecord(r)) report.error(rw, "must be { min, max, defaultCount }");
    else {
      checkKeys(r, ["min", "max", "defaultCount"], rw, report);
      const { min, max, defaultCount } = r;
      if (!Number.isInteger(min) || !Number.isInteger(max) || !Number.isInteger(defaultCount)) report.error(rw, "min, max, and defaultCount must be integers");
      else if (!((min as number) >= 1 && (min as number) <= (defaultCount as number) && (defaultCount as number) <= (max as number))) {
        report.error(rw, "need 1 ≤ min ≤ defaultCount ≤ max");
      }
      if (entry.variadic !== undefined) report.warn(rw, "ignored when variadic is set");
      if (entry.dynamicPortsRule === undefined) report.error(rw, "needs a dynamicPortsRule that builds the repeated ports");
    }
  }

  const settingKeys: string[] = [];
  if (entry.settings !== undefined) {
    if (!Array.isArray(entry.settings)) report.error(where, "settings must be an array");
    else {
      entry.settings.forEach((s: unknown, i) => {
        const sw = `${where} settings[${i}]`;
        if (!isRecord(s)) return report.error(sw, "must be an object");
        checkKeys(s, SETTING_KEYS, sw, report);
        if (!isString(s.key) || !KEY_RE.test(s.key)) return report.error(sw, "invalid key");
        if (allKeys.has(s.key) || settingKeys.includes(s.key)) report.error(sw, `key "${s.key}" collides with a port or setting`);
        settingKeys.push(s.key);
        if (!SETTING_TYPES.includes(String(s.type))) report.error(sw, `type must be one of ${SETTING_TYPES.join(", ")}`);
        if (!("default" in s)) report.error(sw, "default required");
        if (!isNonEmptyString(s.name) || !isNonEmptyString(s.description)) report.error(sw, "name and description required");
        if (s.type === "enum" && (!Array.isArray(s.enumOptions) || s.enumOptions.length === 0)) report.error(sw, "enum setting needs enumOptions");
      });
    }
  }
  if (entry.dynamicPortsRule !== undefined && !isNonEmptyString(entry.dynamicPortsRule)) report.error(where, "dynamicPortsRule must be a non-empty string");
  if (typeof entry.alwaysEvaluate !== "boolean") report.error(where, "alwaysEvaluate must be a boolean");

  // Shortcut.
  const expectedShortcut = SHORTCUTS[index.type];
  if (entry.shortcut !== expectedShortcut) {
    report.error(where, expectedShortcut ? `shortcut must be "${expectedShortcut}"` : "only the patches in §11.2 carry a shortcut");
  }

  // Lists.
  if (!isStringArray(entry.pairsWellWith)) report.error(where, "pairsWellWith must be a string array");
  else {
    if (entry.pairsWellWith.length < 2 || entry.pairsWellWith.length > 5) report.error(where, "pairsWellWith needs 2–5 types");
    for (const t of entry.pairsWellWith) {
      if (!typesInIndex.has(t)) report.error(where, `pairsWellWith "${t}" isn't in index.json`);
      if (t === index.type) report.error(where, "pairsWellWith must not include the patch itself");
    }
  }
  if (!isStringArray(entry.commonMistakes) || entry.commonMistakes.length < 1 || entry.commonMistakes.length > 4 || !entry.commonMistakes.every(isNonEmptyString)) {
    report.error(where, "commonMistakes needs 1–4 non-empty strings");
  }
  if (!Array.isArray(entry.examples) || entry.examples.length < 1 || entry.examples.length > 3) report.error(where, "examples needs 1–3 items");
  else {
    entry.examples.forEach((ex: unknown, i) => {
      const ew = `${where} examples[${i}]`;
      if (!isRecord(ex)) return report.error(ew, "must be an object");
      checkKeys(ex, EXAMPLE_KEYS, ew, report);
      if (!isNonEmptyString(ex.title) || !isNonEmptyString(ex.outline)) report.error(ew, "title and outline required");
      if (ex.description !== undefined && !isNonEmptyString(ex.description)) report.error(ew, "description must be a non-empty string");
    });
  }

  // Origami mapping.
  if (index.origami_name === null) {
    if (entry.origami !== null) report.error(where, "Sonobe-native patches use origami: null");
  } else if (!isRecord(entry.origami)) report.error(where, "origami must be { id?, name }");
  else {
    checkKeys(entry.origami, ["id", "name"], `${where} origami`, report);
    if (entry.origami.name !== index.origami_name) report.error(where, `origami.name must be "${index.origami_name}"`);
    if (index.origami_id === null ? "id" in entry.origami : entry.origami.id !== index.origami_id) {
      report.error(where, index.origami_id === null ? "origami.id must be omitted (census has no id)" : `origami.id must be "${index.origami_id}"`);
    }
  }
  if (entry.importAliases !== undefined && (!isStringArray(entry.importAliases) || new Set(entry.importAliases).size !== entry.importAliases.length)) {
    report.error(where, "importAliases must be unique strings");
  }
  const portKeys = new Set([...inputKeys, ...outputKeys, ...variadicInputs, ...variadicOutputs]);
  if (entry.origamiPorts !== undefined) {
    if (!isRecord(entry.origamiPorts)) report.error(where, "origamiPorts must be an object");
    else for (const [k, v] of Object.entries(entry.origamiPorts)) {
      if (!portKeys.has(k)) report.error(where, `origamiPorts.${k} isn't a port`);
      if (!isNonEmptyString(v)) report.error(where, `origamiPorts.${k} must be a label`);
    }
  }
  if (entry.defaultNotes !== undefined) {
    if (!isRecord(entry.defaultNotes)) report.error(where, "defaultNotes must be an object");
    else for (const [k, v] of Object.entries(entry.defaultNotes)) {
      if (!inputKeys.has(k) && !settingKeys.includes(k) && !variadicInputs.some((key) => key.startsWith(k))) report.error(where, `defaultNotes.${k} isn't an input or setting`);
      if (!isString(v) || !NOTE_RE.test(v)) report.error(where, `defaultNotes.${k} must start with verified:, legacy:, inferred:, or sonobe:`);
    }
  }

  return {
    entry,
    where,
    inputKeys: new Set([...inputKeys, ...variadicInputs, ...settingKeys]),
    outputKeys: new Set([...outputKeys, ...variadicOutputs]),
    variants,
    dynamic: entry.dynamicPortsRule !== undefined,
  };
}

function validateChunk(path: string, index: IndexEntry[], report: Report): LoadedEntry[] {
  const file = basename(path);
  const raw = readJson(path, report);
  if (raw === undefined) return [];
  if (!isRecord(raw) || !Array.isArray(raw.patches)) {
    report.error(file, 'must be { "file", "category", "patches": [...] }');
    return [];
  }
  checkKeys(raw, ["file", "category", "patches"], file, report);
  if (raw.file !== file) report.error(file, `"file" must be "${file}"`);
  const expected = index.filter((e) => e.file === file);
  if (expected.length === 0) report.error(file, "index.json assigns no patches to this file");
  else if (raw.category !== expected[0]!.category) report.error(file, `"category" must be "${expected[0]!.category}"`);
  if (raw.patches.length > MAX_CHUNK) report.error(file, `has ${raw.patches.length} patches (max ${MAX_CHUNK})`);

  const got = raw.patches.map((p: unknown) => (isRecord(p) ? String(p.type) : "?"));
  const want = expected.map((e) => e.type);
  if (got.join() !== want.join()) report.error(file, `patch order must match index.json: ${want.join(", ")}`);

  const typesInIndex = new Set(index.map((e) => e.type));
  const loaded: LoadedEntry[] = [];
  for (const p of raw.patches) {
    if (!isRecord(p) || !isString(p.type)) {
      report.error(file, "each patch must be an object with a type");
      continue;
    }
    const indexEntry = expected.find((e) => e.type === p.type) ?? index.find((e) => e.type === p.type);
    if (!indexEntry) {
      report.error(`${file} ${p.type}`, "type isn't in index.json");
      continue;
    }
    loaded.push(validateEntry(p, indexEntry, `${file} ${p.type}`, typesInIndex, report));
  }
  return loaded;
}

// ---------------------------------------------------------------------------
// Example outlines
// ---------------------------------------------------------------------------

const TOKEN_RE = /"(?:[^"\\]|\\.)*"|\S+/g;
const TYPE_EXPR_RE = /^([a-z][a-zA-Z0-9]*)(?:<([a-z][a-zA-Z0-9]*)>)?(?:\[(\d+)\])?$/;

function validateOutline(outline: string, where: string, typesInIndex: Set<string>, specs: Map<string, LoadedEntry>, report: Report): void {
  const patchTypes = new Map<string, string>();
  const links: { source: string; at: string }[] = [];
  for (const line of outline.split("\n")) {
    const tokens = line.trim().match(TOKEN_RE) ?? [];
    const kind = tokens[0];
    if (kind !== "patch" && kind !== "layer") continue;
    const id = tokens[1] ?? "";
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) report.error(where, `invalid ${kind} id "${id}"`);
    const rest = tokens.slice(kind === "patch" ? 3 : 2);
    let spec: LoadedEntry | undefined;
    if (kind === "patch") {
      const match = TYPE_EXPR_RE.exec(tokens[2] ?? "");
      if (!match) {
        report.error(where, `can't parse patch type "${tokens[2] ?? ""}"`);
        continue;
      }
      const [, type, variant] = match;
      if (!typesInIndex.has(type!)) report.error(where, `example uses unknown patch type "${type}"`);
      patchTypes.set(id, type!);
      spec = specs.get(type!);
      if (spec && variant && !spec.variants.includes(variant)) report.error(where, `${type} has no variant "${variant}"`);
    }
    for (const token of rest) {
      const arrow = token.indexOf("←");
      const equals = token.indexOf("=");
      const cut = arrow > 0 && (equals < 0 || arrow < equals) ? arrow : equals > 0 ? equals : -1;
      if (cut <= 0) continue;
      const key = token.slice(0, cut);
      if (spec && !spec.dynamic && !spec.inputKeys.has(key)) report.error(where, `${patchTypes.get(id)} has no input "${key}"`);
      if (cut === arrow) links.push({ source: token.slice(arrow + 1), at: `${id}.${key}` });
    }
  }
  for (const { source, at } of links) {
    if (source.startsWith("$in.")) continue;
    const [patchId, port] = source.split(".");
    const type = patchTypes.get(patchId ?? "");
    if (!type) {
      report.error(where, `${at} links from undeclared patch "${patchId}"`);
      continue;
    }
    const spec = specs.get(type);
    if (spec && !spec.dynamic && !spec.outputKeys.has(port ?? "")) report.error(where, `${at} links from missing output ${type}.${port}`);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Validates the catalog directory; `files` limits which chunk files are checked (default: all present). */
export function validateCatalog(dir: string, files?: string[]): CatalogIssue[] {
  const report = new Report();
  const indexRaw = readJson(join(dir, "index.json"), report);
  const index = indexRaw === undefined ? [] : validateIndex(indexRaw, report);

  const decisionsPath = join(dir, "census-decisions.json");
  if (existsSync(decisionsPath)) {
    const raw = readJson(decisionsPath, report);
    if (raw !== undefined) validateDecisions(raw, index, resolve(dir, "../../../docs/research/patches/index.json"), report);
  } else report.error("census-decisions.json", "missing");

  const chunkPaths = files?.length
    ? files.map((f) => (isAbsolute(f) ? f : existsSync(f) ? resolve(f) : join(dir, f)))
    : readdirSync(dir).filter((f) => /^[a-z]+-\d+\.json$/.test(f)).sort().map((f) => join(dir, f));

  const specs = new Map<string, LoadedEntry>();
  const loaded: LoadedEntry[] = [];
  for (const path of chunkPaths) {
    if (!existsSync(path)) {
      report.error(basename(path), "file not found");
      continue;
    }
    for (const item of validateChunk(path, index, report)) {
      specs.set(String(item.entry.type), item);
      loaded.push(item);
    }
  }

  // Examples need every loaded spec, so they're checked last.
  const typesInIndex = new Set(index.map((e) => e.type));
  for (const item of loaded) {
    if (!Array.isArray(item.entry.examples)) continue;
    item.entry.examples.forEach((ex: unknown, i) => {
      if (isRecord(ex) && isString(ex.outline)) validateOutline(ex.outline, `${item.where} examples[${i}]`, typesInIndex, specs, report);
    });
  }
  return report.issues;
}

function main(): void {
  const dir = dirname(fileURLToPath(import.meta.url));
  const issues = validateCatalog(dir, process.argv.slice(2));
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  for (const issue of [...errors, ...warnings]) console.log(`${issue.severity === "error" ? "error" : "warn "}  ${issue.where}: ${issue.message}`);
  console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exitCode = errors.length > 0 ? 1 : 0;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && realpathSync(entryPath) === realpathSync(fileURLToPath(import.meta.url))) main();
