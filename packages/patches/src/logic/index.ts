import type { PatchDefinition } from "@sonobe/engine";
import { and } from "./and.ts";
import { equals } from "./equals.ts";
import { equalsExactly } from "./equalsExactly.ts";
import { greaterThan } from "./greaterThan.ts";
import { greaterThanOrEqual } from "./greaterThanOrEqual.ts";
import { ifElse } from "./ifElse.ts";
import { inRange } from "./inRange.ts";
import { lessThan } from "./lessThan.ts";
import { lessThanOrEqual } from "./lessThanOrEqual.ts";
import { not } from "./not.ts";
import { or } from "./or.ts";

/** Logic patches in catalog order. */
export const definitions: PatchDefinition[] = [and, or, not, equals, equalsExactly, greaterThan, greaterThanOrEqual, lessThan, lessThanOrEqual, ifElse, inRange];
