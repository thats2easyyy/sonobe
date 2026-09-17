/** Edges Unpack: splits an Edges value into top, right, bottom, and left. */

import { defineUnpack } from "./packing.ts";

export const edgesUnpack = defineUnpack(
  "edgesUnpack",
  ["top", "right", "bottom", "left"],
  (id) => `${id}: Value has a side that isn't a finite number, so it outputs 0`,
);
