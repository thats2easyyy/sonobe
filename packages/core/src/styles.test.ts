import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "./document.ts";
import { loadProjectFromDisk } from "./node.ts";
import { formatStyleDigest, styleDigest } from "./styles.ts";
import { mustApply } from "./testing/fixtures.ts";
import type { InputValue, LayerNode, Op, SonobeDocument } from "./types.ts";

const TAB_BAR = fileURLToPath(new URL("../../../examples/05-tab-bar", import.meta.url));

/** The same document with every layer's props written in the opposite key order. */
function reversedProps(doc: SonobeDocument): SonobeDocument {
  const flip = (l: LayerNode): LayerNode => ({ ...l, props: Object.fromEntries(Object.entries(l.props).reverse()), ...(l.children ? { children: l.children.map(flip) } : {}) });
  return { ...doc, components: Object.fromEntries(Object.entries(doc.components).map(([id, c]) => [id, { ...c, layers: c.layers.map(flip) }])) };
}

describe("styleDigest", () => {
  it("digests the tab bar example the same way every time", async () => {
    const doc = await loadProjectFromDisk(TAB_BAR);
    const digest = styleDigest(doc);
    expect(styleDigest(await loadProjectFromDisk(TAB_BAR), "main")).toEqual(digest);
    expect(styleDigest(reversedProps(doc))).toEqual(digest);
    expect(digest).toMatchObject({ component: "main", layers: 92 });
    expect(digest.colors.slice(0, 3)).toEqual([
      { value: "#111118FF", uses: 16, roles: ["fill", "text"] },
      { value: "#000000FF", uses: 14, roles: ["shadow"] },
      { value: "#FFFFFFFF", uses: 12, roles: ["fill", "text"] },
    ]);
    expect(digest.colors).toHaveLength(12);
    expect(digest.fonts).toEqual([{ family: "Inter", weights: [400, 600, 700], uses: 39 }]);
    expect(digest.fontSizes[0]).toEqual({ size: 17, uses: 13 });
    expect(digest.radii[0]).toEqual({ radius: 24, uses: 8 });
    expect(digest.shadows).toEqual([
      { color: "#000000FF", radius: 18, offset: [0, 6], opacity: 0.08, uses: 13 },
      { color: "#000000FF", radius: 16, offset: [0, -4], opacity: 0.06, uses: 1 },
    ]);
    const text = formatStyleDigest(digest);
    expect(text).toBe(formatStyleDigest(styleDigest(reversedProps(doc))));
    expect(text.split("\n")).toEqual([
      "styles main (92 layers)",
      "colors #111118FF fill,text×16 · #000000FF shadow×14 · #FFFFFFFF fill,text×12 · #5F5F6BFF text×9 · #FFFFFFB3 text×8 · #8B5CF6FF gradient×3 · #11111859 fill,stroke×2 · #FDE68AFF gradient×2 · #FF3D71FF gradient×2 · #0284C7FF gradient×1 · #0E0F1AFF gradient×1 · #14B8A6FF gradient×1",
      'fonts "Inter" 400,600,700 ×39',
      "font sizes 17×13 · 13×12 · 15×5 · 11×4 · 34×4 · 22×1",
      "radii 24×8 · 1×5 · 18×5 · 12×4 · 3×3 · 2×1",
      // The shadow's opacity folds into its color's alpha, the way it draws.
      "shadows #00000014 r18 0,6 ×13 · #0000000F r16 0,-4 ×1",
    ]);
  });

  it("counts only literal props a layer stores: not links, knob refs or defaults", () => {
    const doc = mustApply(createEmptyDocument(), [
      { op: "addKnob", knob: { id: "accent", name: "Accent", type: "color", value: "#FF3B30FF" } },
      { op: "addKnob", knob: { id: "round", name: "Round", type: "number", value: 12 } },
      {
        op: "addLayer",
        layer: {
          type: "group",
          name: "Card",
          props: { color: { link: "$knob.accent" }, cornerRadius: { link: "$knob.round" }, shadowOpacity: 0.2, shadowRadius: { link: "$knob.round" } },
          children: [
            { type: "text", name: "Title", props: { text: "Hi", textColor: "#111118FF", fontSize: { link: "$knob.round" } } },
            { type: "text", name: "Body", props: { text: "There" } },
            { type: "rectangle", name: "Plain" },
          ],
        },
      },
    ]).doc;
    const digest = styleDigest(doc);
    expect(digest).toEqual({ component: "main", layers: 4, colors: [{ value: "#111118FF", uses: 1, roles: ["text"] }], fonts: [], fontSizes: [], radii: [], shadows: [] });
    expect(formatStyleDigest(digest)).toBe("styles main (4 layers)\ncolors #111118FF text×1");
  });

  const rect = (name: string, props: Record<string, InputValue>): Op => ({ op: "addLayer", layer: { type: "rectangle", name, props } });

  it("orders ties by value and caps each list", () => {
    const doc = mustApply(createEmptyDocument(), [
      ...["#FF0000FF", "#00FF00FF", "#0000FFFF"].map((color, i) => rect(`Swatch ${i}`, { color, cornerRadius: [30, 10, 20][i] })),
      rect("Red Again", { color: "#FF0000FF" }),
      ...Array.from({ length: 14 }, (_, i) => rect(`Tint ${i}`, { color: `#1010${(16 + i).toString(16).toUpperCase()}FF`, cornerRadius: i + 1 })),
      { op: "addLayer", layer: { type: "text", name: "Label", props: { text: "Go", fontFamily: "SF Pro", fontWeight: 600, fontSize: 15 } } },
      { op: "addLayer", layer: { type: "text", name: "Caption", props: { text: "Later", fontWeight: 400, fontSize: 13 } } },
      { op: "addLayer", layer: { type: "text", name: "Note", props: { text: "Soon", fontFamily: "SF Pro", fontWeight: 400, fontSize: 13 } } },
    ]).doc;
    const digest = styleDigest(doc);
    expect(digest.colors.map((c) => `${c.value}×${c.uses}`)).toEqual([
      "#FF0000FF×2",
      // One use each: by value.
      "#0000FFFF×1",
      "#00FF00FF×1",
      ...["10", "11", "12", "13", "14", "15", "16", "17", "18"].map((b) => `#1010${b}FF×1`),
    ]);
    // 10 is a swatch's and a tint's; the rest tie, smallest first (as numbers: 2 before 10).
    expect(digest.radii.map((r) => `${r.radius}×${r.uses}`)).toEqual(["10×2", "1×1", "2×1", "3×1", "4×1", "5×1"]);
    expect(digest.fontSizes).toEqual([{ size: 13, uses: 2 }, { size: 15, uses: 1 }]);
    // A weight alone counts toward the type's default font.
    expect(digest.fonts).toEqual([{ family: "SF Pro", weights: [400, 600], uses: 2 }, { family: "Inter", weights: [400], uses: 1 }]);
    expect(formatStyleDigest(digest).split("\n").slice(2)).toEqual(['fonts "SF Pro" 400,600 ×2 · "Inter" 400 ×1', "font sizes 13×2 · 15×1", "radii 10×2 · 1×1 · 2×1 · 3×1 · 4×1 · 5×1"]);
  });

  it("leaves out paint that can't show", () => {
    const doc = mustApply(createEmptyDocument(), [
      rect("Clear", { color: "#FFFFFF00" }),
      rect("No Border", { strokeColor: "#222222FF" }),
      rect("Outlined", { strokeColor: "#333333FF", strokeWidth: 1 }),
      rect("No Shadow", { shadowColor: "#444444FF", shadowRadius: 8 }),
      rect("Shadowed", { shadowColor: "#666666FF", shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: [0, 2] }),
      rect("Wash", { color: "#555555FF", gradient: { gradient: { kind: "linear", stops: [[0, "#FF0000FF"], [1, "#FFFFFF00"]], start: [0, 0], end: [1, 1] } } }),
    ]).doc;
    const digest = styleDigest(doc);
    expect(digest.colors).toEqual([
      { value: "#333333FF", uses: 1, roles: ["stroke"] },
      { value: "#666666FF", uses: 1, roles: ["shadow"] },
      { value: "#FF0000FF", uses: 1, roles: ["gradient"] },
    ]);
    expect(digest.shadows).toEqual([{ color: "#666666FF", radius: 8, offset: [0, 2], opacity: 0.5, uses: 1 }]);
    expect(formatStyleDigest(digest).split("\n").at(-1)).toBe("shadows #66666680 r8 0,2 ×1");
  });

  it("says when a component has no layers yet, and teaches an unknown component", () => {
    const doc = createEmptyDocument();
    expect(formatStyleDigest(styleDigest(doc))).toBe("styles main (no layers yet)");
    expect(() => styleDigest(doc, "nope")).toThrow('There\'s no component "nope".');
  });
});
