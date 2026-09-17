/**
 * Photo Picker: opens the system photo picker on a pulse and outputs the chosen photos and videos
 * (first item plus whole loops). Evaluates once per frame; the picker's promise only stores its
 * result, which the next evaluate applies.
 */

import type { AssetRef } from "@sonobe/core";
import type { PickedMedia, RuntimeServices } from "@sonobe/engine";
import { definePatch, finiteOr, logOnce, loopOf, toBool, warnOnce } from "../infra/index.ts";
import { clampInt, describeError, enumOr, isAssetRef, releaseRef, warnLoopedInputs } from "./shared.ts";

interface PickRequest {
  id: number;
  result: { files: readonly unknown[]; error?: unknown } | null;
}

interface PickerState {
  items: PickedMedia[];
  requestId: number;
  pending: PickRequest | null;
  error: boolean;
  message: string;
}

const MEDIA_TYPES = ["all", "photos", "videos"] as const;

/** A host result as a PickedMedia item, or undefined when it isn't one. */
export function toPickedMedia(value: unknown): PickedMedia | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const kind = v.kind === "video" ? "video" : v.kind === "image" ? "image" : undefined;
  if (!kind) return undefined;
  const image = isAssetRef(v.image) ? v.image : null;
  const video = isAssetRef(v.video) ? v.video : null;
  if (!image && !video) return undefined;
  return {
    kind,
    image,
    video: kind === "video" ? video : null,
    width: Math.max(0, finiteOr(v.width, 0)),
    height: Math.max(0, finiteOr(v.height, 0)),
    name: typeof v.name === "string" ? v.name : "",
  };
}

function releaseItems(services: RuntimeServices, items: readonly unknown[]): void {
  for (const item of items) {
    const v = item as { image?: AssetRef | null; video?: AssetRef | null } | null;
    releaseRef(services, isAssetRef(v?.image) ? v.image : null);
    releaseRef(services, isAssetRef(v?.video) ? v.video : null);
  }
}

export const photoPickerPatch = definePatch<PickerState>("photoPicker", {
  mutedBehavior: "zero",
  state: () => ({ items: [], requestId: 0, pending: null, error: false, message: "" }),
  evaluate(ctx) {
    const s = ctx.state;
    warnLoopedInputs(ctx, ["open", "mediaType", "multiple", "reset", "maxCount"], "photoPicker");
    let picked = false;
    const request = s.pending;
    if (request?.result && request.id === s.requestId) {
      s.pending = null;
      const { files, error } = request.result;
      if (error !== undefined) {
        s.error = true;
        s.message = describeError(error) || "The picker couldn't be used.";
        releaseItems(ctx.services, files);
      } else if (files.length > 0) {
        const multiple = toBool(ctx.input("multiple"));
        const limit = multiple ? clampInt(ctx.input("maxCount"), 10, 1, 100) : 1;
        const accept = enumOr(ctx.input("mediaType"), MEDIA_TYPES, "all");
        const matching = files
          .map(toPickedMedia)
          .filter((item): item is PickedMedia => item !== undefined && (accept === "all" || (accept === "photos" ? item.kind === "image" : item.kind === "video")));
        if (multiple && matching.length > limit) warnOnce(ctx, "maxCount", `photoPicker: kept the first ${limit} items; Max Count drops the rest.`);
        const kept = matching.slice(0, limit);
        releaseItems(
          ctx.services,
          files.filter((f) => !kept.some((k) => k.image === (f as PickedMedia)?.image && k.video === (f as PickedMedia)?.video)),
        );
        if (kept.length === 0) {
          s.error = true;
          s.message = "That file isn't a kind this picker accepts.";
        } else {
          releaseItems(ctx.services, s.items);
          s.items = kept;
          s.error = false;
          s.message = "";
          picked = true;
        }
      }
    }
    if (ctx.pulsed("reset")) {
      s.requestId++;
      s.pending = null;
      releaseItems(ctx.services, s.items);
      s.items = [];
      s.error = false;
      s.message = "";
    } else if (ctx.pulsed("open") && s.pending === null) {
      const platform = ctx.services.platform;
      if (typeof platform.pickMedia !== "function") {
        logOnce(ctx, "log", "noPicker", "photoPicker: no file picker in simulation");
      } else {
        const r: PickRequest = { id: ++s.requestId, result: null };
        s.pending = r;
        const options = { accept: enumOr(ctx.input("mediaType"), MEDIA_TYPES, "all"), multiple: toBool(ctx.input("multiple")) };
        let promise: Promise<readonly unknown[]>;
        try {
          promise = Promise.resolve(platform.pickMedia(options));
        } catch (error) {
          promise = Promise.reject(error);
        }
        const services = ctx.services;
        promise.then(
          (files) => {
            r.result = { files: Array.isArray(files) ? files : [] };
            if (r.id !== s.requestId) releaseItems(services, r.result.files);
          },
          (error: unknown) => {
            r.result = { files: [], error: error ?? "The picker couldn't be used." };
          },
        );
      }
    }
    if (s.pending) ctx.requestNextFrame();
    const first = s.items[0];
    ctx.output("image", first?.image ?? null);
    ctx.output("video", first?.video ?? null);
    ctx.output("isVideo", first?.kind === "video");
    ctx.output("naturalSize", first ? [first.width, first.height] : [0, 0]);
    ctx.output("images", loopOf(s.items.map((item) => item.image)));
    ctx.output("videos", loopOf(s.items.map((item) => item.video)));
    ctx.output("count", s.items.length);
    ctx.output("loading", s.pending !== null);
    ctx.output("error", s.error);
    ctx.output("errorMessage", s.message);
    if (picked) ctx.pulse("picked");
  },
  dispose(state, services) {
    if (!state) return;
    state.requestId++;
    state.pending = null;
    releaseItems(services, state.items);
    state.items = [];
  },
});
