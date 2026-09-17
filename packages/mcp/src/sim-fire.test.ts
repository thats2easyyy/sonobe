/**
 * Simulation semantics that depend on when inputs fire: hit reports against the frame each input
 * lands on, scroll wheels that hover first, trace times across Restart Prototype, hot-swapped
 * edits laid out without advancing time, scene(simId), and component-internal addressing.
 */

import { afterEach, describe, expect, it } from "vitest";
import { connectClient, tempProject, type TempProject, type TestClient } from "./test-helpers.ts";

let project: TempProject | undefined;
let client: TestClient | undefined;

afterEach(async () => {
  await client?.close();
  await project?.cleanup();
  client = undefined;
  project = undefined;
});

async function setup(ops: unknown[]): Promise<{ c: TestClient; simId: string; p: TempProject }> {
  project = await tempProject();
  client = await connectClient(project.host);
  const built = await client.call("apply_ops", { ops });
  expect(built.isError, built.text).toBe(false);
  const reset = await client.call("sim_reset", {});
  expect(reset.isError, reset.text).toBe(false);
  return { c: client, simId: reset.structured.simId as string, p: project };
}

type Report = {
  index: number;
  hit?: { layerId?: string; handledBy: string[]; instancePath?: string };
  warnings: string[];
};

const MENU = [
  {
    op: "addLayer",
    layer: {
      ref: "button",
      type: "rectangle",
      name: "Menu Button",
      props: { position: [20, 40], size: [120, 44] },
    },
  },
  {
    op: "addLayer",
    layer: {
      ref: "backdrop",
      type: "rectangle",
      name: "Backdrop",
      props: { position: [0, 300], size: [402, 300] },
    },
  },
  {
    op: "addLayer",
    layer: {
      ref: "chip",
      type: "rectangle",
      name: "Chip",
      props: { position: [0, 700], size: [60, 60] },
    },
  },
  { op: "addPatch", patch: { ref: "chips", type: "loop", name: "Chips", inputs: { count: 2 } } },
  { op: "connect", from: "$chips.index", to: "@$chip.zPosition" },
  {
    op: "addPatch",
    patch: { ref: "tap", type: "interaction", name: "Tap Menu", inputs: { layer: { layer: "$button" } } },
  },
  {
    op: "addPatch",
    patch: { ref: "open", type: "switch", name: "Menu Open", inputs: { turnOn: { link: "$tap.tap" } } },
  },
  {
    op: "addPatch",
    patch: {
      type: "interaction",
      name: "Tap Backdrop",
      inputs: { layer: { layer: "$backdrop" } },
    },
  },
  { op: "connect", from: "$open.on", to: "@$backdrop.opacity" },
];

describe("inputs resolve when they fire", () => {
  it("reports hits against the frame each tap lands on, and skips layers that aren't there", async () => {
    const { c, simId } = await setup(MENU);
    const before = await c.call("sim_get_values", { simId, targets: ["@backdrop.opacity"] });
    expect(before.structured.values).toEqual({ "@backdrop.opacity": 0 });
    const r = await c.call("sim_dispatch", {
      simId,
      events: [
        { kind: "tap", target: "@menu_button" },
        { kind: "tap", target: "@backdrop", atMs: 400 },
        { kind: "tap", target: "@chip#4", atMs: 600 },
      ],
    });
    expect(r.isError, r.text).toBe(false);
    const events = r.structured.events as Report[];
    expect(events[0]!.hit).toMatchObject({ layerId: "menu_button", handledBy: ["tap_menu"] });
    // The backdrop only became touchable after the first tap opened the menu.
    expect(events[1]!.hit).toMatchObject({ layerId: "backdrop", handledBy: ["tap_backdrop"] });
    expect(events[1]!.warnings).toEqual([]);
    expect(events[2]!.warnings[0]).toContain(
      'Layer "chip#4" wasn\'t in the frame at 600 ms, so the tap was skipped',
    );
    expect(events[2]!.hit).toBeUndefined();
  });

  it("gives traces on a copy the same per-input reports without moving the session", async () => {
    const { c, simId } = await setup(MENU);
    const trace = await c.call("sim_trace", {
      simId,
      targets: ["menu_open.on", "@backdrop.opacity"],
      durationMs: 800,
      events: [
        { kind: "tap", target: "@menu_button" },
        { kind: "tap", target: "@backdrop", atMs: 400 },
      ],
    });
    expect(trace.isError, trace.text).toBe(false);
    const events = trace.structured.events as Report[];
    expect(events[1]!.hit).toMatchObject({ layerId: "backdrop" });
    expect(events[1]!.warnings).toEqual([]);
    expect(trace.text).not.toContain("warning");
    const now = await c.call("sim_get_values", { simId, targets: ["menu_open.on"] });
    expect(now.structured).toMatchObject({ frame: 0, values: { "menu_open.on": false } });
  });

  it("explains a target that isn't rendered before anything runs", async () => {
    const { c, simId } = await setup(MENU);
    const r = await c.call("sim_dispatch", { simId, events: [{ kind: "tap", target: "@chip#4" }] });
    expect(r.isError).toBe(true);
    expect(r.structured.error).toMatchObject({ code: "layer_not_rendered" });
    expect(r.text).toContain("fewer copies");
    const info = await c.call("sim_get_values", { simId, targets: ["menu_open.on"] });
    expect(info.structured.frame).toBe(0);
  });

  it("hovers before the wheel so Scroll takes it", async () => {
    const { c, simId } = await setup([
      {
        op: "addLayer",
        layer: {
          ref: "window",
          type: "group",
          name: "Feed Window",
          props: { position: [0, 64], size: [402, 400], clip: true },
        },
      },
      {
        op: "addLayer",
        parent: "$window",
        layer: { ref: "feed", type: "group", name: "Feed", props: { size: [402, 2000] } },
      },
      {
        op: "addPatch",
        patch: {
          ref: "scroll",
          type: "scroll",
          name: "Feed Scroll",
          inputs: { layer: { layer: "$feed" } },
        },
      },
      { op: "connect", from: "$scroll.position", to: "@$feed.position" },
    ]);
    const r = await c.call("sim_dispatch", {
      simId,
      events: [{ kind: "scroll", target: "@feed_window", dy: 300 }],
    });
    expect(r.isError, r.text).toBe(false);
    expect((r.structured.events as Report[])[0]!.hit).toMatchObject({ handledBy: ["feed_scroll"] });
    await c.call("sim_step", { simId, frames: 30 });
    const v = await c.call("sim_get_values", { simId, targets: ["feed_scroll.y"] });
    expect((v.structured.values as Record<string, number>)["feed_scroll.y"]).not.toBe(0);
  });
});

describe("trace times", () => {
  it("stay monotonic when Restart Prototype fires inside a trace", async () => {
    const { c, simId } = await setup([
      {
        op: "addLayer",
        layer: {
          ref: "start",
          type: "rectangle",
          name: "Start Over",
          props: { position: [100, 100], size: [120, 60] },
        },
      },
      {
        op: "addPatch",
        patch: { ref: "tap", type: "interaction", name: "Tap Start", inputs: { layer: { layer: "$start" } } },
      },
      {
        op: "addPatch",
        patch: { type: "restartPrototype", name: "Restart", inputs: { restart: { link: "$tap.tap" } } },
      },
    ]);
    for (const advance of [false, true]) {
      const r = await c.call("sim_trace", {
        simId,
        targets: ["tap_start.down"],
        durationMs: 600,
        events: [{ kind: "tap", target: "@start_over", atMs: 100 }],
        maxRows: 600,
        ...(advance ? { advance } : {}),
      });
      expect(r.isError, r.text).toBe(false);
      const times = r.structured.times as number[];
      expect(times).toHaveLength(36);
      expect(times[0]).toBeCloseTo(16.67, 1);
      for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);
    }
  });
});

describe("hot-swapped edits", () => {
  it("lay out without advancing time, and scene(simId) renders the session", async () => {
    const { c, simId, p } = await setup(MENU);
    const scene = p.host.sim.scene(simId);
    expect(scene.roots.map((n) => n.layerId)).toContain("menu_button");
    await c.call("add_layers", {
      layers: [{ type: "oval", name: "Dot", props: { position: [300, 40], size: [40, 40] } }],
    });
    const swapped = p.host.sim.scene(simId);
    expect(swapped.frame).toBe(scene.frame);
    expect(swapped.roots.map((n) => n.layerId)).toContain("dot");
    const tap = await c.call("sim_dispatch", { simId, events: [{ kind: "tap", target: "@dot" }] });
    expect(tap.isError, tap.text).toBe(false);
    expect(tap.text).toContain("picked up the edits");
    expect((tap.structured.events as Report[])[0]!.hit).toMatchObject({ layerId: "dot" });
    expect(() => p.host.sim.scene("sim_99")).toThrow(/no simulation/);
  });
});

describe("component-internal addressing", () => {
  async function likeButton() {
    project = await tempProject();
    client = await connectClient(project.host);
    const c = client;
    await c.call("add_layers", {
      layers: [
        {
          type: "rectangle",
          name: "Like Button",
          props: { position: [171, 400], size: [60, 60], color: "#E5E5EAFF" },
        },
      ],
    });
    const patches = await c.call("add_patches", {
      patches: [
        { ref: "tap", type: "interaction", name: "Tap Like", inputs: { layer: { layer: "like_button" } } },
        { ref: "liked", type: "switch", name: "Liked", inputs: { flip: { link: "$tap.tap" } } },
        {
          ref: "tint",
          type: "transition",
          typeParam: "color",
          name: "Like Tint",
          inputs: { progress: { link: "$liked.on" }, start: "#E5E5EAFF", end: "#FF3B5CFF" },
        },
      ],
      connections: [{ from: "$tint.output", to: "@like_button.color" }],
    });
    expect(patches.isError, patches.text).toBe(false);
    const made = await c.call("create_component", {
      name: "Like Button",
      layerIds: ["like_button"],
      patchIds: ["tap_like", "liked", "like_tint"],
    });
    expect(made.isError, made.text).toBe(false);
    const reset = await c.call("sim_reset", {});
    return { c, simId: reset.structured.simId as string };
  }

  it("taps, reads and traces inside instances", async () => {
    const { c, simId } = await likeButton();
    const tap = await c.call("sim_dispatch", {
      simId,
      events: [{ kind: "tap", target: "@like_button_2/like_button" }],
    });
    expect(tap.isError, tap.text).toBe(false);
    expect((tap.structured.events as Report[])[0]!.hit).toMatchObject({
      layerId: "like_button",
      instancePath: "like_button_2",
      handledBy: ["like_button_2/tap_like"],
    });
    expect(tap.text).toContain("hit like_button_2/like_button");
    const values = await c.call("sim_get_values", {
      simId,
      targets: ["like_button_2/liked.on", "main/like_button_2/liked.on"],
    });
    expect(values.isError, values.text).toBe(false);
    expect(values.structured.values).toEqual({
      "like_button_2/liked.on": true,
      "main/like_button_2/liked.on": true,
    });
    const trace = await c.call("sim_trace", {
      simId,
      targets: ["@like_button_2/like_button.color"],
      durationMs: 100,
    });
    expect(trace.isError, trace.text).toBe(false);
    expect(trace.text).toContain("#FF3B5C");
  });

  it("teaches instance paths when an id lives inside a component", async () => {
    const { c, simId } = await likeButton();
    const root = await c.call("sim_get_values", { simId, targets: ["liked.on"] });
    expect(root.isError).toBe(true);
    expect(root.structured.error).toMatchObject({ code: "inside_component" });
    expect(root.text).toContain('"like_button_2/liked.on"');
    const layer = await c.call("sim_get_values", { simId, targets: ["@like_button.color"] });
    expect(layer.text).toContain('"@like_button_2/like_button.color"');
    const wrong = await c.call("sim_get_values", { simId, targets: ["nope/liked.on"] });
    expect(wrong.structured.error).toMatchObject({ code: "not_an_instance" });
    expect(wrong.text).toContain("like_button_2 (like_button)");
    const port = await c.call("sim_get_values", { simId, targets: ["like_button_2/liked.of"] });
    expect(port.text).toContain('Did you mean "on"');
  });

  it("gets items through instance paths", async () => {
    const { c } = await likeButton();
    const items = await c.call("get_items", { ids: ["like_button_2/liked", "@like_button_2/nope"] });
    expect(items.isError, items.text).toBe(false);
    expect(items.text).toContain("inside instance like_button_2 (component like_button):");
    expect(items.text).toContain("flip");
    expect(items.structured.missing).toEqual(["@like_button_2/nope"]);
    expect((items.structured.items as { instancePath?: string }[])[0]).toMatchObject({
      instancePath: "like_button_2",
    });
  });
});
