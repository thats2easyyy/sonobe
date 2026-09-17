/** Point 4D: packs X, Y, Z, and W into a 4D point. */

import { definePack } from "./packing.ts";

export const point4d = definePack("point4d", ["x", "y", "z", "w"], (id) => `${id}: a component isn't a finite number, so Point 4D uses 0 for it`);
