/** 15 Grid with Loops: twelve color tiles from one repeated layer. Loop, Grid Layout, per-index color, a staggered entrance, and tap to pick. */

import { addLayer, addPatch, connect, group, homeIndicator, layerRef, link, palette, SCREEN, shadow, statusBar, text, type } from "../lib/kit.ts";
import type { Recipe } from "../lib/recipe.ts";

export const TILE_COUNT = 12;
export const COLUMNS = 3;
export const GRID_ORIGIN: [number, number] = [16, 290];
export const GRID_WIDTH = SCREEN.width - 32;
export const TILE_HEIGHT = 116;
export const SPACING = 10;
export const STAGGER_SECONDS = 0.04;

export const gridWithLoops: Recipe = {
  folder: "15-grid-with-loops",
  name: "Grid with Loops",
  description: "Twelve color tiles made from one layer and one loop. Grid Layout places them, HSL Color tints each one, they pop in one after another, and tapping a tile picks its color.",
  guides: ["07-loops"],
  background: palette.canvas,
  notes:
    "Tap a tile. Tiles is a loop of 12 indices, and the Tile layer repeats once per index because its props are wired to looped values. Every patch fed by the loop runs once per tile; Selected Tile remembers which copy was tapped.",
  ops: () => [
    addLayer(statusBar("app", "dark")),
    addLayer(text("title", "Title", "Palette", type.largeTitle, palette.ink, { position: [24, 70] })),
    addLayer(text("subtitle", "Subtitle", "12 colors · tap one to pick it", type.footnote, palette.ink2, { position: [24, 114] })),
    addLayer(
      group("preview", "Preview", { position: [16, 150], size: [GRID_WIDTH, 120], cornerRadius: 24, ...shadow("soft") }, [
        text("preview_caption", "Preview Caption", "SELECTED", type.caption, palette.white70, { position: [20, 20] }),
        text("preview_label", "Preview Hex", "#000000", type.title, palette.white, { position: [20, 62] }),
      ]),
    ),
    addLayer(
      group("tile", "Tile", { cornerRadius: 18, strokeColor: palette.white, strokeWidth: 0, strokePosition: "inside" }, [
        text("tile_label", "Tile Number", "#01", type.caption, palette.white, { position: [14, 12] }),
      ]),
    ),
    addLayer(homeIndicator("app", "dark")),

    // The loop and the grid
    addPatch("tiles", "loop", "Tiles", { count: TILE_COUNT }),
    addPatch("tile_grid", "gridLayout", "Tile Grid", { index: link("tiles.index"), columns: COLUMNS, origin: GRID_ORIGIN, width: GRID_WIDTH, itemHeight: TILE_HEIGHT, spacing: SPACING }),
    connect("tile_grid.position", "@tile.position"),
    connect("tile_grid.size", "@tile.size"),

    // A color and a number per tile
    addPatch("hue", "divide", "Hue Step", { value1: link("tiles.index"), value2: TILE_COUNT }, { typeParam: "number", inputCount: 2 }),
    addPatch("tile_colors", "hslColor", "Tile Color", { hue: link("hue.output"), saturation: 0.72, lightness: 0.6 }),
    connect("tile_colors.color", "@tile.color"),
    addPatch("tile_number", "add", "Tile Number", { value1: link("tiles.index"), value2: 1 }, { typeParam: "number", inputCount: 2 }),
    addPatch("tile_numbers", "formatNumber", "Tile Label", { value: link("tile_number.output"), minimumDigits: 2, prefix: "#" }),
    connect("tile_numbers.text", "@tile_label.text"),

    // Staggered entrance: each tile waits index × 0.04 s longer
    addPatch("started", "whenPrototypeStarts", "Prototype Starts"),
    addPatch("intro_wait", "wait", "Short Pause", { start: link("started.started"), duration: 0.15 }),
    addPatch("stagger_delay", "multiply", "Stagger Delay", { value1: link("tiles.index"), value2: STAGGER_SECONDS }, { typeParam: "number", inputCount: 2 }),
    addPatch("tile_shown", "delay", "Tile Shown", { value: link("intro_wait.done"), duration: link("stagger_delay.output") }, { typeParam: "boolean" }),
    addPatch("intro_spring", "popAnimation", "Intro Spring", { number: link("tile_shown.output"), bounciness: 6, speed: 14 }),
    addPatch("tile_scale", "transition", "Tile Scale", { progress: link("intro_spring.output"), start: 0.6, end: 1 }, { typeParam: "number" }),
    addPatch("tile_opacity", "progress", "Tile Opacity", { value: link("intro_spring.output"), start: 0, end: 0.6, clampToRange: true }),
    connect("tile_scale.output", "@tile.scale"),
    connect("tile_opacity.progress", "@tile.opacity"),

    // Tap to pick: Selected Tile remembers which copy pulsed
    addPatch("tap_tile", "interaction", "Tap Tile", { layer: layerRef("tile") }),
    addPatch("selected_tile", "loopOptionSwitch", "Selected Tile", { select: link("tap_tile.tap") }),
    addPatch("is_selected", "equals", "Is Selected", { value1: link("tiles.index"), value2: link("selected_tile.option") }, { typeParam: "number" }),
    addPatch("select_spring", "popAnimation", "Select Spring", { number: link("is_selected.output"), bounciness: 4, speed: 16 }),
    addPatch("ring_width", "transition", "Ring Width", { progress: link("select_spring.output"), start: 0, end: 4 }, { typeParam: "number" }),
    connect("ring_width.output", "@tile.strokeWidth"),

    // The preview reads one item out of the color loop
    addPatch("selected_color", "loopSelect", "Selected Color", { loop: link("tile_colors.color"), index: link("selected_tile.option") }, { typeParam: "color" }),
    addPatch("preview_color", "popAnimation", "Preview Color", { number: link("selected_color.output"), bounciness: 0, speed: 12 }, { typeParam: "color" }),
    addPatch("preview_hex", "colorToHex", "Preview Hex", { color: link("selected_color.output") }),
    connect("preview_color.output", "@preview.color"),
    connect("preview_hex.hex", "@preview_label.text"),
  ],
};
