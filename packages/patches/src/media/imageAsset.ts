/**
 * Image: outputs a picture reference from a project asset or, when URL isn't empty, a loadable web
 * address. Missing assets and unsupported URL schemes output null. Stateless.
 */

import type { PatchContext } from "@sonobe/engine";
import { definePatch, toText, warnOnce } from "../infra/index.ts";
import { assetExists, isAssetRef, isLoadableUrl } from "./shared.ts";

/** Shared by Image and Video: the URL override, else an existing asset reference, else null. */
export function evaluateAssetReference(ctx: PatchContext, kind: "image" | "video", patchName: string): void {
  const url = toText(ctx.input("url")).trim();
  if (url !== "") {
    if (isLoadableUrl(url, kind)) {
      ctx.output("output", { url });
    } else {
      warnOnce(ctx, "badUrl", `${patchName}: URL isn't a web address it can load (use http:, https:, blob:, or a data: ${kind}), so it outputs nothing.`);
      ctx.output("output", null);
    }
    return;
  }
  const ref = ctx.input(kind);
  ctx.output("output", isAssetRef(ref) && assetExists(ctx, ref) ? ref : null);
}

export const imageAssetPatch = definePatch("imageAsset", {
  evaluate(ctx) {
    evaluateAssetReference(ctx, "image", "Image");
  },
});
