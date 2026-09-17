import { buildDoc, createMockRegistry, createTestRuntime, runPatch, sequenceDefinition } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { definitions } from "./index.ts";
import { restartPrototype } from "./restartPrototype.ts";

const FIRST_FRAME_WARNING = "loop_demo ignored a restart pulse on the first frame; restarting there would repeat forever";
const warnings = (result: ReturnType<typeof runPatch>) => result.logs.filter((l) => l.level === "warn").map((l) => l.args.join(" "));

describe("restartPrototype", () => {
  it("ignores a pulse on the first frame with one warning, and restarts on later pulses", () => {
    const result = runPatch(restartPrototype, [{ restart: true }, {}, { restart: true }, {}], { id: "loop_demo" });
    expect(result.restarts).toBe(1);
    expect(warnings(result)).toEqual([FIRST_FRAME_WARNING]);
  });

  it("restarts once when a held boolean turns on", () => {
    const result = runPatch(restartPrototype, [{}, { restart: true }, { restart: true }, { restart: true }], { edgeInputs: ["restart"] });
    expect(result.restarts).toBe(1);
  });

  it("warns once per patch, not per loop index, and never requests a restart on the first frame", () => {
    const result = runPatch(restartPrototype, [{ restart: loopOf([true, true]) }], { id: "loop_demo" });
    expect(result.restarts).toBe(0);
    expect(warnings(result)).toEqual([FIRST_FRAME_WARNING]);
  });

  it("requests one restart per pulsing index; the runtime collapses them into one", () => {
    const h = createPatchHarness(restartPrototype);
    let requests = 0;
    h.services.restart = () => {
      requests++;
    };
    h.step();
    h.step({ inputs: { restart: loopOf([true, false, true]) } });
    expect(requests).toBe(2);
  });

  it("never restarts while muted", () => {
    expect(runPatch(restartPrototype, [{}, { restart: true }]).restarts).toBe(1);
    expect(runPatch(restartPrototype, [{}, { restart: true }], { muted: true }).restarts).toBe(0);
  });

  it("finishes the frame, then the runtime starts again from frame 0", () => {
    const pulses = sequenceDefinition("pulses", "pulse", [false, false, true, false]);
    const registry = createMockRegistry([pulses, ...definitions]);
    const rt = createTestRuntime(
      buildDoc({ patches: { src: { type: "pulses" }, again: { type: "restartPrototype", inputs: { restart: { link: "src.value" } } }, start: { type: "whenPrototypeStarts" } } }, registry),
      registry,
    );
    const seen: [number, unknown][] = [];
    for (let i = 0; i < 5; i++) {
      rt.step();
      seen.push([rt.frame, rt.getValue("start.started")]);
    }
    expect(seen).toEqual([
      [0, true],
      [1, false],
      [2, false],
      [0, true],
      [1, false],
    ]);
  });

  it("can't loop forever when When Prototype Starts drives it, and warns again after each restart", () => {
    const registry = createMockRegistry(definitions);
    const logs: string[] = [];
    const rt = createTestRuntime(
      buildDoc({ patches: { launched: { type: "whenPrototypeStarts" }, loop_demo: { type: "restartPrototype", inputs: { restart: { link: "launched.started" } } } } }, registry),
      registry,
      { onLog: (level, args) => (level === "warn" ? logs.push(args.join(" ")) : undefined) },
    );
    for (let i = 0; i < 4; i++) rt.step();
    expect(rt.frame).toBe(3);
    expect(rt.issues().filter((i) => i.message === FIRST_FRAME_WARNING)).toHaveLength(1);
    expect(logs).toEqual([FIRST_FRAME_WARNING]);
    rt.restart();
    rt.step();
    expect(logs).toEqual([FIRST_FRAME_WARNING, FIRST_FRAME_WARNING]);
  });
});
