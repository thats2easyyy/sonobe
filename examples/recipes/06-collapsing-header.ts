/** 06 Collapsing Header: a playlist header that shrinks into a bar as the tracks scroll, driven straight from the scroll position. */

import type { NewLayer } from "@sonobe/core";
import { addLayer, addPatch, connect, gradient, gradientLayer, group, homeIndicator, layerRef, link, oval, palette, rect, SCREEN, shadow, shape, statusBar, text, type } from "../lib/kit.ts";
import type { Recipe } from "../lib/recipe.ts";

export const HEADER_TALL = 300;
export const HEADER_SHORT = 110;
/** Scroll distance over which the header collapses. */
export const COLLAPSE_DISTANCE = HEADER_TALL - HEADER_SHORT;

const TRACKS: [string, string][] = [
  ["Neon Rain", "3:41"], ["Coastline at 2 AM", "4:05"], ["Slow Headlights", "3:18"], ["Afterglow", "2:57"], ["Streetlamp Choir", "3:33"], ["Tunnel Vision", "4:21"],
  ["Static Hearts", "3:09"], ["Overpass", "3:46"], ["Glass Skyline", "4:12"], ["Cruise Control", "3:27"], ["Dashboard Light", "3:52"], ["Nightshift", "4:38"],
  ["Exit 42", "2:49"], ["Low Beams", "3:15"], ["Echo Park", "3:58"], ["Blue Hour", "4:02"], ["Parallel Lanes", "3:36"], ["Homeward", "5:11"],
];
const FIRST_TRACK_Y = 360;
const TRACK_HEIGHT = 56;
const CONTENT_HEIGHT = FIRST_TRACK_Y + TRACKS.length * TRACK_HEIGHT + 40;

function track(index: number): NewLayer {
  const [title, duration] = TRACKS[index]!;
  const n = index + 1;
  return group(`track_${n}`, title, { position: [0, FIRST_TRACK_Y + index * TRACK_HEIGHT], size: [SCREEN.width, TRACK_HEIGHT] }, [
    text(`track_${n}_number`, "Number", String(n), { fontSize: 13, fontWeight: 500 }, palette.white40, { position: [36, 19], anchor: [0.5, 0], textAlignment: "center" }),
    text(`track_${n}_title`, "Title", title, { fontSize: 16, fontWeight: 600 }, palette.white, { position: [64, 9] }),
    text(`track_${n}_artist`, "Artist", "Nova Lane", type.footnote, palette.white70, { position: [64, 30] }),
    text(`track_${n}_duration`, "Duration", duration, { fontSize: 13, fontWeight: 500 }, palette.white40, { position: [378, 19], anchor: [1, 0], textAlignment: "right" }),
  ]);
}

export const collapsingHeader: Recipe = {
  folder: "06-collapsing-header",
  name: "Collapsing Header",
  description: "A playlist header that shrinks into a compact bar as the tracks scroll under it. The title glides into the bar and the cover art fades, all read straight from the scroll position.",
  guides: ["04-layers-and-layout", "06-gestures"],
  background: palette.night,
  notes:
    "Scroll the tracks. Collapse Progress turns the first 190 points of scrolling into 0…1, and every Transition reads it, so the header follows the finger exactly with no animation of its own.",
  ops: () => [
    addLayer(
      group("content", "Tracks", { size: [SCREEN.width, CONTENT_HEIGHT], color: palette.night }, [
        text("track_summary", "Summary", "18 songs · 1 hr 4 min", type.footnote, palette.white70, { position: [24, 322] }),
        ...TRACKS.map((_, i) => track(i)),
      ]),
    ),
    addLayer(
      group("header", "Header", { size: [SCREEN.width, HEADER_TALL], clip: true, color: palette.night, hitTest: false, ...shadow("glow", palette.black) }, [
        gradientLayer("header_art", "Header Art", gradient([[0, "#4C1D95FF"], [0.55, "#BE185DFF"], [1, "#0E0F1AFF"]], [0, 0], [0.4, 1]), { size: [SCREEN.width, HEADER_TALL] }),
        group("cover", "Cover Art", { position: [SCREEN.width / 2, 140], anchor: [0.5, 0.5], size: [150, 150], cornerRadius: 18, clip: true, ...shadow("glow", palette.black) }, [
          gradientLayer("cover_sky", "Sky", gradient([[0, "#F472B6FF"], [1, "#7C3AEDFF"]]), { size: [150, 150] }),
          oval("cover_sun", "Sun", { position: [45, 38], size: [60, 60], color: "#FDE68AFF" }),
          rect("cover_road", "Road", { position: [55, 92], size: [40, 90], rotation: 0, color: "#1E1B4BFF" }),
          rect("cover_horizon", "Horizon", { position: [0, 96], size: [150, 54], color: "#312E81FF" }),
          rect("cover_lane", "Lane", { position: [73, 104], size: [4, 40], color: "#FDE68AFF" }),
        ]),
        gradientLayer("header_shade", "Shade", gradient([[0, "#0E0F1A00"], [1, "#0E0F1AFF"]]), { position: [0, 200], size: [SCREEN.width, 100] }),
        oval("back_button", "Back", { position: [16, 62], size: [36, 36], color: "#FFFFFF26" }),
        rect("back_chevron_top", "Chevron Top", { position: [28, 74], size: [11, 3], rotation: -45, cornerRadius: 1.5, color: palette.white }),
        rect("back_chevron_bottom", "Chevron Bottom", { position: [28, 82], size: [11, 3], rotation: 45, cornerRadius: 1.5, color: palette.white }),
        text("header_title", "Title", "Night Drive", type.largeTitle, palette.white, { position: [24, 228] }),
        text("header_subtitle", "Subtitle", "Playlist · Nova Lane", type.footnote, palette.white70, { position: [24, 272] }),
        group("play_button", "Play Button", { position: [322, 244], size: [56, 56], cornerRadius: 28, color: palette.green, ...shadow("glow", palette.green) }, [
          shape("play_icon", "Play Icon", { size: [56, 56], color: palette.night }),
        ]),
      ]),
    ),
    addLayer(statusBar("app", "light")),
    addLayer(homeIndicator("app", "light")),

    addPatch("play_icon_shape", "svgPathShape", "Play Icon Shape", { pathData: "M22 17L40 28L22 39Z", viewBox: [0, 0, 56, 56], size: [56, 56] }),
    connect("play_icon_shape.shape", "@play_icon.shape"),

    // Scroll the tracks
    addPatch("tracks_scroll", "scroll", "Scroll Tracks", { layer: layerRef("content"), scrollY: "free" }),
    connect("tracks_scroll.position", "@content.position"),

    // One progress, read by every Transition
    addPatch("collapse", "progress", "Collapse Progress", { value: link("tracks_scroll.y"), start: 0, end: -COLLAPSE_DISTANCE, clampToRange: true }),
    addPatch("header_size", "transition", "Header Size", { progress: link("collapse.progress"), start: [SCREEN.width, HEADER_TALL], end: [SCREEN.width, HEADER_SHORT] }, { typeParam: "size" }),
    addPatch("cover_scale", "transition", "Cover Scale", { progress: link("collapse.progress"), start: 1, end: 0.6 }, { typeParam: "number" }),
    addPatch("cover_fade", "transition", "Cover Fade", { progress: link("collapse.progress"), start: 1, end: 0 }, { typeParam: "number" }),
    addPatch("title_position", "transition", "Title Position", { progress: link("collapse.progress"), start: [24, 228], end: [64, 64] }, { typeParam: "point" }),
    addPatch("title_size", "transition", "Title Size", { progress: link("collapse.progress"), start: 34, end: 20 }, { typeParam: "number" }),
    addPatch("play_position", "transition", "Play Position", { progress: link("collapse.progress"), start: [322, 244], end: [342, 58] }, { typeParam: "point" }),
    addPatch("play_scale", "transition", "Play Scale", { progress: link("collapse.progress"), start: 1, end: 0.72 }, { typeParam: "number" }),
    connect("header_size.output", "@header.size"),
    connect("cover_scale.output", "@cover.scale"),
    connect("cover_fade.output", "@cover.opacity"),
    connect("cover_fade.output", "@header_subtitle.opacity"),
    connect("title_position.output", "@header_title.position"),
    connect("title_size.output", "@header_title.fontSize"),
    connect("play_position.output", "@play_button.position"),
    connect("play_scale.output", "@play_button.scale"),
  ],
};
