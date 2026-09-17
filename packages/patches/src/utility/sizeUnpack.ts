/** Size Unpack: splits a size into Width and Height. */

import { defineUnpack } from "./packing.ts";

export const sizeUnpack = defineUnpack("sizeUnpack", ["width", "height"], (id) => `${id} got a value that isn't a finite number and used 0`);
