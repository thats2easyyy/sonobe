/** Point: packs X and Y into a 2D point. */

import { definePack } from "./packing.ts";

export const point = definePack("point", ["x", "y"], (id) => `${id} got a value that isn't a finite number and used 0`);
