import { describe, expect, it } from "vitest";
import { createHistory } from "./history.ts";
import { createIdLedger, retiredIds, seenIdsExcept, seenIdsFromJSON, seenIdsToJSON } from "./idLedger.ts";
import { applyOps } from "./ops/index.ts";
import { ID_REDO_SCENARIOS, ID_SCENARIO_SETUP, ID_SCENARIOS, runIdScenario, type IdScenarioHost } from "./testing/idScenarios.ts";
import { emptyDoc, expectRoundTrip, mockRegistry, mustApply } from "./testing/fixtures.ts";
import type { Op, SonobeDocument } from "./types.ts";

const setup = () => mustApply(emptyDoc(), ID_SCENARIO_SETUP).doc;

/** What both hosts do: one ledger, observed after every commit and undo. */
function coreHost(initial: SonobeDocument): IdScenarioHost & { doc: () => SonobeDocument } {
  let doc = initial;
  const ids = createIdLedger(initial);
  const history = createHistory();
  return {
    doc: () => doc,
    async apply(ops, { dryRun }) {
      const r = applyOps(doc, ops, { registry: mockRegistry, seenIds: ids, dryRun });
      if (r.ok && !dryRun && r.applied.length) {
        doc = r.doc;
        ids.observe(doc, r.affected.components);
        history.push({ label: "edit", author: { kind: "agent", name: "Claude" }, ops: r.applied, inverse: r.inverse });
      }
      return r;
    },
    async undo() {
      replay(history.undo()!.ops);
    },
    async redo() {
      replay(history.redo()!.ops);
    },
  };
  function replay(ops: Op[]) {
    const r = applyOps(doc, ops, { registry: mockRegistry, lenient: true });
    doc = r.doc;
    ids.observe(doc, r.affected.components);
  }
}

describe("id ledger", () => {
  it("records ids per component, all of them or only the affected ones", () => {
    const doc = setup();
    const ids = createIdLedger(doc);
    expect([...ids.components].sort()).toEqual(["main", "swipe_card"]);
    expect([...ids.items.get("main")!].sort()).toEqual(["card", "card_gone", "tap_card"]);
    const next = mustApply(doc, [{ op: "addPatch", component: "swipe_card", patch: { type: "switch", name: "Gone" } }, { op: "addPatch", patch: { type: "switch", name: "Other" } }]).doc;
    ids.observe(next, ["swipe_card"]);
    expect(ids.items.get("swipe_card")!.has("gone")).toBe(true);
    expect(ids.items.get("main")!.has("other")).toBe(false);
  });

  it("retires ids seen in a component that aren't live there", () => {
    const doc = setup();
    const ids = createIdLedger(doc);
    const removed = mustApply(doc, [{ op: "removePatch", id: "card_gone" }]).doc;
    expect(ids.isRetired(removed, "main", "card_gone")).toBe(true);
    expect(ids.isRetired(removed, "swipe_card", "card_gone")).toBe(false);
    expect(ids.isRetired(doc, "main", "card_gone")).toBe(false);
    expect(ids.isRetired(removed, "main", "never_seen")).toBe(false);
    expect(retiredIds(ids, removed)).toEqual({ main: ["card_gone"] });
    ids.clear();
    expect(ids.isRetired(removed, "main", "card_gone")).toBe(false);
    expect(ids.items.size).toBe(0);
  });

  it("round-trips through JSON (drafts continue their session) and reads damaged JSON as fewer ids", () => {
    const ids = createIdLedger(setup());
    const json = seenIdsToJSON(ids);
    expect(json).toEqual({ items: { main: ["card", "card_gone", "tap_card"], swipe_card: ["card_gone", "is_top_card"] }, components: ["main", "swipe_card"], knobs: [], presets: [] });
    const restored = createIdLedger();
    restored.merge(seenIdsFromJSON(JSON.parse(JSON.stringify(json))));
    expect(seenIdsToJSON(restored)).toEqual(json);
    expect(seenIdsToJSON(seenIdsFromJSON({ items: { main: ["a", 3], bad: "x" }, components: "nope" }))).toEqual({ items: { bad: [], main: ["a"] }, components: [], knobs: [], presets: [] });
    expect(seenIdsToJSON(seenIdsFromJSON(null)).components).toEqual([]);
  });

  describe("shared scenarios on core", () => {
    for (const scenario of [...ID_SCENARIOS, ...ID_REDO_SCENARIOS]) {
      it(scenario.name, async () => {
        expect(await runIdScenario(coreHost(setup()), scenario)).toEqual(scenario.expected);
      });
    }
  });

  it("teaches the rebuild when an explicit id is retired or taken", async () => {
    const host = coreHost(setup());
    await host.apply([{ op: "removePatch", id: "card_gone" }], { dryRun: false });
    const retired = await host.apply([{ op: "addPatch", patch: { id: "card_gone", type: "switch" } }], { dryRun: false });
    expect(retired.errors[0]).toMatchObject({
      code: "id_retired",
      message: expect.stringContaining('"card_gone" belonged to an item removed from main earlier in this session'),
      hint: expect.stringContaining('remove it and add the new one in the same batch (if the removal is already applied, undo it first). Or leave "id" out to get "card_gone_2"'),
    });
    const taken = await host.apply([{ op: "addPatch", patch: { id: "tap_card", type: "switch" } }], { dryRun: false });
    expect(taken.errors[0]!.hint).toContain("To replace that item, remove it earlier in the same batch.");
  });

  it("keeps undo and redo exact for in-batch replacements, retyped and reused by a layer", () => {
    const doc = setup();
    const ids = createIdLedger(doc);
    const batches: Op[][] = [
      [{ op: "removePatch", id: "card_gone" }, { op: "addPatch", patch: { id: "card_gone", type: "counter" } }],
      [{ op: "removePatch", id: "card_gone" }, { op: "addLayer", layer: { id: "card_gone", type: "rectangle" } }],
      [{ op: "removeLayer", id: "card" }, { op: "addLayer", layer: { type: "group", name: "Card", children: [{ type: "rectangle", name: "Shade" }] } }, { op: "setInput", target: "tap_card.layer", value: { layer: "card" } }],
    ];
    for (const ops of batches) {
      const r = mustApply(doc, ops, { seenIds: ids });
      expectRoundTrip(doc, r);
    }
  });

  it("records knob and preset ids in their own namespaces, whichever components an edit names", () => {
    const doc = mustApply(emptyDoc(), [{ op: "addKnobPreset", preset: { name: "Proposal" } }, { op: "addKnob", knob: { id: "gap", name: "Gap", type: "number" } }]).doc;
    const ids = createIdLedger();
    ids.observe(doc, []);
    expect([...ids.knobs]).toEqual(["gap"]);
    expect([...ids.presets]).toEqual(["proposal"]);
    expect(seenIdsToJSON(ids)).toMatchObject({ knobs: ["gap"], presets: ["proposal"] });
    expect(seenIdsFromJSON(seenIdsToJSON(ids)).knobs.has("gap")).toBe(true);
    const gone = mustApply(doc, [{ op: "removeKnob", id: "gap" }, { op: "addKnobPreset", preset: { name: "Other" } }, { op: "removeKnobPreset", id: "proposal" }]).doc;
    // A knob id is its own namespace: an item may still be called "gap".
    const r = mustApply(gone, [{ op: "addKnob", knob: { name: "Gap", type: "number" } }, { op: "addKnobPreset", preset: { name: "Proposal" } }, { op: "addPatch", patch: { id: "gap", type: "switch" } }], { seenIds: ids });
    expect(r.doc.knobs!.knobs[0]!.id).toBe("gap_2");
    expect(r.doc.knobs!.presets.map((p) => p.id)).toEqual(["other", "proposal_2"]);
    expect(Object.keys(r.doc.components.main!.patches)).toEqual(["gap"]);
    expect(seenIdsExcept(ids, doc).knobs.size).toBe(0);
  });

  it("is ignored by lenient applies (undo and redo)", () => {
    const doc = setup();
    const ids = createIdLedger(doc);
    const removed = mustApply(doc, [{ op: "removePatch", id: "card_gone" }]).doc;
    expect(mustApply(removed, [{ op: "addPatch", patch: { id: "card_gone", type: "switch" } }], { seenIds: ids, lenient: true }).results[0]!.ids).toEqual(["card_gone"]);
  });
});
