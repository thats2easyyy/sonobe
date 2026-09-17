import type { PatchDefinition } from "@sonobe/engine";
import { bluetoothLePatch } from "./bluetoothLe.ts";
import { deviceInfoPatch } from "./deviceInfo.ts";
import { deviceMotionPatch } from "./deviceMotion.ts";
import { deviceTimePatch } from "./deviceTime.ts";
import { gameControllerPatch } from "./gameController.ts";
import { hapticPatch } from "./haptic.ts";
import { interfaceOrientationPatch } from "./interfaceOrientation.ts";
import { locationPatch } from "./location.ts";
import { softKeyboardPatch } from "./softKeyboard.ts";
import { textToSpeechPatch } from "./textToSpeech.ts";
import { vibratePatch } from "./vibrate.ts";

export {
  bluetoothLePatch,
  deviceInfoPatch,
  deviceMotionPatch,
  deviceTimePatch,
  gameControllerPatch,
  hapticPatch,
  interfaceOrientationPatch,
  locationPatch,
  softKeyboardPatch,
  textToSpeechPatch,
  vibratePatch,
};

/** Every device-category definition, in catalog order. */
export const definitions: PatchDefinition[] = [
  deviceInfoPatch,
  deviceMotionPatch,
  deviceTimePatch,
  vibratePatch,
  textToSpeechPatch,
  hapticPatch,
  locationPatch,
  gameControllerPatch,
  interfaceOrientationPatch,
  softKeyboardPatch,
  bluetoothLePatch,
];
