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
