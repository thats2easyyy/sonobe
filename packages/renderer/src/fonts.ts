/**
 * Font assets on screen: registers a FontFace for every font asset that names its face (AssetRecord.font),
 * so text layers whose Font names that family draw with it. DomTextMeasurer re-measures once the fonts
 * load. Call sync with each new document; faces for removed assets are taken away.
 */

import type { AssetRecord, Id } from "@sonobe/core";

export interface FontAssetRegistry {
  sync(assets: Readonly<Record<Id, AssetRecord>>): void;
  dispose(): void;
}

interface FontFaceSetLike {
  add(face: FontFace): unknown;
  delete(face: FontFace): unknown;
}

export function createFontAssetRegistry(resolveAssetUrl: (assetId: Id) => string | undefined, doc: Document | undefined = typeof document === "undefined" ? undefined : document): FontAssetRegistry {
  const fonts = (doc as (Document & { fonts?: FontFaceSetLike }) | undefined)?.fonts;
  const FontFaceCtor = (doc?.defaultView as (Window & { FontFace?: typeof FontFace }) | null | undefined)?.FontFace;
  const faces = new Map<string, FontFace>();
  return {
    sync(assets) {
      if (!fonts || typeof FontFaceCtor !== "function") return;
      const wanted = new Set<string>();
      for (const record of Object.values(assets)) {
        if (record.kind !== "font" || !record.font?.family) continue;
        const url = resolveAssetUrl(record.id);
        if (!url) continue;
        const key = JSON.stringify([record.id, record.file, url, record.font]);
        wanted.add(key);
        if (faces.has(key)) continue;
        const descriptors: FontFaceDescriptors = {};
        if (record.font.weight) descriptors.weight = record.font.weight;
        if (record.font.style) descriptors.style = record.font.style;
        if (record.font.unicodeRange) descriptors.unicodeRange = record.font.unicodeRange;
        let face: FontFace;
        try {
          face = new FontFaceCtor(record.font.family, `url("${url.replace(/["\\\n]/g, (c) => (c === "\n" ? "" : `\\${c}`))}")`, descriptors);
        } catch {
          continue;
        }
        faces.set(key, face);
        fonts.add(face);
        face.load().catch(() => undefined);
      }
      for (const [key, face] of faces) {
        if (wanted.has(key)) continue;
        fonts.delete(face);
        faces.delete(key);
      }
    },
    dispose() {
      if (fonts) for (const face of faces.values()) fonts.delete(face);
      faces.clear();
    },
  };
}
