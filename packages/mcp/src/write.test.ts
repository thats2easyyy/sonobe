import { readNodePositions } from "@sonobe/core";
import { homeFrame, rectContains, rectsOverlap, type Rect } from "@sonobe/core/graph";
import { ID_SCENARIO_SETUP, ID_SCENARIOS, runIdScenario, type IdScenarioHost } from "@sonobe/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { estimateGraphGeometry } from "./geometry.ts";
import {
  buildGrowCard,
  connectClient,
  tempProject,
  type TempProject,
  type TestClient,
} from "./test-helpers.ts";

let project: TempProject;
let client: TestClient;

beforeEach(async () => {
  project = await tempProject();
  client = await connectClient(project.host);
});

afterEach(async () => {
  await client.close();
  await project.cleanup();
});

describe("refs in any order", () => {
  it("wires patches that name patches later in the batch, like a drag loop through Sample and Hold", async () => {
    await client.call("add_layers", {
      layers: [
        { type: "rectangle", name: "Sheet", props: { position: [0, 600], size: [402, 700] } },
      ],
    });
    // The usability study's bottom sheet: "$snap" is used before the patch that defines it.
    const r = await client.call("add_patches", {
      patches: [
        { ref: "drag", type: "gesture", name: "Drag Sheet", inputs: { layer: { layer: "sheet" } } },
        {
          ref: "dy",
          type: "pointUnpack",
          name: "Drag Distance",
          inputs: { value: { link: "$drag.translation" } },
        },
        {
          ref: "release",
          type: "pulse",
          name: "Finger Lifted",
          inputs: { on: { link: "$drag.down" } },
        },
        {
          ref: "rest",
          type: "sampleAndHold",
          name: "Resting Offset",
          inputs: { value: { link: "$snap.output" }, sample: { link: "$release.turnedOff" } },
        },
        {
          ref: "finger",
          type: "add",
          name: "Finger Offset",
          inputs: { value1: { link: "$rest.output" }, value2: { link: "$dy.y" } },
        },
        {
          ref: "snap",
          type: "snap",
          name: "Snap to Peek or Open",
          inputs: {
            value: { link: "$finger.output" },
            mode: "points",
            points: { loop: [0, -630] },
          },
        },
      ],
    });
    expect(r.isError, r.text).toBe(false);
    expect(r.structured.created).toEqual([
      "drag_sheet",
      "drag_distance",
      "finger_lifted",
      "resting_offset",
      "finger_offset",
      "snap_to_peek_or_open",
    ]);
    expect(r.text).toContain("$snap → snap_to_peek_or_open");
    expect((await client.call("get_outline", {})).text).toContain(
      "value←snap_to_peek_or_open.output",
    );
    const all = await client.call("get_diagnostics", {});
    const loop = (
      all.structured.diagnostics as { code: string; severity: string; message: string }[]
    ).find((d) => d.code === "feedback_loop");
    expect(loop).toMatchObject({
      severity: "info",
      message: expect.stringContaining("This loop is intentional"),
    });

    const typo = await client.call("add_patches", {
      patches: [
        { ref: "spin", type: "add", name: "Spin", inputs: { value1: { link: "$sipn.output" } } },
      ],
    });
    expect(typo.isError).toBe(true);
    expect(typo.text).toContain(
      '"$sipn" doesn\'t name anything created in this batch. Did you mean "$spin"?',
    );
    expect(typo.text).toContain("Refs in this batch: $spin.");
  });
});

describe("building an ISAT chain", () => {
  it("adds layers and wired patches in batches and returns deltas", async () => {
    const layers = await client.call("add_layers", {
      layers: [
        {
          type: "rectangle",
          name: "Card",
          props: { position: [22, 300], size: [358, 220], cornerRadius: 24 },
        },
      ],
    });
    expect(layers.isError).toBe(false);
    expect(layers.structured).toMatchObject({
      ok: true,
      changed: "all",
      revision: 1,
      created: ["card"],
    });

    const patches = await client.call("add_patches", {
      patches: [
        { ref: "tap", type: "interaction", name: "Tap Card", inputs: { layer: { layer: "card" } } },
        {
          ref: "grown",
          type: "switch",
          name: "Card Grown",
          inputs: { flip: { link: "$tap.tap" } },
        },
        {
          ref: "spring",
          type: "popAnimation",
          name: "Grow Spring",
          inputs: { number: { link: "$grown.on" }, speed: 12 },
        },
        {
          ref: "scale",
          type: "transition",
          name: "Card Scale",
          inputs: { progress: { link: "$spring.output" }, start: 1, end: 1.08 },
        },
      ],
      connections: [{ from: "$scale.output", to: "@card.scale" }],
      label: "tap to grow the card",
    });
    expect(patches.isError).toBe(false);
    expect(patches.structured).toMatchObject({
      ok: true,
      revision: 2,
      created: ["tap_card", "card_grown", "grow_spring", "card_scale"],
      idMap: { tap: "tap_card", grown: "card_grown", spring: "grow_spring", scale: "card_scale" },
    });
    expect(patches.text).toContain("Refs: $tap → tap_card");
    expect((patches.structured.diagnostics as { totals: { errors: number } }).totals.errors).toBe(
      0,
    );

    const outline = await client.call("get_outline", {});
    expect(outline.text).toContain(
      'layer card rectangle "Card" @22,300 358x220 scale←card_scale.output cornerRadius=24',
    );
    expect(outline.text).toContain('patch card_grown switch "Card Grown" flip←tap_card.tap');
    expect(outline.text).toContain(
      'patch card_scale transition<number> "Card Scale" progress←grow_spring.output start=1 end=1.08',
    );

    const history = await client.call("list_history", {});
    expect(history.text).toContain("Claude: tap to grow the card (5 ops)");
    expect(history.text).toContain("Claude: added 1 layer");

    const diagnostics = await client.call("get_diagnostics", { severity: "warning" });
    expect(diagnostics.text).toContain("No warning-level diagnostics");
  });

  it("places auto-positioned patches by dependency depth", async () => {
    await buildGrowCard(client);
    const snap = await project.host.getDocument();
    const p = snap.doc.components.main!.patches;
    expect(p.tap_card!.ui.x).toBeLessThan(p.card_grown!.ui.x);
    expect(p.card_grown!.ui.x).toBeLessThan(p.grow_spring!.ui.x);
    expect(p.grow_spring!.ui.x).toBeLessThan(p.card_scale!.ui.x);
  });

  it("refuses to silently replace a connection and offers the op", async () => {
    await buildGrowCard(client);
    await client.call("add_patches", { patches: [{ type: "interaction", name: "Tap Screen" }] });
    const r = await client.call("connect", {
      connections: [{ from: "tap_screen.tap", to: "card_grown.flip" }],
    });
    expect(r.isError).toBe(true);
    expect(r.structured.error).toMatchObject({ code: "already_connected" });
    expect(r.text).toContain("replaceExisting");
    const replaced = await client.call("connect", {
      connections: [{ from: "tap_screen.tap", to: "card_grown.flip" }],
      replaceExisting: true,
    });
    expect(replaced.isError).toBe(false);
  });

  it("explains type mismatches with converter ops that work", async () => {
    await buildGrowCard(client);
    const r = await client.call("connect", {
      connections: [{ from: "card_grown.on", to: "@card.color" }],
    });
    expect(r.isError).toBe(true);
    expect(r.structured).toMatchObject({ ok: false, changed: "none", revision: 2 });
    const errors = r.structured.errors as { code: string; suggestions: { ops: unknown[] }[] }[];
    expect(errors[0]!.code).toBe("type_mismatch");
    expect(errors[0]!.suggestions.length).toBeGreaterThan(0);
    expect(r.text).toContain("ops: [");
    const fix = await client.call("apply_ops", { ops: errors[0]!.suggestions[0]!.ops });
    expect(fix.isError).toBe(false);
  });
});

describe("apply_ops", () => {
  it("rolls back a failing batch atomically with a did-you-mean suggestion", async () => {
    const r = await client.call("apply_ops", {
      ops: [
        { op: "addLayer", layer: { type: "rectangle", name: "Card" } },
        { op: "addPatch", patch: { ref: "pop", type: "popAnimaton" } },
      ],
    });
    expect(r.isError).toBe(true);
    expect(r.structured).toMatchObject({ ok: false, changed: "none", revision: 0 });
    expect(r.text).toContain("Nothing changed: op 1 of 2 failed");
    expect(r.text).toContain('Did you mean "popAnimation"');
    const info = await client.call("get_document_info", {});
    expect(info.structured.revision).toBe(0);
    const outline = await client.call("get_outline", {});
    expect(outline.text).not.toContain("layer card");
  });

  it("teaches unknown ports and wrong-direction connections with ready ops", async () => {
    await buildGrowCard(client);
    const port = await client.call("apply_ops", {
      ops: [{ op: "connect", from: "tap_card.tap", to: "card_grown.flp" }],
    });
    expect(port.isError).toBe(true);
    expect(port.text).toContain('Did you mean "flip"');
    const swapped = await client.call("apply_ops", {
      ops: [{ op: "connect", from: "card_grown.flip", to: "tap_card.tap" }],
    });
    expect(swapped.isError).toBe(true);
    expect(swapped.text).toContain("wrong_direction");
    expect(swapped.text).toContain('"from":"tap_card.tap","to":"card_grown.flip"');
  });

  it("previews with dryRun and guards with expectedRevision", async () => {
    await buildGrowCard(client);
    const dry = await client.call("apply_ops", {
      ops: [{ op: "disconnect", to: "card_grown.flip" }],
      dryRun: true,
    });
    expect(dry.isError).toBe(false);
    expect(dry.text).toContain("Dry run");
    expect(dry.structured).toMatchObject({ changed: "none", revision: 2, dryRun: true });
    expect(
      (dry.structured.diagnostics as { added: { code: string }[] }).added.map((d) => d.code),
    ).toContain("unused_patch");
    expect((await client.call("get_document_info", {})).structured.revision).toBe(2);

    const stale = await client.call("apply_ops", {
      ops: [{ op: "rename", id: "card", name: "Hero" }],
      expectedRevision: 1,
    });
    expect(stale.isError).toBe(true);
    expect(stale.text).toContain("revision_conflict");
    expect(stale.structured).toMatchObject({
      conflict: { expectedRevision: 1, currentRevision: 2 },
    });
    const fresh = await client.call("apply_ops", {
      ops: [{ op: "rename", id: "card", name: "Hero" }],
      expectedRevision: 2,
    });
    expect(fresh.structured).toMatchObject({ ok: true, revision: 3 });
  });

  it("replaces a patch's type in place and lists what didn't fit", async () => {
    await buildGrowCard(client);
    const r = await client.call("apply_ops", {
      ops: [{ op: "replacePatch", id: "grow_spring", patch: { type: "classicAnimation" } }],
    });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toContain("Dropped what the new patch type has no fitting port for: grow_spring.bounciness (5), grow_spring.speed (12). The undo tool brings them back.");
    expect(r.structured.dropped).toEqual([
      { to: "grow_spring.bounciness", value: 5 },
      { to: "grow_spring.speed", value: 12 },
    ]);
    const outline = (await client.call("get_outline", {})).text;
    expect(outline).toContain('patch grow_spring classicAnimation<number> "Grow Spring" number←card_grown.on');
    expect(outline).toContain("progress←grow_spring.output");
    const history = await client.call("list_history", {});
    expect(history.text).toContain("replaced 1 patch");
  });

  it("lists what a typeParam or inputCount change drops", async () => {
    await buildGrowCard(client);
    const added = await client.call("add_patches", {
      patches: [{ ref: "pick", type: "optionPicker", name: "Pick", inputCount: 3, inputs: { option1: 4, option2: 6 } }],
    });
    expect(added.isError, added.text).toBe(false);
    const fewer = await client.call("apply_ops", {
      ops: [{ op: "updatePatch", id: "pick", inputCount: 2 }],
      dryRun: true,
    });
    expect(fewer.text).toContain("Would drop what no longer fits after the typeParam or inputCount change: pick.option2 (6).");
    const point = await client.call("apply_ops", { ops: [{ op: "updatePatch", id: "card_scale", typeParam: "point" }] });
    expect(point.isError, point.text).toBe(false);
    expect(point.text).toContain("Dropped what no longer fits after the typeParam or inputCount change: card_scale.start (1), card_scale.end (1.08). The undo tool brings them back.");
    expect(point.structured.dropped).toEqual([
      { to: "card_scale.start", value: 1 },
      { to: "card_scale.end", value: 1.08 },
    ]);
  });

  it("creates patch components with published ports", async () => {
    const r = await client.call("apply_ops", {
      ops: [
        {
          op: "addComponent",
          component: { id: "press_feedback", name: "Press Feedback", kind: "patchComponent" },
        },
        {
          op: "updateInterface",
          component: "press_feedback",
          inputs: { down: { key: "down", name: "Down", type: "boolean", default: false } },
          outputs: { scale: { key: "scale", name: "Scale", type: "number" } },
        },
        {
          op: "addPatch",
          component: "press_feedback",
          patch: { ref: "pop", type: "popAnimation", inputs: { number: { link: "$in.down" } } },
        },
        { op: "connect", component: "press_feedback", from: "$pop.output", to: "$out.scale" },
      ],
    });
    expect(r.isError).toBe(false);
    const outline = await client.call("get_outline", { component: "press_feedback" });
    expect(outline.text).toContain("output scale number");
  });
});

describe("other write tools", () => {
  it("set_values skips connected inputs unless asked", async () => {
    await buildGrowCard(client);
    const r = await client.call("set_values", {
      updates: [
        { target: "grow_spring.bounciness", value: 8 },
        { target: "@card.scale", value: 2 },
      ],
    });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("Skipped @card.scale: driven by card_scale.output");
    expect(r.structured.ignored).toEqual([
      { target: "@card.scale", reason: expect.stringContaining("replaceConnections") },
    ]);
    const all = await client.call("set_values", { updates: [{ target: "@card.scale", value: 2 }] });
    expect(all.isError).toBe(true);
    expect(all.structured.error).toMatchObject({ code: "all_ignored" });
  });

  it("updates, renames, tidies and componentizes", async () => {
    await buildGrowCard(client);
    expect(
      (
        await client.call("update_layers", {
          updates: [{ ids: ["card"], props: { cornerRadius: 12 }, name: "Hero Card" }],
        })
      ).isError,
    ).toBe(false);
    expect(
      (await client.call("rename", { updates: [{ id: "grow_spring", name: "Hero Spring" }] }))
        .isError,
    ).toBe(false);
    const tidy = await client.call("tidy_graph", {});
    expect(tidy.isError).toBe(false);
    expect((await client.call("tidy_graph", {})).text).toContain("already tidy");
    const comp = await client.call("create_component", {
      name: "Grow Card",
      layerIds: ["card"],
      patchIds: ["tap_card", "card_grown", "grow_spring", "card_scale"],
    });
    expect(comp.isError).toBe(false);
    expect(comp.structured.componentId).toBe("grow_card");
    const outline = await client.call("get_outline", {});
    expect(outline.text).toContain("componentInstance:grow_card");
    expect(outline.text).toContain('component grow_card "Grow Card" (layerComponent)');
  });

  it("asks for confirmation before deleting many items", async () => {
    await client.call("add_layers", {
      layers: Array.from({ length: 12 }, (_, i) => ({ type: "rectangle", name: `Box ${i + 1}` })),
    });
    const ids = Array.from({ length: 12 }, (_, i) => `box_${i + 1}`);
    const first = await client.call("delete_items", { ids });
    expect(first.isError).toBe(false);
    expect(first.structured).toMatchObject({ status: "confirmation_required", changed: "none" });
    expect(first.text).toContain("Nothing changed yet");
    const token = first.structured.confirmToken as string;
    const wrong = await client.call("delete_items", { ids, confirmToken: "del_nope" });
    expect(wrong.structured.status).toBe("confirmation_required");
    const done = await client.call("delete_items", { ids, confirmToken: token });
    expect(done.structured).toMatchObject({ ok: true, changed: "all" });
    expect((await client.call("get_layers", {})).text).toContain("has no layers yet");
  });

  it("deletes a few items directly and undoes them in one step", async () => {
    await buildGrowCard(client);
    const del = await client.call("delete_items", { ids: ["card", "card_scale"] });
    expect(del.structured).toMatchObject({ ok: true, revision: 3 });
    const undo = await client.call("undo", {});
    expect(undo.isError).toBe(false);
    expect(undo.text).toContain("Undid");
    const outline = await client.call("get_outline", {});
    expect(outline.text).toContain("scale←card_scale.output");
  });

  it("reports what a destructive batch removes, cascades included, on dry runs and real runs", async () => {
    const children = Array.from({ length: 40 }, (_, i) => ({ type: "rectangle", name: `Row ${i + 1}` }));
    expect((await client.call("add_layers", { layers: [{ type: "group", name: "Screen", children }] })).isError).toBe(false);
    const lib = await client.call("apply_ops", {
      ops: [
        { op: "addComponent", component: { id: "library", name: "Library", kind: "patchComponent" } },
        ...Array.from({ length: 20 }, (_, i) => ({ op: "addPatch", component: "library", patch: { id: `sw_${i}`, type: "switch" } })),
      ],
    });
    expect(lib.isError).toBe(false);
    expect(lib.structured.removed).toBeUndefined();

    const dry = await client.call("apply_ops", { ops: [{ op: "removeLayer", id: "screen" }], dryRun: true });
    expect(dry.structured).toMatchObject({ changed: "none", removed: { layers: 41, total: 41 } });
    expect(dry.text).toContain("Would remove: 41 layers.");
    const component = await client.call("apply_ops", { ops: [{ op: "removeComponent", id: "library" }], dryRun: true });
    expect(component.structured.removed).toMatchObject({ components: 1, patches: 20, total: 21 });

    const real = await client.call("apply_ops", { ops: [{ op: "removeLayer", id: "screen" }] });
    expect(real.structured).toMatchObject({ changed: "all", removed: { layers: 41, total: 41 } });
    expect(real.text).toContain("Removed: 41 layers.");
  });

  it("previews delete_items with dryRun without asking or changing anything", async () => {
    await client.call("add_layers", {
      layers: Array.from({ length: 12 }, (_, i) => ({ type: "rectangle", name: `Box ${i + 1}` })),
    });
    const ids = Array.from({ length: 12 }, (_, i) => `box_${i + 1}`);
    const before = (await client.call("get_document_info", {})).structured.revision;
    const dry = await client.call("delete_items", { ids, dryRun: true });
    expect(dry.isError).toBe(false);
    expect(dry.structured).toMatchObject({ changed: "none", dryRun: true, removed: { layers: 12, total: 12 } });
    expect(dry.structured.status).toBeUndefined();
    expect((await client.call("get_document_info", {})).structured.revision).toBe(before);
  });
});

describe("history", () => {
  it("undoes agent batches, refuses human edits, and explains an empty history", async () => {
    await buildGrowCard(client);
    const undo = await client.call("undo", {});
    expect(undo.text).toContain('Undid "Claude: tap to grow the card (5 ops)"');
    expect(undo.structured.revision).toBe(3);
    const outline = await client.call("get_outline", {});
    expect(outline.text).not.toContain("patch ");
    expect(outline.text).toContain("layer card");

    await project.host.apply([{ op: "rename", id: "card", name: "Mine" }], {
      label: "renamed card",
      author: { kind: "human", name: "You" },
    });
    const refused = await client.call("undo", {});
    expect(refused.isError).toBe(true);
    expect(refused.structured.error).toMatchObject({ code: "human_edit" });
    const txn = (
      (await client.call("list_history", { author: "human" })).structured.entries as {
        txnId: string;
      }[]
    )[0]!.txnId;
    expect((await client.call("undo", { txnId: txn })).isError).toBe(false);
    expect((await client.call("undo", {})).isError).toBe(false);
    const empty = await client.call("undo", {});
    expect(empty.isError).toBe(true);
    expect(empty.structured.error).toMatchObject({ code: "nothing_to_undo" });
  });
});

describe("cancelled calls", () => {
  it("never apply or undo once their signal has aborted", async () => {
    await buildGrowCard(client);
    const before = (await project.host.getDocument()).revision;
    const cancelled = new AbortController();
    cancelled.abort();
    const author = { kind: "agent" as const, name: "Claude" };
    await expect(project.host.apply([{ op: "addLayer", layer: { type: "oval", name: "Dot" } }], { label: "dot", author, signal: cancelled.signal })).rejects.toMatchObject({ code: "cancelled" });
    await expect(project.host.history.undo({ author, signal: cancelled.signal })).rejects.toMatchObject({ code: "cancelled" });
    expect((await project.host.getDocument()).revision).toBe(before);
    expect((await client.call("list_history", {})).text).not.toContain("dot");
  });
});

describe("rebuilding a component", () => {
  const CLAUDE = { kind: "agent", name: "Claude" } as const;

  describe("shared id scenarios (ARCHITECTURE §3.2)", () => {
    for (const scenario of ID_SCENARIOS) {
      it(scenario.name, async () => {
        const host = project.host;
        expect((await host.apply(ID_SCENARIO_SETUP, { label: "setup", author: CLAUDE })).ok).toBe(true);
        const adapter: IdScenarioHost = {
          apply: (ops, { dryRun }) => host.apply(ops, { label: "edit", author: CLAUDE, dryRun }),
          undo: async () => void (await host.history.undo({ author: CLAUDE })),
        };
        expect(await runIdScenario(adapter, scenario)).toEqual(scenario.expected);
      });
    }
  });

  /** The retro's swipe card: a patch component whose instance in main feeds the Badge. */
  const buildSwipeCard = async () => {
    const r = await client.call("apply_ops", {
      ops: [
        { op: "addComponent", component: { id: "swipe_card", name: "Swipe Card", kind: "patchComponent" } },
        {
          op: "updateInterface",
          component: "swipe_card",
          inputs: { down: { name: "Down", type: "boolean" }, swipedLeft: { name: "Swiped Left", type: "pulse" } },
          outputs: { gone: { name: "Gone", type: "boolean" }, wentLeft: { name: "Went Left", type: "boolean" } },
        },
        { op: "addPatch", component: "swipe_card", patch: { id: "went_left", type: "switch", inputs: { turnOn: { link: "$in.swipedLeft" } } } },
        { op: "addPatch", component: "swipe_card", patch: { id: "card_gone", type: "or", inputs: { value1: { link: "went_left.on" }, value2: { link: "$in.down" } } } },
        { op: "connect", component: "swipe_card", from: "card_gone.output", to: "$out.gone" },
        { op: "connect", component: "swipe_card", from: "went_left.on", to: "$out.wentLeft" },
        { op: "addLayer", layer: { id: "badge", type: "rectangle", name: "Badge" } },
        { op: "addPatch", patch: { id: "tap", type: "interaction", inputs: { layer: { layer: "badge" } } } },
        { op: "addPatch", patch: { id: "card_1_swipe", type: "component", component: "swipe_card", name: "Card 1 Swipe", inputs: { down: { link: "tap.down" }, swipedLeft: { link: "tap.tap" } } } },
        { op: "connect", from: "card_1_swipe.wentLeft", to: "@badge.opacity" },
      ],
    });
    expect(r.isError, r.text).toBe(false);
  };
  const rebuild = [
    { op: "removePatch", component: "swipe_card", id: "went_left" },
    { op: "updateInterface", component: "swipe_card", replace: true, inputs: { down: { name: "Down", type: "boolean" } }, outputs: { gone: { name: "Gone", type: "boolean" } } },
  ];

  it("a port declared again with another type lists the cables it no longer fits", async () => {
    await buildSwipeCard();
    const r = await client.call("apply_ops", { ops: [{ op: "updateInterface", component: "swipe_card", inputs: { swipedLeft: { name: "Swipe Color", type: "color" } } }] });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toContain("Disconnected 1 cable in main: tap.tap → card_1_swipe.swipedLeft.");
    expect(r.text).toContain("Disconnected 1 cable in swipe_card: $in.swipedLeft → went_left.turnOn.");
    expect(r.text).toContain("The undo tool brings them back.");
    expect(r.structured.diagnostics).toMatchObject({ totals: { errors: 0 } });
  });

  it("replace: true unpublishes old ports, and the result lists every cable it cut; undo restores them", async () => {
    await buildSwipeCard();
    const dry = await client.call("apply_ops", { ops: rebuild, dryRun: true });
    expect(dry.text).toContain("Would unpublish from Swipe Card: input swipedLeft; output wentLeft.");
    expect(dry.text).toContain("Would disconnect 2 cables in main: tap.tap → card_1_swipe.swipedLeft, card_1_swipe.wentLeft → @badge.opacity.");
    expect(dry.structured).toMatchObject({ changed: "none", unpublished: [{ component: "swipe_card", inputs: ["swipedLeft"], outputs: ["wentLeft"] }] });

    const real = await client.call("apply_ops", { ops: rebuild });
    expect(real.isError, real.text).toBe(false);
    expect(real.text).toContain("Removed: 1 patch.");
    expect(real.text).toContain("Unpublished from Swipe Card: input swipedLeft; output wentLeft.");
    expect(real.text).toContain("Disconnected 1 cable in swipe_card: went_left.on → card_gone.value1.");
    expect(real.text).toContain("The undo tool brings them back.");
    expect(real.structured.disconnected).toEqual({
      count: 3,
      cables: [
        { component: "main", from: "tap.tap", to: "card_1_swipe.swipedLeft" },
        { component: "main", from: "card_1_swipe.wentLeft", to: "@badge.opacity" },
        { component: "swipe_card", from: "went_left.on", to: "card_gone.value1" },
      ],
    });
    const outline = (await client.call("get_outline", { component: "swipe_card" })).text;
    expect(outline).toContain('output gone boolean "Gone" ←card_gone.output');
    expect(outline).not.toContain("swipedLeft");

    expect((await client.call("undo", {})).isError).toBe(false);
    const restored = (await client.call("get_outline", {})).text;
    expect(restored).toContain("opacity←card_1_swipe.wentLeft");
    expect(restored).toContain("swipedLeft←tap.tap");
  });

  it("warns when a cable reads an output the component doesn't drive", async () => {
    await buildSwipeCard();
    const r = await client.call("apply_ops", { ops: [{ op: "disconnect", component: "swipe_card", to: "$out.wentLeft" }] });
    expect(r.text).toContain("undriven_output");
    expect(r.text).toContain("Swipe Card doesn't drive that output inside");
  });

  it("names the retired ids a later batch skipped, on their own line", async () => {
    await buildSwipeCard();
    const oneBatch = await client.call("apply_ops", {
      ops: [
        { op: "removePatch", component: "swipe_card", id: "card_gone" },
        { op: "addPatch", component: "swipe_card", patch: { type: "or", name: "Card Gone" } },
      ],
    });
    expect(oneBatch.text).toContain("Created: card_gone (or)");
    expect(oneBatch.text).not.toContain("Retired ids");
    await client.call("apply_ops", { ops: [{ op: "removePatch", component: "swipe_card", id: "card_gone" }] });
    const later = await client.call("apply_ops", { ops: [{ op: "addPatch", component: "swipe_card", patch: { type: "or", name: "Card Gone" } }] });
    expect(later.text).toContain("Created: card_gone_2 (or)\nRetired ids skipped: card_gone → card_gone_2. Those ids belonged to items removed earlier this session");
    expect(later.structured.retiredIds).toEqual({ card_gone_2: "card_gone" });
    const explicit = await client.call("apply_ops", { ops: [{ op: "addPatch", component: "swipe_card", patch: { id: "card_gone", type: "or" } }] });
    expect(explicit.isError).toBe(true);
    expect(explicit.text).toContain('"card_gone" belonged to an item removed from swipe_card earlier in this session.');
    expect(explicit.text).toContain("undo it first");
  });

  it("names the item that took an id first when two names in a batch slug alike", async () => {
    const r = await client.call("add_patches", {
      patches: [
        { type: "switch", name: "Card Above: Gone" },
        { type: "switch", name: "Card Above Gone" },
      ],
    });
    expect(r.text).toContain('Suffixed ids: card_above_gone_2 ("Card Above Gone") because card_above_gone ("Card Above: Gone") took card_above_gone earlier in this batch.');
    expect(r.structured.suffixedIds).toEqual({ card_above_gone_2: "card_above_gone" });
  });

  it("teaches guessed updateInterface fields", async () => {
    await buildSwipeCard();
    const r = await client.call("apply_ops", { ops: [{ op: "updateInterface", component: "swipe_card", mode: "replace", inputs: {} }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('updateInterface has no field "mode".');
    expect(r.text).toContain('pass "replace": true');
  });
});

describe("tidy_graph with comment frames", () => {
  const places = ["Mānoa Falls Trail", "Honolulu Museum of Art", "Rainbow Drive-In", "Leonard's Bakery"];
  /** The sectioned deck from the retro: knobs, the deck, places and category chips, one loose patch, and a driven layer. */
  const sectioned = [
    { op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card" } },
    { op: "addComment", comment: { id: "knobs", text: "KNOBS", rect: [0, 0, 380, 420] } },
    { op: "addPatch", patch: { id: "k_resp", type: "splitter", typeParam: "number", name: "Spring Response (app: 0.3)", inputs: { value: 0.3 }, ui: { x: 20, y: 40 } } },
    { op: "addPatch", patch: { id: "k_damp", type: "splitter", typeParam: "number", name: "Spring Damping (app: 0.75)", inputs: { value: 0.75 }, ui: { x: 20, y: 130 } } },
    { op: "addPatch", patch: { id: "k_fly", type: "splitter", typeParam: "number", name: "Fly-Out Distance (app: 600)", inputs: { value: 600 }, ui: { x: 20, y: 220 } } },
    { op: "addComment", comment: { id: "deck", text: "THE DECK", rect: [440, 0, 1100, 420] } },
    { op: "addPatch", patch: { id: "drag", type: "gesture", name: "Drag Card", ui: { x: 460, y: 40 } } },
    { op: "addPatch", patch: { id: "fly", type: "multiply", name: "Fly-Out X", ui: { x: 700, y: 220 }, inputs: { value1: { link: "k_fly.output" }, value2: 1 } } },
    { op: "addPatch", patch: { id: "spring", type: "popAnimation", name: "Card Spring", ui: { x: 1180, y: 40 }, inputs: { number: { link: "fly.output" } } } },
    { op: "addComment", comment: { id: "places", text: "PLACES", rect: [440, 480, 330, 520] } },
    { op: "addPatch", patch: { id: "names", type: "loopBuilder", typeParam: "text", inputCount: 4, name: "Place Names", inputs: Object.fromEntries(places.map((v, i) => [`item${i}`, v])), ui: { x: 460, y: 520 } } },
    { op: "addPatch", patch: { id: "count", type: "loopCount", name: "Card Count", ui: { x: 460, y: 680 }, inputs: { loop: { link: "names.loop" } } } },
    { op: "addComment", comment: { id: "chips", text: "CATEGORY CHIPS", rect: [820, 480, 400, 300] } },
    { op: "addPatch", patch: { id: "scroll", type: "scroll", name: "Scroll Categories", ui: { x: 840, y: 520 } } },
    { op: "addPatch", patch: { id: "loose", type: "popAnimation", name: "Next Card Rise", ui: { x: 1700, y: 600 }, inputs: { number: { link: "spring.output" } } } },
    { op: "connect", from: "spring.output", to: "@card.scale" },
  ];

  const geometry = async () => {
    const { doc } = await project.host.getDocument();
    return { doc, ...estimateGraphGeometry(doc, project.host.registry, "main") };
  };
  const overlapping = (rects: [string, Rect][]) => rects.flatMap(([a, r], i) => rects.slice(i + 1).filter(([, s]) => rectsOverlap(r, s)).map(([b]) => `${a}×${b}`));

  it("keeps every node in its frame, refits and separates the frames, and moves layer nodes too", async () => {
    expect((await client.call("apply_ops", { ops: sectioned })).isError).toBe(false);
    const before = await geometry();
    const frames = [...before.frames].map(([id, f]) => ({ id, ...f }));
    const home = new Map([...before.nodes].map(([id, r]) => [id, homeFrame(r, frames)?.id]));
    const r = await client.call("tidy_graph", {});
    expect(r.isError).toBe(false);
    expect(r.text).toContain("Frames: ");
    expect(r.text).toContain("Node sizes are estimated");
    const after = await geometry();
    expect(overlapping([...after.nodes])).toEqual([]);
    expect(overlapping([...after.frames])).toEqual([]);
    for (const [id, frame] of home) {
      if (frame) expect(rectContains(after.frames.get(frame)!, after.nodes.get(id)!), `${id} in ${frame}`).toBe(true);
      else for (const [fid, f] of after.frames) expect(rectsOverlap(f, after.nodes.get(id)!), `${id} clear of ${fid}`).toBe(false);
    }
    expect(readNodePositions(after.doc.components.main)["@card"]).toBeDefined();
    expect((await client.call("tidy_graph", {})).text).toContain("already tidy");
  });

  it("tidies inside the named frames only, previews with dryRun, and teaches unknown ids", async () => {
    await client.call("apply_ops", { ops: sectioned });
    const { revision } = await project.host.getDocument();
    const preview = await client.call("tidy_graph", { frames: ["places"], dryRun: true });
    expect(preview.text).toContain("Dry run");
    expect((await project.host.getDocument()).revision).toBe(revision);
    const before = await geometry();
    expect((await client.call("tidy_graph", { frames: ["places"] })).isError).toBe(false);
    const after = await geometry();
    for (const id of ["k_resp", "drag", "spring", "loose"]) expect(after.nodes.get(id), id).toEqual(before.nodes.get(id));
    // PLACES grew into CATEGORY CHIPS, which moved clear of it with its patch.
    const dx = after.frames.get("chips")!.x - before.frames.get("chips")!.x;
    expect(after.nodes.get("scroll")!.x - before.nodes.get("scroll")!.x).toBe(dx);
    expect(overlapping([...after.frames])).toEqual([]);
    const wrong = await client.call("tidy_graph", { frames: ["plces"] });
    expect(wrong.isError).toBe(true);
    expect(wrong.text).toContain('There\'s no comment "plces" in main. Did you mean "places"?');
    expect(wrong.text).toContain('places ("PLACES")');
    expect((await client.call("tidy_graph", { ids: ["nmes"] })).text).toContain('Did you mean "names"?');
  });

  it("tidies by the sizes the open patch editor measured, at the same revision only", async () => {
    await client.call("apply_ops", { ops: sectioned });
    const snap = await project.host.getDocument();
    const estimated = await client.call("tidy_graph", { frames: ["places"], dryRun: true });
    expect(estimated.text).toContain("Node sizes are estimated");
    // An editor showing main measured Place Names wider than the estimate (say, a longer live value).
    let revision = snap.revision;
    project.host.graphGeometry = async ({ component }) => ({ docId: snap.docId, component, revision, nodes: { names: { x: 460, y: 520, width: 520, height: 124, measured: true } } });
    const measured = await client.call("tidy_graph", { frames: ["places"], dryRun: true });
    expect(measured.text).toContain("Node sizes: 1 of 11 as the patch editor measured them");
    const places = (r: typeof measured) => (r.structured.frames as Record<string, Rect>).places!;
    expect(places(measured).width).toBeGreaterThan(places(estimated).width + 200);
    // Boxes the editor drew for another revision are ignored.
    revision = snap.revision - 1;
    expect((await client.call("tidy_graph", { frames: ["places"], dryRun: true })).text).toContain("Node sizes are estimated");
  });
});

describe("setNodePositions through apply_ops", () => {
  it("says when a layer has no graph node yet, and teaches updateComponent writes that would drop positions", async () => {
    await buildGrowCard(client);
    await client.call("add_layers", { layers: [{ type: "rectangle", name: "Badge" }] });
    const r = await client.call("apply_ops", { ops: [{ op: "setNodePositions", positions: { "@card": [900, 40], "@badge": [900, 300] } }] });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("Saved positions for @badge; they apply once a cable drives or reads those layers");
    expect(r.text).not.toContain("@card;");
    expect((await client.call("list_history", {})).text).toContain("moved 2 nodes");
    const wipe = await client.call("apply_ops", { ops: [{ op: "updateComponent", id: "main", meta: { patchEditor: { nodes: { "@card": [1, 2] } } } }] });
    expect(wipe.isError).toBe(true);
    expect(wipe.text).toContain("meta_conflict");
    expect(wipe.text).toContain("setNodePositions");
  });
});

describe("add_patches placement", () => {
  it("sizes columns as the editor draws them, so wide Loop Builders never overlap what reads them", async () => {
    const values = (prefix: string) => Object.fromEntries([0, 1, 2, 3].map((i) => [`item${i}`, `${prefix} ${i}: a long place name`]));
    await client.call("apply_ops", { ops: [{ op: "addComment", comment: { id: "top", text: "Existing", rect: [0, 0, 400, 200] } }] });
    const r = await client.call("add_patches", {
      patches: [
        { ref: "names", type: "loopBuilder", typeParam: "text", inputCount: 4, name: "Place Names", inputs: values("Name") },
        { ref: "addresses", type: "loopBuilder", typeParam: "text", inputCount: 4, name: "Place Addresses", inputs: values("Address") },
        { ref: "count", type: "loopCount", name: "Card Count", inputs: { loop: { link: "$names.loop" } } },
      ],
    });
    expect(r.isError).toBe(false);
    const { doc } = await project.host.getDocument();
    const boxes = estimateGraphGeometry(doc, project.host.registry, "main").nodes;
    const names = boxes.get("place_names")!;
    expect(names.width).toBeGreaterThan(250);
    expect(boxes.get("card_count")!.x).toBeGreaterThanOrEqual(names.x + names.width + 72);
    const rects = [...boxes.values()];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(rectsOverlap(rects[i]!, rects[j]!)).toBe(false);
    for (const rect of rects) expect(rectsOverlap(rect, { x: 0, y: 0, width: 400, height: 200 })).toBe(false);
  });
});
