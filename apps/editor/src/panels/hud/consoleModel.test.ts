import { applyOps, COMPONENT_PATCH_TYPE, createEmptyDocument } from "@sonobe/core";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import type { ConsoleEntry } from "../../state/console.ts";
import { ALL_CONSOLE_LEVELS, componentForPath, consoleEntryTarget, filterConsoleEntries, formatConsoleTime, scriptLocation } from "./consoleModel.ts";

const registry = createPatchRegistry();

const entry = (id: string, level: ConsoleEntry["level"], source: string, message: string): ConsoleEntry => ({ id, level, source, message, timestamp: 0, count: 1 });

describe("console filters", () => {
  const entries = [entry("1", "log", "counter", "count is 3"), entry("2", "warn", "prototype", "Loop capped at 10000"), entry("3", "error", "js_1", "SyntaxError on line 4"), entry("4", "info", "prototype", "Prototype restarted")];

  it("filters by level", () => {
    expect(filterConsoleEntries(entries, { levels: { ...ALL_CONSOLE_LEVELS, log: false, info: false } }).map((e) => e.id)).toEqual(["2", "3"]);
    expect(filterConsoleEntries(entries, { levels: ALL_CONSOLE_LEVELS })).toHaveLength(4);
  });

  it("matches every term against source and message", () => {
    expect(filterConsoleEntries(entries, { levels: ALL_CONSOLE_LEVELS, query: "PROTOTYPE restarted" }).map((e) => e.id)).toEqual(["4"]);
    expect(filterConsoleEntries(entries, { levels: ALL_CONSOLE_LEVELS, query: "js_1" }).map((e) => e.id)).toEqual(["3"]);
    expect(filterConsoleEntries(entries, { levels: ALL_CONSOLE_LEVELS, query: "nothing here" })).toEqual([]);
  });
});

describe("scriptLocation", () => {
  it("finds line and column references", () => {
    expect(scriptLocation("SyntaxError on line 12: Unexpected token")).toEqual({ line: 12 });
    expect(scriptLocation("Line 3, column 5: This string never ends.")).toEqual({ line: 3, column: 5 });
    expect(scriptLocation("TypeError: x is undefined (at js_1.js:8:14)")).toEqual({ line: 8, column: 14 });
    expect(scriptLocation("ReferenceError: foo is not defined (4:2)")).toEqual({ line: 4, column: 2 });
    expect(scriptLocation("Shader error on line 7: 'uv' undeclared")).toEqual({ line: 7 });
    expect(scriptLocation("Prototype restarted")).toBeNull();
    expect(scriptLocation("Loaded 12:30 schedule")).toBeNull();
  });
});

describe("console sources", () => {
  function nestedDocument() {
    let doc = createEmptyDocument();
    const added = applyOps(doc, [{ op: "addComponent", component: { name: "Card", kind: "patchComponent" } }], { registry });
    expect(added.ok).toBe(true);
    doc = added.doc;
    const cardId = Object.keys(doc.components).find((id) => id !== doc.project.root)!;
    const r = applyOps(
      doc,
      [
        { op: "addPatch", patch: { id: "pop", type: "popAnimation", name: "Press Spring" } },
        { op: "addPatch", component: cardId, patch: { id: "inner_counter", type: "counter" } },
        { op: "addPatch", patch: { id: "card_1", type: COMPONENT_PATCH_TYPE, component: cardId } },
        { op: "addLayer", layer: { id: "box", type: "rectangle", name: "Box" } },
      ],
      { registry },
    );
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    return { doc: r.doc, cardId };
  }

  it("resolves component paths through instances", () => {
    const { doc, cardId } = nestedDocument();
    expect(componentForPath(doc, undefined)).toBe("main");
    expect(componentForPath(doc, "main")).toBe("main");
    expect(componentForPath(doc, "main/card_1")).toBe(cardId);
    expect(componentForPath(doc, "main/missing")).toBeUndefined();
  });

  it("finds the patch or layer an entry came from", () => {
    const { doc, cardId } = nestedDocument();
    expect(consoleEntryTarget(doc, { source: "pop", componentPath: "main" })).toEqual({ component: "main", id: "pop", kind: "patch", name: "Press Spring" });
    expect(consoleEntryTarget(doc, { source: "inner_counter", componentPath: "main/card_1" })).toEqual({ component: cardId, id: "inner_counter", kind: "patch", name: "inner_counter" });
    expect(consoleEntryTarget(doc, { source: "box" })).toEqual({ component: "main", id: "box", kind: "layer", name: "Box" });
    expect(consoleEntryTarget(doc, { source: "prototype" })).toBeNull();
    expect(consoleEntryTarget(doc, { source: "gone", componentPath: "main" })).toBeNull();
  });

  it("formats times with milliseconds", () => {
    expect(formatConsoleTime(new Date(2026, 8, 16, 9, 5, 7, 42).getTime())).toBe("09:05:07.042");
  });
});
