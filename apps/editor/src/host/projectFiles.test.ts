import { applyOps, createEmptyDocument, serializeDocument } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { getRegistry } from "../state/registry.ts";
import { documentFiles, isDocumentFile, planProjectWrite } from "./projectFiles.ts";

const registry = getRegistry();

describe("project write plans", () => {
  it("counts only files the loader reads as document files", () => {
    expect(isDocumentFile("project.json")).toBe(true);
    expect(isDocumentFile("components/main.json")).toBe(true);
    expect(isDocumentFile("scripts/js_1.js")).toBe(true);
    for (const other of ["scripts/.eslintrc.json", "scripts/my helper.js", "scripts/lib/math.js", "components/README.txt", "notes.md"]) expect(isDocumentFile(other), other).toBe(false);
  });

  it("deletes only stale script files Sonobe owns", () => {
    const doc = applyOps(createEmptyDocument(), [
      { op: "setScript", file: "js_1.js", source: "// one" },
      { op: "setScript", file: "js_2.js", source: "// two" },
    ], { registry }).doc;
    const onDisk = { ...serializeDocument(doc), "scripts/.eslintrc.json": "{}", "scripts/my helper.js": "// spaces" };
    const next = applyOps(doc, [{ op: "setScript", file: "js_2.js", source: null }], { registry }).doc;
    expect(planProjectWrite(next, onDisk).deleted).toEqual(["scripts/js_2.js"]);
    expect(planProjectWrite(next, documentFiles(onDisk)).deleted).toEqual(["scripts/js_2.js"]);
  });

  it("refuses documents whose files would overwrite each other where names ignore case", () => {
    const doc = applyOps(createEmptyDocument(), [
      { op: "addComponent", component: { id: "tabBar", name: "Tab Bar", kind: "layerComponent" } },
      { op: "addComponent", component: { id: "tabbar", name: "Tabbar", kind: "layerComponent" } },
    ], { registry, lenient: true }).doc;
    expect(() => planProjectWrite(doc, undefined)).toThrow(/components\/tabBar\.json and components\/tabbar\.json would overwrite each other/);
  });
});
