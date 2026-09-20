import { applyOps } from "@sonobe/core";
import { createRuntime } from "@sonobe/engine";
import { buildDoc, runFrames } from "@sonobe/engine/testing";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { withPausableScripts } from "./scripts.ts";

const counterScript = `export const outputs = [{ key: "frames", type: "number" }];
let frames = 0;
export function evaluate(patch) {
  frames += 1;
  patch.output("frames", frames);
}`;

describe("scripts in the player", () => {
  it("run only while Sonobe doesn't hold them for trust", () => {
    const registry = createPatchRegistry();
    const base = buildDoc({}, registry);
    const result = applyOps(base, [
      { op: "setScript", file: "count.js", source: counterScript },
      { op: "addPatch", patch: { id: "count", type: "javascript", name: "Count", settings: { script: "count.js" } } },
    ], { registry });
    expect(result.ok).toBe(true);
    let paused = true;
    const runtime = createRuntime(result.doc!, { registry: withPausableScripts(registry, () => paused), platform: {} });
    runFrames(runtime, 3);
    expect(runtime.getValue("count.frames")).toBe(0);
    expect(runtime.issues()).toEqual([expect.objectContaining({ code: "script_untrusted", severity: "warning", message: expect.stringContaining("Trust the project in Sonobe") })]);
    paused = false;
    runFrames(runtime, 3);
    expect(runtime.getValue("count.frames")).toBeGreaterThan(0);
    runtime.dispose();
  });

  it("leaves a registry without scripts alone", () => {
    const registry = createPatchRegistry();
    registry.definitions.delete("javascript");
    expect(withPausableScripts(registry, () => true)).toBe(registry);
  });
});
