/** 07 Pull to Refresh: pull the feed past a threshold and let go; a spinner holds the list down while a pretend request runs. */

import type { NewLayer } from "@sonobe/core";
import { addLayer, addPatch, connect, group, homeIndicator, layerRef, link, oval, palette, rect, SCREEN, shadow, shape, statusBar, text, type } from "../lib/kit.ts";
import type { Recipe } from "../lib/recipe.ts";

/** How far to pull (points) before letting go refreshes, and how much room the spinner gets while it runs. */
export const THRESHOLD = 64;
export const SPACER = 64;
const HEADER_HEIGHT = 130;

const ACTIVITY: [string, string, string][] = [
  ["Maya liked your photo", "2 min ago", palette.pink],
  ["Leo started following you", "14 min ago", palette.indigo],
  ["Your export finished", "32 min ago", palette.green],
  ["Iris commented: “that spring!”", "1 h ago", palette.amber],
  ["3 people viewed your prototype", "2 h ago", palette.sky],
  ["Dev shared “Checkout Flow”", "3 h ago", palette.violet],
  ["Weekly summary is ready", "5 h ago", palette.teal],
  ["Hana liked your comment", "Yesterday", palette.pink],
  ["New device connected", "Yesterday", palette.coral],
  ["Zoe mentioned you", "Mon", palette.indigo],
  ["Your prototype got 12 new views", "Mon", palette.sky],
  ["Kai liked your photo", "Sun", palette.pink],
  ["Ruth started following you", "Sun", palette.indigo],
  ["Backup completed", "Sat", palette.green],
  ["Oliver commented: “ship it”", "Sat", palette.amber],
  ["Welcome to Activity", "Fri", palette.violet],
];

function activityRow(index: number): NewLayer {
  const [title, time, color] = ACTIVITY[index]!;
  const n = index + 1;
  return group(`activity_${n}`, title, { position: [16, 12 + index * 84], size: [370, 72], cornerRadius: 18, color: palette.surface, ...shadow("soft") }, [
    oval(`activity_${n}_icon`, "Icon", { position: [16, 16], size: [40, 40], color: `${color.slice(0, 7)}26` }),
    oval(`activity_${n}_dot`, "Icon Dot", { position: [30, 30], size: [12, 12], color }),
    text(`activity_${n}_title`, "Title", title, type.subhead, palette.ink, { position: [68, 16] }),
    text(`activity_${n}_time`, "Time", time, type.footnote, palette.ink2, { position: [68, 39] }),
  ]);
}

export const pullToRefresh: Recipe = {
  folder: "07-pull-to-refresh",
  name: "Pull to Refresh",
  description: "Pull the feed down past a threshold and let go. A spinner draws in as you pull, holds the list down while a pretend request runs, then the list slides back up.",
  guides: ["03-states-and-pulses", "06-gestures"],
  background: palette.canvas,
  notes:
    "Pull the list down more than 64 points and let go. Let Go Past Threshold turns on the moment the finger lifts while the list is pulled far enough, which turns Refreshing on; a Wait turns it off 1.6 seconds later.",
  ops: () => [
    addLayer(
      group("window", "Window", { position: [0, HEADER_HEIGHT], size: [SCREEN.width, SCREEN.height - HEADER_HEIGHT], clip: true }, [
        shape("spinner", "Spinner", { position: [SCREEN.width / 2, 34], anchor: [0.5, 0.5], size: [28, 28], color: palette.clear, strokeColor: palette.indigo, strokeWidth: 3, lineCap: "round", strokeEnd: 0, opacity: 0, hitTest: false }),
        group("content", "Feed", { size: [SCREEN.width, 12 + ACTIVITY.length * 84 + 40], color: palette.canvas }, ACTIVITY.map((_, i) => activityRow(i))),
      ]),
    ),
    addLayer(
      group("header", "Header", { size: [SCREEN.width, HEADER_HEIGHT], color: palette.canvas, hitTest: false }, [
        text("header_title", "Title", "Activity", type.largeTitle, palette.ink, { position: [24, 66] }),
        text("subtitle", "Status", "Pull down to refresh", type.footnote, palette.ink2, { position: [24, 106] }),
        rect("header_divider", "Divider", { position: [0, HEADER_HEIGHT - 1], size: [SCREEN.width, 1], color: palette.hairline }),
      ]),
    ),
    addLayer(statusBar("app", "dark")),
    addLayer(homeIndicator("app", "dark")),

    // Scroll, and how far past the top it's pulled
    addPatch("feed_scroll", "scroll", "Scroll Feed", { layer: layerRef("content"), scrollY: "free" }),
    addPatch("pull_amount", "progress", "Pull Amount", { value: link("feed_scroll.y"), start: 0, end: THRESHOLD, clampToRange: true }),

    // Decide: not dragging AND pulled far enough. That turns on at the moment the finger lifts past the threshold.
    addPatch("not_dragging", "not", "Not Dragging", { value: link("feed_scroll.dragging") }),
    addPatch("pulled_far", "greaterThanOrEqual", "Pulled Far Enough", { value1: link("feed_scroll.y"), value2: THRESHOLD }, { typeParam: "number", inputCount: 2 }),
    addPatch("start_refresh", "and", "Let Go Past Threshold", { value1: link("not_dragging.output"), value2: link("pulled_far.output") }, { inputCount: 2 }),
    addPatch("refreshing", "switch", "Refreshing", { turnOn: link("start_refresh.output") }),
    addPatch("refresh_timer", "wait", "Pretend Network Request", { start: link("refreshing.on"), duration: 1.6 }),
    connect("refresh_timer.finished", "refreshing.turnOff"),

    // Hold the list down while refreshing
    addPatch("spacer_spring", "popAnimation", "Spacer Spring", { number: link("refreshing.on"), bounciness: 0, speed: 14 }),
    addPatch("spacer_height", "transition", "Spacer Height", { progress: link("spacer_spring.output"), start: 0, end: SPACER }, { typeParam: "number" }),
    addPatch("content_y", "add", "Content Y", { value1: link("feed_scroll.y"), value2: link("spacer_height.output") }, { typeParam: "number", inputCount: 2 }),
    addPatch("content_position", "point", "Content Position", { x: 0, y: link("content_y.output") }),
    connect("content_position.output", "@content.position"),

    // Spinner: draws in while pulling, spins while refreshing
    addPatch("spinner_shape", "circleShape", "Spinner Circle", { position: [14, 14], radius: 11 }),
    connect("spinner_shape.shape", "@spinner.shape"),
    addPatch("spinner_reveal", "max", "Spinner Reveal", { value1: link("pull_amount.progress"), value2: link("spacer_spring.output") }, { typeParam: "number", inputCount: 2 }),
    addPatch("spinner_arc", "transition", "Spinner Arc", { progress: link("spinner_reveal.output"), start: 0, end: 0.8 }, { typeParam: "number" }),
    addPatch("spin", "repeatingAnimation", "Spin", { enabled: link("refreshing.on"), duration: 0.9, curve: "linear", mirrored: false }),
    addPatch("spinner_rotation", "transition", "Spinner Rotation", { progress: link("spin.progress"), start: 0, end: 360 }, { typeParam: "number" }),
    connect("spinner_reveal.output", "@spinner.opacity"),
    connect("spinner_arc.output", "@spinner.strokeEnd"),
    connect("spinner_rotation.output", "@spinner.rotation"),

    // Status text
    addPatch("refresh_count", "counter", "Refresh Count", { increase: link("refresh_timer.finished") }),
    addPatch("has_refreshed", "greaterThan", "Has Refreshed", { value1: link("refresh_count.count"), value2: 0 }, { typeParam: "number", inputCount: 2 }),
    addPatch("status_text", "ifElse", "Status Text", { condition: link("has_refreshed.output"), ifTrue: "Updated just now", ifFalse: "Pull down to refresh" }, { typeParam: "text" }),
    connect("status_text.output", "@subtitle.text"),
  ],
};
