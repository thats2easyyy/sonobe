import type { PatchDefinition } from "@sonobe/engine";
import { doubleTap } from "./doubleTap.ts";
import { drag } from "./drag.ts";
import { gesture } from "./gesture.ts";
import { hover } from "./hover.ts";
import { interaction } from "./interaction.ts";
import { keyboard } from "./keyboard.ts";
import { longPress } from "./longPress.ts";
import { momentumScrolling } from "./momentumScrolling.ts";
import { mouse } from "./mouse.ts";
import { popSwitch } from "./popSwitch.ts";
import { scroll } from "./scroll.ts";
import { swipe } from "./swipe.ts";
import { tapToggle } from "./tapToggle.ts";
import { touches } from "./touches.ts";

/** Interaction patches, in catalog order. */
export const definitions: PatchDefinition[] = [
  interaction,
  gesture,
  swipe,
  longPress,
  doubleTap,
  tapToggle,
  hover,
  keyboard,
  drag,
  scroll,
  mouse,
  touches,
  popSwitch,
  momentumScrolling,
];
