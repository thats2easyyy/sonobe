import { formatColor } from "@sonobe/core";
import type { Color, GradientValue, SonobeDocument } from "@sonobe/core";
import { buildDoc, createMockRegistry, createTestRuntime, runFrames, tap } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { rgbToHsl } from "./colorToHsl.ts";
import { hslToRgb } from "./hslColor.ts";
import { definitions } from "./index.ts";

describe("color patches in a runtime", () => {
  const registry = createMockRegistry(definitions);

  it("springs a card from a brand color to its complement and labels the live hex code", () => {
    const doc = buildDoc(
      {
        layers: [
          { id: "card", type: "rectangle", name: "Card", props: { size: [200, 200], color: { link: "tint.output" } } },
          { id: "code", type: "text", name: "Code", props: { position: [0, 300], text: { link: "code_text.hex" } } },
        ],
        patches: {
          tap_card: { type: "interaction", inputs: { layer: { layer: "card" } } },
          pressed: { type: "switch", inputs: { flip: { link: "tap_card.tap" } } },
          pop: { type: "popAnimation", inputs: { number: { link: "pressed.on" }, bounciness: 0, speed: 20 } },
          brand: { type: "hexColor", inputs: { hex: "#5B5FEF" } },
          brand_hsl: { type: "colorToHsl", inputs: { color: { link: "brand.color" } } },
          shifted: { type: "add", inputs: { value1: { link: "brand_hsl.hue" }, value2: 0.5 } },
          accent: { type: "hslColor", inputs: { hue: { link: "shifted.output" }, saturation: { link: "brand_hsl.saturation" }, lightness: { link: "brand_hsl.lightness" } } },
          tint: { type: "transition", typeParam: "color", inputs: { progress: { link: "pop.output" }, start: { link: "brand.color" }, end: { link: "accent.color" } } },
          code_text: { type: "colorToHex", inputs: { color: { link: "tint.output" } } },
        },
      },
      registry,
    );
    const rt = createTestRuntime(doc, registry);
    runFrames(rt, 1);
    expect(formatColor(rt.getValue("@card.color") as Color)).toBe("#5B5FEFFF");
    expect(rt.getValue("@code.text")).toBe("#5B5FEF");
    expect(rt.issues().filter((i) => i.severity === "error")).toEqual([]);

    runFrames(rt, 2, tap(100, 100));
    expect(rt.getValue("pressed.on")).toBe(true);
    runFrames(rt, 180);

    const brand = rt.getValue("brand.color") as Color;
    const [h, s, l] = rgbToHsl(brand.r, brand.g, brand.b);
    const [r, g, b] = hslToRgb(h + 0.5, s, l);
    const card = rt.getValue("@card.color") as Color;
    expect(card.r).toBeCloseTo(r, 2);
    expect(card.g).toBeCloseTo(g, 2);
    expect(card.b).toBeCloseTo(b, 2);
    expect(rt.getValue("@code.text")).toBe(formatColor(card).slice(0, 7));
    expect(rt.getValue("@code.text")).toBe(formatColor({ r, g, b, a: 1 }).slice(0, 7));
  });

  it("feeds a three-stop gradient layer with animated stops", () => {
    const base = buildDoc(
      {
        layers: [{ id: "background", type: "gradient", name: "Background", props: { size: [390, 844], gradient: { link: "sunset.gradient" } } }],
        patches: {
          warm: { type: "hexColor", inputs: { hex: "#FF5F6D" } },
          sunset: { type: "gradientBuilder", inputs: { color1: { link: "warm.color" }, stop2: 0.55, color2: "#FFC371FF" } },
        },
      },
      registry,
    );
    // Core's addPatch only accepts inputCount on variadic specs, so the stop count is set on the node directly.
    const main = base.components.main!;
    const sunset = main.patches.sunset!;
    const doc: SonobeDocument = {
      ...base,
      components: { ...base.components, main: { ...main, patches: { ...main.patches, sunset: { ...sunset, inputCount: 3, inputs: { ...sunset.inputs, stop3: 1, color3: "#47CACCFF" } } } } },
    };
    const rt = createTestRuntime(doc, registry);
    runFrames(rt, 2);
    const g = rt.getValue("@background.gradient") as GradientValue;
    expect(g.kind).toBe("linear");
    expect(g.stops.map((stop) => [stop.offset, formatColor(stop.color)])).toEqual([
      [0, "#FF5F6DFF"],
      [0.55, "#FFC371FF"],
      [1, "#47CACCFF"],
    ]);
    expect(rt.issues().filter((i) => i.severity === "error" || i.code === "unknown_port")).toEqual([]);
  });
});
