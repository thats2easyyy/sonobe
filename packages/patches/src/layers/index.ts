import type { PatchDefinition } from "@sonobe/engine";
import { blurEffect } from "./blurEffect.ts";
import { colorControlsEffect } from "./colorControlsEffect.ts";
import { convertPosition } from "./convertPosition.ts";
import { glassEffect } from "./glassEffect.ts";
import { layerInfo } from "./layerInfo.ts";

export const definitions: PatchDefinition[] = [layerInfo, convertPosition, blurEffect, colorControlsEffect, glassEffect];
