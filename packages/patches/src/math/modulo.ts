/** Modulo: wraps Value 1 by each later input with floored modulo (the result has the divisor's sign). */

import { defineArithmetic } from "./shared.ts";

export const modulo = defineArithmetic("modulo", "modulo");
