/** Point 4D Unpack: splits a 4D point (or a color's RGBA) into X, Y, Z, and W. */

import { defineUnpack } from "./packing.ts";

export const point4dUnpack = defineUnpack(
  "point4dUnpack",
  ["x", "y", "z", "w"],
  (id) => `${id}: Value has a component that isn't a finite number, so it outputs 0`,
);
