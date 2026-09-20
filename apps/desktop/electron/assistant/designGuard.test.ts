import { applyOps, createEmptyDocument, createRegistry, type Op, type SonobeDocument } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { createReplaceGuard, fingerprintSubtree, replaceDeclinedDetail, replaceDeclinedMessage, replacePrompt, type ReplaceCheck } from "./designGuard.ts";

const registry = createRegistry();

function apply(doc: SonobeDocument, ops: Op[]) {
  const result = applyOps(doc, ops, { registry });
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
  return result;
}

const edit = (doc: SonobeDocument, ops: Op[]) => apply(doc, ops).doc;

/** Main with a hand-made Home screen, and a Checkout screen as import_design adds one (in front). */
function fixture(): SonobeDocument {
  return edit(createEmptyDocument({ name: "Guard" }), [
    {
      op: "addLayer",
      layer: {
        id: "home",
        type: "group",
        name: "Home",
        props: { position: [0, 0], size: [402, 874] },
        children: [
          { id: "welcome", type: "text", name: "Welcome", props: { text: "Hi" } },
          { id: "home_card", type: "rectangle", name: "Card", props: { size: [370, 120], cornerRadius: 12 } },
        ],
      },
    },
    {
      op: "addLayer",
      layer: {
        id: "checkout",
        type: "group",
        name: "Checkout",
        props: { position: [0, 0], size: [402, 874], color: "#FFFFFFFF" },
        children: [
          { id: "title", type: "text", name: "Title", props: { text: "Checkout", textColor: "#111118FF", position: [16, 60] } },
          {
            id: "card",
            type: "group",
            name: "Card",
            props: { position: [16, 120], size: [370, 200], cornerRadius: 24 },
            children: [
              { id: "price", type: "text", name: "Price", props: { text: "$42" } },
              { id: "promo", type: "text", name: "Promo Badge", props: { text: "10% off" } },
              { id: "pay", type: "rectangle", name: "Pay Button", props: { color: "#8B5CF6FF", size: [338, 50] } },
            ],
          },
          { id: "divider", type: "rectangle", name: "Divider", props: { size: [402, 1], color: "#E5E5EAFF" } },
        ],
      },
    },
  ]);
}

const DOC = "doc_1";
const ask = (replace: string, picked: string | null = null) => ({ docId: DOC, component: "main", replace, picked });

/** A guard that remembers Checkout as the Assistant imported it. */
function remembered() {
  const doc = fixture();
  const guard = createReplaceGuard();
  guard.remember(DOC, "main", "checkout", doc);
  return { doc, guard };
}

describe("createReplaceGuard", () => {
  it("goes ahead without asking when a remembered screen is unchanged", () => {
    const { doc, guard } = remembered();
    expect(guard.tracks(DOC)).toBe(true);
    expect(guard.tracks("doc_2")).toBe(false);
    expect(guard.check(ask("checkout"), doc)).toBeNull();
    expect(guard.check(ask("checkout"), structuredClone(doc))).toBeNull();
    expect(guard.check(ask("card"), doc)).toBeNull();
  });

  it("names a text layer whose color the person changed", () => {
    const { doc, guard } = remembered();
    const changed = edit(doc, [{ op: "updateLayer", id: "title", props: { textColor: "#FF3B30FF" } }]);
    expect(guard.check(ask("checkout"), changed)).toEqual({ reason: "hand_edited", target: { id: "checkout", name: "Checkout" }, changed: ["Title"], changedCount: 1 });
    // Also when the person picked the screen: what they changed still goes.
    expect(guard.check(ask("checkout", "checkout"), changed)?.reason).toBe("hand_edited");
  });

  it("detects an added child and a removed one, without naming the siblings that shifted", () => {
    const { doc, guard } = remembered();
    const added = edit(doc, [{ op: "addLayer", parent: "card", index: 0, layer: { id: "sticker", type: "text", name: "Sticker", props: { text: "New" } } }]);
    expect(guard.check(ask("checkout"), added)).toMatchObject({ reason: "hand_edited", changed: ["Sticker"], changedCount: 1 });
    const removed = edit(doc, [{ op: "removeLayer", id: "promo" }]);
    expect(guard.check(ask("checkout"), removed)).toMatchObject({ reason: "hand_edited", changed: ["Promo Badge"], changedCount: 1 });
    const group = edit(doc, [{ op: "removeLayer", id: "card" }]);
    expect(guard.check(ask("checkout"), group)).toMatchObject({ changed: ["Card", "Price", "Promo Badge", "Pay Button"], changedCount: 4 });
  });

  it("names a layer moved in its stack or to another parent", () => {
    const { doc, guard } = remembered();
    const reordered = edit(doc, [{ op: "moveLayer", id: "pay", parent: "card", index: 0 }]);
    expect(guard.check(ask("checkout"), reordered)).toMatchObject({ changed: ["Pay Button"], changedCount: 1 });
    const reparented = edit(doc, [{ op: "moveLayer", id: "title", parent: "card", index: 3 }]);
    expect(guard.check(ask("checkout"), reparented)).toMatchObject({ changed: ["Title"], changedCount: 1 });
    const nudged = edit(doc, [{ op: "updateLayer", id: "card", props: { position: [16, 140] } }]);
    expect(guard.check(ask("checkout"), nudged)).toMatchObject({ changed: ["Card"], changedCount: 1 });
  });

  it("checks a nested replace inside a remembered screen against that subtree only", () => {
    const { doc, guard } = remembered();
    const outside = edit(doc, [{ op: "updateLayer", id: "title", props: { textColor: "#FF3B30FF" } }]);
    expect(guard.check(ask("card"), outside)).toBeNull();
    const inside = edit(doc, [{ op: "updateLayer", id: "price", props: { text: "$40" } }]);
    expect(guard.check(ask("card"), inside)).toEqual({ reason: "hand_edited", target: { id: "card", name: "Card" }, changed: ["Price"], changedCount: 1 });
    // The replaced layer keeps its place, so moving it isn't a change a replace would lose.
    const moved = edit(doc, [{ op: "updateLayer", id: "card", props: { position: [16, 140] } }]);
    expect(guard.check(ask("card"), moved)).toBeNull();
  });

  it("takes the Assistant's own edits in with refresh, but not a person's change elsewhere in the screen", () => {
    const { doc, guard } = remembered();
    const human = edit(doc, [{ op: "updateLayer", id: "divider", props: { color: "#FF3B30FF" } }]);
    const assistant = apply(human, [{ op: "updateLayer", id: "title", props: { textColor: "#8B5CF6FF", text: "Pay" } }]);
    expect(assistant.affected).toMatchObject({ components: ["main"], layers: ["title"] });
    expect(guard.check(ask("checkout"), assistant.doc)?.changed).toEqual(["Title", "Divider"]);
    guard.refresh(DOC, assistant.doc, assistant.affected);
    expect(guard.check(ask("checkout"), assistant.doc)).toMatchObject({ reason: "hand_edited", changed: ["Divider"], changedCount: 1 });
    // A write that names no layers takes nothing in.
    guard.refresh(DOC, assistant.doc, { components: ["main"], layers: [] });
    expect(guard.check(ask("checkout"), assistant.doc)).toMatchObject({ changed: ["Divider"] });
  });

  it("takes in only the components a write changed: another component's layer with the same id isn't the screen's", () => {
    const kit = edit(fixture(), [
      { op: "addComponent", component: { id: "card_kit", name: "Card Kit", kind: "layerComponent" } },
      { op: "addLayer", component: "card_kit", layer: { id: "title", type: "text", name: "Title", props: { text: "Card" } } },
    ]);
    const guard = createReplaceGuard();
    guard.remember(DOC, "main", "checkout", kit);
    const human = edit(kit, [{ op: "updateLayer", id: "title", props: { text: "My checkout" } }]);
    const assistant = apply(human, [{ op: "updateLayer", component: "card_kit", id: "title", props: { text: "Card 2" } }]);
    expect(assistant.affected).toMatchObject({ components: ["card_kit"], layers: ["title"] });
    guard.refresh(DOC, assistant.doc, assistant.affected);
    expect(guard.check(ask("checkout"), assistant.doc)).toMatchObject({ reason: "hand_edited", changed: ["Title"], changedCount: 1 });
    // Nor does it hide a layer the person removed from the screen.
    const removed = edit(kit, [{ op: "removeLayer", id: "title" }]);
    const again = apply(removed, [{ op: "updateLayer", component: "card_kit", id: "title", props: { text: "Card 3" } }]);
    guard.refresh(DOC, again.doc, again.affected);
    expect(guard.check(ask("checkout"), again.doc)).toMatchObject({ reason: "hand_edited", changed: ["Title"], changedCount: 1 });
  });

  it("doesn't count the siblings of a layer the Assistant removed or added", () => {
    const { doc, guard } = remembered();
    const removed = apply(doc, [{ op: "removeLayer", id: "promo" }]);
    guard.refresh(DOC, removed.doc, removed.affected);
    expect(guard.check(ask("checkout"), removed.doc)).toBeNull();
    const added = apply(removed.doc, [{ op: "addLayer", parent: "checkout", index: 0, layer: { id: "back", type: "text", name: "Back", props: { text: "‹" } } }]);
    guard.refresh(DOC, added.doc, added.affected);
    expect(guard.check(ask("checkout"), added.doc)).toBeNull();
  });

  it("goes ahead when the person's Undo took a screen back to a version the Assistant left, and names only what they changed after", () => {
    const { doc: v1, guard } = remembered();
    // Claude replaces Checkout (a replace keeps the screen's id), then tweaks its title.
    const v2 = edit(v1, [
      { op: "updateLayer", id: "price", props: { text: "$38" } },
      { op: "removeLayer", id: "promo" },
    ]);
    guard.remember(DOC, "main", "checkout", v2);
    const v3 = apply(v2, [{ op: "updateLayer", id: "title", props: { text: "Pay" } }]);
    guard.refresh(DOC, v3.doc, v3.affected);
    expect(guard.check(ask("checkout"), v3.doc)).toBeNull();
    // Undo steps back through Claude's versions: none of them is the person's change.
    expect(guard.check(ask("checkout"), v2)).toBeNull();
    expect(guard.check(ask("checkout"), v1)).toBeNull();
    expect(guard.check(ask("card"), v1)).toBeNull();
    // An undo, then a hand edit: only the edit is named.
    const edited = edit(v1, [{ op: "updateLayer", id: "pay", props: { color: "#000000FF" } }]);
    expect(guard.check(ask("checkout"), edited)).toEqual({ reason: "hand_edited", target: { id: "checkout", name: "Checkout" }, changed: ["Pay Button"], changedCount: 1 });
    // A mix of two versions (the first with the last one's title) is none of them, so it asks.
    const mixed = edit(v1, [{ op: "updateLayer", id: "title", props: { text: "Pay" } }]);
    expect(guard.check(ask("checkout"), mixed)).toMatchObject({ reason: "hand_edited", changedCount: 1 });
  });

  it("keeps a nested import's earlier version in its screen's record, and a write elsewhere adds no version", () => {
    const { doc: v1, guard } = remembered();
    const v2 = edit(v1, [{ op: "updateLayer", id: "price", props: { text: "$38" } }]);
    guard.remember(DOC, "main", "card", v2);
    expect(guard.check(ask("checkout"), v1)).toBeNull();
    expect(guard.check(ask("card"), v1)).toBeNull();
    // More Assistant writes to Home than a record keeps versions don't push Checkout's first one out.
    let doc = v2;
    for (let i = 0; i < 25; i++) {
      const home = apply(doc, [{ op: "updateLayer", id: "welcome", props: { text: `Hi ${i}` } }]);
      guard.refresh(DOC, home.doc, home.affected);
      doc = home.doc;
    }
    expect(guard.check(ask("checkout"), edit(doc, [{ op: "updateLayer", id: "price", props: { text: "$42" } }]))).toBeNull();
  });

  it("goes ahead for the layer the person picked and its descendants when nothing's remembered", () => {
    const guard = createReplaceGuard();
    const doc = fixture();
    expect(guard.check(ask("home", "home"), doc)).toBeNull();
    expect(guard.check(ask("home_card", "home"), doc)).toBeNull();
    // Picking a card isn't asking for its whole screen.
    expect(guard.check(ask("home", "home_card"), doc)?.reason).toBe("untargeted");
  });

  it("asks before replacing a layer the person didn't pick and the Assistant didn't make", () => {
    const { doc, guard } = remembered();
    expect(guard.check(ask("home"), doc)).toEqual({ reason: "untargeted", target: { id: "home", name: "Home" }, changed: [], changedCount: 0 });
    // A record of another document or component doesn't count.
    const other = createReplaceGuard();
    other.remember("doc_2", "main", "home", doc);
    expect(other.check(ask("home"), doc)?.reason).toBe("untargeted");
    expect(other.check({ ...ask("home"), component: "other" }, doc)).toBeNull(); // no such component: import_design says so
    expect(guard.check(ask("nowhere"), doc)).toBeNull();
  });

  it("ignores the replaced root's position and place in the stack", () => {
    const { doc, guard } = remembered();
    const moved = edit(doc, [{ op: "updateLayer", id: "checkout", props: { position: [40, 12] } }]);
    expect(guard.check(ask("checkout"), moved)).toBeNull();
    const behind = edit(doc, [{ op: "moveLayer", id: "checkout", parent: null, index: 0 }]);
    expect(guard.check(ask("checkout"), behind)).toBeNull();
    const renamed = edit(doc, [{ op: "rename", id: "checkout", name: "Pay" }]);
    expect(guard.check(ask("checkout"), renamed)).toMatchObject({ changed: ["Pay"], changedCount: 1 });
  });

  it("remembers a replace: the screen is the Assistant's again, and a nested import joins its screen's record", () => {
    const { doc, guard } = remembered();
    const human = edit(doc, [
      { op: "updateLayer", id: "price", props: { text: "$40" } },
      { op: "updateLayer", id: "divider", props: { color: "#FF3B30FF" } },
    ]);
    // Claude redesigns the card (the person approved): its layers are the Assistant's, the divider isn't.
    const imported = edit(human, [
      { op: "removeLayer", id: "card" },
      { op: "addLayer", parent: "checkout", index: 1, layer: { id: "card", type: "group", name: "Card", props: { position: [16, 120], size: [370, 220] }, children: [{ id: "price", type: "text", name: "Price", props: { text: "$38" } }] } },
    ]);
    guard.remember(DOC, "main", "card", imported);
    expect(guard.check(ask("card"), imported)).toBeNull();
    expect(guard.check(ask("checkout"), imported)).toMatchObject({ changed: ["Divider"], changedCount: 1 });
    guard.remember(DOC, "main", "checkout", imported);
    expect(guard.check(ask("checkout"), imported)).toBeNull();
  });

  it("drops the records inside a screen it remembers over them", () => {
    const doc = fixture();
    const guard = createReplaceGuard();
    guard.remember(DOC, "main", "home_card", doc);
    expect(guard.check(ask("home"), doc)?.reason).toBe("untargeted");
    guard.remember(DOC, "main", "home", doc);
    const changed = edit(doc, [{ op: "updateLayer", id: "home_card", props: { cornerRadius: 20 } }]);
    expect(guard.check(ask("home"), changed)).toMatchObject({ changed: ["Card"], changedCount: 1 });
    expect(guard.check(ask("home_card"), changed)).toMatchObject({ target: { id: "home_card", name: "Card" }, changed: ["Card"] });
    guard.clear();
    expect(guard.tracks(DOC)).toBe(false);
    expect(guard.check(ask("home"), doc)?.reason).toBe("untargeted");
  });

  it("lists each changed name once, and counts every changed layer", () => {
    const { doc, guard } = remembered();
    const changed = edit(doc, [
      { op: "rename", id: "price", name: "Label" },
      { op: "rename", id: "promo", name: "Label" },
      { op: "updateLayer", id: "pay", props: { color: "#000000FF" } },
      { op: "updateLayer", id: "divider", props: { color: "#000000FF" } },
      { op: "updateLayer", id: "title", props: { text: "Pay" } },
      { op: "updateLayer", id: "card", props: { cornerRadius: 8 } },
      { op: "addLayer", parent: "checkout", layer: { id: "note", type: "text", name: "Note", props: { text: "!" } } },
    ]);
    expect(guard.check(ask("checkout"), changed)).toMatchObject({ changed: ["Title", "Card", "Label", "Pay Button", "Divider"], changedCount: 7 });
  });
});

describe("fingerprintSubtree", () => {
  it("is deterministic, ignores key order and the root's position, and counts a child's position", () => {
    const doc = fixture();
    const prints = fingerprintSubtree(doc, "main", "checkout");
    expect([...prints.keys()]).toEqual(["checkout", "title", "card", "price", "promo", "pay", "divider"]);
    expect(prints.get("pay")).toEqual({ hash: expect.stringMatching(/^[0-9a-f]{8}$/), name: "Pay Button" });
    expect(fingerprintSubtree(structuredClone(doc), "main", "checkout")).toEqual(prints);

    const shuffled = structuredClone(doc);
    const title = shuffled.components.main!.layers[1]!.children![0]!;
    title.props = Object.fromEntries(Object.entries(title.props).reverse());
    expect(fingerprintSubtree(shuffled, "main", "checkout")).toEqual(prints);

    const rootMoved = fingerprintSubtree(edit(doc, [{ op: "updateLayer", id: "checkout", props: { position: [40, 0] } }]), "main", "checkout");
    expect(rootMoved).toEqual(prints);
    const childMoved = fingerprintSubtree(edit(doc, [{ op: "updateLayer", id: "title", props: { position: [16, 64] } }]), "main", "checkout");
    expect([...childMoved].filter(([id, p]) => p.hash !== prints.get(id)!.hash).map(([id]) => id)).toEqual(["title"]);
    expect(fingerprintSubtree(doc, "main", "nowhere").size).toBe(0);
  });
});

describe("replacePrompt", () => {
  const handEdited = (changed: string[], changedCount = changed.length): ReplaceCheck => ({ reason: "hand_edited", target: { id: "checkout", name: "Checkout" }, changed, changedCount });
  const untargeted: ReplaceCheck = { reason: "untargeted", target: { id: "home", name: "Home" }, changed: [], changedCount: 0 };
  const impact = { dropped: ["Promo Badge", "Old Banner", "Divider"], droppedCount: 3, lostConnections: 1 };

  it("asks to replace a person's changes, with and without the dry run's impact", () => {
    expect(replacePrompt(handEdited(["Title", "Pay Button"]), null)).toEqual({
      kind: "replace",
      count: 0,
      title: "Replace your changes to “Checkout”?",
      message: "You changed Title and Pay Button after Claude made this screen. Claude's new version replaces the whole screen. You can undo it afterwards.",
      approveLabel: "Replace",
      declineLabel: "Keep my changes",
    });
    expect(replacePrompt(handEdited(["Title", "Pay Button"]), impact)).toMatchObject({
      count: 3,
      message: "You changed Title and Pay Button after Claude made this screen. Claude's new version replaces the whole screen, and 3 layers aren't in it: Promo Badge, Old Banner, Divider. 1 connection will be removed. You can undo it afterwards.",
    });
    expect(replacePrompt(handEdited(["Title"]), { dropped: ["Promo Badge"], droppedCount: 1, lostConnections: 2 }).message).toBe(
      "You changed Title after Claude made this screen. Claude's new version replaces the whole screen, and 1 layer isn't in it: Promo Badge. 2 connections will be removed. You can undo it afterwards.",
    );
    expect(replacePrompt(handEdited(["Title"]), { dropped: [], droppedCount: 0, lostConnections: 0 }).message).toBe(
      "You changed Title after Claude made this screen. Claude's new version replaces the whole screen. You can undo it afterwards.",
    );
    expect(replacePrompt(handEdited(["Title"]), { dropped: [], droppedCount: 0, lostConnections: 1 }).message).toBe(
      "You changed Title after Claude made this screen. Claude's new version replaces the whole screen. 1 connection will be removed. You can undo it afterwards.",
    );
  });

  it("lists up to five names, then “and N more”", () => {
    expect(replacePrompt(handEdited(["A", "B", "C"]), null).message).toMatch(/^You changed A, B and C after Claude made this screen\./);
    expect(replacePrompt(handEdited(["A", "B", "C", "D", "E"], 7), null).message).toMatch(/^You changed A, B, C, D, E, and 2 more after Claude made this screen\./);
    expect(replacePrompt(handEdited(["Label"], 3), null).message).toMatch(/^You changed Label, and 2 more after/);
    const many = { dropped: ["A", "B", "C", "D", "E", "F", "G"], droppedCount: 8, lostConnections: 0 };
    expect(replacePrompt(handEdited(["Title"]), many).message).toContain("the whole screen, and 8 layers aren't in it: A, B, C, D, E, and 3 more. You can undo");
    expect(replacePrompt(untargeted, many).message).toContain(" 8 layers aren't in the new version: A, B, C, D, E, and 3 more. You can undo");
  });

  it("asks to rebuild a layer the person didn't ask to change", () => {
    expect(replacePrompt(untargeted, null)).toEqual({
      kind: "replace",
      count: 0,
      title: "Replace “Home”?",
      message: "Claude wants to rebuild “Home”, which you didn't ask it to change. You can undo it afterwards.",
      approveLabel: "Replace",
      declineLabel: "Keep “Home”",
    });
    expect(replacePrompt(untargeted, impact)).toMatchObject({
      count: 3,
      message: "Claude wants to rebuild “Home”, which you didn't ask it to change. 3 layers aren't in the new version: Promo Badge, Old Banner, Divider. 1 connection will be removed. You can undo it afterwards.",
    });
    expect(replacePrompt(untargeted, { dropped: ["Promo Badge"], droppedCount: 1, lostConnections: 0 }).message).toBe(
      "Claude wants to rebuild “Home”, which you didn't ask it to change. 1 layer isn't in the new version: Promo Badge. You can undo it afterwards.",
    );
    expect(replacePrompt(untargeted, { dropped: [], droppedCount: 0, lostConnections: 3 }).message).toBe(
      "Claude wants to rebuild “Home”, which you didn't ask it to change. 3 connections will be removed. You can undo it afterwards.",
    );
  });

  it("shows names from the document on one line", () => {
    const check: ReplaceCheck = { ...untargeted, target: { id: "home", name: "Home\nscreen" } };
    expect(replacePrompt(check, null).title).toBe("Replace “Home screen”?");
    expect(replacePrompt({ ...check, target: { id: "home", name: "x".repeat(100) } }, null).title).toBe(`Replace “${"x".repeat(79)}…”?`);
  });

  it("builds its copy from a real check", () => {
    const { doc, guard } = remembered();
    const changed = edit(doc, [
      { op: "updateLayer", id: "title", props: { textColor: "#FF3B30FF" } },
      { op: "updateLayer", id: "pay", props: { color: "#000000FF" } },
    ]);
    const check = guard.check(ask("checkout"), changed)!;
    expect(replacePrompt(check, null).message).toMatch(/^You changed Title and Pay Button after Claude made this screen\./);
  });
});

describe("replaceDeclinedMessage and replaceDeclinedDetail", () => {
  it("tell Claude and the chip what the person kept", () => {
    const untargeted: ReplaceCheck = { reason: "untargeted", target: { id: "home", name: "Home" }, changed: [], changedCount: 0 };
    const handEdited: ReplaceCheck = { reason: "hand_edited", target: { id: "checkout", name: "Checkout" }, changed: ["Title"], changedCount: 1 };
    expect(replaceDeclinedMessage(untargeted)).toBe("The person kept “Home” as it is, so nothing changed. Import your design as a new screen instead (leave out replace), or ask what they'd like.");
    expect(replaceDeclinedMessage(handEdited)).toBe("The person kept their changes to “Checkout”, so nothing changed. Import your design as a new screen instead (leave out replace), or ask them what to change.");
    expect(replaceDeclinedDetail(untargeted)).toBe("You kept “Home”");
    expect(replaceDeclinedDetail(handEdited)).toBe("You kept your changes");
  });
});
