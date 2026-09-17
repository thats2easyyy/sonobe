/**
 * 08 Bottom Sheet: drag a sheet between three stops. The finger drives the sheet directly, and on
 * release a Spring Animation takes over with the finger's velocity, aiming at the stop a fling
 * would reach.
 */

import type { NewLayer } from "@sonobe/core";
import { addLayer, addPatch, connect, gradient, gradientLayer, group, homeIndicator, layerRef, link, oval, palette, rect, SCREEN, shadow, statusBar, text, type } from "../lib/kit.ts";
import type { Recipe } from "../lib/recipe.ts";

/** Sheet top y at each stop: half open (where it starts), fully open, collapsed. */
export const STOPS = { half: 470, full: 132, collapsed: 760 } as const;

const PLACES: [string, string, string, [string, string]][] = [
  ["Juniper & Oak", "4.8 · 6 min walk", "$$", ["#FFB37BFF", "#FF5E7EFF"]],
  ["Morning Tide", "4.7 · 9 min walk", "$$", ["#7DD3FCFF", "#5B5CF6FF"]],
  ["Ferro Espresso", "4.9 · 12 min walk", "$", ["#FDE68AFF", "#F59E0BFF"]],
  ["Little Orbit", "4.6 · 14 min walk", "$$", ["#86EFACFF", "#14B8A6FF"]],
  ["Cloudline Roasters", "4.7 · 18 min walk", "$$$", ["#F0ABFCFF", "#8B5CF6FF"]],
];

function placeRow(index: number): NewLayer {
  const [name, meta, price, [from, to]] = PLACES[index]!;
  const n = index + 1;
  return group(`place_${n}`, name, { position: [0, 168 + index * 76], size: [SCREEN.width, 76] }, [
    rect(`place_${n}_thumb`, "Thumbnail", { position: [24, 12], size: [52, 52], cornerRadius: 14, gradient: gradient([[0, from], [1, to]], [0, 0], [1, 1]) }),
    text(`place_${n}_name`, "Name", name, type.headline, palette.ink, { position: [92, 16] }),
    text(`place_${n}_meta`, "Details", meta, type.footnote, palette.ink2, { position: [92, 40] }),
    text(`place_${n}_price`, "Price", price, type.subhead, palette.ink3, { position: [378, 26], anchor: [1, 0], textAlignment: "right" }),
    rect(`place_${n}_divider`, "Divider", { position: [92, 75], size: [286, 1], color: palette.hairline }),
  ]);
}

function pin(id: string, name: string, at: [number, number], color: string): NewLayer {
  return group(id, name, { position: at, anchor: [0.5, 0.5], size: [34, 34], hitTest: false }, [
    oval(`${id}_dot`, "Dot", { size: [34, 34], color, strokeColor: palette.white, strokeWidth: 3, ...shadow("soft") }),
    oval(`${id}_center`, "Center", { position: [12, 12], size: [10, 10], color: palette.white }),
  ]);
}

export const bottomSheet: Recipe = {
  folder: "08-bottom-sheet",
  name: "Bottom Sheet",
  description: "Drag a sheet up, down, or flick it. It follows your finger, then springs to the stop a fling would reach, keeping the finger's speed.",
  guides: ["05-springs-and-feel", "06-gestures"],
  background: "#E8EFE6FF",
  notes:
    "Drag the sheet by any part of it, slowly or with a flick. While your finger is down the sheet follows it exactly; on release Nearest Stop After Fling projects where a fling would land, Current Stop remembers that stop, and Sheet Spring glides there starting at the finger's speed.",
  ops: () => [
    // Map
    addLayer(gradientLayer("map", "Map", gradient([[0, "#EAF2E3FF"], [1, "#DCE7F3FF"]]), { size: [SCREEN.width, SCREEN.height], hitTest: false })),
    addLayer(oval("park", "Park", { position: [-70, 150], size: [270, 230], color: "#C7E3BEFF", hitTest: false })),
    addLayer(rect("bay", "Bay", { position: [250, 470], size: [260, 320], rotation: 18, cornerRadius: 70, color: "#BBD8F1FF", hitTest: false })),
    addLayer(rect("avenue", "Avenue", { position: [-40, 310], size: [520, 18], rotation: -14, color: palette.white, hitTest: false })),
    addLayer(rect("cross_street", "Cross Street", { position: [190, -40], size: [16, 980], rotation: 10, color: palette.white, hitTest: false })),
    addLayer(rect("side_street", "Side Street", { position: [-20, 560], size: [480, 10], rotation: 8, color: "#FFFFFFCC", hitTest: false })),
    addLayer(pin("pin_1", "Pin 1", [118, 252], palette.coral)),
    addLayer(pin("pin_2", "Pin 2", [262, 214], palette.coral)),
    addLayer(pin("pin_3", "Pin 3", [84, 420], palette.coral)),
    addLayer(oval("you_halo", "You Halo", { position: [210, 360], anchor: [0.5, 0.5], size: [64, 64], color: "#5B5CF633", hitTest: false })),
    addLayer(oval("you", "You", { position: [210, 360], anchor: [0.5, 0.5], size: [18, 18], color: palette.indigo, strokeColor: palette.white, strokeWidth: 3, hitTest: false })),
    addLayer(statusBar("map", "dark")),
    addLayer(
      group("location_chip", "Location Chip", { position: [16, 66], size: [370, 50], cornerRadius: 25, color: palette.white, hitTest: false, ...shadow("soft") }, [
        oval("location_dot", "Location Dot", { position: [20, 20], size: [10, 10], color: palette.green }),
        text("location_label", "Location", "Mission District", type.headline, palette.ink, { position: [40, 14] }),
      ]),
    ),

    // Scrim and sheet
    addLayer(rect("scrim", "Scrim", { size: [SCREEN.width, SCREEN.height], color: palette.black, opacity: 0, hitTest: false })),
    addLayer(
      group("sheet", "Sheet", { position: [0, STOPS.half], size: [SCREEN.width, SCREEN.height], cornerRadius: 28, color: palette.white, ...shadow("lifted") }, [
        rect("grabber", "Grabber", { position: [181, 10], size: [40, 5], cornerRadius: 3, color: "#D4D4D8FF" }),
        text("sheet_title", "Sheet Title", "Coffee nearby", type.title2, palette.ink, { position: [24, 34] }),
        text("sheet_subtitle", "Sheet Subtitle", "12 places open now", type.footnote, palette.ink2, { position: [24, 66] }),
        group("search", "Search", { position: [24, 104], size: [354, 44], cornerRadius: 12, color: palette.fill }, [
          oval("search_icon", "Search Icon", { position: [16, 15], size: [14, 14], color: palette.clear, strokeColor: palette.ink3, strokeWidth: 2 }),
          text("search_placeholder", "Placeholder", "Search cafés", type.callout, palette.ink3, { position: [40, 11] }),
        ]),
        ...PLACES.map((_, i) => placeRow(i)),
      ]),
    ),
    addLayer(homeIndicator("app", "dark")),

    // Gesture: where the finger is and how fast it moves
    addPatch("sheet_gesture", "gesture", "Drag Sheet", { layer: layerRef("sheet") }),
    addPatch("sheet_idle", "not", "Not Dragging", { value: link("sheet_gesture.down") }),
    addPatch("finger", "pulse", "Finger Down or Up", { on: link("sheet_gesture.down") }),
    addPatch("drag_distance", "pointUnpack", "Drag Distance", { value: link("sheet_gesture.translation") }),
    addPatch("drag_speed", "pointUnpack", "Drag Speed", { value: link("sheet_gesture.velocity") }),

    // Follow the finger from wherever the sheet was grabbed
    addPatch("sheet_y_last_frame", "delay1", "Sheet Y Last Frame", {}, { typeParam: "number" }),
    addPatch("grab_y", "sampleAndHold", "Sheet Y at Grab", { value: link("sheet_y_last_frame.output"), sample: link("sheet_idle.output") }, { typeParam: "number" }),
    addPatch("finger_y", "add", "Sheet Y Under Finger", { value1: link("grab_y.output"), value2: link("drag_distance.y") }, { typeParam: "number", inputCount: 2 }),

    // On release, pick the stop a fling would reach
    addPatch("stops", "loopBuilder", "Stops", { item0: STOPS.half, item1: STOPS.full, item2: STOPS.collapsed }, { typeParam: "number", inputCount: 3 }),
    addPatch("fling_stop", "snap", "Nearest Stop After Fling", { value: link("sheet_y_last_frame.output"), velocity: link("drag_speed.y"), mode: "points", points: link("stops.loop"), deceleration: "fast" }, { typeParam: "number" }),
    addPatch("current_stop", "counter", "Current Stop", { jump: link("finger.turnedOff"), jumpToNumber: link("fling_stop.index") }),
    addPatch("stop_y", "loopSelect", "Stop Y", { loop: link("stops.loop"), index: link("current_stop.count") }, { typeParam: "number" }),

    // Animate: follow exactly while dragging, spring with the finger's speed after
    addPatch("sheet_target", "ifElse", "Finger or Stop", { condition: link("sheet_gesture.down"), ifTrue: link("finger_y.output"), ifFalse: link("stop_y.output") }, { typeParam: "number" }),
    addPatch("sheet_spring", "springAnimation", "Sheet Spring", { number: link("sheet_target.output"), tension: 300, friction: 30, gestureActive: link("sheet_gesture.down"), gestureVelocity: link("drag_speed.y") }, { typeParam: "number" }),
    addPatch("sheet_position", "point", "Sheet Position", { x: 0, y: link("sheet_spring.output") }),
    connect("sheet_position.output", "@sheet.position"),
    connect("sheet_spring.output", "sheet_y_last_frame.value"),

    // Dim the map as the sheet opens
    addPatch("sheet_openness", "progress", "Sheet Openness", { value: link("sheet_spring.output"), start: STOPS.collapsed, end: STOPS.full, clampToRange: true }),
    addPatch("scrim_opacity", "transition", "Scrim Opacity", { progress: link("sheet_openness.progress"), start: 0, end: 0.4 }, { typeParam: "number" }),
    connect("scrim_opacity.output", "@scrim.opacity"),
  ],
};
