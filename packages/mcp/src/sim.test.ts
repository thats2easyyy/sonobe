import type { EngineRegistry } from "@sonobe/engine";
import { createMockRegistry } from "@sonobe/engine/testing";
import { createPatchRegistry } from "@sonobe/patches";
import { afterEach, describe, expect, it } from "vitest";
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

  it("explains that screenshots need the app", async () => {
    const { c } = await setup(createMockRegistry());
    const shot = await c.call("get_screenshot", {});
    expect(shot.isError).toBe(true);
    expect(shot.structured.error).toMatchObject({ code: "screenshots_unavailable" });
    expect(shot.text).toContain("Open the project in the Sonobe app for screenshots");
  });
});
