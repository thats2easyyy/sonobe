/** Corner Radii: packs four radii clockwise from the top left (the `cornerRadii` layer prop's order). */

import { definePack } from "./packing.ts";

export const cornerRadii = definePack(
  "cornerRadii",
  ["topLeft", "topRight", "bottomRight", "bottomLeft"],
  (id) => `${id}: a radius isn't a finite number, so Corner Radii uses 0 for it`,
);
