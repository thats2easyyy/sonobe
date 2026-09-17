/** 04 Carousel Paging: swipe through trip cards one page at a time, with peeking neighbors, page dots, and a Next button. */

import type { NewLayer } from "@sonobe/core";
import { addLayer, addPatch, connect, gradient, gradientLayer, group, homeIndicator, layerRef, link, oval, palette, rect, SCREEN, shadow, statusBar, text, type } from "../lib/kit.ts";
import type { Recipe } from "../lib/recipe.ts";

const CARD: [number, number] = [320, 480];
const GAP = 12;
/** Left edge of the first card: (402 − 320) / 2, so the current card is centered and its neighbors peek. */
export const INSET = (SCREEN.width - CARD[0]) / 2;
export const STEP = CARD[0] + GAP;

/** name, tagline, days, price, sky gradient, land color */
const TRIPS: [string, string, string, string, [string, string], string][] = [
  ["Kyoto", "Temples and tea houses", "7 days", "$1,240", ["#FDBA74FF", "#DB2777FF"], "#3B0A2EFF"],
  ["Reykjavík", "Chasing the northern lights", "5 days", "$980", ["#0F766EFF", "#1E1B4BFF"], "#020617FF"],
  ["Lisbon", "Tiles, trams and custard tarts", "4 days", "$1,610", ["#FDE68AFF", "#F97316FF"], "#7C2D12FF"],
  ["Patagonia", "Glaciers at the end of the world", "10 days", "$2,150", ["#BAE6FDFF", "#6366F1FF"], "#1E293BFF"],
];

function tripCard(index: number): NewLayer {
  const [name, tagline, days, , [skyTop, skyBottom], land] = TRIPS[index]!;
  const n = index + 1;
  return group(`trip_${n}`, name, { size: CARD, cornerRadius: 28, clip: true, color: palette.nightSurface, ...shadow("glow", palette.black) }, [
    gradientLayer(`trip_${n}_sky`, "Sky", gradient([[0, skyTop], [1, skyBottom]]), { size: CARD }),
    oval(`trip_${n}_sun`, "Sun", { position: [196, 70], size: [92, 92], color: "#FFFFFFD9", ...shadow("glow", palette.white) }),
    rect(`trip_${n}_peak_1`, "Peak", { position: [-40, 250], size: [260, 260], rotation: 45, cornerRadius: 24, color: `${land.slice(0, 7)}B3` }),
    rect(`trip_${n}_peak_2`, "Peak", { position: [150, 290], size: [240, 240], rotation: 45, cornerRadius: 24, color: land }),
    group(`trip_${n}_chip`, "Days", { position: [20, 20], size: [76, 30], cornerRadius: 15, color: "#FFFFFF33", backgroundBlur: 12, hitTest: false }, [
      text(`trip_${n}_days`, "Days Label", days, type.caption, palette.white, { position: [38, 15], anchor: [0.5, 0.5], textAlignment: "center" }),
    ]),
    text(`trip_${n}_name`, "Name", name, type.title, palette.white, { position: [24, 376] }),
    text(`trip_${n}_tagline`, "Tagline", tagline, type.callout, palette.white70, { position: [24, 416] }),
  ]);
}

export const carouselPaging: Recipe = {
  folder: "04-carousel-paging",
  name: "Carousel Paging",
  description: "Swipe through trip cards one page at a time. Neighbors peek at the edges, the dots stretch to show where you are, and a Next button jumps ahead.",
  guides: ["06-gestures", "07-loops"],
  background: palette.night,
  notes:
    "Swipe the cards. Scroll Trips pages one card at a time (Page Size 320, Page Padding 12) and reports the page number; the dots and the price read that number. Next jumps to the following page.",
  ops: () => [
    addLayer(gradientLayer("backdrop", "Backdrop", gradient([[0, "#1A1B2AFF"], [1, "#0B0C14FF"]]), { size: [SCREEN.width, SCREEN.height], hitTest: false })),
    addLayer(statusBar("app", "light")),
    addLayer(text("title", "Title", "Trips", type.largeTitle, palette.white, { position: [24, 76] })),
    addLayer(text("subtitle", "Subtitle", "Swipe to explore", type.callout, palette.white70, { position: [24, 120] })),
    addLayer(group("carousel", "Carousel", { position: [0, 176], size: [SCREEN.width, CARD[1]] }, [
      group("cards", "Cards", { position: [INSET, 0], size: [TRIPS.length * CARD[0] + (TRIPS.length - 1) * GAP, CARD[1]], layout: "row", spacing: GAP }, TRIPS.map((_, i) => tripCard(i))),
    ])),
    addLayer(oval("dot", "Page Dot", { anchor: [0.5, 0.5], size: [8, 8], color: palette.white40, hitTest: false })),
    addLayer(text("price_caption", "Price Caption", "From", type.footnote, palette.white70, { position: [24, 738] })),
    addLayer(text("price", "Price", TRIPS[0]![3], type.title2, palette.white, { position: [24, 758] })),
    addLayer(group("next_button", "Next Button", { position: [322, 734], size: [56, 56], cornerRadius: 28, color: palette.white }, [
      rect("next_arrow_top", "Arrow Top", { position: [24, 22], size: [12, 3], rotation: 45, cornerRadius: 1.5, color: palette.ink, hitTest: false }),
      rect("next_arrow_bottom", "Arrow Bottom", { position: [24, 31], size: [12, 3], rotation: -45, cornerRadius: 1.5, color: palette.ink, hitTest: false }),
    ])),
    addLayer(homeIndicator("app", "light")),

    // Paging scroll: each page is one card plus the gap
    addPatch("trips_scroll", "scroll", "Scroll Trips", {
      layer: layerRef("cards"),
      scrollX: "paging",
      scrollY: "off",
      startPosition: [INSET, 0],
      pageSize: CARD,
      pagePadding: [GAP, 0],
    }),
    connect("trips_scroll.position", "@cards.position"),

    // Page dots: one Oval repeated by a loop; the current page stretches
    addPatch("page_dots", "loop", "Page Dots", { count: TRIPS.length }),
    addPatch("dot_x", "mathExpression", "Dot X", {}, { settings: { expression: "171 + index * 20" } }),
    connect("page_dots.index", "dot_x.index"),
    addPatch("dot_position", "point", "Dot Position", { x: link("dot_x.output"), y: 700 }),
    connect("dot_position.output", "@dot.position"),
    addPatch("dot_is_current", "equals", "Dot Is Current Page", { value1: link("page_dots.index"), value2: link("trips_scroll.pageX") }, { typeParam: "number" }),
    addPatch("dot_spring", "popAnimation", "Dot Spring", { number: link("dot_is_current.output"), bounciness: 0, speed: 18 }),
    addPatch("dot_size", "transition", "Dot Size", { progress: link("dot_spring.output"), start: [8, 8], end: [22, 8] }, { typeParam: "size" }),
    addPatch("dot_color", "transition", "Dot Color", { progress: link("dot_spring.output"), start: palette.white40, end: palette.white }, { typeParam: "color" }),
    connect("dot_size.output", "@dot.size"),
    connect("dot_color.output", "@dot.color"),

    // The price for the current page
    addPatch("trip_price", "optionPicker", "Trip Price", { option: link("trips_scroll.pageX"), option0: TRIPS[0]![3], option1: TRIPS[1]![3], option2: TRIPS[2]![3], option3: TRIPS[3]![3] }, { typeParam: "text", inputCount: 4 }),
    connect("trip_price.output", "@price.text"),

    // Next: jump to the following page's x (Start Position x minus page × step)
    addPatch("tap_next", "interaction", "Tap Next", { layer: layerRef("next_button") }),
    addPatch("next_page_x", "mathExpression", "Next Page X", {}, { settings: { expression: `${INSET} - clamp(page + 1, 0, ${TRIPS.length - 1}) * ${STEP}` } }),
    connect("trips_scroll.pageX", "next_page_x.page"),
    connect("next_page_x.output", "trips_scroll.jumpPositionX"),
    connect("tap_next.tap", "trips_scroll.jumpToX"),
  ],
};
