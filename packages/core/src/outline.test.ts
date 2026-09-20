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
    expect(full).toContain('patch pop popAnimation "Press" muted bounciness=8 number←toggle.on speed=10 ui=522,40 collapsed settings={"preset":"snappy"}');
    expect(full).toContain("patch grow transition<number> end=1.08 progress←pop.output start=1 ui=765,40");
    expect(full).toContain('  layer title text "Title" "Popular Events" locked');
    expect(full).toContain('comment note_1 "Spring feel matches iOS sheet" rect=30,20,600,120 color=yellow');
  });

  it("shows where layer and interface nodes sit in the graph in full detail only", () => {
    const doc = mustApply(buildSampleDocument(), [
      { op: "updateInterface", component: "main", inputs: { size: { key: "size", name: "Size", type: "number" } } },
      { op: "setNodePositions", positions: { $in: [-260, 40] } },
    ]).doc;
    const full = getOutline(doc, "main", { detail: "full" });
    expect(full).toContain("nodes $in=-260,40\n");
    expect(full).toMatch(/layer card group "Card" .* node=auto\n/);
    expect(full).not.toMatch(/layer title .*node=/);
    const placed = getOutline(mustApply(doc, [{ op: "setNodePositions", positions: { "@card": [900, 20] } }]).doc, "main", { detail: "full" });
    expect(placed).toMatch(/layer card group "Card" .* node=900,20\n/);
    expect(getOutline(doc, "main")).not.toContain("node");
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

  it("prints the knob block first whenever the root is shown", () => {
    const doc = mustApply(buildSampleDocument(), [
      { op: "addKnobPreset", preset: { name: "Proposal" } },
      { op: "addKnobPreset", preset: { name: "Shipped app", locked: true } },
      { op: "addKnob", knob: { id: "bounce", name: "Bounce", group: "Press", type: "number", value: 8, min: 0, max: 20, step: 1, unit: "pt", description: "How much the card overshoots." } },
      { op: "addKnob", knob: { id: "mode", name: "Mode", type: "enum", options: [{ key: "snappy", name: "Snappy" }, { key: "soft", name: "Soft" }], values: { shipped_app: "soft" } } },
      { op: "setInput", target: "pop.bounciness", value: { link: "$knob.bounce" } },
    ]).doc;
    const normal = getOutline(doc, "main", { registry: mockRegistry }).split("\n");
    expect(normal.slice(0, 4)).toEqual([
      'knobs 2 · running proposal "Proposal" · presets proposal "Proposal", shipped_app "Shipped app" locked',
      'knob bounce number "Bounce" group="Press" 0…20 step=1 unit=pt proposal=8 shipped_app=8',
      'knob mode enum "Mode" proposal=snappy shipped_app=soft',
      "",
    ]);
    expect(normal).toContain("patch pop popAnimation number←toggle.on bounciness←$knob.bounce");
    expect(getOutline(doc, "main", { detail: "compact", registry: mockRegistry }).split("\n").slice(1, 3)).toEqual(["knob bounce number =8", "knob mode enum =snappy"]);
    const full = getOutline(doc, undefined, { detail: "full", registry: mockRegistry }).split("\n");
    expect(full[1]).toBe('knob bounce number "Bounce" group="Press" 0…20 step=1 unit=pt proposal=8 shipped_app=8 description="How much the card overshoots."');
    expect(full[2]).toBe('knob mode enum "Mode" options=snappy|soft proposal=snappy shipped_app=soft');
    const other = mustApply(doc, [{ op: "addComponent", component: { id: "chip", name: "Chip", kind: "layerComponent" } }]).doc;
    expect(getOutline(other, "chip")).not.toContain("knobs");
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
