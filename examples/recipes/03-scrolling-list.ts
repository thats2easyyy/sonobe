/** 03 Scrolling List: a message inbox that scrolls with momentum, lifts its header, and offers a way back to the top. */

import type { NewLayer } from "@sonobe/core";
import { addLayer, addPatch, connect, gradient, group, homeIndicator, layerRef, link, oval, palette, rect, SCREEN, shadow, statusBar, text, type } from "../lib/kit.ts";
import type { Recipe } from "../lib/recipe.ts";

const ROW_HEIGHT = 76;
const WINDOW: [number, number] = [SCREEN.width, SCREEN.height - 150];

/** name, preview, time, unread, avatar gradient */
const CONVERSATIONS: [string, string, string, boolean, [string, string]][] = [
  ["Ava Chen", "The prototype feels so much better now", "9:24", true, ["#FF9A62FF", "#FF3D71FF"]],
  ["Design Crit", "Leo: can we look at the sheet again?", "9:02", true, ["#7DD3FCFF", "#5B5CF6FF"]],
  ["Marcus Hale", "Sending the new icons this afternoon", "8:47", true, ["#FDE68AFF", "#F59E0BFF"]],
  ["Priya Raman", "Dinner at 8? I booked the corner table", "Yesterday", false, ["#86EFACFF", "#14B8A6FF"]],
  ["Sunday Soccer", "Hana: bring the orange cones", "Yesterday", false, ["#F0ABFCFF", "#8B5CF6FF"]],
  ["Leo Okafor", "Ha, that spring is way too bouncy", "Yesterday", false, ["#FCA5A5FF", "#EF4444FF"]],
  ["Hana Sato", "Photos from the trip are up", "Mon", false, ["#A5B4FCFF", "#6366F1FF"]],
  ["Tomás Rivera", "Thanks for the intro!", "Mon", false, ["#99F6E4FF", "#0EA5E9FF"]],
  ["Book Club", "Iris: chapter 9 was wild", "Sun", false, ["#FDBA74FF", "#EA580CFF"]],
  ["Iris Novak", "Voice memo · 0:42", "Sun", false, ["#D9F99DFF", "#65A30DFF"]],
  ["Dev Patel", "Merged. Ship it", "Sat", false, ["#C4B5FDFF", "#7C3AEDFF"]],
  ["Family", "Mom: call when you land", "Sat", false, ["#FBCFE8FF", "#DB2777FF"]],
  ["Zoe Martin", "Can you share the file?", "Fri", false, ["#BAE6FDFF", "#0284C7FF"]],
  ["Kai Andersen", "See you at the climbing gym", "Fri", false, ["#FEF08AFF", "#CA8A04FF"]],
  ["Ruth Mendes", "Loved the talk", "Thu", false, ["#BBF7D0FF", "#16A34AFF"]],
  ["Oliver Grant", "Receipt attached", "Wed", false, ["#E9D5FFFF", "#9333EAFF"]],
];

const CONTENT_HEIGHT = 8 + CONVERSATIONS.length * ROW_HEIGHT + 40;

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function row(index: number): NewLayer {
  const [name, preview, time, unread, [from, to]] = CONVERSATIONS[index]!;
  const n = index + 1;
  const children: NewLayer[] = [
    oval(`chat_${n}_avatar`, "Avatar", { position: [20, 12], size: [52, 52], gradient: gradient([[0, from], [1, to]], [0, 0], [1, 1]) }),
    text(`chat_${n}_initials`, "Initials", initials(name), type.subhead, palette.white, { position: [46, 38], anchor: [0.5, 0.5], textAlignment: "center" }),
    text(`chat_${n}_name`, "Name", name, unread ? type.headline : { fontSize: 17, fontWeight: 500 }, palette.ink, { position: [88, 15] }),
    text(`chat_${n}_preview`, "Preview", preview, type.footnote, unread ? palette.ink : palette.ink2, { position: [88, 40], maxLines: 1 }),
    text(`chat_${n}_time`, "Time", time, { fontSize: 13, fontWeight: 500 }, unread ? palette.indigo : palette.ink3, { position: [382, 17], anchor: [1, 0], textAlignment: "right" }),
    rect(`chat_${n}_divider`, "Divider", { position: [88, ROW_HEIGHT - 1], size: [SCREEN.width - 88, 1], color: palette.hairline }),
  ];
  if (unread) children.splice(5, 0, oval(`chat_${n}_unread`, "Unread Dot", { position: [372, 44], size: [10, 10], color: palette.indigo }));
  return group(`chat_${n}`, name, { position: [0, 8 + index * ROW_HEIGHT], size: [SCREEN.width, ROW_HEIGHT] }, children);
}

export const scrollingList: Recipe = {
  folder: "03-scrolling-list",
  name: "Scrolling List",
  description: "An inbox that scrolls with momentum and rubber-bands at the edges. The header lifts as messages slide under it, and a Back to Top button appears once you're far down.",
  guides: ["04-layers-and-layout", "06-gestures"],
  background: palette.canvas,
  notes:
    "Drag or flick the list. Scroll Inbox moves the content layer inside a clipped window; Header Lift and Scrolled Far read its y straight away, so those effects follow the finger with no animation of their own. Tap Back to Top to jump home.",
  ops: () => [
    addLayer(
      group("window", "Window", { position: [0, 150], size: WINDOW, clip: true }, [
        group("content", "Content", { size: [SCREEN.width, CONTENT_HEIGHT], color: palette.canvas }, CONVERSATIONS.map((_, i) => row(i))),
      ]),
    ),
    addLayer(
      group("header", "Header", { size: [SCREEN.width, 150], color: palette.canvas, shadowColor: palette.black, shadowOpacity: 0, shadowRadius: 14, shadowOffset: [0, 6], hitTest: false }, [
        text("header_title", "Title", "Messages", type.largeTitle, palette.ink, { position: [24, 70] }),
        text("header_subtitle", "Unread Count", "3 unread", type.footnote, palette.ink2, { position: [24, 114] }),
        group("compose", "Compose", { position: [338, 72], size: [40, 40], cornerRadius: 20, color: palette.indigo }, [
          rect("compose_bar_h", "Plus Horizontal", { position: [12, 19], size: [16, 2], cornerRadius: 1, color: palette.white }),
          rect("compose_bar_v", "Plus Vertical", { position: [19, 12], size: [2, 16], cornerRadius: 1, color: palette.white }),
        ]),
      ]),
    ),
    addLayer(statusBar("app", "dark")),
    addLayer(
      group("top_button", "Back to Top", { position: [SCREEN.width / 2, 940], anchor: [0.5, 0.5], size: [148, 44], cornerRadius: 22, color: palette.ink, ...shadow("glow", palette.black) }, [
        text("top_button_label", "Back to Top Label", "Back to top", type.subhead, palette.white, { position: [74, 22], anchor: [0.5, 0.5], textAlignment: "center" }),
      ]),
    ),
    addLayer(homeIndicator("app", "dark")),

    // Scroll: the content layer moves inside its parent window
    addPatch("inbox_scroll", "scroll", "Scroll Inbox", { layer: layerRef("content"), scrollY: "free" }),
    connect("inbox_scroll.position", "@content.position"),

    // Scroll-linked: the header shadow grows over the first 24 points
    addPatch("header_lift", "progress", "Header Lift", { value: link("inbox_scroll.y"), start: 0, end: -24, clampToRange: true }),
    addPatch("header_shadow", "transition", "Header Shadow", { progress: link("header_lift.progress"), start: 0, end: 0.14 }, { typeParam: "number" }),
    connect("header_shadow.output", "@header.shadowOpacity"),

    // Back to Top: shows after 400 points, jumps home on tap
    addPatch("scrolled_far", "lessThan", "Scrolled Far", { value1: link("inbox_scroll.y"), value2: -400 }, { typeParam: "number", inputCount: 2 }),
    addPatch("top_button_spring", "popAnimation", "Back to Top Spring", { number: link("scrolled_far.output"), bounciness: 4, speed: 16 }),
    addPatch("top_button_position", "transition", "Back to Top Position", { progress: link("top_button_spring.output"), start: [SCREEN.width / 2, 940], end: [SCREEN.width / 2, 800] }, { typeParam: "point" }),
    connect("top_button_position.output", "@top_button.position"),
    addPatch("tap_top", "interaction", "Tap Back to Top", { layer: layerRef("top_button") }),
    connect("tap_top.tap", "inbox_scroll.jumpToY"),
  ],
};
