/**
 * sim_override through the real tools on an autosaving headless project: overrides change only the
 * simulation (never the person's document, history or files), survive the person's edits, and
 * teach when they can't apply.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
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

const card = (n: number, color: string) => ({
  type: "rectangle",
  name: `Card ${n}`,
  props: { position: [22 + n * 4, 200 + n * 8], size: [358, 478], cornerRadius: 24, color },
});

/** A deck of four cards (Card 1 on top), a hidden Yes badge, and tap-to-grow on Card 1. */
async function setup() {
  project = await tempProject({ autosave: true });
  client = await connectClient(project.host);
  const built = await client.call("apply_ops", {
    ops: [
      {
        op: "addLayer",
        layer: {
          type: "group",
          name: "Deck",
          props: { size: [402, 874] },
          children: [
            card(4, "#FF3B30FF"),
            card(3, "#FF9500FF"),
            card(2, "#34C759FF"),
            card(1, "#007AFFFF"),
            {
              type: "rectangle",
              name: "Yes Badge",
              props: { position: [260, 230], size: [95, 95], color: "#FFFFFFFF", opacity: 0 },
            },
          ],
        },
      },
      {
        op: "addPatch",
        patch: {
          ref: "tap",
          type: "interaction",
          name: "Tap Card",
          inputs: { layer: { layer: "card_1" } },
        },
      },
      {
        op: "addPatch",
        patch: {
          ref: "grown",
          type: "switch",
          name: "Card Grown",
          inputs: { flip: { link: "$tap.tap" } },
        },
      },
      {
        op: "addPatch",
        patch: {
          ref: "spring",
          type: "popAnimation",
          name: "Grow Spring",
          inputs: { number: { link: "$grown.on" }, bounciness: 5, speed: 12 },
        },
      },
      {
        op: "addPatch",
        patch: {
          ref: "scale",
          type: "transition",
          name: "Card Scale",
          inputs: { progress: { link: "$spring.output" }, start: 1, end: 1.08 },
        },
      },
      { op: "connect", from: "$scale.output", to: "@card_1.scale" },
    ],
  });
  expect(built.isError, built.text).toBe(false);
  const reset = await client.call("sim_reset", {});
  return { c: client, simId: reset.structured.simId as string };
}

/** Every file in the project folder with its bytes and modification time. */
async function files(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of await readdir(dir, { recursive: true })) {
    const file = path.join(dir, name);
    if (!(await stat(file)).isFile()) continue;
    out[name] = `${(await stat(file)).mtimeMs} ${(await readFile(file)).toString("base64")}`;
  }
  return out;
}

const overrideCount = async (c: TestClient, simId: string) =>
  (
    ((await c.call("sim_get_values", { simId, targets: ["@card_1.opacity"] })).structured
      .overrides as unknown[] | undefined) ?? []
  ).length;

describe("sim_override", () => {
  it("changes only the simulation: never the document, history or files", async () => {
    const { c, simId } = await setup();
    const info = (await c.call("get_document_info")).structured;
    const history = (await c.call("list_history")).text;
    const disk = await files(project!.project);

    const peek = await c.call("sim_override", {
      simId,
      set: [
        { target: "@card_1.opacity", value: 0 },
        { target: "@card_2.opacity", value: 0 },
      ],
      ops: [{ op: "updateLayer", id: "yes_badge", props: { opacity: 1 } }],
    });
    expect(peek.isError, peek.text).toBe(false);
    expect(peek.text).toContain(`${simId} · frame`);
    expect(peek.text).toContain("· 3 overrides");
    expect(peek.text).toContain(
      "simulation only: the person's document, viewer and history are unchanged",
    );
    expect(peek.text).toContain("ov_1 @card_1.opacity = 0 (was the default 1)");
    expect(peek.text).toContain("ov_3 @yes_badge.opacity = 1 (was 0)");
    expect(peek.structured.applied).toHaveLength(3);

    const values = await c.call("sim_get_values", {
      simId,
      targets: ["@card_1.opacity", "@card_2.opacity", "@card_3.opacity", "@yes_badge.opacity"],
    });
    expect(values.structured.values).toEqual({
      "@card_1.opacity": 0,
      "@card_2.opacity": 0,
      "@card_3.opacity": 1,
      "@yes_badge.opacity": 1,
    });
    expect(values.text).toContain(
      "@card_1.opacity = 0 (overridden in this simulation, was the default 1)",
    );
    expect(values.text).toContain("@card_3.opacity = 1\n");
    expect(values.structured.notes).toEqual({
      "@card_1.opacity": "overridden in this simulation, was the default 1",
      "@card_2.opacity": "overridden in this simulation, was the default 1",
      "@yes_badge.opacity": "overridden in this simulation, was 0",
    });

    // The person's side is exactly as it was: same revision, history, and bytes on disk.
    const after = (await c.call("get_document_info")).structured;
    expect(after.revision).toBe(info.revision);
    expect(after.text).toContain(`${simId} (frame 0, 3 sim_overrides)`);
    expect((await c.call("list_history")).text).toBe(history);
    expect(await files(project!.project)).toEqual(disk);
    const outline = (await c.call("get_outline")).text;
    expect(outline).toContain('layer yes_badge rectangle "Yes Badge" @260,230 95x95 opacity=0 ');
    expect(outline).not.toMatch(/layer card_1 .*opacity/);
  });

  it("replaces an override of the same target, clears by id or target, and clears all", async () => {
    const { c, simId } = await setup();
    const first = await c.call("sim_override", {
      simId,
      set: [
        { target: "@card_1.opacity", value: 0 },
        { target: "@card_2.opacity", value: 0 },
      ],
    });
    const again = await c.call("sim_override", {
      simId,
      ops: [{ op: "setInput", target: "@card_1.opacity", value: 0.2 }],
    });
    expect(again.structured.overrides).toHaveLength(2);
    expect((again.structured.applied as { id: string }[])[0]!.id).toBe(
      (first.structured.applied as { id: string }[])[0]!.id,
    );
    expect(again.text).toContain("@card_1.opacity = 0.2");

    const one = await c.call("sim_override", { simId, clear: "@card_2.opacity" });
    expect(one.text).toContain("Cleared: ov_2 @card_2.opacity");
    expect(one.structured.overrides).toHaveLength(1);
    const byId = await c.call("sim_override", { simId, clear: ["ov_1"] });
    expect(byId.text).toContain("No overrides: the simulation runs the person's document");
    expect(byId.text.split("\n")[0]).toBe(`${simId} · frame 0 · 0 ms`);

    await c.call("sim_override", { simId, set: [{ target: "@card_3.opacity", value: 0 }] });
    const all = await c.call("sim_override", { simId, clear: "all" });
    expect(all.structured.cleared).toHaveLength(1);
    expect(
      (await c.call("sim_get_values", { simId, targets: ["@card_3.opacity"] })).structured.values,
    ).toEqual({ "@card_3.opacity": 1 });

    const missing = await c.call("sim_override", { simId, clear: ["@card_9.opacity"] });
    expect(missing.structured.error).toMatchObject({ code: "not_overridden" });
  });

  it("stays on top of the person's edits and reports an override their edit removed, once", async () => {
    const { c, simId } = await setup();
    await c.call("sim_override", {
      simId,
      set: [
        { target: "@yes_badge.opacity", value: 1 },
        { target: "@card_4.opacity", value: 0.5 },
      ],
    });
    await c.call("update_layers", {
      updates: [{ ids: ["card_1"], props: { color: "#AF52DEFF" } }],
    });
    const edited = await c.call("sim_get_values", {
      simId,
      targets: ["@card_1.color", "@yes_badge.opacity"],
    });
    expect(edited.structured.documentUpdated).toBe(true);
    expect(edited.structured.values).toMatchObject({ "@yes_badge.opacity": 1 });
    expect(edited.text).toContain("Note: the document changed since the last call");

    await c.call("delete_items", { ids: ["card_4"] });
    const dropped = await c.call("sim_get_values", { simId, targets: ["@card_3.opacity"] });
    expect(dropped.text).toContain(
      "Note: dropped the override on @card_4.opacity; the person's latest edit doesn't accept it",
    );
    expect(dropped.structured.overrides).toHaveLength(1);
    const later = await c.call("sim_get_values", { simId, targets: ["@card_3.opacity"] });
    expect(later.text).not.toContain("dropped");
  });

  it("pins linked values for traces on a copy and keeps state through literal overrides", async () => {
    const { c, simId } = await setup();
    await c.call("sim_dispatch", { simId, events: [{ kind: "tap", target: "@card_1" }] });
    const pin = await c.call("sim_override", {
      simId,
      set: [{ target: "@card_1.scale", value: 1.5 }],
    });
    expect(pin.text).toContain("@card_1.scale = 1.5 (was linked to card_scale.output)");
    const trace = await c.call("sim_trace", {
      simId,
      targets: ["@card_1.scale", "card_scale.output"],
      durationMs: 400,
    });
    const summaries = trace.structured.summaries as Record<string, { end: number }>;
    expect(summaries["@card_1.scale"]!.end).toBe(1.5);
    expect(summaries["card_scale.output"]!.end).toBeGreaterThan(1.05);

    // A literal-only override keeps a spring mid-flight exactly where it was.
    const s2 = (await c.call("sim_reset", {})).structured.simId as string;
    await c.call("sim_dispatch", { simId: s2, events: [{ kind: "tap", target: "@card_1" }] });
    await c.call("sim_step", { simId: s2, ms: 100 });
    const read = async () =>
      (await c.call("sim_get_values", { simId: s2, targets: ["grow_spring.output"] })).structured
        .values as Record<string, number>;
    const mid = await read();
    expect(mid["grow_spring.output"]).toBeGreaterThan(0);
    await c.call("sim_override", {
      simId: s2,
      set: [{ target: "grow_spring.bounciness", value: 15 }],
    });
    expect(await read()).toEqual(mid);
    // Patches read a new input when they next evaluate, and the note says so until then.
    const input = () =>
      c.call("sim_get_values", { simId: s2, targets: ["grow_spring.bounciness"] });
    expect((await input()).text).toContain(
      "grow_spring.bounciness = 5 (overridden to 15 in this simulation from the next frame, was 5)",
    );
    await c.call("sim_step", { simId: s2, frames: 1 });
    expect((await input()).text).toContain(
      "grow_spring.bounciness = 15 (overridden in this simulation, was 5)",
    );
  });

  it("clears on sim_reset unless keepOverrides, and restarts from frame 0 on request", async () => {
    const { c, simId } = await setup();
    await c.call("sim_step", { simId, frames: 30 });
    const restarted = await c.call("sim_override", {
      simId,
      ops: [{ op: "disconnect", to: "grow_spring.number" }],
      restart: true,
    });
    expect(restarted.structured).toMatchObject({ frame: 0, restarted: true });
    expect(restarted.text).toContain("restarted from frame 0");
    expect(restarted.text).toContain(
      "grow_spring.number disconnected (was linked to card_grown.on)",
    );

    const kept = await c.call("sim_reset", { simId, keepOverrides: true });
    expect(kept.text).toContain("Kept overrides");
    expect(kept.structured.overrides).toHaveLength(1);
    await c.call("sim_dispatch", { simId, events: [{ kind: "tap", target: "@card_1" }] });
    await c.call("sim_step", { simId, ms: 500 });
    const still = await c.call("sim_get_values", { simId, targets: ["@card_1.scale"] });
    expect(still.structured.values).toEqual({ "@card_1.scale": 1 });

    const cleared = await c.call("sim_reset", { simId });
    expect(cleared.text).toContain(
      "Cleared 1 override (grow_spring.number); pass keepOverrides: true to keep them.",
    );
    expect(cleared.structured.overrides).toBeUndefined();
    expect(await overrideCount(c, simId)).toBe(0);
  });

  it("teaches, and changes nothing, when an override can't apply", async () => {
    const { c, simId } = await setup();
    await c.call("sim_override", { simId, set: [{ target: "@card_1.opacity", value: 0.5 }] });
    const cases: [Record<string, unknown>, string, string?][] = [
      [{ set: [{ target: "@card_1.opacity#3", value: 0 }] }, "override_per_copy"],
      [{ ops: [{ op: "removeLayer", id: "card_1" }] }, "override_op_unsupported"],
      [
        { set: [{ target: "grow_spring.bouncyness", value: 3 }] },
        "unknown_port",
        'Did you mean "bounciness"',
      ],
      [
        { set: [{ target: "card_grown.on", value: true }] },
        "override_output",
        "grow_spring.number",
      ],
      [{ set: [{ target: "@card_1.opacity", value: "red" }] }, "invalid_value"],
      [{ set: [{ target: "@card_9.opacity", value: 0 }] }, "not_found"],
      [{ clear: ["ov_9"], set: [{ target: "@card_2.opacity", value: 0 }] }, "not_overridden"],
    ];
    for (const [args, code, mentions] of cases) {
      const r = await c.call("sim_override", { simId, ...args });
      expect(r.isError, JSON.stringify(args)).toBe(true);
      expect(r.structured.error, JSON.stringify(args)).toMatchObject({ code });
      if (mentions) expect(r.text).toContain(mentions);
      expect(await overrideCount(c, simId), code).toBe(1);
    }
    const unknown = await c.call("sim_override", { simId: "sim_99", clear: "all" });
    expect(unknown.structured.error).toMatchObject({ code: "unknown_sim" });
  });

  it("finishes a traced drag that outlasts the trace when the trace advances the session", async () => {
    const { c, simId } = await setup();
    const trace = await c.call("sim_trace", {
      simId,
      targets: ["tap_card.down"],
      durationMs: 300,
      advance: true,
      events: [{ kind: "drag", from: "@card_1", to: [200, 700], durationMs: 600 }],
    });
    expect(trace.isError, trace.text).toBe(false);
    expect(trace.structured.framesAfterTrace).toBeGreaterThan(15);
    expect(trace.text).toContain("stepped");
    expect(trace.text).toContain("(no pointer is left down)");
    const down = await c.call("sim_get_values", { simId, targets: ["tap_card.down"] });
    expect(down.structured.values).toEqual({ "tap_card.down": false });
  });
});
