/**
 * Snapshot: captures a layer (or the whole screen) as a picture on a pulse through the host's
 * renderer. Only the newest capture's result applies; a failure keeps the previous picture.
 */

import type { AssetRef } from "@sonobe/core";
import { definePatch, logOnce, warnOnce } from "../infra/index.ts";
import { mediaPlatform } from "./platform.ts";
import { describeError, isAssetRef, isLayerRef, releaseRef, withMutedBehavior } from "./shared.ts";

interface SnapshotRequest {
  id: number;
  result: { image: AssetRef | null; message: string } | null;
}

interface SnapshotState {
  image: AssetRef | null;
  requestId: number;
  pending: SnapshotRequest | null;
}

export const snapshotPatch = withMutedBehavior(
  definePatch<SnapshotState>("snapshot", {
    state: () => ({ image: null, requestId: 0, pending: null }),
    evaluate(ctx) {
      const s = ctx.state;
      let captured = false;
      const request = s.pending;
      if (request?.result && request.id === s.requestId) {
        s.pending = null;
        if (request.result.image) {
          releaseRef(ctx.services, s.image);
          s.image = request.result.image;
          captured = true;
        } else {
          warnOnce(ctx, `failed:${request.result.message}`, `snapshot: ${request.result.message}`);
        }
      }
      if (ctx.pulsed("capture")) {
        const platform = mediaPlatform(ctx.services);
        if (typeof platform.snapshot !== "function") {
          logOnce(ctx, "log", "noRenderer", "snapshot: no renderer in simulation");
        } else {
          const r: SnapshotRequest = { id: ++s.requestId, result: null };
          s.pending = r;
          const raw = ctx.input("layer");
          const layer = isLayerRef(raw) ? raw : null;
          const scale = ctx.services.device().screenScale;
          const services = ctx.services;
          let promise: Promise<unknown>;
          try {
            promise = Promise.resolve(platform.snapshot(layer, { scale: Number.isFinite(scale) && scale > 0 ? scale : 1 }));
          } catch (error) {
            promise = Promise.reject(error);
          }
          promise.then(
            (image) => {
              const ref = isAssetRef(image) ? image : null;
              r.result = { image: ref, message: ref ? "" : "the capture returned no picture" };
              if (r.id !== s.requestId) releaseRef(services, ref);
            },
            (error: unknown) => {
              r.result = { image: null, message: describeError(error) };
            },
          );
        }
      }
      if (s.pending) ctx.requestNextFrame();
      ctx.output("image", s.image);
      if (captured) ctx.pulse("captured");
    },
    dispose(state, services) {
      if (!state) return;
      state.requestId++;
      state.pending = null;
      releaseRef(services, state.image);
      state.image = null;
    },
  }),
  "zero",
);
