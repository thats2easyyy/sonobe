/**
 * lottie-web's SVG "light" build (no expressions) as its own script for the web player. player.ts
 * loads this file the first time a Lottie layer draws, so prototypes without Lottie layers never
 * download it.
 */

import lottie from "lottie-web/build/player/lottie_light";

(globalThis as { sonobeLottie?: unknown }).sonobeLottie = lottie;
