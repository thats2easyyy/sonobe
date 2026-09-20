/**
 * Captures placemark-discover.html into capture.json and downloads its photos into photos/, the way
 * import_design would, so examples/build.ts can import the design offline and get the same layers
 * every time. It needs Playwright's Chromium and the network (the photos come from Wikimedia
 * Commons), and text sizes follow this computer's fonts, so run it only when the design changes:
 *
 *   node examples/16-placemark-deck/design/capture.ts
 *
 * Then rebuild with node examples/build.ts 16-placemark-deck. photos.json names every photo's file and
 * credit; a photo the page shows that photos.json doesn't list stops the capture.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { capturePage } from "@sonobe/import/node";
import { readDesignPhotos } from "../../lib/design.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, "placemark-discover.html"), "utf8");
const photos = readDesignPhotos(path.join(here, "photos.json"));

const result = await capturePage({ html, width: 402, height: 874 });
if (result.notes?.length) process.stdout.write(`${result.notes.join("\n")}\n`);
mkdirSync(path.join(here, "photos"), { recursive: true });
for (const [key, source] of Object.entries(result.capture.images)) {
  if (source.url.startsWith("data:")) continue;
  const photo = photos.get(new URL(source.url).href);
  if (!photo) throw new Error(`The page shows ${source.url}, which photos.json doesn't list. Add its file and credit there.`);
  const image = result.images.get(key);
  if (!image) throw new Error(`${photo.file} (${source.url}) didn't download. Check the network and try again.`);
  writeFileSync(path.join(here, photo.file), image.bytes);
}
writeFileSync(path.join(here, "capture.json"), `${JSON.stringify(result.capture, null, 1)}\n`);
process.stdout.write(`✓ capture.json and ${photos.size} photos\n`);
