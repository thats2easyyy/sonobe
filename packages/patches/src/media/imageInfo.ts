/**
 * Image Info: a picture's natural size in points, pixel density (@2x, @3x), file name, aspect ratio,
 * and loading state, from the host's media info. A new picture keeps describing the previous one
 * until its info is ready.
 */

import type { AssetRef } from "@sonobe/core";
import { definePatch, logOnce, warnOnce } from "../infra/index.ts";
import { mediaInfoReader } from "./platform.ts";
import type { MediaInfo } from "./platform.ts";
import { isAssetRef, refKey, withMutedBehavior } from "./shared.ts";

interface Info {
  size: [number, number];
  scale: number;
  name: string;
  aspectRatio: number;
}

const EMPTY: Info = { size: [0, 0], scale: 1, name: "", aspectRatio: 0 };

/** Pixel density from a file name: "hero@2x.png" → 2, "hero@3x" → 3, otherwise undefined. */
export function densityFromName(name: string): number | undefined {
  const match = /@([23])x(\.[^./]*)?$/i.exec(name);
  return match ? Number(match[1]) : undefined;
}

/** A file name without its extension and density suffix: "hero@2x.png" → "hero". */
export function baseName(name: string): string {
  return name.replace(/\.[^.]*$/, "").replace(/@[23]x$/i, "");
}

/** The raw file name: the host's name, else a URL's last path segment (percent-decoded). */
export function rawNameOf(ref: AssetRef, info?: MediaInfo): string {
  if (info && typeof info.name === "string" && info.name !== "") return info.name;
  if (typeof ref.url !== "string" || /^(data|blob):/i.test(ref.url)) return "";
  const path = ref.url.split(/[?#]/)[0] ?? "";
  const segment = path.replace(/\/+$/, "").split("/").pop() ?? "";
  if (/^[a-z][a-z0-9+.-]*:$/i.test(segment)) return "";
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function describe(ref: AssetRef, info: MediaInfo): Info {
  const raw = rawNameOf(ref, info);
  const scale = densityFromName(raw) ?? 1;
  const w = Number.isFinite(info.width) && info.width > 0 ? info.width / scale : 0;
  const h = Number.isFinite(info.height) && info.height > 0 ? info.height / scale : 0;
  return { size: [w, h], scale, name: baseName(raw), aspectRatio: h > 0 ? w / h : 0 };
}

interface ImageInfoState {
  key: string;
  info: Info;
  loading: boolean;
}

export const imageInfoPatch = withMutedBehavior(
  definePatch<ImageInfoState>("imageInfo", {
    state: () => ({ key: "", info: EMPTY, loading: false }),
    evaluate(ctx) {
      const s = ctx.state;
      if (ctx.node.muted) {
        ctx.output("naturalSize", [0, 0]);
        ctx.output("scale", 1);
        ctx.output("name", "");
        ctx.output("aspectRatio", 0);
        ctx.output("loading", false);
        return;
      }
      const raw = ctx.input("image");
      const ref = isAssetRef(raw) ? raw : null;
      const key = refKey(ref);
      if (key !== s.key) {
        s.key = key;
        if (ref === null) {
          s.info = EMPTY;
          s.loading = false;
        } else {
          s.loading = true;
        }
      }
      if (s.loading && ref !== null) {
        const read = mediaInfoReader(ctx.services);
        if (!read) {
          logOnce(ctx, "log", "noMediaInfo", "imageInfo: this host can't describe pictures yet, so Image Info outputs empty values.");
          s.info = EMPTY;
          s.loading = false;
        } else {
          let info: MediaInfo | undefined;
          try {
            info = read(ref);
          } catch {
            info = undefined;
          }
          if (info?.status === "ready") {
            s.info = describe(ref, info);
            s.loading = false;
          } else if (info === undefined || info.status === "error") {
            s.info = { ...EMPTY, name: baseName(rawNameOf(ref, info)) };
            s.loading = false;
            warnOnce(ctx, `load:${key}`, `imageInfo: couldn't load the picture${s.info.name ? ` "${s.info.name}"` : ""}.`);
          } else {
            ctx.requestNextFrame();
          }
        }
      }
      ctx.output("naturalSize", [...s.info.size]);
      ctx.output("scale", s.info.scale);
      ctx.output("name", s.info.name);
      ctx.output("aspectRatio", s.info.aspectRatio);
      ctx.output("loading", s.loading);
    },
  }),
  "evaluate",
);
