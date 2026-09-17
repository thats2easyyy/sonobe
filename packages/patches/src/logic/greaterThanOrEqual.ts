/** Greater Than or Equal: true when each value is greater than or equal to the next. */

import { defineChainComparison } from "./shared.ts";

export const greaterThanOrEqual = defineChainComparison("greaterThanOrEqual", (a, b) => a >= b);
