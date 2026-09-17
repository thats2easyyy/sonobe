/** Point 3D Unpack: splits a 3D point into X, Y, and Z. */

import { defineUnpack } from "./packing.ts";

export const point3dUnpack = defineUnpack(
  "point3dUnpack",
  ["x", "y", "z"],
  (id) => `${id}: Value has a component that isn't a finite number, so it outputs 0`,
);
