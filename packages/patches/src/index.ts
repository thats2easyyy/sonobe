/**
 * @sonobe/patches: the built-in patch library. Specs come straight from the catalog JSON
 * (packages/patches/catalog), category modules attach evaluators with definePatch, and the
 * registry gives unimplemented types friendly fallbacks. Implementer helpers live under `infra`.
 */

export * from "./specs.ts";
export * from "./registry.ts";
export { definePatch } from "./infra/definePatch.ts";
export type { PatchImplementation } from "./infra/definePatch.ts";
export {
  CATEGORY_DESCRIPTIONS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  STATUS_LABELS,
  TIER_LABELS,
  renderPatchReference,
  renderReferenceFiles,
  renderReferenceIndex,
} from "./infra/reference.ts";
export * as infra from "./infra/index.ts";
