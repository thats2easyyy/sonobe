/**
 * Id retirement scenarios (ARCHITECTURE §3.2) shared by every host's tests, so the editor store, the
 * headless session and core agree on which ids a new item gets. Each host adapts itself to
 * IdScenarioHost; runIdScenario plays the steps and reports what the last op of the last step did.
 * Ops use patch types every registry has (the real one and the test mock).
 */

import type { Id, Op, OpResult, SonobeError } from "../types.ts";

export interface IdScenarioHost {
  apply(ops: Op[], options: { dryRun: boolean }): Promise<{ ok: boolean; results: OpResult[]; errors: SonobeError[] }>;
  /** Undo the newest history group. */
  undo(): Promise<void>;
}

export type IdStep = { apply: Op[]; dryRun?: boolean } | { undo: true };

/** What the last op of the last step did: the ids it created (and why any got a suffix), or the error code. */
export type IdOutcome = { ids: Id[]; retired?: Record<Id, Id>; suffixed?: Record<Id, Id> } | { error: string };

export interface IdScenario {
  name: string;
  steps: IdStep[];
  expected: IdOutcome;
}

/** main: a Card, Tap Card, and Card Gone; swipe_card: Is Top Card and its own Card Gone. */
export const ID_SCENARIO_SETUP: Op[] = [
  { op: "addLayer", layer: { type: "rectangle", name: "Card" } },
  { op: "addPatch", patch: { type: "interaction", name: "Tap Card", inputs: { layer: { layer: "card" } } } },
  { op: "addPatch", patch: { type: "switch", name: "Card Gone", inputs: { flip: { link: "tap_card.tap" } } } },
  { op: "addComponent", component: { name: "Swipe Card", kind: "patchComponent" }, ref: "sc" },
  { op: "addPatch", component: "$sc", patch: { type: "switch", name: "Is Top Card" } },
  { op: "addPatch", component: "$sc", patch: { type: "switch", name: "Card Gone" } },
];

const removeCardGone: Op = { op: "removePatch", id: "card_gone" };
const addCardGone = (id?: string): Op => ({ op: "addPatch", patch: { ...(id ? { id } : {}), type: "switch", name: "Card Gone", inputs: { flip: { link: "tap_card.tap" } } } });
const sticker: Op = { op: "addLayer", layer: { type: "rectangle", name: "Sticker" } };
const swipeCard = (id?: string): Op => ({ op: "addComponent", component: { ...(id ? { id } : {}), name: "Swipe Card", kind: "patchComponent" } });
const removeSwipeCard: Op = { op: "removeComponent", id: "swipe_card" };

export const ID_SCENARIOS: IdScenario[] = [
  { name: "one batch that removes an item and adds it again keeps the derived id", steps: [{ apply: [removeCardGone, addCardGone()] }], expected: { ids: ["card_gone"] } },
  { name: "one batch that removes an item and adds it again keeps an explicit id", steps: [{ apply: [removeCardGone, addCardGone("card_gone")] }], expected: { ids: ["card_gone"] } },
  { name: "a dry run of the one-batch rebuild keeps the id", steps: [{ apply: [removeCardGone, addCardGone()], dryRun: true }], expected: { ids: ["card_gone"] } },
  {
    name: "a removal in an earlier batch retires the id, and the result says so",
    steps: [{ apply: [removeCardGone] }, { apply: [addCardGone()] }],
    expected: { ids: ["card_gone_2"], retired: { card_gone_2: "card_gone" } },
  },
  { name: "a dry run skips a retired id too", steps: [{ apply: [removeCardGone] }, { apply: [addCardGone()], dryRun: true }], expected: { ids: ["card_gone_2"], retired: { card_gone_2: "card_gone" } } },
  { name: "an explicit retired id fails with id_retired", steps: [{ apply: [removeCardGone] }, { apply: [addCardGone("card_gone")] }], expected: { error: "id_retired" } },
  { name: "remove, undo, then rebuild in one batch keeps the id", steps: [{ apply: [removeCardGone] }, { undo: true }, { apply: [removeCardGone, addCardGone()] }], expected: { ids: ["card_gone"] } },
  { name: "add, undo, add again skips the undone id", steps: [{ apply: [sticker] }, { undo: true }, { apply: [sticker] }], expected: { ids: ["sticker_2"], retired: { sticker_2: "sticker" } } },
  {
    name: "an id retired in one component stays free in another",
    steps: [{ apply: [{ op: "removePatch", component: "swipe_card", id: "is_top_card" }] }, { apply: [{ op: "addPatch", patch: { type: "switch", name: "Is Top Card" } }] }],
    expected: { ids: ["is_top_card"] },
  },
  {
    name: "an id stays retired in its component while another component still has it",
    steps: [{ apply: [removeCardGone] }, { apply: [{ op: "addPatch", patch: { type: "switch", name: "Card Gone" } }] }],
    expected: { ids: ["card_gone_2"], retired: { card_gone_2: "card_gone" } },
  },
  {
    name: "an explicit add before the removal it replaces fails with id_taken",
    steps: [{ apply: [addCardGone("card_gone"), removeCardGone] }],
    expected: { error: "id_taken" },
  },
  { name: "a removed component's id is retired", steps: [{ apply: [removeSwipeCard] }, { apply: [swipeCard()] }], expected: { ids: ["swipe_card_2"], retired: { swipe_card_2: "swipe_card" } } },
  { name: "an explicit retired component id fails, ignoring case", steps: [{ apply: [removeSwipeCard] }, { apply: [swipeCard("Swipe_Card")] }], expected: { error: "id_retired" } },
  { name: "a component removed and added again in one batch keeps its id", steps: [{ apply: [removeSwipeCard, swipeCard()] }], expected: { ids: ["swipe_card"] } },
  {
    name: "a retired patch id doesn't block a component id",
    steps: [{ apply: [{ op: "addPatch", patch: { type: "switch", name: "Toggle" } }] }, { apply: [{ op: "removePatch", id: "toggle" }] }, { apply: [{ op: "addComponent", component: { name: "Toggle", kind: "patchComponent" } }] }],
    expected: { ids: ["toggle"] },
  },
  {
    name: "two names that slug to one id in a batch: the second is suffixed, naming the first",
    steps: [{ apply: [{ op: "addPatch", patch: { type: "switch", name: "Card Above: Gone" } }, { op: "addPatch", patch: { type: "switch", name: "Card Above Gone" } }] }],
    expected: { ids: ["card_above_gone_2"], suffixed: { card_above_gone_2: "card_above_gone" } },
  },
];

/** Play a scenario's steps on a host set up with ID_SCENARIO_SETUP. */
export async function runIdScenario(host: IdScenarioHost, scenario: IdScenario): Promise<IdOutcome> {
  let outcome: IdOutcome = { ids: [] };
  for (const step of scenario.steps) {
    if ("undo" in step) {
      await host.undo();
      continue;
    }
    const r = await host.apply(step.apply, { dryRun: !!step.dryRun });
    if (!r.ok) {
      outcome = { error: r.errors[0]?.code ?? "unknown" };
      continue;
    }
    const last = r.results.at(-1);
    outcome = { ids: last?.ids ?? [], ...(last?.retired ? { retired: last.retired } : {}), ...(last?.suffixed ? { suffixed: last.suffixed } : {}) };
  }
  return outcome;
}
