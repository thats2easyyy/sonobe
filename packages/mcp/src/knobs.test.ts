/**
 * Knob tools through the real MCP surface on a headless project: set_knobs builds and tunes knobs
 * and presets in one batch, get_knobs reads and compares them, apply_knob_preset switches what the
 * person's prototype runs, and sim_reset runs another preset in a simulation only.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

/**
 * A card that flies out when a swipe travels past Commit Distance: Swipe (distance only) turns Gone on,
 * which springs the card to x 600.
 */
async function deck(): Promise<TestClient> {
  project = await tempProject();
  client = await connectClient(project.host);
  const layers = await client.call("add_layers", {
    layers: [{ type: "rectangle", name: "Card", props: { position: [22, 300], size: [358, 220] } }],
  });
  expect(layers.isError, layers.text).toBe(false);
  const patches = await client.call("add_patches", {
    patches: [
      {
        ref: "swipe",
        type: "swipe",
        name: "Swipe Card",
        inputs: { layer: { layer: "card" }, minVelocity: 100000, minDistance: 95 },
      },
      {
        ref: "gone",
        type: "switch",
        name: "Gone",
        inputs: { turnOn: { link: "$swipe.swipedRight" } },
      },
      {
        ref: "fly",
        type: "popAnimation",
        name: "Fly Spring",
        inputs: { number: { link: "$gone.on" }, bounciness: 5, speed: 20 },
      },
      {
        ref: "x",
        type: "transition",
        name: "Card X",
        typeParam: "point",
        inputs: { progress: { link: "$fly.output" }, start: [22, 300], end: [600, 300] },
      },
    ],
    connections: [{ from: "$x.output", to: "@card.position" }],
  });
  expect(patches.isError, patches.text).toBe(false);
  return client;
}

const SLOW_DRAG = [{ kind: "drag", from: "@card", to: [301, 410], durationMs: 800 }];

/** The deck with three presets, Proposal running: Commit Distance 60, 200, 100 and Fly Bounce 5, 2, 9. */
async function threePresets(c: TestClient): Promise<void> {
  const r = await c.call("set_knobs", {
    presets: [{ name: "Proposal" }, { name: "Shipped app", locked: true }, { name: "Third" }],
    knobs: [
      {
        name: "Commit Distance",
        connect: ["swipe_card.minDistance"],
        values: { Proposal: 60, "Shipped app": 200, Third: 100 },
      },
      {
        name: "Fly Bounce",
        connect: ["fly_spring.bounciness"],
        values: { Proposal: 5, "Shipped app": 2, Third: 9 },
      },
    ],
  });
  expect(r.isError, r.text).toBe(false);
}

describe("set_knobs", () => {
  it("makes presets and knobs in one batch, infers what it isn't told, and locks last", async () => {
    const c = await deck();
    const r = await c.call("set_knobs", {
      presets: [{ name: "Proposal" }, { name: "Shipped app", locked: true }],
      knobs: [
        {
          name: "Commit Distance",
          group: "Throw",
          connect: ["swipe_card.minDistance"],
          values: { "Shipped app": 400 },
        },
        {
          name: "Fly Bounce",
          group: "Throw",
          type: "number",
          value: 5,
          connect: [{ target: "fly_spring.bounciness" }],
        },
      ],
    });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toContain(
      "Knobs: created 2 (commit_distance, fly_bounce; 1 group), updated 0 · Presets: Proposal (running), Shipped app (locked) · Connected 2 inputs",
    );
    expect(r.text).toContain(
      "Commit Distance: inferred type number, value 95 from swipe_card.minDistance and range 0…1000 step 10 pt from the value (pass them to set your own).",
    );
    expect(r.text).toContain(
      "Fly Bounce: inferred range 0…20 step 0.5 from fly_spring.bounciness's declared range (pass it to set your own).",
    );
    expect(r.text).toContain("Proposal vs Shipped app: 1 of 2 knobs differ.");
    const doc = (await project!.host.getDocument()).doc;
    expect(doc.knobs).toMatchObject({
      active: "proposal",
      presets: [
        { id: "proposal", name: "Proposal" },
        { id: "shipped_app", name: "Shipped app", locked: true },
      ],
      knobs: [
        {
          id: "commit_distance",
          group: "Throw",
          type: "number",
          values: { proposal: 95, shipped_app: 400 },
          min: 0,
          max: 1000,
          step: 10,
          unit: "pt",
        },
        { id: "fly_bounce", values: { proposal: 5, shipped_app: 5 } },
      ],
    });
    expect(doc.components.main!.patches.swipe_card!.inputs.minDistance).toEqual({
      link: "$knob.commit_distance",
    });
    // One call is one undo step.
    expect(
      (await c.call("list_history", {})).text.match(/set_knobs|made 2 knobs/g)?.length ?? 0,
    ).toBeGreaterThan(0);
  });

  it("teaches which preset a value belongs to, refuses locked presets, and reports skipped connections", async () => {
    const c = await deck();
    await c.call("set_knobs", {
      presets: [{ name: "Proposal" }, { name: "Shipped app", locked: true }],
      knobs: [{ name: "Commit Distance", connect: ["swipe_card.minDistance"] }],
    });
    const ambiguous = await c.call("set_knobs", { knobs: [{ id: "commit_distance", value: 110 }] });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toContain(
      'Commit Distance has values in Proposal and Shipped app. Say which one: values: { "Proposal": 110 }.',
    );
    const locked = await c.call("set_knobs", {
      knobs: [{ id: "Commit Distance", values: { "shipped app": 70 } }],
    });
    expect(locked.isError).toBe(true);
    expect(locked.text).toContain("Shipped app is locked, so its values stay as they are.");
    const tuned = await c.call("set_knobs", {
      knobs: [{ id: "commit_distance", values: { Proposal: 110 } }],
    });
    expect(tuned.isError, tuned.text).toBe(false);
    const skipped = await c.call("set_knobs", {
      knobs: [{ id: "commit_distance", connect: ["fly_spring.number"] }],
    });
    expect(skipped.text).toContain(
      "Skipped fly_spring.number: driven by gone.on; pass replaceConnections: true to replace it.",
    );
    const replaced = await c.call("set_knobs", {
      knobs: [{ name: "Fly Target", type: "number", value: 1, connect: ["fly_spring.number"] }],
      replaceConnections: true,
    });
    expect(replaced.isError, replaced.text).toBe(false);
    const bad = await c.call("set_knobs", {
      knobs: [{ name: "Label", connect: ["swipe_card.layer"] }],
    });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("takes layer, which a knob can't hold");
  });

  it("fails an explicit retired id with core's teaching, and names the id a derived one skipped to", async () => {
    const c = await deck();
    await c.call("set_knobs", {
      presets: [{ name: "Proposal" }, { name: "Third" }],
      knobs: [{ name: "Grow Bounce", type: "number", value: 5 }],
    });
    await c.call("set_knobs", {
      presets: [{ id: "third", remove: true }],
      knobs: [{ id: "grow_bounce", remove: true }],
    });
    const host = project!.host;
    const apply = host.apply.bind(host);
    let applies = 0;
    host.apply = (...args) => {
      applies++;
      return apply(...args);
    };
    const explicit = await c.call("set_knobs", {
      knobs: [{ id: "grow_bounce", name: "Grow Bounce", type: "number", value: 3 }],
    });
    expect(explicit.isError).toBe(true);
    expect(applies).toBe(1);
    expect(explicit.text).toContain(
      '"grow_bounce" belonged to a knob removed earlier in this session.',
    );
    expect(explicit.text).toContain('Or leave "id" out to get "grow_bounce_2".');
    const derived = await c.call("set_knobs", {
      presets: [{ name: "Third" }],
      knobs: [{ name: "Grow Bounce", type: "number", value: 3 }],
    });
    expect(derived.isError, derived.text).toBe(false);
    expect(derived.text).toContain("Knobs: created 1 (grow_bounce_2), updated 0");
    expect(derived.text).toContain("Retired ids skipped: third → third_2, grow_bounce → grow_bounce_2.");
    expect(derived.structured.retiredIds).toEqual({ third_2: "third", grow_bounce_2: "grow_bounce" });
  });

  it("creates, copies, renames and removes presets, and disconnect and remove keep the running value", async () => {
    const c = await deck();
    await c.call("set_knobs", {
      knobs: [
        { name: "Commit Distance", connect: ["swipe_card.minDistance"], value: 120 },
        { name: "Fly Bounce", connect: ["fly_spring.bounciness"] },
      ],
    });
    let doc = (await project!.host.getDocument()).doc;
    expect(doc.knobs!.presets).toEqual([{ id: "default", name: "Default" }]);
    const presets = await c.call("set_knobs", {
      presets: [
        { id: "default", name: "Proposal" },
        { name: "Wild", copyFrom: "Proposal" },
      ],
      knobs: [{ id: "commit_distance", values: { Wild: 40 } }],
    });
    expect(presets.isError, presets.text).toBe(false);
    doc = (await project!.host.getDocument()).doc;
    expect(doc.knobs!.presets.map((p) => p.name)).toEqual(["Proposal", "Wild"]);
    expect(doc.knobs!.knobs[0]!.values).toEqual({ default: 120, wild: 40 });
    const gone = await c.call("set_knobs", {
      presets: [{ id: "wild", remove: true }],
      knobs: [
        { id: "commit_distance", disconnect: ["swipe_card.minDistance"] },
        { id: "fly_bounce", remove: true },
      ],
    });
    expect(gone.isError, gone.text).toBe(false);
    doc = (await project!.host.getDocument()).doc;
    expect(doc.components.main!.patches.swipe_card!.inputs.minDistance).toBe(120);
    expect(doc.components.main!.patches.fly_spring!.inputs.bounciness).toBe(5);
    expect(doc.knobs!.knobs.map((k) => k.id)).toEqual(["commit_distance"]);
    const undone = await c.call("undo", {});
    expect(undone.isError, undone.text).toBe(false);
    expect(
      (await project!.host.getDocument()).doc.components.main!.patches.swipe_card!.inputs
        .minDistance,
    ).toEqual({ link: "$knob.commit_distance" });
  });

  it("converts constant Variable Broadcasters into knobs, leaving live ones", async () => {
    const c = await deck();
    const built = await c.call("add_patches", {
      patches: [
        {
          ref: "far",
          type: "variableBroadcaster",
          typeParam: "number",
          name: "Commit Distance (app: 95)",
          settings: { name: "Commit Distance", scope: "global" },
          inputs: { value: 80 },
        },
        {
          ref: "far_rx",
          type: "variableReceiver",
          typeParam: "number",
          settings: { name: "Commit Distance", scope: "global" },
        },
        {
          ref: "live",
          type: "variableBroadcaster",
          typeParam: "number",
          settings: { name: "Live X" },
          inputs: { value: { link: "fly_spring.output" } },
        },
        {
          ref: "live_rx",
          type: "variableReceiver",
          typeParam: "number",
          settings: { name: "Live X" },
        },
        {
          ref: "echo",
          type: "popAnimation",
          name: "Echo",
          inputs: { number: { link: "$live_rx.output" } },
        },
      ],
      connections: [{ from: "$far_rx.output", to: "swipe_card.minDistance" }],
    });
    expect(built.isError, built.text).toBe(false);
    const info = await c.call("get_diagnostics", { severity: "info" });
    expect(info.text).toContain("variables_could_be_knobs");
    const r = await c.call("set_knobs", {
      presets: [{ name: "Proposal" }, { name: "Shipped app", locked: true }],
      convertVariables: { component: "main" },
      knobs: [{ id: "commit_distance", values: { "Shipped app": 95 }, group: "Throw" }],
    });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toContain(
      "Converted 1 Variable Broadcaster into knobs (Commit Distance): 1 input read them now",
    );
    expect(r.text).toContain(
      "Not converted (variableBroadcaster): Live X is driven by fly_spring.output, so it's a live signal. Keep it a variable.",
    );
    const doc = (await project!.host.getDocument()).doc;
    expect(doc.knobs!.knobs).toEqual([
      {
        id: "commit_distance",
        name: "Commit Distance",
        group: "Throw",
        type: "number",
        values: { proposal: 80, shipped_app: 95 },
        description: "Commit Distance (app: 95)",
        min: 0,
        max: 200,
        step: 1,
        unit: "pt",
      },
    ]);
    expect(Object.keys(doc.components.main!.patches)).not.toContain("commit_distance_app_95");
    expect(Object.keys(doc.components.main!.patches)).toContain("variableBroadcaster");
  });
});

describe("get_knobs and apply_knob_preset", () => {
  it("lists knobs by group with values and readers, compares presets, and switches the running one live", async () => {
    const c = await deck();
    await c.call("set_knobs", {
      presets: [{ name: "Proposal" }, { name: "Shipped app", locked: true }],
      knobs: [
        {
          name: "Commit Distance",
          group: "Throw",
          unit: "pt",
          connect: ["swipe_card.minDistance"],
          values: { "Shipped app": 400 },
        },
        { name: "Fly Bounce", group: "Throw", connect: ["fly_spring.bounciness"] },
      ],
    });
    const knobs = await c.call("get_knobs", {});
    expect(knobs.text.split("\n")).toEqual([
      "2 knobs in 1 group · running Proposal · presets: Proposal, Shipped app (locked)",
      "Throw",
      '  commit_distance "Commit Distance" number 0…1000 step 10 pt · Proposal 95 · Shipped app 400 · 1 reader',
      '  fly_bounce "Fly Bounce" number 0…20 step 0.5 · Proposal 5 · Shipped app 5 · 1 reader',
      "Proposal vs Shipped app: 1 of 2 differ (Commit Distance 95 → 400 pt)",
    ]);
    expect(knobs.structured).toMatchObject({
      active: "proposal",
      compare: {
        a: "proposal",
        b: "shipped_app",
        differences: [{ id: "commit_distance", a: 95, b: 400 }],
      },
    });
    const only = await c.call("get_knobs", {
      compare: ["Shipped app", "Proposal"],
      onlyDifferences: true,
    });
    expect(only.text).not.toContain("fly_bounce");
    expect(only.text).toContain(
      "Shipped app vs Proposal: 1 of 2 differ (Commit Distance 400 → 95 pt)",
    );

    const sim = await c.call("sim_reset", {});
    const simId = String(sim.structured.simId);
    await c.call("sim_step", { simId, frames: 10 });
    const switched = await c.call("apply_knob_preset", { preset: "shipped app" });
    expect(switched.isError, switched.text).toBe(false);
    expect(switched.text).toContain(
      "Running Shipped app (was Proposal) · 1 knob changed: Commit Distance 95 → 400 pt",
    );
    // The open simulation follows the edit without restarting.
    const values = await c.call("sim_get_values", {
      simId,
      targets: ["$knob.commit_distance", "swipe_card.minDistance"],
    });
    expect(values.structured.frame).toBe(10);
    expect(values.structured.documentUpdated).toBe(true);
    expect(values.structured.values).toMatchObject({ "$knob.commit_distance": 400 });
    expect((await c.call("apply_knob_preset", { preset: "Shipped app" })).text).toContain(
      "already running",
    );
    const info = await c.call("get_document_info", {});
    expect(info.text).toContain(
      "Knobs: 2 in 1 group · presets Proposal, Shipped app (running, locked) (get_knobs for values)",
    );
    const outline = await c.call("get_outline", {});
    expect(outline.text).toContain(
      'knobs 2 · running shipped_app "Shipped app" · presets proposal "Proposal", shipped_app "Shipped app" locked',
    );
    expect(outline.text).toContain("minDistance←$knob.commit_distance");
    const explain = await c.call("explain", {});
    expect(explain.text).toContain(
      "the knob Commit Distance (95 pt in Proposal, 400 pt in Shipped app)",
    );
  });
});

describe("knobs in simulations", () => {
  it("runs another preset in a simulation only: the same drag throws the card in one and springs it back in the other", async () => {
    const c = await deck();
    await c.call("set_knobs", {
      presets: [{ name: "Proposal" }, { name: "Shipped app", locked: true }],
      knobs: [
        {
          name: "Commit Distance",
          connect: ["swipe_card.minDistance"],
          values: { Proposal: 60, "Shipped app": 200 },
        },
      ],
    });
    const before = await project!.host.getDocument();
    const proposal = await c.call("sim_reset", { preset: "Proposal" });
    const shipped = await c.call("sim_reset", { preset: "shipped app" });
    expect(shipped.text).toContain("preset Shipped app");
    expect(shipped.text).toContain("Runs Shipped app (simulation only");
    const trace = async (simId: string) =>
      (
        await c.call("sim_trace", {
          simId,
          targets: ["gone.on", "@card.position"],
          durationMs: 1600,
          events: SLOW_DRAG,
          advance: true,
        })
      ).structured as { values: Record<string, unknown[]> };
    const thrown = await trace(String(proposal.structured.simId));
    const kept = await trace(String(shipped.structured.simId));
    expect(thrown.values["gone.on"]!.at(-1)).toBe(true);
    expect((thrown.values["@card.position"]!.at(-1) as number[])[0]).toBeGreaterThan(500);
    expect(kept.values["gone.on"]!.at(-1)).toBe(false);
    const after = await project!.host.getDocument();
    expect(after.revision).toBe(before.revision);
    expect(after.doc.knobs!.active).toBe("proposal");

    const values = await c.call("sim_get_values", {
      simId: String(shipped.structured.simId),
      targets: ["$knob.commit_distance"],
    });
    expect(values.text).toContain(
      "$knob.commit_distance = 200 (Shipped app in this simulation; the person's Proposal has 60)",
    );
    const tried = await c.call("sim_reset", { knobs: { "Commit Distance": 500 } });
    expect(tried.text).toContain("$knob.commit_distance = 500");
    const missing = await c.call("sim_reset", { preset: "Nope" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('There\'s no preset "Nope".');
    const wrongPath = await c.call("sim_get_values", {
      simId: String(shipped.structured.simId),
      targets: ["card/$knob.commit_distance"],
    });
    expect(wrongPath.isError).toBe(true);
  });

  it("sim_reset with keepOverrides puts new knob values over the session's preset and values, and names what a reset stops running", async () => {
    const c = await deck();
    await threePresets(c);
    const first = await c.call("sim_reset", { preset: "Shipped app", knobs: { fly_bounce: 3 } });
    const simId = String(first.structured.simId);
    const kept = await c.call("sim_reset", {
      simId,
      keepOverrides: true,
      knobs: { commit_distance: 150 },
    });
    expect(kept.isError, kept.text).toBe(false);
    expect(kept.text).toContain("preset Shipped app · 2 knob values");
    expect(kept.text).toContain(
      "Runs Shipped app with $knob.fly_bounce = 3, $knob.commit_distance = 150 (simulation only",
    );
    expect(kept.text).not.toContain("Stopped running");
    expect(kept.structured.knobs).toEqual({
      preset: { id: "shipped_app", name: "Shipped app" },
      values: { fly_bounce: 3, commit_distance: 150 },
    });
    // A preset given with keepOverrides replaces the kept one, and the kept values run over it.
    const third = await c.call("sim_reset", { simId, keepOverrides: true, preset: "Third" });
    expect(third.text).toContain(
      "Runs Third with $knob.fly_bounce = 3, $knob.commit_distance = 150 (simulation only",
    );
    // Without keepOverrides the new values replace the session's, and the reset says what stopped.
    const replaced = await c.call("sim_reset", { simId, knobs: { commit_distance: 120 } });
    expect(replaced.text).toContain("Runs $knob.commit_distance = 120 (simulation only");
    expect(replaced.text).toContain(
      "Stopped running Third with $knob.fly_bounce = 3; pass keepOverrides: true to keep it.",
    );
    const values = await c.call("sim_get_values", {
      simId,
      targets: ["$knob.fly_bounce", "$knob.commit_distance"],
    });
    expect(values.structured.values).toEqual({ "$knob.fly_bounce": 5, "$knob.commit_distance": 120 });
  });

  it("names the preset a sim_override switch runs: in the summary, the header, value notes and screenshots", async () => {
    const c = await deck();
    await threePresets(c);
    const simId = String((await c.call("sim_reset", { preset: "Shipped app" })).structured.simId);
    const flip = await c.call("sim_override", {
      simId,
      ops: [{ op: "applyKnobPreset", id: "third" }],
    });
    expect(flip.isError, flip.text).toBe(false);
    expect(flip.text).toContain("ov_1 runs Third (the person runs Proposal)");
    expect(flip.text.split("\n")[0]).toContain(" · preset Third · 1 override");
    const read = async (id: string) =>
      (await c.call("sim_get_values", { simId: id, targets: ["$knob.commit_distance"] })).text;
    expect(await read(simId)).toContain(
      "$knob.commit_distance = 100 (Third in this simulation; the person's Proposal has 60)",
    );
    const shot = await c.call("get_screenshot", { simId });
    expect(shot.text).toContain(`Note: ${simId} runs Third, not the person's knobs.`);
    // A value set in the running preset says so.
    await c.call("sim_override", {
      simId,
      ops: [{ op: "setKnobValue", id: "commit_distance", value: 30, preset: "third" }],
    });
    expect(await read(simId)).toContain(
      "$knob.commit_distance = 30 (overridden in this simulation in Third, was 100 pt)",
    );
    // A preset switch without a sim_reset preset, and one back to the person's preset.
    const alone = String((await c.call("sim_reset", {})).structured.simId);
    await c.call("sim_override", { simId: alone, ops: [{ op: "applyKnobPreset", id: "third" }] });
    expect(await read(alone)).toContain(
      "$knob.commit_distance = 100 (Third in this simulation; the person's Proposal has 60)",
    );
    const back = String((await c.call("sim_reset", { preset: "Shipped app" })).structured.simId);
    const theirs = await c.call("sim_override", {
      simId: back,
      ops: [{ op: "applyKnobPreset", id: "proposal" }],
    });
    expect(theirs.text.split("\n")[0]).not.toContain("preset");
    expect(await read(back)).toMatch(/\$knob\.commit_distance = 60$/m);
  });

  it("sim_override tunes knobs in one simulation, locked presets included", async () => {
    const c = await deck();
    await c.call("set_knobs", {
      presets: [{ name: "Proposal" }, { name: "Shipped app", locked: true }],
      knobs: [
        {
          name: "Commit Distance",
          connect: ["swipe_card.minDistance"],
          values: { Proposal: 60, "Shipped app": 200 },
        },
      ],
    });
    const sim = await c.call("sim_reset", { preset: "Shipped app" });
    const simId = String(sim.structured.simId);
    const r = await c.call("sim_override", {
      simId,
      ops: [{ op: "setKnobValue", id: "commit_distance", value: 30 }],
    });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toContain("Commit Distance = 30 pt (was 200 pt)");
    const values = await c.call("sim_get_values", { simId, targets: ["$knob.commit_distance"] });
    expect(values.structured.values).toMatchObject({ "$knob.commit_distance": 30 });
    const flip = await c.call("sim_override", {
      simId,
      ops: [{ op: "applyKnobPreset", id: "proposal" }],
    });
    expect(flip.isError, flip.text).toBe(false);
    // The preset switch applies first, so the value override tunes the preset the simulation runs.
    expect(
      (await c.call("sim_get_values", { simId, targets: ["$knob.commit_distance"] })).structured
        .values,
    ).toMatchObject({ "$knob.commit_distance": 30 });
    expect((await project!.host.getDocument()).doc.knobs!.knobs[0]!.values).toEqual({
      proposal: 60,
      shipped_app: 200,
    });
  });
});

describe("converting a real session's Variable Broadcasters", () => {
  it("turns the swipe deck's 14 shared constants into knobs: 22 links rewritten, 28 patches gone, the same motion", async () => {
    project = await tempProject();
    const c = (client = await connectClient(project.host));
    const here = path.dirname(fileURLToPath(import.meta.url));
    const session = JSON.parse(
      readFileSync(path.join(here, "../../core/src/testing/session-knobs.json"), "utf8"),
    ) as {
      knobs: { name: string; type: string; value: number | boolean; app: string }[];
      interface: Record<string, unknown>;
      inner: Record<string, unknown>[];
      outputs: Record<string, string>;
    };
    const card = await c.call("apply_ops", {
      ops: [
        {
          op: "addComponent",
          component: { id: "swipe_card", name: "Swipe Card", kind: "patchComponent" },
        },
        session.interface,
        ...session.inner.map((patch) => ({ op: "addPatch", component: "swipe_card", patch })),
        ...Object.entries(session.outputs).map(([key, from]) => ({
          op: "connect",
          component: "swipe_card",
          from,
          to: `$out.${key}`,
        })),
      ],
    });
    expect(card.isError, card.text).toBe(false);
    const main = await c.call("apply_ops", {
      ops: [
        ...session.knobs.map((k) => ({
          op: "addPatch",
          patch: {
            type: "variableBroadcaster",
            typeParam: k.type,
            name: `${k.name} (app: ${k.app})`,
            settings: { name: k.name, scope: "global" },
            inputs: { value: k.value },
          },
        })),
        {
          op: "addPatch",
          patch: {
            ref: "press_rx",
            type: "variableReceiver",
            typeParam: "number",
            name: "Button Press Scale",
            settings: { name: "Button Press Scale", scope: "global" },
          },
        },
        {
          op: "addPatch",
          patch: {
            ref: "yes_press",
            type: "transition",
            name: "Yes Button Scale",
            inputs: { progress: 0.5, start: 1, end: { link: "$press_rx.output" } },
          },
        },
        { op: "addPatch", patch: { ref: "clock", type: "time" } },
        {
          op: "addPatch",
          patch: {
            ref: "drift",
            type: "point",
            name: "Drift",
            inputs: { x: { link: "$clock.time" }, y: 0 },
          },
        },
        ...[1, 2, 3, 4].map((n) => ({
          op: "addPatch",
          patch: {
            id: `card_${n}_swipe`,
            type: "component",
            component: "swipe_card",
            inputs: { translation: { link: "$drift.output" } },
          },
        })),
      ],
    });
    expect(main.isError, main.text).toBe(false);
    const count = async () =>
      Object.values((await project!.host.getDocument()).doc.components).reduce(
        (n, x) => n + Object.keys(x.patches).length,
        0,
      );
    expect(await count()).toBe(95);
    const targets = [
      "card_1_swipe.position",
      "card_2_swipe.rotation",
      "card_3_swipe.scale",
      "yes_button_scale.output",
    ];
    const trace = async () => {
      const sim = await c.call("sim_reset", {});
      return (
        await c.call("sim_trace", { simId: String(sim.structured.simId), targets, durationMs: 500 })
      ).structured.values;
    };
    const before = await trace();

    const r = await c.call("set_knobs", { convertVariables: { component: "main" } });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toContain("Converted 14 Variable Broadcasters into knobs");
    expect(r.text).toContain("22 inputs read them now");
    expect(await count()).toBe(67);
    const doc = (await project.host.getDocument()).doc;
    expect(doc.knobs!.knobs.find((k) => k.id === "tilt_per_point")!.values.default).toBe(1 / 30);
    expect(doc.knobs!.knobs.find((k) => k.id === "commit_distance")).toMatchObject({
      description: "Commit Distance (app: 95)",
    });
    expect(await trace()).toEqual(before);
  });
});

describe("knob links in other tools", () => {
  it("connect reads knobs, and set_values leaves knob-driven inputs to set_knobs", async () => {
    const c = await deck();
    await c.call("set_knobs", { knobs: [{ name: "Fly Bounce", type: "number", value: 7 }] });
    const connected = await c.call("connect", {
      connections: [{ from: "$knob.fly_bounce", to: "fly_spring.bounciness" }],
      replaceExisting: true,
    });
    expect(connected.isError, connected.text).toBe(false);
    const set = await c.call("set_values", {
      updates: [
        { target: "fly_spring.bounciness", value: 3 },
        { target: "fly_spring.speed", value: 18 },
      ],
    });
    expect(set.isError, set.text).toBe(false);
    expect(set.text).toContain(
      "Skipped fly_spring.bounciness: reads knob Fly Bounce; tune it with set_knobs, or pass replaceConnections: true to unlink it.",
    );
    const wrong = await c.call("connect", {
      connections: [{ from: "$knob.fly_bounce", to: "@card.color" }],
    });
    expect(wrong.isError).toBe(true);
    expect(wrong.text).toContain('Knob "Fly Bounce" is a number, but Card\'s Color needs a color.');
  });

  it("are listed in the Claude Desktop manifest", () => {
    const manifest = JSON.parse(
      readFileSync(
        path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          "../../../integrations/claude-desktop/manifest.json",
        ),
        "utf8",
      ),
    ) as { tools: { name: string }[] };
    expect(manifest.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["get_knobs", "set_knobs", "apply_knob_preset"]),
    );
  });
});
