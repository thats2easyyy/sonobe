/** Text to JSON: parses JSON text strictly, reporting invalid text instead of holding old data. */

import { definePatch, toText } from "../infra/index.ts";
import { errorText, stripBom, withMutedBehavior } from "./shared.ts";

/** Every Text to JSON error message starts with this. */
export const TEXT_TO_JSON_ERROR_PREFIX = "Text isn't valid JSON: ";

export interface TextToJsonState {
  has: boolean;
  text: string;
  json: unknown;
  error: boolean;
  message: string;
}

export const textToJson = withMutedBehavior(
  definePatch<TextToJsonState>("textToJson", {
    state: () => ({ has: false, text: "", json: null, error: false, message: "" }),
    evaluate(ctx) {
      const s = ctx.state;
      const text = stripBom(toText(ctx.input("text")));
      if (!s.has || text !== s.text) {
        s.has = true;
        s.text = text;
        s.json = null;
        s.error = false;
        s.message = "";
        if (text.trim() !== "") {
          try {
            s.json = JSON.parse(text);
          } catch (e) {
            s.error = true;
            s.message = TEXT_TO_JSON_ERROR_PREFIX + errorText(e);
          }
        }
      }
      ctx.output("json", s.json as never);
      ctx.output("error", s.error);
      ctx.output("errorMessage", s.message);
    },
  }),
  "zero",
);
