/** Point Unpack: splits a 2D point into X and Y. */

import { defineUnpack } from "./packing.ts";

export const pointUnpack = defineUnpack("pointUnpack", ["x", "y"], (id) => `${id} got a value that isn't a finite number and used 0`);
