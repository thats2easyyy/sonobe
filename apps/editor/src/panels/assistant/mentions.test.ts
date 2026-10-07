import { applyOps, createEmptyDocument, type Op, type SonobeDocument } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { getRegistry } from "../../state/registry.ts";
import { parseMarkdown, type MdBlock, type MdInline } from "../learn/markdown.ts";
import { commentName, createMentionIndex, linkMentions, mentionHref, mentionKey, resolveMention, withoutOpenLink, type MentionScope } from "./mentions.ts";

const registry = getRegistry();

/** A camera prototype: a few named patches and layers, two layers that share a name, a comment, two knobs, and a patch component used once. */
function cameraDoc(extra: Op[] = []): SonobeDocument {
  const ops: Op[] = [
    { op: "addKnob", knob: { id: "flight_time", name: "Flight Time", type: "number", value: 0.6 } },
    { op: "addKnob", knob: { id: "shutter_haptic", name: "Shutter Haptic", type: "boolean", value: true } },
    { op: "addComponent", component: { id: "swipe_card", name: "Swipe Card", kind: "patchComponent" } },
    { op: "addPatch", component: "swipe_card", patch: { id: "tilt", type: "multiply", name: "Tilt Angle", typeParam: "number", inputCount: 2, inputs: {} } },
    { op: "addPatch", component: "swipe_card", patch: { id: "roll", type: "add", name: "Roll", typeParam: "number", inputCount: 2, inputs: {} } },
    { op: "addLayer", layer: { id: "level_line", type: "rectangle", name: "Level Line", props: {} } },
    { op: "addLayer", layer: { id: "shutter", type: "oval", name: "Shutter", props: {} } },
    { op: "addLayer", layer: { id: "flash", type: "rectangle", name: "Flash", props: {} } },
    { op: "addLayer", layer: { id: "box_a", type: "rectangle", name: "Box", props: {} } },
    { op: "addLayer", layer: { id: "box_b", type: "rectangle", name: "Box", props: {} } },
    { op: "addLayer", layer: { id: "ok", type: "text", name: "OK", props: {} } },
    { op: "addPatch", patch: { id: "flight_timer", type: "wait", name: "Flight Timer", inputs: {} } },
    { op: "addPatch", patch: { id: "flight_ease", type: "curve", name: "Flight Easing", inputs: {} } },
    { op: "addPatch", patch: { id: "roll", type: "mathExpression", name: "Roll", inputs: {}, settings: { expression: "a + 1" } } },
    { op: "addPatch", patch: { id: "camera", type: "camera", inputs: {} } },
    { op: "addPatch", patch: { id: "shutter_haptic", type: "haptic", name: "Shutter Haptic", inputs: {} } },
    { op: "addPatch", patch: { id: "card_1", type: "component", component: "swipe_card", name: "Card", inputs: {} } },
    { op: "addComment", comment: { id: "note_1", text: "The photo's flight\nIt shrinks along a curve.", rect: [0, 0, 300, 200] } },
    ...extra,
  ];
  const result = applyOps(createEmptyDocument({ name: "Camera Demo" }), ops, { registry });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.doc;
}

const scope = (doc: SonobeDocument, current = doc.project.root): MentionScope => ({ doc, registry, current });

describe("resolveMention", () => {
  const doc = cameraDoc();
  const main = doc.project.root;

  it("finds a patch, a layer with or without its @, a comment and a knob", () => {
    expect(resolveMention(scope(doc), "#flight_timer")).toEqual({ kind: "patch", id: "flight_timer", component: main, name: "Flight Timer", type: "wait", typeName: "Wait", category: "state" });
    expect(resolveMention(scope(doc), "#@level_line")).toEqual({ kind: "layer", id: "level_line", component: main, name: "Level Line", type: "rectangle", typeName: "Rectangle" });
    expect(resolveMention(scope(doc), "#level_line")?.kind).toBe("layer");
    expect(resolveMention(scope(doc), "#note_1")).toEqual({ kind: "comment", id: "note_1", component: main, name: "The photo's flight" });
    expect(resolveMention(scope(doc), "#$knob.flight_time")).toEqual({ kind: "knob", id: "flight_time", name: "Flight Time" });
    // A patch nobody named reads as its type.
    expect(resolveMention(scope(doc), "#camera")?.name).toBe("Camera");
  });

  it("takes a port address or a copy for its item", () => {
    expect(resolveMention(scope(doc), "#flight_timer.progress")?.id).toBe("flight_timer");
    expect(resolveMention(scope(doc), "#@level_line.rotation")?.id).toBe("level_line");
    expect(resolveMention(scope(doc), "#flight_timer%231")?.id).toBe("flight_timer");
  });

  it("looks in the viewed component first, then the others, and follows a component id or an instance path", () => {
    // "roll" is in both: the one the person is looking at wins.
    expect(resolveMention(scope(doc), "#roll")).toMatchObject({ component: main, name: "Roll", type: "mathExpression" });
    expect(resolveMention(scope(doc, "swipe_card"), "#roll")).toMatchObject({ component: "swipe_card", type: "add" });
    expect(resolveMention(scope(doc), "#tilt")).toMatchObject({ component: "swipe_card", name: "Tilt Angle" });
    expect(resolveMention(scope(doc), "#swipe_card/roll")).toMatchObject({ component: "swipe_card", type: "add" });
    expect(resolveMention(scope(doc), "#card_1/roll")).toMatchObject({ component: "swipe_card", type: "add" });
    expect(resolveMention(scope(doc, "swipe_card"), "#card_1/tilt")).toMatchObject({ component: "swipe_card", id: "tilt" });
    // A path that leads nowhere still finds the item by its id.
    expect(resolveMention(scope(doc), "#nowhere/flight_timer")?.id).toBe("flight_timer");
  });

  it("is null for what isn't in the document, and for targets that aren't mentions", () => {
    for (const href of ["#gone", "#$knob.gone", "#", "#%", "flight_timer", "https://example.com/#flight_timer", "#@", "#/"]) expect(resolveMention(scope(doc), href), href).toBeNull();
  });

  it("reads its own hrefs back to the same item", () => {
    for (const href of ["#flight_timer", "#@level_line", "#note_1", "#$knob.flight_time", "#tilt", "#swipe_card/roll"]) {
      const target = resolveMention(scope(doc), href)!;
      expect(resolveMention(scope(doc), mentionHref(target, main)), href).toEqual(target);
    }
    expect(mentionHref(resolveMention(scope(doc), "#tilt")!, main)).toBe("#swipe_card/tilt");
    expect(mentionHref(resolveMention(scope(doc), "#tilt")!, "swipe_card")).toBe("#tilt");
    expect(mentionHref(resolveMention(scope(doc), "#level_line")!, main)).toBe("#@level_line");
    expect(mentionKey(resolveMention(scope(doc), "#tilt")!)).toBe("patch:swipe_card:tilt");
  });
});

describe("commentName", () => {
  it("is the first line with text, cut to 60 characters", () => {
    expect(commentName("\n  The photo's flight \nmore")).toBe("The photo's flight");
    expect(commentName("")).toBe("Comment");
    const long = commentName("x".repeat(80));
    expect(long).toHaveLength(60);
    expect(long.endsWith("…")).toBe(true);
  });
});

/** The reply's links as [text, href], in order. */
function links(blocks: readonly MdBlock[]): [string, string | null][] {
  const out: [string, string | null][] = [];
  const text = (nodes: readonly MdInline[]): string => nodes.map((n) => ("text" in n ? n.text : "children" in n ? text(n.children) : "")).join("");
  const walk = (nodes: readonly MdInline[]) => {
    for (const n of nodes) {
      if (n.type === "link") out.push([text(n.children), n.href]);
      else if ("children" in n) walk(n.children);
    }
  };
  const blocksOf = (list: readonly MdBlock[]) => {
    for (const b of list) {
      if (b.type === "heading" || b.type === "paragraph") walk(b.children);
      else if (b.type === "list") b.items.forEach(blocksOf);
      else if (b.type === "blockquote") blocksOf(b.children);
      else if (b.type === "table") [b.head, ...b.rows].forEach((row) => row.forEach(walk));
    }
  };
  blocksOf(blocks);
  return out;
}

const plain = (blocks: readonly MdBlock[]): string => JSON.stringify(blocks);

describe("linkMentions", () => {
  const doc = cameraDoc();
  const index = createMentionIndex(scope(doc));
  const linked = (source: string) => links(linkMentions(parseMarkdown(source), index));

  it("keeps the Assistant's own links, in the shape the chips resolve", () => {
    expect(linked("[Flight Timer](#flight_timer) feeds [Flight Easing](#flight_ease), which turns the [Level Line](#@level_line). The [Flight Time](#$knob.flight_time) knob sets how long.")).toEqual([
      ["Flight Timer", "#flight_timer"],
      ["Flight Easing", "#flight_ease"],
      ["Level Line", "#@level_line"],
      ["Flight Time", "#$knob.flight_time"],
    ]);
    // A layer linked without its @, a port address, and an item in another component.
    expect(linked("[Level Line](#level_line), [progress](#flight_timer.progress), [Tilt Angle](#tilt)")).toEqual([
      ["Level Line", "#@level_line"],
      ["progress", "#flight_timer"],
      ["Tilt Angle", "#swipe_card/tilt"],
    ]);
  });

  it("shows the name where the Assistant showed the id", () => {
    expect(linked("It feeds [flight_ease](#flight_ease), [flight ease](#flight_ease) and [@level_line](#@level_line), then [the timer](#flight_timer).")).toEqual([
      ["Flight Easing", "#flight_ease"],
      ["Flight Easing", "#flight_ease"],
      ["Level Line", "#@level_line"],
      ["the timer", "#flight_timer"],
    ]);
  });

  it("turns a link to something that isn't there into its text, and leaves other links alone", () => {
    const blocks = linkMentions(parseMarkdown("[Gone](#gone) and [the docs](https://example.com) and [a guide](02-isat.md)."), index);
    expect(links(blocks)).toEqual([
      ["the docs", "https://example.com"],
      ["a guide", "02-isat.md"],
    ]);
    expect(plain(blocks)).toContain("Gone");
  });

  it("finds a name of two words or more wherever it's written", () => {
    expect(linked("Flight Timer runs for 0.6 s and Flight Easing smooths it. Then the Level Line turns.")).toEqual([
      ["Flight Timer", "#flight_timer"],
      ["Flight Easing", "#flight_ease"],
      ["Level Line", "#@level_line"],
    ]);
    // Whole names only, with their capitals.
    expect(linked("flight timer, Flight Timers, PreFlight Timer and Flight Timer_2")).toEqual([]);
  });

  it("finds a one-word name only where the text marks it as a name", () => {
    expect(linked("Roll the phone and tap the shutter. The flash is bright.")).toEqual([]);
    expect(linked("**Roll** works out the angle, the Shutter layer springs, the Camera patch takes the photo, and “Flash” covers the screen.")).toEqual([
      ["Roll", "#roll"],
      ["Shutter", "#@shutter"],
      ["Camera", "#camera"],
      ["Flash", "#@flash"],
    ]);
    // Bold that says more than the name isn't a name.
    expect(linked("**Roll the phone**")).toEqual([]);
  });

  it("leaves a name alone when two items have it, when it's too short, and inside code", () => {
    expect(linked("The Box layer and the **OK** label.")).toEqual([]);
    expect(linked("`Flight Timer` and\n\n```\nFlight Timer\n```")).toEqual([]);
    expect(linked("[Flight Timer docs](https://example.com)")).toEqual([["Flight Timer docs", "https://example.com"]]);
  });

  it("takes a name for the knob when the text says knob, or only a knob has it", () => {
    expect(linked("Shutter Haptic plays on tap. The Shutter Haptic knob picks which one, and Flight Time sets the length.")).toEqual([
      ["Shutter Haptic", "#shutter_haptic"],
      ["Shutter Haptic", "#$knob.shutter_haptic"],
      ["Flight Time", "#$knob.flight_time"],
    ]);
  });

  it("links inside lists, tables, quotes and headings", () => {
    const source = ["## How Flight Timer works", "", "- Flight Easing smooths it", "", "> The Level Line turns", "", "| Patch | Does |", "|---|---|", "| Flight Timer | times it |"].join("\n");
    expect(linked(source).map(([text]) => text)).toEqual(["Flight Timer", "Flight Easing", "Level Line", "Flight Timer"]);
  });

  it("prefers the viewed component's item when a name is in two", () => {
    expect(linkedIn(doc, "swipe_card", "**Roll** adds, and Tilt Angle multiplies. Flight Timer is outside.")).toEqual([
      ["Roll", "#roll"],
      ["Tilt Angle", "#tilt"],
      ["Flight Timer", `#${doc.project.root}/flight_timer`],
    ]);
  });

  it("returns the same blocks when there's nothing to link", () => {
    const empty = createMentionIndex(scope(createEmptyDocument()));
    expect(empty.pattern).toBeNull();
    const blocks = parseMarkdown("Nothing here names anything.");
    expect(plain(linkMentions(blocks, empty))).toBe(plain(blocks));
  });
});

function linkedIn(doc: SonobeDocument, current: string, source: string) {
  return links(linkMentions(parseMarkdown(source), createMentionIndex(scope(doc, current))));
}

describe("createMentionIndex", () => {
  it("keeps its signature while names, ids and the viewed component stay, and changes it when they don't", () => {
    const doc = cameraDoc();
    const signature = createMentionIndex(scope(doc)).signature;
    const moved = applyOps(doc, [{ op: "updateLayer", id: "flash", props: { opacity: 0.5 } }], { registry });
    expect(moved.ok && createMentionIndex(scope(moved.doc)).signature).toBe(signature);

    const changes: Op[][] = [
      [{ op: "rename", id: "flash", name: "White Flash" }],
      [{ op: "removePatch", id: "flight_ease" }],
      [{ op: "removeComment", id: "note_1" }],
      [{ op: "updateKnob", id: "flight_time", name: "Flight Length" }],
      [{ op: "addLayer", layer: { id: "extra", type: "oval", name: "Extra", props: {} } }],
    ];
    for (const ops of changes) {
      const next = applyOps(doc, ops, { registry });
      if (!next.ok) throw new Error(next.errors[0]!.message);
      expect(createMentionIndex(scope(next.doc)).signature, JSON.stringify(ops)).not.toBe(signature);
    }
    expect(createMentionIndex(scope(doc, "swipe_card")).signature).not.toBe(signature);
  });
});

describe("withoutOpenLink", () => {
  it("holds back a link that's only half written at the end of a streaming reply", () => {
    expect(withoutOpenLink("It feeds [Flight Eas")).toBe("It feeds ");
    expect(withoutOpenLink("It feeds [Flight Easing](#flight_")).toBe("It feeds ");
    expect(withoutOpenLink("It feeds [Flight Easing](#flight_ease)")).toBe("It feeds [Flight Easing](#flight_ease)");
    expect(withoutOpenLink("It feeds [Flight Easing](#flight_ease), then [")).toBe("It feeds [Flight Easing](#flight_ease), then ");
    expect(withoutOpenLink("A list [of] things")).toBe("A list [of] things");
    expect(withoutOpenLink("Line one [x\nline two")).toBe("Line one [x\nline two");
  });
});
