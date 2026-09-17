/** Size: packs Width and Height into a size. */

import { definePack } from "./packing.ts";

export const size = definePack("size", ["width", "height"], (id) => `${id} got a value that isn't a finite number and used 0`);
