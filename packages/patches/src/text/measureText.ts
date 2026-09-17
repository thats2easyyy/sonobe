/** Measure Text: the size text takes up in a font, on the current frame, with the same rules as a Text layer. */

import { approximateTextMeasurer } from "@sonobe/engine";
import type { RuntimeServices, TextMeasureStyle } from "@sonobe/engine";
import { definePatch, toText } from "../infra/index.ts";

/** Per loop index: whether a non-finite measurement was reported since restart. */
interface MeasureTextState {
  warned: boolean;
}

/** The runtime's text measurer (`services.measureText`, the same one Text layer layout uses). */
function measure(services: RuntimeServices, text: string, style: TextMeasureStyle, maxWidth: number | null): { width: number; height: number } {
  return typeof services.measureText === "function" ? services.measureText(text, style, maxWidth) : approximateTextMeasurer.measure(text, style, maxWidth);
}

export const measureTextPatch = definePatch<MeasureTextState>("measureText", {
  state: () => ({ warned: false }),
  evaluate(ctx) {
    const text = toText(ctx.input("text"));
    const style: TextMeasureStyle = {
      fontFamily: toText(ctx.input("fontFamily")),
      fontSize: ctx.input<number>("fontSize"),
      fontWeight: ctx.input<number>("fontWeight"),
      letterSpacing: ctx.input<number>("letterSpacing"),
      lineHeight: ctx.input<number>("lineHeight"),
    };
    const maxWidth = ctx.input<number>("maxWidth");
    const measured = measure(ctx.services, text, style, maxWidth > 0 ? maxWidth : null);
    const paragraphs = text.split(/\r\n|\r|\n/).length;
    const height = measured.height + Math.max(0, ctx.input<number>("paragraphSpacing")) * (paragraphs - 1);
    const finite = (x: number) => {
      if (Number.isFinite(x)) return x;
      if (!ctx.state.warned) {
        ctx.state.warned = true;
        ctx.services.log("warn", "Measure Text: the measurement isn't a finite number, so it counts as 0. Check Font Size, Line Height, and Paragraph Spacing.");
      }
      return 0;
    };
    ctx.output("size", [Math.max(0, finite(measured.width)), Math.max(0, finite(height))]);
  },
  mutedBehavior: "zero",
});
