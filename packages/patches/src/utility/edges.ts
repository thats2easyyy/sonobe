/** Edges: packs four side distances in top, right, bottom, left order (the `padding` layer prop's order). */

import { definePack } from "./packing.ts";

export const edges = definePack("edges", ["top", "right", "bottom", "left"], (id) => `${id}: a side isn't a finite number, so Edges uses 0 for it`);
