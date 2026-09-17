/** Greater Than: true when each value is greater than the next. */

import { defineChainComparison } from "./shared.ts";

export const greaterThan = defineChainComparison("greaterThan", (a, b) => a > b);
