/** Divide: divides Value 1 by each later input; a zero divisor outputs 0 and warns once. */

import { defineArithmetic } from "./shared.ts";

export const divide = defineArithmetic("divide", "divide");
