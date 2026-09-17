import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
