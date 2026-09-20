/**
 * Stored designs for recipes that start from an import (Recipe.design): a DesignCapture JSON as
 * capturePage wrote it, plus a photo list saying which file under the example holds each http(s)
 * image the capture downloaded, and whose photo it is. Node only; building never touches the network.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCapture, resolveCaptureFiles, type DesignCapture, type ResolvedImage } from "@sonobe/import";
import { EXAMPLES_DIR } from "./disk.ts";

/** One photo of a stored design, with the credit its license asks for. */
export interface DesignPhoto {
  /** The place or screen it illustrates ("Leonard's Bakery"). */
  place: string;
  /** Its alt text in the page, which names the asset ("Malasadas" → malasadas). */
  name: string;
  /** Relative to the photo list's folder ("photos/malasadas.jpg"). */
  file: string;
  /** The image URL in the page and the capture. */
  url: string;
  /** Where it's published ("https://commons.wikimedia.org/wiki/File:…"). */
  page: string;
  artist: string;
  license: string;
  licenseUrl: string;
}

/** A photo list (see the module comment) by image URL. Throws when the file isn't one. */
export function readDesignPhotos(file: string): Map<string, DesignPhoto> {
  const json = JSON.parse(readFileSync(file, "utf8")) as { photos?: DesignPhoto[] };
  if (!Array.isArray(json.photos)) throw new Error(`${file} needs a "photos" list of { file, url, page, artist, license, licenseUrl }.`);
  return new Map(json.photos.map((photo) => [new URL(photo.url).href, photo]));
}

export interface LoadedDesign {
  capture: DesignCapture;
  /** Bytes by capture image key, as planImport takes them. */
  images: Map<string, ResolvedImage | null>;
}

/**
 * Read a stored capture and resolve its images offline: data: URLs decode in place, http(s) URLs
 * read the files the photo list names. Paths are relative to examples/. Throws naming the image
 * when one has no file.
 */
export async function loadDesign(design: { capture: string; photos: string }): Promise<LoadedDesign> {
  const capture = parseCapture(JSON.parse(readFileSync(path.join(EXAMPLES_DIR, design.capture), "utf8")));
  const listFile = path.join(EXAMPLES_DIR, design.photos);
  const photos = readDesignPhotos(listFile);
  const missing: string[] = [];
  const images = await resolveCaptureFiles(capture, {
    fetch: async (url) => {
      const photo = photos.get(new URL(url).href);
      if (!photo) {
        missing.push(url);
        return null;
      }
      return { bytes: new Uint8Array(readFileSync(path.join(path.dirname(listFile), photo.file))), mime: "" };
    },
  });
  if (missing.length) throw new Error(`${design.photos} has no file for ${missing.join(", ")}. Run the design's capture script again, or add the photo.`);
  const unresolved = [...images].filter(([, image]) => !image).map(([key]) => capture.images[key]?.url ?? key);
  if (unresolved.length) throw new Error(`${design.capture}: couldn't read ${unresolved.join(", ")}.`);
  return { capture, images };
}
