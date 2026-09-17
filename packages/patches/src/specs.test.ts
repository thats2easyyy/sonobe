/** Catalog → spec normalization, and default decoding for every catalog patch. */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistry, decodeInput, isColor, isDecodedLoop, parseColor } from "@sonobe/core";
import type { PortSpec, ValueType } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { defaultToInput, findSpecPort, portDefaultLiteral, resolvePortType, variadicKeys } from "./infra/ports.ts";
import { BEHAVIORS, CATALOG_CHUNKS, CATALOG_FILES, PATCH_TYPES, SPECS, getSpec, hasSpec } from "./specs.ts";
import type { PatchBehavior } from "./specs.ts";

const catalogDir = join(dirname(fileURLToPath(import.meta.url)), "..", "catalog");
const CATALOG_ONLY = ["behavior", "importAliases", "origamiPorts", "defaultNotes", "dynamicPortsRule"];
const VECTOR_LENGTH: Partial<Record<string, number>> = { point: 2, size: 2, anchor: 2, point3d: 3, point4d: 4 };
const NULL_TYPES = new Set(["layer", "image", "video", "sound", "shape", "layerEffect"]);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Why a decoded default isn't a valid runtime value of `type`, or null when it is. */
function decodedProblem(value: unknown, type: ValueType, literal: unknown, port: Pick<PortSpec, "enumOptions">): string | null {
  const vector = VECTOR_LENGTH[type];
  if (vector !== undefined) {
    return Array.isArray(value) && value.length === vector && value.every((n) => Number.isFinite(n)) ? null : `expected ${vector} finite numbers, got ${JSON.stringify(value)}`;
  }
  switch (type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : `expected a finite number, got ${JSON.stringify(value)}`;
    case "index":
      return Number.isInteger(value) && (value as number) >= 0 ? null : `expected a whole number ≥ 0, got ${JSON.stringify(value)}`;
    case "boolean":
      return typeof value === "boolean" ? null : "expected a boolean";
    case "text":
      return typeof value === "string" ? null : "expected text";
    case "enum":
      return typeof value === "string" && (!port.enumOptions || port.enumOptions.some((o) => o.key === value)) ? null : `expected an option key, got ${JSON.stringify(value)}`;
    case "color":
      return isColor(value) && typeof literal === "string" && parseColor(literal) !== undefined ? null : `expected a "#RRGGBBAA" color, got ${JSON.stringify(literal)}`;
    case "json":
      return JSON.stringify(value) === JSON.stringify(literal) ? null : `JSON changed while decoding: ${JSON.stringify(value)}`;
    case "any":
      return value === undefined ? "expected a value" : null;
    case "gradient":
      return value === null || (isRecord(value) && Array.isArray(value.stops)) ? null : "expected a gradient or null";
    default:
      return NULL_TYPES.has(type) && value !== null ? `expected null, got ${JSON.stringify(value)}` : null;
  }
}

function checkDefault(literal: unknown, type: ValueType, port: Pick<PortSpec, "enumOptions">, where: string, found: string[]): void {
  if (literal === undefined) return;
  const decoded = decodeInput(defaultToInput(literal), type);
  if (decoded === undefined) {
    found.push(`${where}: decodes as a link`);
    return;
  }
  if (isDecodedLoop(decoded)) {
    const items = (literal as { loop: unknown[] }).loop;
    decoded.items.forEach((item, i) => {
      const problem = decodedProblem(item, type, items[i], port);
      if (problem) found.push(`${where} loop item ${i}: ${problem}`);
    });
    return;
  }
  const problem = decodedProblem(decoded, type, literal, port);
  if (problem) found.push(`${where}: ${problem}`);
}

describe("catalog specs", () => {
  it("imports every chunk file in the catalog folder", () => {
    const onDisk = readdirSync(catalogDir).filter((f) => /^[a-z]+-\d+\.json$/.test(f)).sort();
    expect([...CATALOG_FILES].sort(), "add an import for each new chunk file to src/specs.ts").toEqual(onDisk);
  });

  it("has one spec per catalog entry in index.json order", () => {
    const index = JSON.parse(readFileSync(join(catalogDir, "index.json"), "utf8")) as { type: string; file: string }[];
    const entries = CATALOG_CHUNKS.flatMap((c) => c.patches.map((p) => p.type));
    expect(PATCH_TYPES).toEqual(entries);
    expect(PATCH_TYPES).toEqual(index.map((e) => e.type));
    expect(CATALOG_FILES).toEqual([...new Set(index.map((e) => e.file))]);
    expect(Object.keys(SPECS)).toEqual(entries);
    expect(Object.keys(BEHAVIORS)).toEqual(entries);
  });

  it("keeps contract fields and moves catalog-only fields to BEHAVIORS", () => {
    const found: string[] = [];
    for (const chunk of CATALOG_CHUNKS) {
      for (const entry of chunk.patches) {
        const raw = entry as unknown as Record<string, unknown>;
        const spec = SPECS[entry.type] as unknown as Record<string, unknown>;
        const expected = Object.entries(raw).filter(([key, value]) => !CATALOG_ONLY.includes(key) && !(key === "origami" && value === null));
        if (JSON.stringify(Object.entries(spec)) !== JSON.stringify(expected)) found.push(`${entry.type}: spec fields differ from the catalog entry`);
        const behavior = BEHAVIORS[entry.type] as unknown as Record<string, unknown>;
        for (const key of CATALOG_ONLY) {
          if (JSON.stringify(behavior[key]) !== JSON.stringify(raw[key])) found.push(`${entry.type}: BEHAVIORS.${key} differs`);
        }
      }
    }
    expect(found).toEqual([]);
    expect(SPECS.springPreset).toMatchObject({ tier: 1, status: "supported" });
    expect(Object.values(SPECS).some((s) => s.settings?.length)).toBe(true);
    expect(Object.values(SPECS).some((s) => s.variantDefaults)).toBe(true);
    expect(Object.values(SPECS).some((s) => s.statusReason)).toBe(true);
    expect((BEHAVIORS.switch as PatchBehavior).behavior).toContain("turnOff");
  });

  it("freezes specs and behaviors", () => {
    expect(Object.isFrozen(SPECS)).toBe(true);
    expect(Object.isFrozen(SPECS.switch)).toBe(true);
    expect(Object.isFrozen(SPECS.switch!.inputs[0])).toBe(true);
    expect(Object.isFrozen(BEHAVIORS.switch)).toBe(true);
  });

  it("looks up only real types", () => {
    expect(getSpec("switch")?.name).toBe("Switch");
    expect(getSpec("constructor")).toBeUndefined();
    expect(hasSpec("toString")).toBe(false);
    expect(hasSpec("popAnimation")).toBe(true);
  });

  it("builds a core registry from every spec", () => {
    const registry = createRegistry(Object.values(SPECS));
    expect([...registry.patches.keys()]).toEqual(PATCH_TYPES);
  });

  it("decodes every declared default for its port type with core decodeInput", () => {
    const found: string[] = [];
    for (const spec of Object.values(SPECS)) {
      const variants: (string | undefined)[] = spec.variants?.length ? [...spec.variants] : [undefined];
      const keys = [...spec.inputs, ...spec.outputs].map((p) => p.key).concat(variadicKeys(spec));
      for (const variant of variants) {
        for (const key of keys) {
          const { port } = findSpecPort(spec, key)!;
          const type = resolvePortType(spec, port.type, variant);
          checkDefault(portDefaultLiteral(spec, key, variant), type, port, `${spec.type}${variant ? `<${variant}>` : ""}.${key}`, found);
        }
      }
      for (const setting of spec.settings ?? []) {
        const problem = setting.type === "json" ? null : decodedProblem(setting.default, setting.type === "number" ? "number" : setting.type === "boolean" ? "boolean" : setting.type, setting.default, setting);
        if (problem) found.push(`${spec.type} setting ${setting.key}: ${problem}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("names real variants and variant ports in variantDefaults", () => {
    const found: string[] = [];
    for (const spec of Object.values(SPECS)) {
      for (const [variant, ports] of Object.entries(spec.variantDefaults ?? {})) {
        if (!(spec.variants as string[] | undefined)?.includes(variant)) found.push(`${spec.type}: variantDefaults names "${variant}", which isn't a variant`);
        for (const key of Object.keys(ports ?? {})) {
          const port = findSpecPort(spec, key)?.port ?? (spec.variadic?.key === key ? spec.variadic : undefined);
          if (port?.type !== "variant") found.push(`${spec.type}: variantDefaults.${variant}.${key} isn't a variant port`);
        }
      }
    }
    expect(found).toEqual([]);
  });
});
