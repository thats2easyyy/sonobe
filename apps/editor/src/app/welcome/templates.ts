/**
 * Templates for the welcome screen: the bundled examples in folder order, with thumbnails rendered
 * headlessly by apps/editor/scripts/generate-thumbnails.mjs into ./thumbnails/<folder>.png.
 */

import { getExamples, type ExampleProject } from "../../panels/learn/examples.ts";

const THUMBNAILS = import.meta.glob("./thumbnails/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

export function thumbnailFor(folder: string, thumbnails: Record<string, string> = THUMBNAILS): string | undefined {
  return thumbnails[`./thumbnails/${folder}.png`];
}

/** Examples ordered the way the examples README teaches them (01, 02, …). */
export function orderTemplates(examples: readonly ExampleProject[]): ExampleProject[] {
  return [...examples].sort((a, b) => a.folder.localeCompare(b.folder, undefined, { numeric: true }));
}

export function getTemplates(): ExampleProject[] {
  return orderTemplates(getExamples());
}

/** What each template shows, in a few words that fit a card on one line. The full description stays in the card's tooltip. */
const TEMPLATE_TAGS: Record<string, string> = {
  "01-tap-to-grow": "Springs bigger on tap",
  "02-like-toggle": "Tap or double-tap to like",
  "03-scrolling-list": "Scroll with momentum",
  "04-carousel-paging": "Swipe one page at a time",
  "05-tab-bar": "Tabs with sliding screens",
  "06-collapsing-header": "Shrinking scroll header",
  "07-pull-to-refresh": "Pull down to refresh",
  "08-bottom-sheet": "Drag and flick a sheet",
  "09-drag-and-snap": "Fling a tile to a corner",
  "10-swipe-cards": "Throw cards to decide",
  "11-long-press-menu": "Hold to open a menu",
  "12-timed-sequence": "Staged confirmation",
  "13-stories": "Auto-advancing stories",
  "14-onboarding": "Three-page onboarding",
  "15-grid-with-loops": "Tiles from one loop",
  "16-placemark-deck": "Vote by throwing cards",
};

/** The tag under a template's name; an example without one gets the first sentence of its description. */
export function templateTag(example: Pick<ExampleProject, "id" | "description">): string {
  return TEMPLATE_TAGS[example.id] ?? example.description.split(/(?<=[.!?])\s/)[0] ?? "";
}
