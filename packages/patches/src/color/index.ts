import type { PatchDefinition } from "@sonobe/engine";
import { colorToHexPatch } from "./colorToHex.ts";
import { colorToHslPatch } from "./colorToHsl.ts";
import { colorToRgbPatch } from "./colorToRgb.ts";
import { gradientBuilderPatch } from "./gradientBuilder.ts";
import { hexColorPatch } from "./hexColor.ts";
import { hslColorPatch } from "./hslColor.ts";
import { rgbColorPatch } from "./rgbColor.ts";

export { colorToHexPatch, colorToHslPatch, colorToRgbPatch, gradientBuilderPatch, hexColorPatch, hslColorPatch, rgbColorPatch };

/** Built-in color patches, in catalog order. */
export const definitions: PatchDefinition[] = [hexColorPatch, rgbColorPatch, hslColorPatch, colorToHexPatch, colorToRgbPatch, colorToHslPatch, gradientBuilderPatch];
