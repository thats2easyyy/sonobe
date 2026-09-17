/**
 * Video: outputs a clip reference from a project asset or, when URL isn't empty, a loadable web
 * address. Missing assets and unsupported URL schemes output null. Stateless.
 */

import { definePatch } from "../infra/index.ts";
import { evaluateAssetReference } from "./imageAsset.ts";

export const videoAssetPatch = definePatch("videoAsset", {
  evaluate(ctx) {
    evaluateAssetReference(ctx, "video", "Video");
  },
});
