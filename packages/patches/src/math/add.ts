/** Add: adds its inputs top to bottom (component-wise for vectors), or joins text. */

import { defineArithmetic } from "./shared.ts";

export const add = defineArithmetic("add", "add");
