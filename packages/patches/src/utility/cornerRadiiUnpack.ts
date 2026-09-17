/** Corner Radii Unpack: splits a Corner Radii value into each corner's radius. */

import { defineUnpack } from "./packing.ts";

export const cornerRadiiUnpack = defineUnpack(
  "cornerRadiiUnpack",
  ["topLeft", "topRight", "bottomRight", "bottomLeft"],
  (id) => `${id}: Value has a radius that isn't a finite number, so it outputs 0`,
);
