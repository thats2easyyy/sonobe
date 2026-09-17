import type { PatchDefinition } from "@sonobe/engine";
import { changeCasePatch } from "./changeCase.ts";
import { formatDateTimePatch } from "./formatDateTime.ts";
import { formatNumberPatch } from "./formatNumber.ts";
import { measureTextPatch } from "./measureText.ts";
import { splitTextPatch } from "./splitText.ts";
import { substringPatch } from "./substring.ts";
import { textContainsPatch } from "./textContains.ts";
import { textEndsWithPatch } from "./textEndsWith.ts";
import { textLengthPatch } from "./textLength.ts";
import { textReplacePatch } from "./textReplace.ts";
import { textStartsWithPatch } from "./textStartsWith.ts";

export {
  changeCasePatch,
  formatDateTimePatch,
  formatNumberPatch,
  measureTextPatch,
  splitTextPatch,
  substringPatch,
  textContainsPatch,
  textEndsWithPatch,
  textLengthPatch,
  textReplacePatch,
  textStartsWithPatch,
};

/** Built-in text patches, in catalog order. */
export const definitions: PatchDefinition[] = [
  formatNumberPatch,
  textLengthPatch,
  splitTextPatch,
  textStartsWithPatch,
  textEndsWithPatch,
  textContainsPatch,
  textReplacePatch,
  changeCasePatch,
  substringPatch,
  measureTextPatch,
  formatDateTimePatch,
];
