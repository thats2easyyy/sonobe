/**
 * The example prototypes at rest. The scripted scenarios in each test.json run in simulations, which
 * step every frame; live hosts stop asking for frames while a prototype rests (ARCHITECTURE.md §5.2).
 * Here each scenario's input is replayed on a runtime stepped the way a resting host steps it, and it
 * must draw, on every frame, what the same input draws when every frame is stepped.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import type { SonobeDocument } from "@sonobe/core";
import { createRuntime, type InputEvent, type SonobeRuntime } from "@sonobe/engine";
import { runRested } from "@sonobe/engine/testing";
import { createHeadlessHost } from "@sonobe/mcp";
import { createPatchRegistry } from "@sonobe/patches";
import { afterAll, describe, expect, it, vi } from "vitest";
import { EXAMPLES_DIR, listExampleFolders } from "./lib/disk.ts";
import { parseExampleTest, runScenario } from "./lib/scenarios.ts";

const registry = createPatchRegistry();
const host = createHeadlessHost({ registry, maxSimSessions: 2 });

afterAll(async () => {
  await host.close();
});

interface Tape {
  doc: SonobeDocument;
  /** The input dispatched before each step. */
  frames: InputEvent[][];
}

/** Run `scenario` in a simulation and return the input its runtime got, frame by frame. */
async function record(docId: string, scenario: Parameters<typeof runScenario>[2]): Promise<Tape> {
  // The simulation makes its own runtimes, so their dispatch and step are watched on the class.
  const proto = Object.getPrototypeOf(createRuntime((await host.getDocument(docId)).doc, { registry, deterministic: true })) as SonobeRuntime;
  const tapes = new Map<SonobeRuntime, Tape & { pending: InputEvent[] }>();
  const tapeOf = (rt: SonobeRuntime) => {
    let tape = tapes.get(rt);
    if (!tape) tapes.set(rt, (tape = { doc: rt.document, frames: [], pending: [] }));
    return tape;
  };
  const dispatch = proto.dispatch;
  const step = proto.step;
  const onDispatch = vi.spyOn(proto, "dispatch").mockImplementation(function (this: SonobeRuntime, events) {
    tapeOf(this).pending.push(...structuredClone(events));
    return dispatch.call(this, events);
  });
  const onStep = vi.spyOn(proto, "step").mockImplementation(function (this: SonobeRuntime, dt) {
    const tape = tapeOf(this);
    tape.frames.push(tape.pending);
    tape.pending = [];
    return step.call(this, dt);
  });
  try {
    await runScenario(host, docId, scenario);
  } finally {
    onDispatch.mockRestore();
    onStep.mockRestore();
  }
  // The session's own runtime ran the whole scenario; clones made for traces ran less.
  return [...tapes.values()].sort((a, b) => b.frames.length - a.frames.length)[0]!;
}

describe("examples: a host that rests draws what a host that steps every frame draws", () => {
  let steps = 0;
  let frames = 0;

  for (const folder of listExampleFolders()) {
    const test = parseExampleTest(JSON.parse(readFileSync(path.join(EXAMPLES_DIR, folder, "test.json"), "utf8")), `${folder}/test.json`);
    it(folder, async () => {
      const { docId } = await host.openDocument(path.join(EXAMPLES_DIR, folder));
      for (const scenario of test.scenarios) {
        const tape = await record(docId, scenario);
        expect(tape.frames.length, scenario.name).toBeGreaterThan(0);
        const watch = [...new Set(scenario.expect.map((e) => e.target))];
        const run = runRested(tape.doc, registry, tape.frames.length, tape.frames, { watch });
        expect(run.mismatch, scenario.name).toBeNull();
        steps += run.steps;
        frames += tape.frames.length;
      }
    });
  }

  it("and rests for a good part of the scenarios", () => {
    // Most scenarios are a gesture and the animation after it, then a wait to read the result.
    expect(frames).toBeGreaterThan(1000);
    expect(steps / frames).toBeLessThan(0.9);
  });
});
