/**
 * 14 Onboarding: three pages with Next, Skip, swipes, page dots, and a Get started button on the last
 * page. A Counter holds the page; the buttons and swipes are enabled from last frame's page.
 */

import type { NewLayer } from "@sonobe/core";
import { addLayer, addPatch, connect, gradient, gradientLayer, group, hitArea, homeIndicator, layerRef, link, oval, palette, rect, SCREEN, shadow, statusBar, text, type } from "../lib/kit.ts";
import type { Recipe } from "../lib/recipe.ts";

export const LAST_PAGE = 2;

const PAGES: [string, string, [string, string], string][] = [
  ["Plan together", "Share one plan with everyone going, from flights to dinner reservations.", ["#A5B4FCFF", "#5B5CF6FF"], "#FDE68AFF"],
  ["Share the moment", "Photos land in the trip album automatically, so nobody has to ask twice.", ["#FBCFE8FF", "#DB2777FF"], "#BAE6FDFF"],
  ["Stay in sync", "Changes show up for everyone right away, even when you're offline.", ["#99F6E4FF", "#0D9488FF"], "#FECACAFF"],
];

function page(index: number): NewLayer {
  const [title, body, [from, to], accent] = PAGES[index]!;
  const n = index + 1;
  return group(`page_${n}`, title, { size: [SCREEN.width, SCREEN.height] }, [
    group(`page_${n}_art`, "Illustration", { position: [51, 130], size: [300, 300], cornerRadius: 150, clip: true, hitTest: false, ...shadow("glow", to) }, [
      gradientLayer(`page_${n}_art_fill`, "Fill", gradient([[0, from], [1, to]], [0, 0], [1, 1]), { size: [300, 300] }),
      oval(`page_${n}_art_orb`, "Orb", { position: [170 - index * 40, 60 + index * 20], size: [90, 90], color: accent }),
      rect(`page_${n}_art_card`, "Card", { position: [60, 150], size: [180, 110], rotation: -8 + index * 8, cornerRadius: 20, color: "#FFFFFFD9" }),
      rect(`page_${n}_art_line_1`, "Line", { position: [84, 180], size: [110, 10], rotation: -8 + index * 8, cornerRadius: 5, color: to }),
      rect(`page_${n}_art_line_2`, "Line", { position: [84, 204], size: [70, 10], rotation: -8 + index * 8, cornerRadius: 5, color: `${to.slice(0, 7)}66` }),
    ]),
    text(`page_${n}_title`, "Title", title, type.title, palette.ink, { position: [SCREEN.width / 2, 486], anchor: [0.5, 0], textAlignment: "center" }),
    text(`page_${n}_body`, "Body", body, type.callout, palette.ink2, { position: [41, 530], size: [320, 66], widthMode: "fixed", textAlignment: "center" }),
  ]);
}

export const onboarding: Recipe = {
  folder: "14-onboarding",
  name: "Onboarding",
  description: "Three onboarding pages with Next, Skip, swipes and page dots. Next becomes Get started on the last page and finishes the flow.",
  guides: ["02-isat", "03-states-and-pulses"],
  background: palette.canvas,
  notes:
    "Tap Next, swipe the pages, or tap Skip. Current Page holds the page number and Pages Spring slides to page × −402. Next and the swipes are enabled from Page Last Frame, so the tap that lands on the last page can't also count as Get started.",
  ops: () => [
    addLayer(group("pages", "Pages", { size: [SCREEN.width * PAGES.length, SCREEN.height], layout: "row" }, PAGES.map((_, i) => page(i)))),
    addLayer(hitArea("swipe_area", "Swipe Area", { position: [0, 100], size: [SCREEN.width, 540] })),
    addLayer(statusBar("app", "dark")),
    addLayer(group("skip_button", "Skip Button", { position: [314, 64], size: [72, 40] }, [
      text("skip_label", "Skip Label", "Skip", type.subhead, palette.ink2, { position: [36, 20], anchor: [0.5, 0.5], textAlignment: "center" }),
    ])),
    addLayer(oval("dot", "Page Dot", { anchor: [0.5, 0.5], size: [8, 8], color: "#D4D4D8FF", hitTest: false })),
    addLayer(group("next_button", "Next Button", { position: [24, 744], size: [354, 56], cornerRadius: 28, color: palette.indigo, ...shadow("glow", palette.indigo) }, [
      text("next_label", "Next Label", "Next", type.headline, palette.white, { position: [177, 28], anchor: [0.5, 0.5], textAlignment: "center" }),
    ])),
    addLayer(group("welcome", "Welcome", { size: [SCREEN.width, SCREEN.height], opacity: 0, hitTest: false }, [
      gradientLayer("welcome_fill", "Fill", gradient([[0, "#5B5CF6FF"], [1, "#8B5CF6FF"]], [0, 0], [1, 1]), { size: [SCREEN.width, SCREEN.height] }),
      text("welcome_title", "Welcome Title", "You're all set", type.largeTitle, palette.white, { position: [SCREEN.width / 2, 400], anchor: [0.5, 0], textAlignment: "center" }),
      text("welcome_body", "Welcome Body", "Let's plan something.", type.callout, palette.white70, { position: [SCREEN.width / 2, 450], anchor: [0.5, 0], textAlignment: "center" }),
    ])),
    addLayer(homeIndicator("app", "dark")),

    // What was true last frame decides which inputs are live now
    addPatch("page", "counter", "Current Page"),
    addPatch("page_last_frame", "delay1", "Page Last Frame", { value: link("page.count") }, { typeParam: "number" }),
    addPatch("was_last_page", "equals", "Was On Last Page", { value1: link("page_last_frame.output"), value2: LAST_PAGE }, { typeParam: "number" }),
    addPatch("was_first_page", "equals", "Was On First Page", { value1: link("page_last_frame.output"), value2: 0 }, { typeParam: "number" }),
    addPatch("can_go_forward", "not", "Can Go Forward", { value: link("was_last_page.output") }),
    addPatch("can_go_back", "not", "Can Go Back", { value: link("was_first_page.output") }),

    // Inputs
    addPatch("tap_next", "interaction", "Tap Next", { layer: layerRef("next_button"), enabled: link("can_go_forward.output") }),
    addPatch("tap_get_started", "interaction", "Tap Get Started", { layer: layerRef("next_button"), enabled: link("was_last_page.output") }),
    addPatch("tap_skip", "interaction", "Tap Skip", { layer: layerRef("skip_button") }),
    addPatch("swipe_forward", "swipe", "Swipe to Next", { layer: layerRef("swipe_area"), enabled: link("can_go_forward.output"), axis: "horizontal", minDistance: 60, minVelocity: 400 }),
    addPatch("swipe_back", "swipe", "Swipe to Previous", { layer: layerRef("swipe_area"), enabled: link("can_go_back.output"), axis: "horizontal", minDistance: 60, minVelocity: 400 }),
    addPatch("go_forward", "or", "Next or Swipe Left", { value1: link("tap_next.tap"), value2: link("swipe_forward.swipedLeft") }, { inputCount: 2 }),
    connect("go_forward.output", "page.increase"),
    connect("swipe_back.swipedRight", "page.decrease"),
    connect("tap_skip.tap", "page.jump"),
    { op: "setInput", target: "page.jumpToNumber", value: LAST_PAGE },

    // Slide the pages
    addPatch("pages_x", "multiply", "Pages X", { value1: link("page.count"), value2: -SCREEN.width }, { typeParam: "number", inputCount: 2 }),
    addPatch("pages_spring", "popAnimation", "Pages Spring", { number: link("pages_x.output"), bounciness: 2, speed: 13 }),
    addPatch("pages_position", "point", "Pages Position", { x: link("pages_spring.output"), y: 0 }),
    connect("pages_position.output", "@pages.position"),

    // The last page: label, Skip, and finishing
    addPatch("on_last_page", "equals", "On Last Page", { value1: link("page.count"), value2: LAST_PAGE }, { typeParam: "number" }),
    addPatch("button_label", "ifElse", "Button Label", { condition: link("on_last_page.output"), ifTrue: "Get started", ifFalse: "Next" }, { typeParam: "text" }),
    connect("button_label.output", "@next_label.text"),
    addPatch("skip_visible", "not", "Skip Visible", { value: link("on_last_page.output") }),
    addPatch("skip_fade", "classicAnimation", "Skip Fade", { number: link("skip_visible.output"), duration: 0.2, curve: "cubicOut" }, { typeParam: "number" }),
    connect("skip_fade.output", "@skip_button.opacity"),
    addPatch("onboarding_done", "switch", "Onboarding Done", { turnOn: link("tap_get_started.tap") }),
    addPatch("welcome_fade", "classicAnimation", "Welcome Fade", { number: link("onboarding_done.on"), duration: 0.35, curve: "cubicOut" }, { typeParam: "number" }),
    connect("welcome_fade.output", "@welcome.opacity"),

    // Page dots
    addPatch("page_dots", "loop", "Page Dots", { count: PAGES.length }),
    addPatch("dot_x", "mathExpression", "Dot X", {}, { settings: { expression: "177 + index * 24" } }),
    connect("page_dots.index", "dot_x.index"),
    addPatch("dot_position", "point", "Dot Position", { x: link("dot_x.output"), y: 700 }),
    addPatch("dot_is_current", "equals", "Dot Is Current Page", { value1: link("page_dots.index"), value2: link("page.count") }, { typeParam: "number" }),
    addPatch("dot_spring", "popAnimation", "Dot Spring", { number: link("dot_is_current.output"), bounciness: 0, speed: 18 }),
    addPatch("dot_size", "transition", "Dot Size", { progress: link("dot_spring.output"), start: [8, 8], end: [24, 8] }, { typeParam: "size" }),
    addPatch("dot_color", "transition", "Dot Color", { progress: link("dot_spring.output"), start: "#D4D4D8FF", end: palette.indigo }, { typeParam: "color" }),
    connect("dot_position.output", "@dot.position"),
    connect("dot_size.output", "@dot.size"),
    connect("dot_color.output", "@dot.color"),
  ],
};
