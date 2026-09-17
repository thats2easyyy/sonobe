/** JSON to Text: writes any JSON value as standard JSON text, pretty or compact. */

import { definePatch, toBool, toJson } from "../infra/index.ts";
import { warnIndexed } from "./shared.ts";

export interface JsonToTextState {
  has: boolean;
  input: unknown;
  pretty: boolean;
  text: string;
}

export const jsonToText = definePatch<JsonToTextState>("jsonToText", {
  state: () => ({ has: false, input: undefined, pretty: false, text: "" }),
  evaluate(ctx) {
    const s = ctx.state;
    const input = ctx.input("json");
    const pretty = toBool(ctx.input("pretty"));
    if (!s.has || input !== s.input || pretty !== s.pretty) {
      let text: string;
      try {
        text = JSON.stringify(toJson(input), null, pretty ? 2 : undefined) ?? "null";
      } catch {
        text = "";
        warnIndexed(ctx, "cycle", "JSON to Text can't write a value that contains itself.");
      }
      s.has = true;
      s.input = input;
      s.pretty = pretty;
      s.text = text;
    }
    ctx.output("text", s.text);
  },
});
