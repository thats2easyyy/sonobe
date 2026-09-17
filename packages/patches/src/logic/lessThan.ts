/** Less Than: true when each value is less than the next. */

import { defineChainComparison } from "./shared.ts";

export const lessThan = defineChainComparison("lessThan", (a, b) => a < b);
