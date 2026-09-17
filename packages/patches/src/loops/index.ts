import type { PatchDefinition } from "@sonobe/engine";
import { gridLayoutPatch } from "./gridLayout.ts";
import { loopPatch } from "./loop.ts";
import { loopAllPatch } from "./loopAll.ts";
import { loopAnyPatch } from "./loopAny.ts";
import { loopAppendPatch } from "./loopAppend.ts";
import { loopBuilderPatch } from "./loopBuilder.ts";
import { loopCountPatch } from "./loopCount.ts";
import { loopDedupePatch } from "./loopDedupe.ts";
import { loopFilterPatch } from "./loopFilter.ts";
import { loopInsertPatch } from "./loopInsert.ts";
import { loopOptionSwitchPatch } from "./loopOptionSwitch.ts";
import { loopOverArrayPatch } from "./loopOverArray.ts";
import { loopRemovePatch } from "./loopRemove.ts";
import { loopRemoveLastPatch } from "./loopRemoveLast.ts";
import { loopReversePatch } from "./loopReverse.ts";
import { loopSelectPatch } from "./loopSelect.ts";
import { loopShufflePatch } from "./loopShuffle.ts";
import { loopSumPatch } from "./loopSum.ts";
import { loopToArrayPatch } from "./loopToArray.ts";
import { runningTotalPatch } from "./runningTotal.ts";

export {
  gridLayoutPatch,
  loopAllPatch,
  loopAnyPatch,
  loopAppendPatch,
  loopBuilderPatch,
  loopCountPatch,
  loopDedupePatch,
  loopFilterPatch,
  loopInsertPatch,
  loopOptionSwitchPatch,
  loopOverArrayPatch,
  loopPatch,
  loopRemoveLastPatch,
  loopRemovePatch,
  loopReversePatch,
  loopSelectPatch,
  loopShufflePatch,
  loopSumPatch,
  loopToArrayPatch,
  runningTotalPatch,
};

/** Every loops-category definition, in catalog order. */
export const definitions: PatchDefinition[] = [
  loopPatch,
  loopBuilderPatch,
  loopCountPatch,
  loopSelectPatch,
  loopOptionSwitchPatch,
  loopAnyPatch,
  loopAllPatch,
  loopFilterPatch,
  loopSumPatch,
  runningTotalPatch,
  gridLayoutPatch,
  loopReversePatch,
  loopShufflePatch,
  loopDedupePatch,
  loopInsertPatch,
  loopAppendPatch,
  loopRemovePatch,
  loopRemoveLastPatch,
  loopToArrayPatch,
  loopOverArrayPatch,
];
