/** Point 3D: packs X, Y, and Z into a 3D point. */

import { definePack } from "./packing.ts";

export const point3d = definePack("point3d", ["x", "y", "z"], (id) => `${id}: a component isn't a finite number, so Point 3D uses 0 for it`);
