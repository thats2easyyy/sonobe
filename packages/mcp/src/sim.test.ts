import type { EngineRegistry } from "@sonobe/engine";
import { createMockRegistry } from "@sonobe/engine/testing";
import { createPatchRegistry } from "@sonobe/patches";
import { afterEach, describe, expect, it } from "vitest";
import { createSimulationManager } from "./sim.ts";
import {
  buildGrowCard,
  connectClient,
  tempProject,
  type TempProject,
  type TestClient,
} from "./test-helpers.ts";

const ISAT = ["interaction", "switch", "popAnimation", "transition"];
const realRegistry = createPatchRegistry();
const missing = ISAT.filter((t) => !realRegistry.isImplemented(t));
if (missing.length)
  console.warn(
    `Skipping real-patch simulation tests until these evaluators land: ${missing.join(", ")}.`,
  );

let project: TempProject | undefined;
let client: TestClient | undefined;

afterEach(async () => {
  await client?.close();
  await project?.cleanup();
  client = undefined;
  project = undefined;
});

async function setup(registry: EngineRegistry = realRegistry) {
  project = await tempProject({ registry });
  client = await connectClient(project.host);
  await buildGrowCard(client);
  const reset = await client.call("sim_reset", {});
  expect(reset.isError).toBe(false);
  return { c: client, simId: reset.structured.simId as string };
}

describe.skipIf(missing.length > 0)(`simulation with real patches (${ISAT.join(", ")})`, () => {
  it("taps the card and traces @card.scale settling at 1.08", async () => {
    const { c, simId } = await setup();
    const before = await c.call("sim_get_values", {
      simId,
      targets: ["@card.scale", "card_grown.on"],
    });
    expect(before.structured.values).toEqual({ "@card.scale": 1, "card_grown.on": false });

    const tap = await c.call("sim_dispatch", { simId, events: [{ kind: "tap", target: "@card" }] });
    expect(tap.isError).toBe(false);
    expect(tap.text).toContain("hit card");
    expect(tap.text).toContain("heard by tap_card");
    const events = tap.structured.events as {
      hit: { layerId: string; handledBy: string[] };
      warnings: string[];
    }[];
    expect(events[0]!.hit).toMatchObject({ layerId: "card", handledBy: ["tap_card"] });
    expect(events[0]!.warnings).toEqual([]);

    const trace = await c.call("sim_trace", {
      simId,
      targets: ["@card.scale", "grow_spring.output"],
      durationMs: 1000,
      maxRows: 10,
    });
    expect(trace.isError).toBe(false);
    const summary = (
      trace.structured.summaries as Record<
        string,
        { end: number; settleTime: number | null; max: number }
      >
    )["@card.scale"]!;
    expect(summary.end).toBeCloseTo(1.08, 2);
    expect(summary.settleTime).not.toBeNull();
    expect(summary.max).toBeGreaterThanOrEqual(1.08 - 1e-3);
    expect(trace.text).toContain("t_ms");
    expect(trace.text).toMatch(/@card\.scale: start .* → end 1\.08/);
    expect(trace.structured.frames).toBe(60);

    // Tracing a copy leaves the session where it was; stepping moves it.
    const now = await c.call("sim_get_values", { simId, targets: ["card_grown.on"] });
    expect(now.structured.values).toEqual({ "card_grown.on": true });
    const idle = await c.call("sim_step", { simId, until: "idle" });
    expect(idle.structured).toMatchObject({ settled: true, timedOut: false });
    expect(idle.text).toContain("@card.scale:");
    const settled = await c.call("sim_get_values", { simId, targets: ["@card.scale"] });
    expect(settled.structured.values as Record<string, number>).toMatchObject({
      "@card.scale": expect.closeTo(1.08, 2),
    });
  });

  it("steps until a condition and reports watched changes", async () => {
    const { c, simId } = await setup();
    const r = await c.call("sim_trace", {
      simId,
      targets: ["@card.scale"],
      durationMs: 200,
      events: [{ kind: "tap", target: "@card", atMs: 50 }],
      advance: true,
      maxRows: 4,
    });
    expect(r.isError).toBe(false);
    const step = await c.call("sim_step", {
      simId,
      until: { target: "@card.scale", op: ">=", value: 1.07 },
      maxMs: 2000,
      watch: ["@card.scale"],
    });
    expect(step.structured.settled).toBe(true);
    const far = await c.call("sim_step", {
      simId,
      until: { target: "@card.scale", op: ">", value: 5 },
      maxMs: 200,
    });
    expect(far.structured).toMatchObject({ settled: false, timedOut: true });
    expect(far.text).toContain("timed out");
  });

  it("explains taps that miss", async () => {
    const { c, simId } = await setup();
    const miss = await c.call("sim_dispatch", {
      simId,
      events: [{ kind: "tap", target: [10, 10] }],
    });
    expect(miss.text).toContain("hit nothing");
    expect(miss.text).toContain('Nearest layer with a touch patch: "card"');
    await c.call("add_layers", {
      layers: [
        { type: "rectangle", name: "Cover", props: { position: [0, 250], size: [402, 400] } },
      ],
    });
    const covered = await c.call("sim_dispatch", {
      simId,
      events: [{ kind: "tap", target: "@card" }],
    });
    expect(covered.text).toContain("picked up the edits");
    expect(covered.text).toContain('"cover" sits in front of "card"');
  });

  it("validates addresses with suggestions", async () => {
    const { c, simId } = await setup();
    const r = await c.call("sim_get_values", { simId, targets: ["@card.scal"] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Did you mean "scale"');
    const patch = await c.call("sim_get_values", { simId, targets: ["card.scale"] });
    expect(patch.text).toContain('"card" is a layer; write "@card.scale"');
    const unknown = await c.call("sim_step", { simId: "sim_99" });
    expect(unknown.structured.error).toMatchObject({ code: "unknown_sim" });
  });
});

describe("simulation settling with feedback loops", () => {
  // The documented Delay One Frame example: each frame adds 3 degrees to last frame's angle.
  const SPINNER = [
    { op: "addLayer", layer: { ref: "spinner", type: "rectangle", name: "Spinner", props: { position: [181, 420], size: [40, 40] } } },
    { op: "addPatch", patch: { ref: "spin", type: "add", name: "Spin", inputs: { value2: 3 } } },
    { op: "addPatch", patch: { ref: "last", type: "delay1", name: "Last Angle" } },
    { op: "connect", from: "$spin.output", to: "$last.value" },
    { op: "connect", from: "$last.output", to: "$spin.value1" },
    { op: "connect", from: "$spin.output", to: "@$spinner.rotation" },
  ];

  it("reports a spinning feedback loop as still animating in previews and sim_step", async () => {
    project = await tempProject();
    client = await connectClient(project.host);
    const built = await client.call("apply_ops", { ops: SPINNER });
    expect(built.isError, built.text).toBe(false);
    const { doc } = await project.host.getDocument();
    const sim = createSimulationManager({ registry: realRegistry, getDocument: () => ({ docId: "doc", doc, revision: 1 }) });
    try {
      expect(sim.previewScene("doc", { maxMs: 200 }).settled).toBe(false);
      expect(sim.previewScene("doc", { atMs: 100 }).settled).toBe(false);
    } finally {
      sim.dispose();
    }
    const reset = await client.call("sim_reset", {});
    const simId = reset.structured.simId as string;
    const step = await client.call("sim_step", { simId, frames: 10 });
    expect(step.isError, step.text).toBe(false);
    expect(step.structured.settled).toBe(false);
    const values = await client.call("sim_get_values", { simId, targets: ["@spinner.rotation"] });
    expect((values.structured.values as Record<string, number>)["@spinner.rotation"]).toBe(33);
  });
});

describe("simulation with mock patches", () => {
  it("runs independent sessions by simId", async () => {
    const { c, simId } = await setup(createMockRegistry());
    const second = await c.call("sim_reset", {});
    const other = second.structured.simId as string;
    expect(other).not.toBe(simId);
    await c.call("sim_dispatch", { simId, events: [{ kind: "tap", target: "@card" }] });
    await c.call("sim_step", { simId, frames: 90 });
    const a = await c.call("sim_get_values", { simId, targets: ["card_grown.on", "@card.scale"] });
    const b = await c.call("sim_get_values", {
      simId: other,
      targets: ["card_grown.on", "@card.scale"],
    });
    expect((a.structured.values as Record<string, unknown>)["card_grown.on"]).toBe(true);
    expect((a.structured.values as Record<string, number>)["@card.scale"]).toBeCloseTo(1.08, 2);
    expect(b.structured.values).toEqual({ "card_grown.on": false, "@card.scale": 1 });
    const info = await c.call("get_document_info", {});
    expect(info.text).toContain(`Simulations: ${simId}`);
  });

  it("refuses traces on a copy once a simulation has run past its replay budget", { timeout: 120_000 }, async () => {
    const { c, simId } = await setup(createMockRegistry());
    await c.call("sim_dispatch", { simId, events: [{ kind: "tap", target: "@card" }] });
    for (let i = 0; i < 3; i++) {
      const stepped = await c.call("sim_step", { simId, frames: 7200 });
      expect(stepped.isError, stepped.text).toBe(false);
    }
    const copy = await c.call("sim_trace", { simId, targets: ["card_grown.on"], durationMs: 100 });
    expect(copy.isError).toBe(true);
    expect(copy.text).toContain("run too long to copy");
    const moving = await c.call("sim_trace", { simId, targets: ["card_grown.on"], durationMs: 100, advance: true });
    expect(moving.isError, moving.text).toBe(false);
    expect((moving.structured.values as Record<string, unknown[]>)["card_grown.on"]!.every((v) => v === true)).toBe(true);
  });

  it("never changes the document", async () => {
    const { c, simId } = await setup(createMockRegistry());
    const before = (await c.call("get_document_info", {})).structured.revision;
    await c.call("sim_dispatch", {
      simId,
      events: [
        { kind: "drag", from: "@card", to: [300, 700] },
        { kind: "key", key: "Space", atMs: 20 },
      ],
    });
    await c.call("sim_trace", { simId, targets: ["@card.scale"], durationMs: 100 });
    expect((await c.call("get_document_info", {})).structured.revision).toBe(before);
  });

  it("draws simulation screenshots headlessly", async () => {
    const { c, simId } = await setup(createMockRegistry());
    const shot = await c.call("get_screenshot", { simId, target: "@card" });
    expect(shot.isError, shot.text).toBe(false);
    expect(shot.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(shot.text).toContain(`@card · 358×220 · 0 ms · ${simId}`);
  });
});
