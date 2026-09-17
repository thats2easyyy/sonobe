/** Array Append: adds items to the end of a JSON array on a pulse, remembering them per index. */

import { MAX_LOOP_LENGTH, definePatch } from "../infra/index.ts";
import { jsonEqual, portJson, variantOf } from "./shared.ts";

/** Most items Array Append remembers per loop index. */
export const MAX_APPENDED_ITEMS = MAX_LOOP_LENGTH;

export interface ArrayAppendState {
  seeded: boolean;
  base: unknown;
  items: unknown[];
  output: unknown[];
  warned: boolean;
}

export const arrayAppend = definePatch<ArrayAppendState>("arrayAppend", {
  state: () => ({ seeded: false, base: undefined, items: [], output: [], warned: false }),
  evaluate(ctx) {
    const s = ctx.state;
    const input = ctx.input("array");
    let dirty = false;
    if (!s.seeded || (input !== s.base && !jsonEqual(input, s.base))) {
      s.seeded = true;
      s.base = input;
      s.items = [];
      dirty = true;
    }
    if (ctx.pulsed("reset") && s.items.length > 0) {
      s.items = [];
      dirty = true;
    }
    if (ctx.pulsed("append")) {
      if (s.items.length < MAX_APPENDED_ITEMS) {
        s.items.push(portJson(ctx, ctx.input("item"), variantOf(ctx, arrayAppend)));
        dirty = true;
      } else if (!s.warned) {
        s.warned = true;
        ctx.services.log("warn", `${ctx.id}: Array Append holds at most 10,000 appended items.`);
      }
    }
    if (dirty) s.output = [...(Array.isArray(s.base) ? s.base : []), ...s.items];
    ctx.output("output", s.output);
  },
});
