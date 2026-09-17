import { describe, expect, it } from "vitest";
import { formatOutlineValue, getOutline } from "./outline.ts";
import { buildSampleDocument, mockRegistry, mustApply } from "./testing/fixtures.ts";

describe("getOutline", () => {
  it("projects a component compactly (normal detail)", () => {
    expect(getOutline(buildSampleDocument(), "main", { registry: mockRegistry })).toBe(
      [
        'component main "Main" (prototype) 390x844',
        'layer card group "Card" @16,120 358x220 scale←grow.output color=#FFFFFFFF cornerRadius=24',
        '  layer title text "Title" "Popular Events"',
        "patch tap_card interaction layer=@card",
        "patch toggle switch flip←tap_card.tap",
        "patch pop popAnimation number←toggle.on bounciness=8",
        "patch grow transition<number> progress←pop.output start=1 end=1.08",
        'comment note_1 "Spring feel matches iOS sheet"',
      ].join("\n"),
    );
  });

  it("keeps only structure and connections in compact detail", () => {
    expect(getOutline(buildSampleDocument(), "main", { detail: "compact", registry: mockRegistry })).toBe(
      [
        'component main "Main" (prototype) 390x844',
        'layer card group "Card" scale←grow.output',
        '  layer title text "Title"',
        "patch tap_card interaction layer=@card",
        "patch toggle switch flip←tap_card.tap",
        "patch pop popAnimation number←toggle.on",
        "patch grow transition<number> progress←pop.output",
      ].join("\n"),
    );
  });

  it("adds editor state in full detail and shows all stored inputs without a registry", () => {
    const doc = mustApply(buildSampleDocument(), [
      { op: "updateComponent", id: "main", notes: "Tap the card to expand it." },
      { op: "updatePatch", id: "pop", muted: true, name: "Press", settings: { preset: "snappy" }, ui: { collapsed: true } },
      { op: "updateLayer", id: "title", locked: true },
    ]).doc;
    const full = getOutline(doc, "main", { detail: "full" });
    expect(full).toContain('notes "Tap the card to expand it."');
    expect(full).toContain('patch pop popAnimation "Press" muted bounciness=8 number←toggle.on speed=10 ui=440,40 collapsed settings={"preset":"snappy"}');
    expect(full).toContain("patch grow transition<number> end=1.08 progress←pop.output start=1 ui=640,40");
    expect(full).toContain('  layer title text "Title" "Popular Events" locked');
    expect(full).toContain('comment note_1 "Spring feel matches iOS sheet" rect=30,20,600,120 color=yellow');
  });

  it("lists every component with its interface, root first", () => {
    const doc = mustApply(buildSampleDocument(), [
      { op: "addComponent", component: { name: "Chip", kind: "layerComponent" } },
      { op: "updateInterface", component: "chip", inputs: { label: { key: "label", name: "Label", type: "text", default: "Buy" } } },
      { op: "addPatch", component: "chip", patch: { id: "tap", type: "interaction" } },
      { op: "updateInterface", component: "chip", outputs: { tapped: { key: "tapped", name: "Tapped", type: "pulse", link: "tap.tap" } } },
      { op: "addLayer", layer: { id: "chip_1", type: "componentInstance", name: "Buy Chip", component: "chip", props: { label: "Order" } } },
    ]).doc;
    const text = getOutline(doc, undefined, { registry: mockRegistry });
    const [main, chip] = text.split("\n\n");
    expect(main).toContain('layer chip_1 componentInstance:chip "Buy Chip" label="Order"');
    expect(chip).toBe(['component chip "Chip" (layerComponent) 200x100', 'input label text "Label" default="Buy"', 'output tapped pulse "Tapped" ←tap.tap', "patch tap interaction"].join("\n"));
  });

  it("formats values tersely", () => {
    expect(formatOutlineValue({ loop: [[0, 0], [0, 80]] }, "point")).toBe("loop[0,0|0,80]");
    expect(formatOutlineValue({ asset: "photo" })).toBe("asset:photo");
    expect(formatOutlineValue({ gradient: { kind: "linear", stops: [[0, "#FFFFFFFF"], [1, "#000000FF"]], start: [0.5, 0], end: [0.5, 1] } })).toBe("gradient(linear #FFFFFFFF@0,#000000FF@1)");
    expect(formatOutlineValue({ json: { a: 1 } })).toBe('json{"a":1}');
    expect(formatOutlineValue(null)).toBe("none");
    expect(formatOutlineValue("row", "enum")).toBe("row");
    expect(() => getOutline(buildSampleDocument(), "nope")).toThrow(/no component/);
  });
});
