/** Less Than or Equal: true when each value is less than or equal to the next. */

import { defineChainComparison } from "./shared.ts";

export const lessThanOrEqual = defineChainComparison("lessThanOrEqual", (a, b) => a <= b);
