/**
 * Starter prototypes for lessons, built through applyOps with real layer and patch types. Each one
 * holds only what the learner shouldn't have to draw, so every step is about the idea being taught.
 */

import { applyOps, createEmptyDocument, type InputValue, type NewLayer, type NewPatch, type Op, type Registry, type SonobeDocument } from "@sonobe/core";

const text = (id: string, name: string, value: string, props: Record<string, InputValue>): NewLayer => ({ id, type: "text", name, props: { text: value, ...props } });

function build(name: string, ops: Op[], registry: Registry): SonobeDocument {
  const base = createEmptyDocument({ name, device: "iphone-17-pro" });
  const result = applyOps(base, [{ op: "setProject", changes: { name } }, ...ops], { registry });
  if (!result.ok) throw new Error(`The “${name}” lesson prototype couldn't be built:\n${result.errors.map((e) => `op ${e.opIndex}: ${e.message}`).join("\n")}`);
  return result.doc;
}

const layers = (list: NewLayer[]): Op[] => list.map((layer): Op => ({ op: "addLayer", layer }));
const patches = (list: NewPatch[]): Op[] => list.map((patch): Op => ({ op: "addPatch", patch }));
const connect = (pairs: [from: string, to: string][]): Op[] => pairs.map(([from, to]): Op => ({ op: "connect", from, to }));

const photo = (): NewLayer => ({
  id: "photo",
  type: "group",
  name: "Photo",
  props: { position: [36, 180], size: [330, 330], cornerRadius: 32, cornerSmoothing: 0.6, clip: true, shadowColor: "#1C1030FF", shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: [0, 12] },
  children: [
    { id: "sky", type: "gradient", name: "Sky", props: { size: [330, 330], gradient: { gradient: { kind: "linear", stops: [[0, "#FFB36BFF"], [0.55, "#FF6F91FF"], [1, "#6A5ACDFF"]], start: [0.5, 0], end: [0.5, 1] } } } },
    { id: "sun", type: "oval", name: "Sun", props: { position: [196, 72], size: [84, 84], color: "#FFE9B0FF" } },
    { id: "far_hill", type: "oval", name: "Far Hill", props: { position: [120, 226], size: [300, 190], color: "#5B3F8CFF" } },
    { id: "near_hill", type: "oval", name: "Near Hill", props: { position: [-80, 246], size: [340, 190], color: "#3B2A66FF" } },
  ],
});

/** Lesson 1: a photo whose Scale is already driven by a Transition that does nothing yet (End = Start = 1). */
export function firstPrototypeStarter(registry: Registry): SonobeDocument {
  return build(
    "Your First Prototype",
    [
      { op: "updateComponent", id: "main", notes: "Lesson: tap the photo to make it grow. Interaction → Switch → Pop Animation → Transition." },
      ...layers([
        { id: "background", type: "colorFill", name: "Background", props: { color: "#F2F2F7FF" } },
        text("title", "Title", "Tap to grow", { position: [24, 76], fontSize: 32, fontWeight: 700, letterSpacing: -0.4, textColor: "#000000FF" }),
        text("subtitle", "Subtitle", "Your first prototype", { position: [24, 122], fontSize: 15, textColor: "#6E6E73FF" }),
        photo(),
      ]),
      ...patches([{ id: "photo_scale", type: "transition", name: "Photo Scale", typeParam: "number", inputs: { start: 1, end: 1 }, ui: { x: 760, y: 60 } }]),
      ...connect([["photo_scale.output", "@photo.scale"]]),
    ],
    registry,
  );
}

/** Lesson 2: a lamp whose brightness comes from a Transition, and a button to wire up. */
export function statesAndPulsesStarter(registry: Registry): SonobeDocument {
  return build(
    "States and Pulses",
    [
      { op: "updateComponent", id: "main", notes: "Lesson: a pulse lasts one frame; a Switch remembers." },
      ...layers([
        { id: "background", type: "colorFill", name: "Background", props: { color: "#15151CFF" } },
        text("title", "Title", "Light switch", { position: [24, 76], fontSize: 32, fontWeight: 700, letterSpacing: -0.4, textColor: "#FFFFFFFF" }),
        text("subtitle", "Subtitle", "States and pulses", { position: [24, 122], fontSize: 15, textColor: "#9A9AA6FF" }),
        { id: "lamp", type: "oval", name: "Lamp", props: { position: [91, 230], size: [220, 220], color: "#FFD66BFF", shadowColor: "#FFB02EFF", shadowOpacity: 0.6, shadowRadius: 60 } },
        {
          id: "button",
          type: "group",
          name: "Button",
          props: { position: [71, 640], size: [260, 64], cornerRadius: 32, color: "#FFFFFFFF" },
          children: [text("button_label", "Button Label", "Toggle the light", { position: [0, 0], size: [260, 64], widthMode: "fixed", heightMode: "fixed", fontSize: 17, fontWeight: 600, textAlignment: "center", verticalAlignment: "center", textColor: "#15151CFF" })],
        },
      ]),
      ...patches([{ id: "glow", type: "transition", name: "Glow", typeParam: "number", inputs: { start: 0.12, end: 1 }, ui: { x: 760, y: 60 } }]),
      ...connect([["glow.output", "@lamp.opacity"]]),
    ],
    registry,
  );
}

/** Lesson 3: a complete tap-to-grow chain with a slow, bounceless spring to tune. */
export function springFeelStarter(registry: Registry): SonobeDocument {
  return build(
    "Spring Feel",
    [
      { op: "updateComponent", id: "main", notes: "Lesson: tune how a spring feels with Bounciness and Speed." },
      ...layers([
        { id: "background", type: "colorFill", name: "Background", props: { color: "#F2F2F7FF" } },
        text("title", "Title", "Spring feel", { position: [24, 76], fontSize: 32, fontWeight: 700, letterSpacing: -0.4, textColor: "#000000FF" }),
        {
          id: "card",
          type: "group",
          name: "Card",
          props: { position: [46, 190], size: [310, 400], cornerRadius: 28, cornerSmoothing: 0.6, clip: true, color: "#FFFFFFFF", shadowColor: "#1C1030FF", shadowOpacity: 0.16, shadowRadius: 28, shadowOffset: [0, 14] },
          children: [
            { id: "card_art", type: "gradient", name: "Art", props: { size: [310, 250], gradient: { gradient: { kind: "linear", stops: [[0, "#2BC0E4FF"], [1, "#5B5CF6FF"]], start: [0, 0], end: [1, 1] } } } },
            text("card_title", "Card Title", "Tap the card", { position: [20, 272], fontSize: 22, fontWeight: 700, textColor: "#000000FF" }),
            text("card_hint", "Card Hint", "Then tune the spring", { position: [20, 306], fontSize: 15, textColor: "#6E6E73FF" }),
          ],
        },
      ]),
      ...patches([
        { id: "tap_card", type: "interaction", name: "Tap Card", inputs: { layer: { layer: "card" } }, ui: { x: 40, y: 60 } },
        { id: "card_zoomed", type: "switch", name: "Card Zoomed", ui: { x: 260, y: 60 } },
        { id: "zoom_spring", type: "popAnimation", name: "Zoom Spring", typeParam: "number", inputs: { bounciness: 0, speed: 4 }, ui: { x: 480, y: 60 } },
        { id: "card_scale", type: "transition", name: "Card Scale", typeParam: "number", inputs: { start: 1, end: 1.12 }, ui: { x: 720, y: 60 } },
      ]),
      ...connect([
        ["tap_card.tap", "card_zoomed.flip"],
        ["card_zoomed.on", "zoom_spring.number"],
        ["zoom_spring.output", "card_scale.progress"],
        ["card_scale.output", "@card.scale"],
      ]),
    ],
    registry,
  );
}

/** Lesson 4: one row layer positioned by index × spacing + offset, waiting for a Loop. */
export function listsWithLoopsStarter(registry: Registry): SonobeDocument {
  return build(
    "Lists with Loops",
    [
      { op: "updateComponent", id: "main", notes: "Lesson: one layer, many copies. A Loop gives every copy its own index." },
      ...layers([
        { id: "background", type: "colorFill", name: "Background", props: { color: "#F2F2F7FF" } },
        text("title", "Title", "Inbox", { position: [24, 76], fontSize: 32, fontWeight: 700, letterSpacing: -0.4, textColor: "#000000FF" }),
        {
          id: "row",
          type: "group",
          name: "Row",
          props: { size: [362, 64], cornerRadius: 16, color: "#FFFFFFFF" },
          children: [
            { id: "avatar", type: "oval", name: "Avatar", props: { position: [14, 14], size: [36, 36], color: "#5B5CF6FF" } },
            text("row_title", "Row Title", "New message", { position: [64, 12], fontSize: 16, fontWeight: 600, textColor: "#000000FF" }),
            text("row_preview", "Row Preview", "Tap to read", { position: [64, 34], fontSize: 13, textColor: "#6E6E73FF" }),
          ],
        },
      ]),
      ...patches([
        { id: "row_spacing", type: "multiply", name: "Row Spacing", typeParam: "number", inputs: { value1: 0, value2: 76 }, ui: { x: 300, y: 60 } },
        { id: "row_offset", type: "add", name: "Row Offset", typeParam: "number", inputs: { value2: 130 }, ui: { x: 520, y: 60 } },
        { id: "row_position", type: "point", name: "Row Position", inputs: { x: 20 }, ui: { x: 740, y: 60 } },
      ]),
      ...connect([
        ["row_spacing.output", "row_offset.value1"],
        ["row_offset.output", "row_position.y"],
        ["row_position.output", "@row.position"],
      ]),
    ],
    registry,
  );
}
