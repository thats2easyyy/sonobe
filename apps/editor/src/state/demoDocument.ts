/**
 * "Photo Zoom": the demo prototype shown when no project is open. A feed card whose photo zooms
 * on tap (Interaction → Switch → Pop Animation → Transition), a springy like button, a status bar,
 * and the next card peeking in from below. Built through applyOps with real patch types.
 */

import { applyOps, createEmptyDocument, type InputValue, type NewLayer, type NewPatch, type Op, type Registry, type SonobeDocument } from "@sonobe/core";
import { getRegistry } from "./registry.ts";

export const DEMO_DOCUMENT_NAME = "Photo Zoom";

const text = (id: string, name: string, value: string, props: Record<string, InputValue>): NewLayer => ({ id, type: "text", name, props: { text: value, ...props } });

const rect = (id: string, name: string, props: Record<string, InputValue>): NewLayer => ({ id, type: "rectangle", name, props });

/** Layers back → front. */
function demoLayers(): NewLayer[] {
  return [
    { id: "background", type: "colorFill", name: "Background", props: { color: "#F2F2F7FF" } },
    {
      id: "status_bar",
      type: "group",
      name: "Status Bar",
      props: { position: [0, 0], size: [402, 54] },
      children: [
        text("time", "Time", "9:41", { position: [52, 19], fontSize: 17, fontWeight: 600, textColor: "#000000FF" }),
        rect("signal_1", "Signal 1", { position: [298, 27], size: [3, 6], cornerRadius: 1, color: "#000000FF" }),
        rect("signal_2", "Signal 2", { position: [303, 25], size: [3, 8], cornerRadius: 1, color: "#000000FF" }),
        rect("signal_3", "Signal 3", { position: [308, 23], size: [3, 10], cornerRadius: 1, color: "#000000FF" }),
        rect("signal_4", "Signal 4", { position: [313, 21], size: [3, 12], cornerRadius: 1, color: "#00000059" }),
        rect("battery_body", "Battery", { position: [332, 20], size: [25, 13], cornerRadius: 4, color: "#00000000", strokeWidth: 1, strokeColor: "#00000059" }),
        rect("battery_level", "Battery Level", { position: [334, 22], size: [18, 9], cornerRadius: 2, color: "#000000FF" }),
        rect("battery_cap", "Battery Cap", { position: [358, 24], size: [2, 5], cornerRadius: 1, color: "#00000059" }),
      ],
    },
    text("title", "Title", "Popular Events", { position: [20, 66], fontSize: 34, fontWeight: 700, letterSpacing: -0.4, textColor: "#000000FF" }),
    text("subtitle", "Subtitle", "This weekend in San Francisco", { position: [20, 110], fontSize: 15, textColor: "#6E6E73FF" }),
    {
      id: "card",
      type: "group",
      name: "Event Card",
      props: { position: [16, 146], size: [370, 440], color: "#FFFFFFFF", cornerRadius: 28, cornerSmoothing: 0.6, clip: true, shadowColor: "#1C1030FF", shadowRadius: 30, shadowOffset: [0, 14] },
      children: [
        {
          id: "photo",
          type: "group",
          name: "Photo",
          props: { position: [0, 0], size: [370, 300], clip: true },
          children: [
            { id: "sky", type: "gradient", name: "Sky", props: { size: [370, 300], gradient: { gradient: { kind: "linear", stops: [[0, "#FFB36BFF"], [0.55, "#FF6F91FF"], [1, "#6A5ACDFF"]], start: [0.5, 0], end: [0.5, 1] } } } },
            { id: "sun", type: "oval", name: "Sun", props: { position: [214, 88], size: [96, 96], color: "#FFE9B0FF" } },
            { id: "hill_back", type: "oval", name: "Far Hill", props: { position: [150, 206], size: [340, 210], color: "#5B3F8CFF" } },
            { id: "hill_front", type: "oval", name: "Near Hill", props: { position: [-90, 228], size: [380, 210], color: "#3B2A66FF" } },
          ],
        },
        text("event_date", "Date", "SAT · JUNE 14", { position: [20, 320], fontSize: 13, fontWeight: 600, letterSpacing: 0.6, textColor: "#FF375FFF" }),
        text("event_title", "Event Title", "Sunset Picnic in the Park", { position: [20, 342], fontSize: 22, fontWeight: 700, textColor: "#000000FF" }),
        text("event_meta", "Details", "Dolores Park · 6:30 PM · 214 going", { position: [20, 376], fontSize: 15, textColor: "#6E6E73FF" }),
        text("hint", "Hint", "Tap the photo to zoom", { position: [20, 404], fontSize: 13, textColor: "#8E8E93FF" }),
      ],
    },
    {
      id: "like_button",
      type: "group",
      name: "Like Button",
      props: { position: [322, 162], size: [48, 48], color: "#0000003D", cornerRadius: 24, backgroundBlur: 12 },
      children: [
        text("heart", "Heart", "♥", { position: [0, 0], size: [48, 48], widthMode: "fixed", heightMode: "fixed", fontSize: 24, textAlignment: "center", verticalAlignment: "center" }),
      ],
    },
    {
      id: "next_card",
      type: "group",
      name: "Next Card",
      props: { position: [16, 606], size: [370, 300], color: "#FFFFFFFF", cornerRadius: 28, cornerSmoothing: 0.6, clip: true, shadowColor: "#1C1030FF", shadowOpacity: 0.08, shadowRadius: 30, shadowOffset: [0, 14] },
      children: [
        { id: "next_photo", type: "gradient", name: "Next Photo", props: { size: [370, 200], gradient: { gradient: { kind: "linear", stops: [[0, "#2BC0E4FF"], [1, "#1F4E8CFF"]], start: [0, 0], end: [1, 1] } } } },
        text("next_title", "Next Title", "Night Market on 24th Street", { position: [20, 218], fontSize: 22, fontWeight: 700, textColor: "#000000FF" }),
      ],
    },
  ];
}

function demoPatches(): NewPatch[] {
  return [
    { id: "tap_photo", type: "interaction", name: "Tap Photo", inputs: { layer: { layer: "card" } }, ui: { x: 40, y: 60 } },
    { id: "zoomed", type: "switch", name: "Zoomed", ui: { x: 260, y: 60 } },
    { id: "zoom_spring", type: "popAnimation", name: "Zoom Spring", typeParam: "number", inputs: { bounciness: 6, speed: 12 }, ui: { x: 480, y: 60 } },
    { id: "photo_scale", type: "transition", name: "Photo Scale", typeParam: "number", inputs: { start: 1, end: 1.18 }, ui: { x: 720, y: 20 } },
    { id: "card_shadow", type: "transition", name: "Card Shadow", typeParam: "number", inputs: { start: 0.08, end: 0.24 }, ui: { x: 720, y: 150 } },
    { id: "tap_like", type: "interaction", name: "Tap Like", inputs: { layer: { layer: "like_button" } }, ui: { x: 40, y: 380 } },
    { id: "liked", type: "switch", name: "Liked", ui: { x: 260, y: 380 } },
    { id: "like_spring", type: "popAnimation", name: "Like Spring", typeParam: "number", inputs: { bounciness: 14, speed: 16 }, ui: { x: 480, y: 380 } },
    { id: "heart_color", type: "transition", name: "Heart Color", typeParam: "color", inputs: { start: "#FFFFFFFF", end: "#FF375FFF" }, ui: { x: 720, y: 340 } },
    { id: "heart_scale", type: "transition", name: "Heart Scale", typeParam: "number", inputs: { start: 1, end: 1.15 }, ui: { x: 720, y: 470 } },
  ];
}

const CONNECTIONS: [from: string, to: string][] = [
  ["tap_photo.tap", "zoomed.flip"],
  ["zoomed.on", "zoom_spring.number"],
  ["zoom_spring.output", "photo_scale.progress"],
  ["zoom_spring.output", "card_shadow.progress"],
  ["photo_scale.output", "@photo.scale"],
  ["card_shadow.output", "@card.shadowOpacity"],
  ["tap_like.tap", "liked.flip"],
  ["liked.on", "like_spring.number"],
  ["like_spring.output", "heart_color.progress"],
  ["like_spring.output", "heart_scale.progress"],
  ["heart_color.output", "@heart.textColor"],
  ["heart_scale.output", "@heart.scale"],
];

/** Ops that build the demo into an empty document (exported for docs and tests). */
export function demoDocumentOps(): Op[] {
  return [
    { op: "setProject", changes: { name: DEMO_DOCUMENT_NAME, background: "#F2F2F7FF" } },
    { op: "updateComponent", id: "main", notes: "Tap the photo to zoom it. Tap the heart to like the event. Both use the same four patches: Interaction → Switch → Pop Animation → Transition." },
    ...demoLayers().map((layer): Op => ({ op: "addLayer", layer })),
    ...demoPatches().map((patch): Op => ({ op: "addPatch", patch })),
    ...CONNECTIONS.map(([from, to]): Op => ({ op: "connect", from, to })),
    { op: "addComment", comment: { id: "zoom_note", text: "Photo zoom: tap flips the switch, the spring chases it, and transitions map 0…1 onto scale and shadow.", rect: [20, 0, 940, 290], color: "yellow" } },
    { op: "addComment", comment: { id: "like_note", text: "Like button: the same pattern with a bouncier spring, mapped onto color and scale.", rect: [20, 320, 940, 290], color: "pink" } },
  ];
}

/** Build the Photo Zoom demo. Throws if the registry can't express it (a bug). */
export function createDemoDocument(registry: Registry = getRegistry()): SonobeDocument {
  const base = createEmptyDocument({ name: DEMO_DOCUMENT_NAME, device: "iphone-17-pro" });
  const result = applyOps(base, demoDocumentOps(), { registry });
  if (!result.ok) {
    const details = result.errors.map((e) => `op ${e.opIndex}: ${e.message}`).join("\n");
    throw new Error(`The demo document couldn't be built:\n${details}`);
  }
  return result.doc;
}
