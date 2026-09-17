/**
 * Integrity tests for the built-in patch catalog (packages/patches/catalog).
 *
 * Every chunk file must describe valid PatchSpec entries plus the catalog-only fields from
 * CONVENTIONS.md, agree with index.json, and stay consistent across patches, so the
 * definePatch modules, generated docs, and MCP schemas built from it can trust the data.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PatchCategory, ValueSubtype, ValueType } from "@sonobe/core";
import { validateCatalog } from "../catalog/validate.ts";

type Json = Record<string, unknown>;

interface IndexEntry {
  type: string;
  name: string;
  category: string;
  tier: number;
  origami_id: string | null;
  origami_name: string | null;
  file: string;
}

interface Chunk {
  file: string;
  raw: unknown;
}

interface Loaded {
  file: string;
  entry: Json;
  where: string;
}

interface Port {
  side: "inputs" | "outputs";
  port: Json;
}

// ---------------------------------------------------------------------------
// Contract mirrors (the satisfies clauses fail typechecking if the contract grows)
// ---------------------------------------------------------------------------

const CATEGORIES = [
  "interaction", "animation", "state", "logic", "math", "loops", "text", "color",
  "data", "device", "media", "shapes", "layers", "utility", "components", "scripting",
] as const satisfies readonly PatchCategory[];

const VALUE_TYPES = [
  "number", "boolean", "pulse", "text", "color", "point", "point3d", "point4d", "size", "anchor",
  "index", "enum", "json", "layer", "image", "video", "sound", "gradient", "shape", "textStyle",
  "layerEffect", "transform", "any",
] as const satisfies readonly ValueType[];

const SUBTYPES = [
  "progress", "angle", "duration", "percent", "distance", "velocity", "multiline", "code", "url",
] as const satisfies readonly ValueSubtype[];

type Covers<Union, Listed> = [Exclude<Union, Listed>] extends [never] ? true : false;
const categoriesCovered: Covers<PatchCategory, (typeof CATEGORIES)[number]> = true;
const valueTypesCovered: Covers<ValueType, (typeof VALUE_TYPES)[number]> = true;
const subtypesCovered: Covers<ValueSubtype, (typeof SUBTYPES)[number]> = true;

const STATUSES = ["supported", "web-limited", "unsupported-web"] as const;
const PLATFORMS = ["desktop", "web", "mobile"];
const SETTING_TYPES = ["text", "number", "boolean", "enum", "json"];
const KEY_RE = /^[a-z][a-zA-Z0-9]*$/;
const MAX_SUMMARY = 160;
const MAX_CHUNK = 18;

/** CONVENTIONS.md §11.1: every easing enum uses these options in this order. */
const CURVE_KEYS = [
  "linear", "quadraticIn", "quadraticOut", "quadraticInOut", "cubicIn", "cubicOut", "cubicInOut",
  "exponentialIn", "exponentialOut", "exponentialInOut", "sinusoidalIn", "sinusoidalOut", "sinusoidalInOut",
];

const VECTOR_LENGTH: Record<string, number> = { point: 2, size: 2, anchor: 2, point3d: 3, point4d: 4 };
const NULL_ONLY_TYPES = new Set(["layer", "image", "video", "sound", "shape", "layerEffect"]);

const REQUIRED_FIELDS = [
  "type", "name", "category", "tier", "status", "aliases", "summary", "docs", "behavior", "inputs", "outputs",
  "alwaysEvaluate", "pairsWellWith", "commonMistakes", "examples", "origami",
];
const OPTIONAL_FIELDS = [
  "statusReason", "platforms", "variadic", "variants", "variantDefaults", "settings", "dynamicPortsRule",
  "shortcut", "importAliases", "origamiPorts", "defaultNotes",
];
const PORT_FIELDS = ["key", "name", "type", "subtype", "default", "min", "max", "step", "enumOptions", "description", "wholeLoop", "advanced"];
const VARIADIC_FIELDS = ["key", "name", "type", "default", "min", "max", "defaultCount", "startIndex", "direction", "description"];

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const catalogDir = join(dirname(fileURLToPath(import.meta.url)), "..", "catalog");

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isNonEmptyString = (value: unknown): value is string => isString(value) && value.trim().length > 0;
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const includes = (list: readonly string[], value: unknown): boolean => isString(value) && list.includes(value);

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(join(catalogDir, file), "utf8"));
}

const index = readJson("index.json") as IndexEntry[];
const indexByType = new Map(index.map((e) => [e.type, e]));
const chunkFiles = readdirSync(catalogDir).filter((f) => /^[a-z]+-\d+\.json$/.test(f)).sort();
const chunks: Chunk[] = chunkFiles.map((file) => ({ file, raw: readJson(file) }));
const loaded: Loaded[] = chunks.flatMap(({ file, raw }) =>
  isRecord(raw) && Array.isArray(raw.patches)
    ? raw.patches.filter(isRecord).map((entry) => ({ file, entry, where: `${file} ${String(entry.type)}` }))
    : [],
);

/** Runs `rule` over every entry and returns human-readable problems. */
function problems(rule: (entry: Json, report: (message: string) => void, item: Loaded) => void): string[] {
  const found: string[] = [];
  for (const item of loaded) rule(item.entry, (message) => found.push(`${item.where}: ${message}`), item);
  return found;
}

function portsOf(entry: Json): Port[] {
  const list: Port[] = [];
  for (const side of ["inputs", "outputs"] as const) {
    const ports = entry[side];
    if (Array.isArray(ports)) for (const port of ports) if (isRecord(port)) list.push({ side, port });
  }
  return list;
}

function inputsOf(entry: Json): Json[] {
  return portsOf(entry).filter((p) => p.side === "inputs").map((p) => p.port);
}

function variantsOf(entry: Json): string[] {
  return isStringArray(entry.variants) ? entry.variants : [];
}

/** Keys a variadic spec expands to, e.g. option0…option31. */
function expandVariadic(variadic: Json): string[] {
  const start = variadic.startIndex === 0 ? 0 : 1;
  const max = isFiniteNumber(variadic.max) ? Math.min(variadic.max, 256) : 0;
  return Array.from({ length: max }, (_, i) => `${String(variadic.key)}${start + i}`);
}

/** Why `value` isn't a valid document literal for `type`, or null when it is. */
function literalProblem(type: string, value: unknown): string | null {
  if (type === "number") return isFiniteNumber(value) ? null : "expected a finite number";
  if (type === "index") return Number.isInteger(value) ? null : "expected an integer";
  if (type === "boolean") return typeof value === "boolean" ? null : "expected a boolean";
  if (type === "text" || type === "enum") return isString(value) ? null : "expected a string";
  if (type === "color") return isString(value) && /^#[0-9A-Fa-f]{8}$/.test(value) ? null : 'expected "#RRGGBBAA"';
  const length = VECTOR_LENGTH[type];
  if (length !== undefined) {
    return Array.isArray(value) && value.length === length && value.every(isFiniteNumber) ? null : `expected ${length} finite numbers`;
  }
  if (NULL_ONLY_TYPES.has(type)) return value === null ? null : "expected null";
  if (type === "gradient" || type === "textStyle") return value === null || isRecord(value) ? null : "expected an object or null";
  if (type === "transform") return value === null || (Array.isArray(value) && value.length === 16 && value.every(isFiniteNumber)) ? null : "expected 16 numbers or null";
  if (type === "json" || type === "any") return null;
  return `no literal encoding for type "${type}"`;
}

/** Checks a default, allowing `{ loop: [...] }` literals on whole-loop ports. */
function defaultProblem(type: string, value: unknown, wholeLoop: boolean): string | null {
  if (wholeLoop && isRecord(value) && "loop" in value && type !== "json") {
    if (!Array.isArray(value.loop)) return '"loop" must hold an array';
    for (const item of value.loop) {
      const problem = literalProblem(type, item);
      if (problem) return `loop item: ${problem}`;
    }
    return null;
  }
  return literalProblem(type, value);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("patch catalog", () => {
  it("mirrors the core contract unions", () => {
    expect([categoriesCovered, valueTypesCovered, subtypesCovered]).toEqual([true, true, true]);
  });

  it("loads chunk files that index.json assigns", () => {
    expect(chunks.length).toBeGreaterThan(0);
    const found: string[] = [];
    const assigned = new Set(index.map((e) => e.file));
    for (const { file, raw } of chunks) {
      if (!isRecord(raw) || !Array.isArray(raw.patches)) {
        found.push(`${file}: must be { file, category, patches: [...] }`);
        continue;
      }
      if (raw.file !== file) found.push(`${file}: "file" is ${JSON.stringify(raw.file)}`);
      if (!includes(CATEGORIES, raw.category) || !file.startsWith(`${String(raw.category)}-`)) found.push(`${file}: "category" doesn't match the file name`);
      if (!assigned.has(file)) found.push(`${file}: index.json assigns no patches to this file`);
      if (raw.patches.length > MAX_CHUNK) found.push(`${file}: ${raw.patches.length} patches (max ${MAX_CHUNK})`);
      if (raw.patches.some((p) => !isRecord(p))) found.push(`${file}: every patch must be an object`);
    }
    for (const file of assigned) if (!chunkFiles.includes(file)) found.push(`index.json assigns patches to missing ${file}`);
    expect(found).toEqual([]);
  });

  it("has one entry per index.json type and no extra entries", () => {
    const found: string[] = [];
    const seen = new Map<string, string[]>();
    for (const item of loaded) {
      const type = String(item.entry.type);
      seen.set(type, [...(seen.get(type) ?? []), item.file]);
    }
    for (const [type, files] of seen) {
      if (files.length > 1) found.push(`${type}: duplicate entries in ${files.join(", ")}`);
      if (!indexByType.has(type)) found.push(`${type}: not in index.json`);
    }
    const indexTypes = new Set<string>();
    for (const e of index) {
      if (indexTypes.has(e.type)) found.push(`index.json lists ${e.type} twice`);
      indexTypes.add(e.type);
      if (!seen.has(e.type)) found.push(`${e.type}: listed in index.json but has no entry`);
    }
    expect(found).toEqual([]);
    expect(loaded.length).toBe(index.length);
  });

  it("entries match the PatchSpec shape plus the catalog fields", () => {
    const known = new Set([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]);
    const found = problems((entry, report) => {
      for (const field of REQUIRED_FIELDS) if (!(field in entry)) report(`missing "${field}"`);
      for (const field of Object.keys(entry)) if (!known.has(field)) report(`unknown field "${field}"`);
      if (!isString(entry.type) || !KEY_RE.test(entry.type)) report("type must be a camelCase key");
      for (const field of ["name", "summary", "docs", "behavior"]) if (!isNonEmptyString(entry[field])) report(`${field} must be a non-empty string`);
      if (!isStringArray(entry.aliases)) report("aliases must be a string array");
      if (typeof entry.alwaysEvaluate !== "boolean") report("alwaysEvaluate must be a boolean");
      if (!Array.isArray(entry.commonMistakes) || entry.commonMistakes.length === 0 || !entry.commonMistakes.every(isNonEmptyString)) report("commonMistakes needs non-empty strings");
      if (!Array.isArray(entry.examples) || entry.examples.length === 0) report("examples needs at least one example");
      else for (const ex of entry.examples) {
        if (!isRecord(ex) || !isNonEmptyString(ex.title) || !isNonEmptyString(ex.outline)) report("each example needs a title and an outline");
        else if (ex.description !== undefined && !isNonEmptyString(ex.description)) report(`example "${ex.title}" has an empty description`);
      }
      if (entry.origami !== null && !(isRecord(entry.origami) && isNonEmptyString(entry.origami.name) && (entry.origami.id === undefined || isNonEmptyString(entry.origami.id)))) {
        report("origami must be null or { id?, name }");
      }
      if (entry.shortcut !== undefined && !isNonEmptyString(entry.shortcut)) report("shortcut must be a non-empty string");
      if (entry.dynamicPortsRule !== undefined && !isNonEmptyString(entry.dynamicPortsRule)) report("dynamicPortsRule must be a non-empty string");
      if (entry.importAliases !== undefined && !isStringArray(entry.importAliases)) report("importAliases must be a string array");
      for (const field of ["origamiPorts", "defaultNotes"]) {
        const value = entry[field];
        if (value !== undefined && !(isRecord(value) && Object.values(value).every(isNonEmptyString))) report(`${field} must map keys to strings`);
      }

      for (const side of ["inputs", "outputs"]) {
        if (!Array.isArray(entry[side])) report(`${side} must be an array`);
      }
      for (const { side, port } of portsOf(entry)) {
        const at = `${side}.${String(port.key)}`;
        for (const field of Object.keys(port)) if (!PORT_FIELDS.includes(field)) report(`${at}: unknown field "${field}"`);
        if (!isNonEmptyString(port.name)) report(`${at}: name required`);
        if (!isNonEmptyString(port.description)) report(`${at}: description required`);
        if (port.subtype !== undefined && !includes(SUBTYPES, port.subtype)) report(`${at}: invalid subtype ${JSON.stringify(port.subtype)}`);
        for (const n of ["min", "max", "step"]) if (port[n] !== undefined && !isFiniteNumber(port[n])) report(`${at}: ${n} must be a finite number`);
        if (isFiniteNumber(port.min) && isFiniteNumber(port.max) && port.min > port.max) report(`${at}: min exceeds max`);
        if (isFiniteNumber(port.step) && port.step <= 0) report(`${at}: step must be positive`);
        for (const flag of ["wholeLoop", "advanced"]) if (port[flag] !== undefined && typeof port[flag] !== "boolean") report(`${at}: ${flag} must be a boolean`);
        if (port.type === "enum") {
          if (!Array.isArray(port.enumOptions) || port.enumOptions.length === 0) report(`${at}: enum ports need enumOptions`);
          else for (const option of port.enumOptions) {
            if (!isRecord(option) || !isString(option.key) || !KEY_RE.test(option.key) || !isNonEmptyString(option.name)) report(`${at}: enum options need a camelCase key and a name`);
            else if (option.description !== undefined && !isNonEmptyString(option.description)) report(`${at}: option ${option.key} has an empty description`);
          }
        } else if (port.enumOptions !== undefined) report(`${at}: enumOptions only belong on enum ports`);
      }

      const v = entry.variadic;
      if (v !== undefined) {
        if (!isRecord(v)) report("variadic must be an object");
        else {
          for (const field of Object.keys(v)) if (!VARIADIC_FIELDS.includes(field)) report(`variadic: unknown field "${field}"`);
          if (!isNonEmptyString(v.name) || !isNonEmptyString(v.description)) report("variadic needs a name and a description");
          const { min, max, defaultCount } = v;
          if (!Number.isInteger(min) || !Number.isInteger(max) || !Number.isInteger(defaultCount)) report("variadic min, max, and defaultCount must be integers");
          else if (!(Number(min) >= 1 && Number(min) <= Number(defaultCount) && Number(defaultCount) <= Number(max))) report("variadic needs 1 ≤ min ≤ defaultCount ≤ max");
          if (v.startIndex !== undefined && v.startIndex !== 0 && v.startIndex !== 1) report("variadic startIndex must be 0 or 1");
          if (v.direction !== undefined && v.direction !== "inputs" && v.direction !== "outputs") report('variadic direction must be "inputs" or "outputs"');
        }
      }
      if (entry.variantDefaults !== undefined && !(isRecord(entry.variantDefaults) && Object.values(entry.variantDefaults).every(isRecord))) {
        report("variantDefaults must map variants to objects");
      }
      if (entry.settings !== undefined) {
        if (!Array.isArray(entry.settings)) report("settings must be an array");
        else for (const s of entry.settings) {
          if (!isRecord(s) || !isString(s.key) || !isNonEmptyString(s.name) || !isNonEmptyString(s.description) || !includes(SETTING_TYPES, s.type) || !("default" in s)) {
            report(`settings: ${JSON.stringify(isRecord(s) ? s.key : s)} needs key, name, type, default, and description`);
          }
        }
      }
    });
    expect(found).toEqual([]);
  });

  it("entries agree with index.json on name, category, tier, and chunk file", () => {
    const found = problems((entry, report, item) => {
      const expected = indexByType.get(String(entry.type));
      if (!expected) return;
      for (const field of ["name", "category", "tier"] as const) {
        if (entry[field] !== expected[field]) report(`${field} ${JSON.stringify(entry[field])} doesn't match index.json (${JSON.stringify(expected[field])})`);
      }
      if (item.file !== expected.file) report(`index.json places this patch in ${expected.file}`);
    });
    expect(found).toEqual([]);
  });

  it("uses valid categories, tiers, statuses, and platforms", () => {
    const found = problems((entry, report) => {
      if (!includes(CATEGORIES, entry.category)) report(`invalid category ${JSON.stringify(entry.category)}`);
      if (entry.tier !== 1 && entry.tier !== 2 && entry.tier !== 3) report(`invalid tier ${JSON.stringify(entry.tier)}`);
      if (!includes(STATUSES, entry.status)) report(`invalid status ${JSON.stringify(entry.status)}`);
      if (entry.status === "supported") {
        if (entry.statusReason !== undefined || entry.platforms !== undefined) report("supported patches omit statusReason and platforms");
      } else {
        if (!isNonEmptyString(entry.statusReason)) report(`${String(entry.status)} patches need a statusReason`);
        if (!isStringArray(entry.platforms) || !entry.platforms.every((p) => PLATFORMS.includes(p))) report("platforms must list desktop, web, or mobile");
        else if (entry.status === "unsupported-web" && entry.platforms.length > 0) report("unsupported-web patches use platforms: []");
        else if (entry.status === "web-limited" && entry.platforms.length === 0) report("web-limited patches list where they work");
      }
      if (entry.tier === 1 && entry.status !== "supported") report("tier 1 patches must be supported");
    });
    expect(found).toEqual([]);
  });

  it("port keys are camelCase and unique within each patch", () => {
    const found = problems((entry, report) => {
      const keys = new Set<string>();
      const claim = (key: unknown, where: string) => {
        if (!isString(key) || !KEY_RE.test(key)) return report(`${where} key ${JSON.stringify(key)} isn't camelCase`);
        if (keys.has(key)) report(`${where} key "${key}" is used twice`);
        keys.add(key);
      };
      for (const { side, port } of portsOf(entry)) claim(port.key, side);
      if (isRecord(entry.variadic)) {
        if (!isString(entry.variadic.key) || !KEY_RE.test(entry.variadic.key)) report("variadic key isn't camelCase");
        for (const key of expandVariadic(entry.variadic)) if (keys.has(key)) report(`variadic key "${key}" collides with a port`);
      }
      if (Array.isArray(entry.settings)) for (const s of entry.settings) if (isRecord(s)) claim(s.key, "setting");
    });
    expect(found).toEqual([]);
  });

  it("port types are value types, and variant ports come with variants", () => {
    const found = problems((entry, report) => {
      const variants = variantsOf(entry);
      const typed: { where: string; type: unknown }[] = portsOf(entry).map(({ side, port }) => ({ where: `${side}.${String(port.key)}`, type: port.type }));
      if (isRecord(entry.variadic)) typed.push({ where: "variadic", type: entry.variadic.type });
      for (const { where, type } of typed) {
        if (type !== "variant" && !includes(VALUE_TYPES, type)) report(`${where}: invalid type ${JSON.stringify(type)}`);
        if (type === "variant" && variants.length === 0) report(`${where}: "variant" needs variants`);
      }
      if (entry.variants !== undefined) {
        if (variants.length === 0) report("variants must be a non-empty string array");
        for (const v of variants) if (!includes(VALUE_TYPES, v) || v === "pulse" || v === "any") report(`invalid variant "${v}"`);
        if (new Set(variants).size !== variants.length) report("duplicate variants");
        if (!typed.some((t) => t.type === "variant")) report('variants declared but no port is "variant"');
      }
      if (isRecord(entry.variantDefaults)) {
        for (const variant of Object.keys(entry.variantDefaults)) if (!variants.includes(variant)) report(`variantDefaults.${variant} isn't a declared variant`);
      }
    });
    expect(found).toEqual([]);
  });

  it("input defaults are compatible with their declared types", () => {
    const found = problems((entry, report) => {
      const variants = variantsOf(entry);
      const resolve = (type: unknown) => (type === "variant" ? variants[0] : isString(type) ? type : undefined);
      for (const { side, port } of portsOf(entry)) {
        const at = `${side}.${String(port.key)}`;
        if (side === "outputs" || port.type === "pulse") {
          if ("default" in port) report(`${at}: ${side === "outputs" ? "outputs" : "pulse inputs"} don't declare a default`);
          continue;
        }
        if (!("default" in port)) {
          report(`${at}: missing default`);
          continue;
        }
        const type = resolve(port.type);
        if (type === undefined) continue;
        const problem = defaultProblem(type, port.default, port.wholeLoop === true);
        if (problem) report(`${at}: default ${JSON.stringify(port.default)}: ${problem}`);
        if (isFiniteNumber(port.default) && ((isFiniteNumber(port.min) && port.default < port.min) || (isFiniteNumber(port.max) && port.default > port.max))) {
          report(`${at}: default ${port.default} is outside min/max`);
        }
      }
      const v = entry.variadic;
      if (isRecord(v) && "default" in v) {
        const type = resolve(v.type);
        if (v.type === "pulse" || v.direction === "outputs") report("pulse and output variadics don't declare a default");
        else if (type !== undefined) {
          const problem = literalProblem(type, v.default);
          if (problem) report(`variadic default: ${problem}`);
        }
      }
      if (isRecord(entry.variantDefaults)) {
        const inputs = new Map(inputsOf(entry).map((p) => [String(p.key), p]));
        for (const [variant, defaults] of Object.entries(entry.variantDefaults)) {
          if (!isRecord(defaults)) continue;
          for (const [key, value] of Object.entries(defaults)) {
            if (inputs.get(key)?.type !== "variant") report(`variantDefaults.${variant}.${key} must name a variant input`);
            const problem = literalProblem(variant, value);
            if (problem) report(`variantDefaults.${variant}.${key}: ${problem}`);
          }
        }
      }
      if (Array.isArray(entry.settings)) {
        for (const s of entry.settings) {
          if (!isRecord(s) || !isString(s.type) || s.type === "enum") continue;
          const problem = literalProblem(s.type, s.default);
          if (problem) report(`setting ${String(s.key)}: ${problem}`);
        }
      }
    });
    expect(found).toEqual([]);
  });

  it("enum defaults are declared option keys", () => {
    const found = problems((entry, report) => {
      const withOptions = [
        ...portsOf(entry).filter((p) => p.side === "inputs").map((p) => ({ where: `inputs.${String(p.port.key)}`, spec: p.port })),
        ...(Array.isArray(entry.settings) ? entry.settings.filter(isRecord).map((s) => ({ where: `setting ${String(s.key)}`, spec: s })) : []),
      ];
      for (const { where, spec } of withOptions) {
        if (spec.type !== "enum") continue;
        const options = Array.isArray(spec.enumOptions) ? spec.enumOptions.filter(isRecord).map((o) => o.key) : [];
        if (options.length === 0) report(`${where}: enum needs options`);
        if (new Set(options).size !== options.length) report(`${where}: duplicate option keys`);
        if (!options.includes(spec.default)) report(`${where}: default ${JSON.stringify(spec.default)} isn't one of ${options.join(", ")}`);
      }
    });
    expect(found).toEqual([]);
  });

  it("pairsWellWith references existing patch types", () => {
    const found = problems((entry, report) => {
      if (!isStringArray(entry.pairsWellWith) || entry.pairsWellWith.length === 0) return report("pairsWellWith must list patch types");
      if (new Set(entry.pairsWellWith).size !== entry.pairsWellWith.length) report("pairsWellWith repeats a type");
      for (const type of entry.pairsWellWith) {
        if (!indexByType.has(type)) report(`pairsWellWith "${type}" doesn't exist`);
        if (type === entry.type) report("pairsWellWith lists the patch itself");
      }
    });
    expect(found).toEqual([]);
  });

  it(`summaries are one non-empty sentence of at most ${MAX_SUMMARY} characters`, () => {
    const found = problems((entry, report) => {
      const summary = entry.summary;
      if (!isNonEmptyString(summary)) return report("summary is empty");
      if (summary.length > MAX_SUMMARY) report(`summary is ${summary.length} characters`);
      if (summary.includes("\n")) report("summary spans several lines");
      if (!summary.endsWith(".")) report("summary must end with a period");
    });
    expect(found).toEqual([]);
  });

  it("passes the conventions validator without errors", () => {
    const errors = validateCatalog(catalogDir).filter((issue) => issue.severity === "error");
    expect(errors.map((e) => `${e.where}: ${e.message}`)).toEqual([]);
  });
});

describe("patch catalog cross-patch consistency", () => {
  /** Capture patches start off so inserting one never turns on a camera or microphone. */
  const CAPTURE_PATCHES = new Set(["camera", "microphone"]);

  it("shared control ports use one name, type, and default", () => {
    const found = problems((entry, report) => {
      for (const { side, port } of portsOf(entry)) {
        const at = `${side}.${String(port.key)}`;
        if (side === "inputs" && port.key === "enabled") {
          const expected = !CAPTURE_PATCHES.has(String(entry.type));
          if (port.type !== "boolean" || port.name !== "Enabled" || port.default !== expected) report(`${at}: expected boolean "Enabled" defaulting to ${expected}`);
        }
        if (side === "inputs" && port.key === "layer" && (port.type !== "layer" || port.name !== "Layer" || port.default !== null)) report(`${at}: expected layer "Layer" defaulting to null`);
        if (side === "inputs" && port.key === "reset" && (port.type !== "pulse" || port.name !== "Reset")) report(`${at}: expected pulse "Reset"`);
        if (port.key === "output" && port.name !== "Output") report(`${at}: the output port is named "Output"`);
        if (port.type === "pulse" && port.wholeLoop === undefined && side === "inputs" && "default" in port) report(`${at}: pulse inputs have no default`);
      }
      const inputs = inputsOf(entry);
      const layerAt = inputs.findIndex((p) => p.key === "layer" && p.advanced !== true);
      const enabledAt = inputs.findIndex((p) => p.key === "enabled");
      if (layerAt > 0) report("layer is the first input");
      if (enabledAt >= 0 && enabledAt !== (layerAt >= 0 ? layerAt + 1 : 0)) report("enabled comes right after layer, or first");
    });
    expect(found).toEqual([]);
  });

  it("advanced inputs come after everyday inputs", () => {
    const found = problems((entry, report) => {
      let advanced: string | null = null;
      for (const port of inputsOf(entry)) {
        if (port.advanced === true) advanced ??= String(port.key);
        else if (advanced !== null) report(`${String(port.key)} follows advanced input ${advanced}`);
      }
    });
    expect(found).toEqual([]);
  });

  it("easing curves share the CURVE options", () => {
    const found = problems((entry, report) => {
      for (const port of inputsOf(entry)) {
        if (port.key !== "curve" || port.type !== "enum") continue;
        const keys = Array.isArray(port.enumOptions) ? port.enumOptions.filter(isRecord).map((o) => o.key) : [];
        if (keys.join() !== CURVE_KEYS.join()) report("curve options must match CONVENTIONS.md §11.1");
      }
    });
    expect(found).toEqual([]);
  });

  it("spring parameters describe the same default spring everywhere", () => {
    // SwiftUI's spring(response: 0.55, dampingFraction: 0.825), with k = (2π/r)² and c = 4π·ζ/r.
    const response = 0.55;
    const dampingFraction = 0.825;
    const tension = (2 * Math.PI / response) ** 2;
    const friction = (4 * Math.PI * dampingFraction) / response;
    const expected: Record<string, number> = { response, dampingFraction, tension, friction, mass: 1, bounciness: 5, speed: 10 };
    const found = problems((entry, report) => {
      for (const port of inputsOf(entry)) {
        const want = expected[String(port.key)];
        if (want === undefined || port.type !== "number") continue;
        if (!isFiniteNumber(port.default) || Math.abs(port.default - want) > 0.005) report(`${String(port.key)} defaults to ${String(port.default)}, expected ${want.toFixed(2)}`);
      }
    });
    expect(found).toEqual([]);
  });

  it("Pop Animation feel ports share one range", () => {
    const found = problems((entry, report) => {
      for (const port of inputsOf(entry)) {
        if (port.key !== "bounciness" && port.key !== "speed") continue;
        if (port.min !== 0 || port.max !== 20 || port.step !== 0.5) report(`${String(port.key)}: expected min 0, max 20, step 0.5`);
      }
    });
    expect(found).toEqual([]);
  });

  it("whole-loop Loop inputs default to an empty loop unless they answer on/off", () => {
    const found = problems((entry, report) => {
      for (const port of inputsOf(entry)) {
        if (port.key !== "loop" || port.wholeLoop !== true) continue;
        const emptyLoop = isRecord(port.default) && Array.isArray(port.default.loop) && port.default.loop.length === 0;
        if (port.type === "boolean" ? port.default !== false : !emptyLoop) report(`loop defaults to ${JSON.stringify(port.default)}`);
      }
    });
    expect(found).toEqual([]);
  });
});

describe("catalog README", () => {
  const readme = () => readFileSync(join(catalogDir, "README.md"), "utf8");
  const row = (label: string, cells: number) => new RegExp(`^\\| ${label.replace(/[*`]/g, "\\$&")} \\|[^|\\n]*${"\\| (\\d+) ".repeat(cells)}\\|`, "m");
  const count = (predicate: (e: IndexEntry, entry: Json | undefined) => boolean) =>
    index.filter((e) => predicate(e, loaded.find((l) => l.entry.type === e.type)?.entry)).length;

  it("reports the current counts per category and tier", () => {
    const text = readme();
    const tiers = (filter: (e: IndexEntry) => boolean) => [1, 2, 3].map((tier) => count((e) => filter(e) && e.tier === tier));
    for (const category of [...CATEGORIES, "**Total**"]) {
      const filter = (e: IndexEntry) => category === "**Total**" || e.category === category;
      const match = row(category === "**Total**" ? category : `\`${category}\``, 4).exec(text);
      expect(match, `README row for ${category}`).not.toBeNull();
      expect(match!.slice(1, 5).map(Number)).toEqual([count(filter), ...tiers(filter)]);
    }
  });

  it("reports the current counts per status", () => {
    const text = readme();
    for (const status of STATUSES) {
      const match = row(`\`${status}\``, 1).exec(text);
      expect(match, `README row for ${status}`).not.toBeNull();
      expect(Number(match![1])).toBe(count((_, entry) => entry?.status === status));
    }
  });
});
