/** 13 Stories: three auto-advancing stories with progress bars. Tap the right side to skip, the left side to go back. */

import { addLayer, addPatch, connect, gradient, gradientLayer, group, hitArea, homeIndicator, layerRef, link, oval, palette, rect, SCREEN, statusBar, text, type } from "../lib/kit.ts";
import type { Recipe } from "../lib/recipe.ts";

export const STORY_SECONDS = 5;
const BAR_ORIGIN: [number, number] = [12, 64];
const BAR_WIDTH = SCREEN.width - 24;
const BAR_GAP = 6;
/** Width of one progress bar: (378 − 2 × 6) / 3. */
export const SEGMENT_WIDTH = (BAR_WIDTH - 2 * BAR_GAP) / 3;

const STORIES: [string, string, string, string][] = [
  ["Day 1 · Lisbon", "Yellow trams and a very steep hill", "#F59E0BFF", "#FDE68AFF"],
  ["Day 2 · Sintra", "Fog over the painted palace", "#0EA5E9FF", "#BAE6FDFF"],
  ["Day 3 · Porto", "Sunset from the bridge", "#DB2777FF", "#FBCFE8FF"],
];

export const stories: Recipe = {
  folder: "13-stories",
  name: "Stories",
  description: "Three stories that advance on their own every five seconds. The bars at the top fill as each one plays; tap the right side to skip ahead or the left side to go back.",
  guides: ["03-states-and-pulses", "07-loops"],
  background: palette.black,
  notes:
    "Watch, or tap the right two thirds to skip and the left third to go back. Current Story counts which story is showing; Story Timer restarts whenever that count changes. Each bar's fill is clamp(story + progress − index, 0, 1): full for stories you've seen, filling for the current one, empty after.",
  ops: () => [
    // One story layer per loop index; only the current one is visible
    addLayer(
      group("story", "Story", { size: [SCREEN.width, SCREEN.height], color: STORIES[0]![2], hitTest: false }, [
        oval("story_sun", "Sun", { position: [40, 180], size: [320, 320], color: STORIES[0]![3] }),
        rect("story_hill", "Hill", { position: [-80, 560], size: [560, 420], rotation: -8, cornerRadius: 120, color: "#0000002E" }),
        text("story_title", "Title", STORIES[0]![0], type.title, palette.white, { position: [24, 648] }),
        text("story_caption", "Caption", STORIES[0]![1], type.callout, palette.white70, { position: [24, 690] }),
      ]),
    ),
    addLayer(gradientLayer("story_shade", "Top Shade", gradient([[0, "#00000066"], [1, "#00000000"]]), { size: [SCREEN.width, 180], hitTest: false })),
    addLayer(rect("segment_track", "Bar Track", { size: [SEGMENT_WIDTH, 3], cornerRadius: 1.5, color: "#FFFFFF59", hitTest: false })),
    addLayer(rect("segment_fill", "Bar Fill", { size: [0, 3], cornerRadius: 1.5, color: palette.white, hitTest: false })),
    addLayer(statusBar("app", "light")),
    addLayer(oval("author_avatar", "Avatar", { position: [16, 82], size: [36, 36], color: palette.white, strokeColor: "#FFFFFF80", strokeWidth: 2, hitTest: false })),
    addLayer(text("author_name", "Author", "lisa.travels · 2h", type.subhead, palette.white, { position: [62, 90] })),
    addLayer(rect("close_bar_1", "Close", { position: [370, 99], size: [20, 2.5], rotation: 45, cornerRadius: 1, color: palette.white, hitTest: false })),
    addLayer(rect("close_bar_2", "Close", { position: [370, 99], size: [20, 2.5], rotation: -45, cornerRadius: 1, color: palette.white, hitTest: false })),
    addLayer(group("reply_field", "Reply Field", { position: [16, 784], size: [370, 48], cornerRadius: 24, color: palette.clear, strokeColor: "#FFFFFF80", strokeWidth: 1.5, hitTest: false }, [
      text("reply_placeholder", "Placeholder", "Send message", type.callout, palette.white70, { position: [20, 13] }),
    ])),
    addLayer(hitArea("tap_zone_back", "Tap Zone Back", { position: [0, 130], size: [SCREEN.width / 3, 640] })),
    addLayer(hitArea("tap_zone_forward", "Tap Zone Forward", { position: [SCREEN.width / 3, 130], size: [(SCREEN.width * 2) / 3, 640] })),
    addLayer(homeIndicator("app", "light")),

    // Story content per index
    addPatch("stories", "loop", "Stories", { count: STORIES.length }),
    addPatch("story_colors", "loopBuilder", "Story Colors", Object.fromEntries(STORIES.map((s, i) => [`item${i}`, s[2]])), { typeParam: "color", inputCount: STORIES.length }),
    addPatch("story_accents", "loopBuilder", "Sun Colors", Object.fromEntries(STORIES.map((s, i) => [`item${i}`, s[3]])), { typeParam: "color", inputCount: STORIES.length }),
    addPatch("story_titles", "loopBuilder", "Story Titles", Object.fromEntries(STORIES.map((s, i) => [`item${i}`, s[0]])), { typeParam: "text", inputCount: STORIES.length }),
    addPatch("story_captions", "loopBuilder", "Story Captions", Object.fromEntries(STORIES.map((s, i) => [`item${i}`, s[1]])), { typeParam: "text", inputCount: STORIES.length }),
    connect("story_colors.loop", "@story.color"),
    connect("story_accents.loop", "@story_sun.color"),
    connect("story_titles.loop", "@story_title.text"),
    connect("story_captions.loop", "@story_caption.text"),

    // Which story: taps and the timer move the count
    addPatch("started", "whenPrototypeStarts", "Prototype Starts"),
    addPatch("tap_back", "interaction", "Tap Left Side", { layer: layerRef("tap_zone_back") }),
    addPatch("tap_forward", "interaction", "Tap Right Side", { layer: layerRef("tap_zone_forward") }),
    addPatch("story_timer", "wait", "Story Timer", { duration: STORY_SECONDS }),
    addPatch("next_story", "or", "Tap or Time Up", { value1: link("tap_forward.tap"), value2: link("story_timer.finished") }, { inputCount: 2 }),
    addPatch("current_story", "counter", "Current Story", { increase: link("next_story.output"), decrease: link("tap_back.tap"), maximumCount: STORIES.length }),
    addPatch("story_changed", "pulseOnChange", "Story Changed", { value: link("current_story.count") }, { typeParam: "number" }),
    addPatch("start_timer", "or", "Start or Story Changed", { value1: link("started.started"), value2: link("story_changed.changed") }, { inputCount: 2 }),
    connect("start_timer.output", "story_timer.start"),

    // Show the current story
    addPatch("story_is_current", "equals", "Is Current Story", { value1: link("stories.index"), value2: link("current_story.count") }, { typeParam: "number" }),
    addPatch("story_fade", "classicAnimation", "Story Fade", { number: link("story_is_current.output"), duration: 0.25, curve: "cubicOut" }, { typeParam: "number" }),
    connect("story_fade.output", "@story.opacity"),

    // Progress bars: one track and one fill per story
    addPatch("segment_grid", "gridLayout", "Bar Positions", { index: link("stories.index"), columns: STORIES.length, origin: BAR_ORIGIN, width: BAR_WIDTH, itemHeight: 3, spacing: BAR_GAP }),
    addPatch("segment_fill_amount", "mathExpression", "Bar Fill Amount", {}, { settings: { expression: "clamp(story + progress - index, 0, 1)" } }),
    connect("current_story.count", "segment_fill_amount.story"),
    connect("story_timer.progress", "segment_fill_amount.progress"),
    connect("stories.index", "segment_fill_amount.index"),
    addPatch("fill_width", "multiply", "Fill Width", { value1: link("segment_fill_amount.output"), value2: SEGMENT_WIDTH }, { typeParam: "number", inputCount: 2 }),
    addPatch("fill_size", "size", "Fill Size", { width: link("fill_width.output"), height: 3 }),
    connect("segment_grid.position", "@segment_track.position"),
    connect("segment_grid.position", "@segment_fill.position"),
    connect("segment_grid.size", "@segment_track.size"),
    connect("fill_size.output", "@segment_fill.size"),
  ],
};
