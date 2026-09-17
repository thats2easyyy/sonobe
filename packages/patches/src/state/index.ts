/** State & Time patches: switches, counters, options, pulses, delays, timers, and clocks. */

import type { PatchDefinition } from "@sonobe/engine";
import { counterPatch } from "./counter.ts";
import { delayPatch } from "./delay.ts";
import { delay1Patch } from "./delay1.ts";
import { optionEqualsPatch } from "./optionEquals.ts";
import { optionPickerPatch } from "./optionPicker.ts";
import { optionSenderPatch } from "./optionSender.ts";
import { optionSwitchPatch } from "./optionSwitch.ts";
import { pulsePatch } from "./pulse.ts";
import { pulseOnChangePatch } from "./pulseOnChange.ts";
import { repeatingPulsePatch } from "./repeatingPulse.ts";
import { sampleAndHoldPatch } from "./sampleAndHold.ts";
import { stopwatchPatch } from "./stopwatch.ts";
import { switchPatch } from "./switch.ts";
import { timePatch } from "./time.ts";
import { waitPatch } from "./wait.ts";
import { whenPrototypeStartsPatch } from "./whenPrototypeStarts.ts";

export {
  counterPatch,
  delay1Patch,
  delayPatch,
  optionEqualsPatch,
  optionPickerPatch,
  optionSenderPatch,
  optionSwitchPatch,
  pulseOnChangePatch,
  pulsePatch,
  repeatingPulsePatch,
  sampleAndHoldPatch,
  stopwatchPatch,
  switchPatch,
  timePatch,
  waitPatch,
  whenPrototypeStartsPatch,
};

/** Every state patch in catalog order. */
export const definitions: PatchDefinition[] = [
  switchPatch,
  counterPatch,
  pulsePatch,
  pulseOnChangePatch,
  whenPrototypeStartsPatch,
  sampleAndHoldPatch,
  optionSwitchPatch,
  optionPickerPatch,
  optionSenderPatch,
  optionEqualsPatch,
  delayPatch,
  delay1Patch,
  waitPatch,
  repeatingPulsePatch,
  timePatch,
  stopwatchPatch,
];
