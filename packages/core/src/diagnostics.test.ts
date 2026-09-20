import { describe, expect, it } from "vitest";
import { getDiagnostics } from "./diagnostics.ts";
import { feedbackEdges } from "./graph.ts";
import { applyOps } from "./ops/index.ts";
import { createRegistry } from "./registry.ts";
import { buildSampleDocument, emptyDoc, extendedRegistry, MOCK_PATCH_SPECS, mockRegistry, mustApply, port } from "./testing/fixtures.ts";
import type { Component, Op, PatchSpec, SonobeDocument } from "./types.ts";

const codes = (doc: SonobeDocument) => getDiagnostics(doc, mockRegistry).map((d) => `${d.severity}:${d.code}`);

function edit(doc: SonobeDocument, fn: (c: Component) => void): SonobeDocument {
  const copy = structuredClone(doc);
  fn(copy.components.main!);
  return copy;
}

describe("getDiagnostics", () => {
  it("reports nothing for a healthy prototype", () => {
    expect(getDiagnostics(buildSampleDocument(), mockRegistry)).toEqual([]);
  });

  it("flags unknown types, ports and props with ready fixes", () => {
    const doc = edit(buildSampleDocument(), (c) => {
      c.patches.weird = { type: "popAnimaton", inputs: {}, ui: { x: 0, y: 0 } };
      c.patches.pop!.inputs.bounciess = 3;
      c.layers[0]!.props.cornerRadus = 4;
      c.layers.push({ id: "sparkle", type: "sparkle", name: "Sparkle", props: {} });
    });
    const d = getDiagnostics(doc, mockRegistry);
    expect(d.find((x) => x.code === "unknown_patch_type")!.message).toContain('"popAnimation"');
    const port = d.find((x) => x.code === "unknown_port")!;
    expect(port).toMatchObject({ severity: "error", component: "main", itemIds: ["pop"], port: "bounciess" });
    expect(port.message).toContain('"bounciness"');
    expect(port.suggestions![0]!.ops).toEqual([{ op: "setInput", component: "main", target: "pop.bounciess", value: null }]);
    expect(applyOps(doc, port.suggestions![0]!.ops!, { registry: mockRegistry }).ok).toBe(true);
    expect(d.some((x) => x.code === "unknown_prop" && x.port === "cornerRadus")).toBe(true);
    expect(d.some((x) => x.code === "unknown_layer_type" && x.itemIds[0] === "sparkle")).toBe(true);
  });

  it("flags dangling links, type mismatches, missing layers and missing assets", () => {
    const doc = edit(buildSampleDocument(), (c) => {
      c.patches.grow!.inputs.progress = { link: "gone.output" };
      c.layers[0]!.props.color = { link: "toggle.on" };
      c.patches.tap_card!.inputs.layer = { layer: "ghost" };
      c.layers[0]!.children![0]!.props.text = { link: "grow.nope" };
      c.layers.push({ id: "hero", type: "image", name: "Hero", props: { image: { asset: "missing" } } });
    });
    expect(codes(doc)).toEqual(expect.arrayContaining(["error:dangling_link", "error:type_mismatch", "error:missing_layer", "error:unknown_port", "error:missing_asset", "info:unused_patch"]));
    const d = getDiagnostics(doc, mockRegistry);
    const dangling = d.find((x) => x.code === "dangling_link")!;
    expect(dangling.itemIds).toEqual(["grow", "gone"]);
    expect(dangling.suggestions!.at(-1)!.ops).toEqual([{ op: "disconnect", component: "main", to: "grow.progress" }]);
    const mismatch = d.find((x) => x.code === "type_mismatch")!;
    expect(mismatch.suggestions![0]!.ops![0]).toMatchObject({ op: "addPatch", patch: { type: "transition", typeParam: "color" } });
  });

  it("flags zero-latency self edges and explains feedback loops", () => {
    expect(codes(edit(buildSampleDocument(), (c) => (c.patches.pop!.inputs.number = { link: "pop.output" })))).toContain("error:self_cycle");
    const loop = mustApply(buildSampleDocument(), [
      { op: "addPatch", patch: { id: "d1", type: "delay1", inputs: { value: { link: "grow.output" } } } },
      { op: "connect", from: "d1.output", to: "pop.number" },
    ]).doc;
    const info = getDiagnostics(loop, mockRegistry).find((d) => d.code === "feedback_loop")!;
    expect(info.severity).toBe("info");
    expect(info.itemIds).toEqual(["d1", "grow", "pop"]);
    expect(info.message).toBe('Patches "d1", "grow", "pop" form a feedback loop. This loop is intentional: Delay 1 "d1" gives it one frame of delay, so grow.output → d1.value reads last frame\'s value.');
    expect(info.hint).toBeUndefined();
    expect(info.suggestions).toBeUndefined();
  });

  it("warns about loops that feed back every frame, naming the cable and offering fixes", () => {
    const loop = mustApply(buildSampleDocument(), [{ op: "connect", from: "grow.output", to: "pop.number" }]).doc;
    const warning = getDiagnostics(loop, mockRegistry).find((d) => d.code === "feedback_loop")!;
    expect(warning.severity).toBe("warning");
    expect(warning.itemIds).toEqual(["grow", "pop"]);
    expect(warning.message).toBe('Patches "grow", "pop" form a feedback loop that feeds values back every frame, so they can drift or oscillate. The connection grow.output → pop.number runs right to left, so it reads last frame\'s value.');
    expect(warning.hint).toBe("If the loop is on purpose, insert a Delay 1 patch on that connection to make the delay explicit. Otherwise disconnect the cable that loops back.");
    const [insert, disconnect] = warning.suggestions!;
    expect(insert!.description).toBe("Insert a Delay 1 on grow.output → pop.number");
    expect(insert!.ops![0]).toMatchObject({ op: "addPatch", patch: { type: "delay1", ui: { x: 540, y: 40 } } });
    expect(disconnect).toEqual({ description: "Disconnect grow.output → pop.number", ops: [{ op: "disconnect", component: "main", to: "pop.number" }] });
    expect(applyOps(loop, disconnect!.ops!, { registry: mockRegistry }).ok).toBe(true);
    const fixed = mustApply(loop, insert!.ops!).doc;
    expect(feedbackEdges(fixed, "main", mockRegistry).map((e) => `${e.from} → ${e.to} (${e.reason})`)).toEqual(["grow.output → delay1.value (delay1)"]);
    const after = getDiagnostics(fixed, mockRegistry).find((d) => d.code === "feedback_loop")!;
    expect(after.severity).toBe("info");
    expect(after.itemIds).toEqual(["delay1", "grow", "pop"]);
    expect(after.message).toContain("This loop is intentional");
    expect(after.suggestions).toBeUndefined();
  });

  it("names loops closed through a layer property or a variable, with fixes on the links the document stores", () => {
    const variableSettings: PatchSpec["settings"] = [
      { key: "name", name: "Name", type: "text", default: "", description: "The variable's name." },
      { key: "scope", name: "Scope", type: "enum", default: "local", enumOptions: [{ key: "local", name: "Local" }, { key: "global", name: "Global" }], description: "Where it reaches." },
    ];
    const registry = createRegistry([
      ...MOCK_PATCH_SPECS,
      { type: "variableBroadcaster", name: "Variable Broadcaster", category: "utility", summary: "Sends a value.", variants: ["number"], settings: variableSettings, inputs: [port("value", "variant", { default: 0 })], outputs: [] },
      { type: "variableReceiver", name: "Variable Receiver", category: "utility", summary: "Receives a value.", variants: ["number"], settings: variableSettings, inputs: [], outputs: [port("output", "variant")] },
    ]);
    const build = (ops: Op[]) => {
      const r = applyOps(emptyDoc(), ops, { registry });
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      return r.doc;
    };
    const loopOf = (doc: SonobeDocument) => getDiagnostics(doc, registry).find((d) => d.code === "feedback_loop");

    const layered = build([
      { op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card" } },
      { op: "addPatch", patch: { id: "a", type: "transition", ui: { x: 0, y: 0 } } },
      { op: "addPatch", patch: { id: "b", type: "transition", ui: { x: 300, y: 40 } } },
      { op: "connect", from: "a.output", to: "b.progress" },
      { op: "setInput", target: "@card.opacity", value: { link: "b.output" } },
      { op: "setInput", target: "a.progress", value: { link: "@card.opacity" } },
    ]);
    const warning = loopOf(layered)!;
    expect(warning.severity).toBe("warning");
    expect(warning.itemIds).toEqual(["a", "b"]);
    expect(warning.message).toBe('Patches "a", "b" form a feedback loop that feeds values back every frame, so they can drift or oscillate. a.progress reads @card.opacity, which b.output drives, so it reads last frame\'s value.');
    const [insert, disconnect] = warning.suggestions!;
    expect(insert!.description).toBe("Insert a Delay 1 on @card.opacity → a.progress");
    expect(insert!.ops![0]).toMatchObject({ op: "addPatch", patch: { type: "delay1", ui: { x: 150, y: 20 } } });
    expect(disconnect).toEqual({ description: "Disconnect @card.opacity → a.progress", ops: [{ op: "disconnect", component: "main", to: "a.progress" }] });
    expect(loopOf(applyOps(layered, disconnect!.ops!, { registry }).doc!)).toBeUndefined();
    const delayed = applyOps(layered, insert!.ops!, { registry });
    expect(delayed.ok).toBe(true);
    expect(feedbackEdges(delayed.doc!, "main", registry).map((e) => `${e.from} → ${e.to} (${e.reason})`)).toEqual(["@card.opacity → delay1.value (delay1)"]);
    expect(loopOf(delayed.doc!)!.severity).toBe("info");

    const variable = build([
      { op: "addPatch", patch: { id: "acc", type: "transition", ui: { x: 300, y: 0 } } },
      { op: "addPatch", patch: { id: "send", type: "variableBroadcaster", settings: { name: "total" }, ui: { x: 500, y: 0 } } },
      { op: "addPatch", patch: { id: "r", type: "variableReceiver", settings: { name: "total" }, ui: { x: 0, y: 0 } } },
      { op: "connect", from: "acc.output", to: "send.value" },
      { op: "connect", from: "r.output", to: "acc.progress" },
    ]);
    const shared = loopOf(variable)!;
    expect(shared.itemIds).toEqual(["acc", "r"]);
    expect(shared.message).toBe('Patches "acc", "r" form a feedback loop that feeds values back every frame, so they can drift or oscillate. Variable Receiver "r" reads the variable "total", which acc.output drives, so it reads last frame\'s value.');
    const [insertOnSend, disconnectSend] = shared.suggestions!;
    expect(insertOnSend!.description).toBe("Insert a Delay 1 on acc.output → send.value");
    expect(insertOnSend!.ops![0]).toMatchObject({ op: "addPatch", patch: { type: "delay1", ui: { x: 400, y: 0 } } });
    expect(disconnectSend).toEqual({ description: "Disconnect acc.output → send.value", ops: [{ op: "disconnect", component: "main", to: "send.value" }] });
    const fixed = applyOps(variable, insertOnSend!.ops!, { registry });
    expect(fixed.ok).toBe(true);
    expect(loopOf(fixed.doc!)!.severity).toBe("info");
  });

  it("calls loops intentional when values only come back when a pulse fires", () => {
    const registry = createRegistry([
      ...MOCK_PATCH_SPECS,
      { type: "scroll", name: "Scroll", category: "interaction", summary: "Scrolls a layer.", inputs: [port("jumpToX", "pulse"), port("jumpPositionX", "number", { default: 0 })], outputs: [port("pageX", "index")] },
      { type: "sampleAndHold", name: "Sample and Hold", category: "state", summary: "Captures a value.", inputs: [port("value", "number", { default: 0 }), port("sample", "boolean", { default: false, acceptsPulse: true })], outputs: [port("output", "number")] },
    ]);
    const build = (ops: Op[]) => {
      const r = applyOps(emptyDoc(), ops, { registry });
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      return r.doc;
    };
    const loopsOf = (doc: SonobeDocument) => getDiagnostics(doc, registry).filter((d) => d.code === "feedback_loop");

    // The carousel's Next button: the page number feeds arithmetic that the scroll reads only when Jump fires.
    const carousel = build([
      { op: "addPatch", patch: { id: "next_page_x", type: "add", ui: { x: 40, y: 300 }, inputs: { value1: { link: "$scroll.pageX" }, value2: 1 } } },
      { op: "addPatch", patch: { ref: "scroll", id: "trips_scroll", type: "scroll", ui: { x: 300, y: 200 }, inputs: { jumpPositionX: { link: "next_page_x.output" } } } },
    ]);
    expect(loopsOf(carousel)).toEqual([
      {
        code: "feedback_loop",
        severity: "info",
        component: "main",
        itemIds: ["next_page_x", "trips_scroll"],
        message:
          'Patches "next_page_x", "trips_scroll" form a feedback loop. This loop is intentional: trips_scroll.jumpPositionX is only read when Jump To X fires, so values go around once per pulse instead of every frame. The connection trips_scroll.pageX → next_page_x.value1 runs right to left, so it reads last frame\'s value.',
      },
    ]);

    const hold = build([
      { op: "addPatch", patch: { id: "grab", type: "sampleAndHold", ui: { x: 0, y: 0 }, inputs: { value: { link: "$finger.output" } } } },
      { op: "addPatch", patch: { ref: "finger", id: "finger", type: "add", ui: { x: 200, y: 0 }, inputs: { value1: { link: "grab.output" } } } },
    ]);
    const held = loopsOf(hold)[0]!;
    expect(held.severity).toBe("info");
    expect(held.message).toContain("grab.value is only read when Sample fires");

    const switches = build([
      { op: "addPatch", patch: { id: "a", type: "switch", ui: { x: 0, y: 0 }, inputs: { flip: { link: "$b.on" } } } },
      { op: "addPatch", patch: { ref: "b", id: "b", type: "switch", ui: { x: 200, y: 0 }, inputs: { turnOff: { link: "a.on" } } } },
    ]);
    expect(loopsOf(switches)[0]).toMatchObject({ severity: "info", message: expect.stringContaining("b.on → a.flip only triggers Flip") });

    // A gate on one path doesn't excuse a second path that feeds back every frame.
    const mixed = build([
      { op: "addPatch", patch: { id: "grab", type: "sampleAndHold", ui: { x: 0, y: 0 }, inputs: { value: { link: "$sum.output" } } } },
      { op: "addPatch", patch: { ref: "sum", id: "sum", type: "add", ui: { x: 200, y: 0 }, inputs: { value1: { link: "grab.output" }, value2: { link: "$echo.output" } } } },
      { op: "addPatch", patch: { ref: "echo", id: "echo", type: "transition", typeParam: "number", ui: { x: 400, y: 0 }, inputs: { progress: { link: "sum.output" } } } },
    ]);
    const warning = loopsOf(mixed)[0]!;
    expect(warning.severity).toBe("warning");
    expect(warning.itemIds).toEqual(["echo", "grab", "sum"]);
    expect(warning.suggestions!.map((s) => s.description)).toContain("Disconnect echo.output → sum.value2");
  });

  it("doesn't warn about pulses into ports that take them on purpose", () => {
    const doc = mustApply(
      buildSampleDocument(),
      [
        { op: "addPatch", patch: { id: "any_tap", type: "or", inputs: { value1: { link: "tap_card.tap" } } } },
        { op: "addPatch", patch: { id: "hold", type: "sampler", inputs: { sample: { link: "tap_card.tap" } } } },
        { op: "addPatch", patch: { id: "floor", type: "roundDown", inputs: { amount: { link: "tap_card.tap" } } } },
      ],
      { registry: extendedRegistry },
    ).doc;
    const warnings = getDiagnostics(doc, extendedRegistry).filter((d) => d.code === "pulse_into_state");
    expect(warnings.map((d) => d.itemIds)).toEqual([["floor", "tap_card"]]);
  });

  it("checks input counts against inputCountRange and typeParams against dynamic variants", () => {
    const counted = edit(buildSampleDocument(), (c) => (c.patches.grad = { type: "stops", inputCount: 9, inputs: {}, ui: { x: 0, y: 0 } }));
    expect(getDiagnostics(counted, extendedRegistry).find((d) => d.code === "input_count_out_of_range")).toMatchObject({
      severity: "warning",
      itemIds: ["grad"],
      message: '"Gradient Builder" has an input count of 9, but it supports 1–4.',
    });
    const scripted = edit(emptyDoc(), (c) => (c.patches.js = { type: "script", typeParam: "color", settings: { variants: ["number", "color"] }, inputs: {}, ui: { x: 0, y: 0 } }));
    expect(getDiagnostics(scripted, extendedRegistry).filter((d) => d.code === "invalid_type_param")).toEqual([]);
    const wrong = edit(scripted, (c) => (c.patches.js!.typeParam = "sound"));
    expect(getDiagnostics(wrong, extendedRegistry).find((d) => d.code === "invalid_type_param")!.message).toContain("(number, color)");
  });

  it("hints when a pulse drives a state input and offers a Switch", () => {
    const doc = mustApply(buildSampleDocument(), [{ op: "connect", from: "tap_card.tap", to: "pop.number" }]).doc;
    const hint = getDiagnostics(doc, mockRegistry).find((d) => d.code === "pulse_into_state")!;
    expect(hint).toMatchObject({ severity: "warning", itemIds: ["pop", "tap_card"], port: "number" });
    expect(hint.message).toContain("Did you mean to use a Switch?");
    const fixed = mustApply(doc, hint.suggestions![0]!.ops!);
    expect(getDiagnostics(fixed.doc, mockRegistry).some((d) => d.code === "pulse_into_state")).toBe(false);
  });

  it("reports unused patches but not sinks", () => {
    const doc = mustApply(buildSampleDocument(), [
      { op: "addPatch", patch: { id: "extra", type: "counter" } },
      { op: "addPatch", patch: { id: "log", type: "logger", inputs: { value: { link: "extra.count" } } } },
      { op: "addPatch", patch: { id: "orphan", type: "switch" } },
    ]).doc;
    expect(getDiagnostics(doc, mockRegistry).filter((d) => d.code === "unused_patch").map((d) => d.itemIds[0])).toEqual(["orphan"]);
  });

  it("warns when an interaction's layer can't receive touches", () => {
    const faded = mustApply(buildSampleDocument(), [{ op: "setInput", target: "@card.opacity", value: 0 }]).doc;
    const w = getDiagnostics(faded, mockRegistry).find((d) => d.code === "untouchable_layer")!;
    expect(w).toMatchObject({ severity: "warning", itemIds: ["card", "tap_card"], port: "layer" });
    expect(w.message).toContain("opacity is 0");
    const nested = mustApply(buildSampleDocument(), [
      { op: "addPatch", patch: { id: "tap_title", type: "interaction", inputs: { layer: { layer: "title" } } } },
      { op: "connect", from: "tap_title.down", to: "grow.start" },
      { op: "setInput", target: "@card.enabled", value: false },
      { op: "setInput", target: "@title.hitTest", value: false },
    ]).doc;
    const warning = getDiagnostics(nested, mockRegistry).find((d) => d.code === "untouchable_layer" && d.itemIds[0] === "title")!;
    expect(warning.message).toContain('its parent "Card" is disabled and Receives Touches is off');
    const fixed = mustApply(nested, warning.suggestions!.flatMap((s) => s.ops ?? []));
    expect(getDiagnostics(fixed.doc, mockRegistry).some((d) => d.code === "untouchable_layer")).toBe(false);
  });

  it("checks component references, duplicate ids, type params and the root", () => {
    const doc = edit(buildSampleDocument(), (c) => {
      c.layers.push({ id: "inst", type: "componentInstance", name: "Inst", component: "nope", props: {} });
      c.patches.card = { type: "switch", inputs: {}, ui: { x: 0, y: 0 } };
      c.patches.grow!.typeParam = "sound";
      c.patches.sum = { type: "add", inputCount: 12, inputs: {}, ui: { x: 0, y: 0 } };
    });
    expect(codes(doc)).toEqual(expect.arrayContaining(["error:component_not_found", "error:duplicate_id", "error:invalid_type_param", "warning:input_count_out_of_range"]));
    const sample = buildSampleDocument();
    expect(codes({ ...sample, project: { ...sample.project, root: "gone" } })).toContain("error:missing_root");
  });

  it("checks published ports", () => {
    const doc = mustApply(emptyDoc(), [
      {
        op: "addComponent",
        component: {
          name: "Chip",
          kind: "patchComponent",
          interface: {
            inputs: { big: { key: "big", name: "Big", type: "number", default: "huge" } },
            outputs: { a: { key: "a", name: "A", type: "number", link: "gone.output" }, b: { key: "b", name: "B", type: "number" } },
          },
        },
      },
      // addComponent refuses content with problems; a lenient apply stands in for a file that already has them.
    ], { lenient: true }).doc;
    const d = getDiagnostics(doc, mockRegistry, { components: ["chip"] });
    expect(d.map((x) => `${x.severity}:${x.code}:${x.port}`)).toEqual(["error:invalid_value:big", "info:unused_input:big", "error:dangling_link:a", "info:unconnected_output:b"]);
  });

  /** A patch component with an unread input and an undriven output, whose instance feeds a layer. */
  const swipeDoc = () =>
    mustApply(emptyDoc(), [
      { op: "addComponent", component: { id: "swipe_card", name: "Swipe Card", kind: "patchComponent" } },
      {
        op: "updateInterface",
        component: "swipe_card",
        inputs: { down: { name: "Down", type: "boolean" }, swipedLeft: { name: "Swiped Left", type: "pulse" } },
        outputs: { gone: { name: "Gone", type: "boolean" }, wentLeft: { name: "Went Left", type: "boolean" } },
      },
      { op: "addPatch", component: "swipe_card", patch: { id: "card_gone", type: "switch", inputs: { turnOn: { link: "$in.down" } } } },
      { op: "connect", component: "swipe_card", from: "card_gone.on", to: "$out.gone" },
      { op: "addLayer", layer: { id: "badge", type: "rectangle", name: "Badge" } },
      { op: "addPatch", patch: { id: "card_1_swipe", type: "component", component: "swipe_card", name: "Card 1 Swipe" } },
      { op: "setInput", target: "@badge.opacity", value: { link: "card_1_swipe.wentLeft" } },
    ]).doc;

  it("flags published inputs nothing inside reads, with an unpublish fix", () => {
    const doc = swipeDoc();
    const d = getDiagnostics(doc, mockRegistry).find((x) => x.code === "unused_input")!;
    expect(d).toMatchObject({ severity: "info", component: "swipe_card", port: "swipedLeft", message: 'The published input "Swiped Left" of Swipe Card isn\'t read inside the component, so values sent to it do nothing.' });
    expect(d.suggestions![0]!.ops).toEqual([{ op: "updateInterface", component: "swipe_card", inputs: { swipedLeft: null } }]);
    const fixed = mustApply(doc, d.suggestions![0]!.ops!).doc;
    expect(getDiagnostics(fixed, mockRegistry).some((x) => x.code === "unused_input")).toBe(false);
    const output = getDiagnostics(doc, mockRegistry).find((x) => x.code === "unconnected_output")!;
    expect(output).toMatchObject({ port: "wentLeft", message: 'The published output "Went Left" of Swipe Card isn\'t connected to anything inside the component.' });
    expect(output.suggestions![0]!.ops).toEqual([{ op: "updateInterface", component: "swipe_card", outputs: { wentLeft: null } }]);
  });

  it("warns on the host when a cable reads an instance output its component doesn't drive", () => {
    const doc = swipeDoc();
    const d = getDiagnostics(doc, mockRegistry).find((x) => x.code === "undriven_output")!;
    expect(d).toMatchObject({
      severity: "warning",
      component: "main",
      itemIds: ["badge", "card_1_swipe"],
      port: "opacity",
      message: 'The Opacity of "Badge" reads "Went Left" from "Card 1 Swipe", but Swipe Card doesn\'t drive that output inside, so it stays at its default.',
    });
    expect(d.suggestions!.map((s) => s.ops)).toEqual([
      [{ op: "disconnect", component: "main", to: "@badge.opacity" }],
      [{ op: "updateInterface", component: "swipe_card", outputs: { wentLeft: null } }],
    ]);
    for (const s of d.suggestions!) expect(getDiagnostics(mustApply(doc, s.ops!).doc, mockRegistry).some((x) => x.code === "undriven_output")).toBe(false);
    const driven = mustApply(doc, [{ op: "connect", component: "swipe_card", from: "card_gone.on", to: "$out.wentLeft" }]).doc;
    expect(getDiagnostics(driven, mockRegistry).some((x) => x.code === "undriven_output")).toBe(false);
  });

  it("warns for layer instances too", () => {
    const doc = mustApply(emptyDoc(), [
      { op: "addComponent", component: { id: "chip", name: "Chip", kind: "layerComponent" } },
      { op: "updateInterface", component: "chip", outputs: { tapped: { name: "Tapped", type: "pulse" } } },
      { op: "addLayer", layer: { id: "chip_1", type: "componentInstance", component: "chip", name: "Buy Chip" } },
      { op: "addPatch", patch: { id: "liked", type: "switch", name: "Liked", inputs: { flip: { link: "@chip_1.tapped" } } } },
    ]).doc;
    expect(getDiagnostics(doc, mockRegistry).find((x) => x.code === "undriven_output")).toMatchObject({ itemIds: ["liked", "chip_1"], message: expect.stringContaining('The Flip of "Liked" reads "Tapped" from "Buy Chip"') });
  });

  it("reports component ids and script names that would share a file", () => {
    const doc = mustApply(
      emptyDoc(),
      [
        { op: "addComponent", component: { id: "card", name: "Card", kind: "layerComponent" } },
        { op: "addComponent", component: { id: "Card", name: "Card 2", kind: "layerComponent" } },
        { op: "setScript", file: "js_1.js", source: "// a" },
        { op: "setScript", file: "JS_1.js", source: "// b" },
      ],
      { lenient: true },
    ).doc;
    const collisions = getDiagnostics(doc, mockRegistry).filter((d) => d.code === "file_name_collision");
    expect(collisions).toHaveLength(2);
    expect(collisions[0]).toMatchObject({ severity: "error", component: "card", message: expect.stringContaining('"Card" and "card"') });
    expect(collisions[0]!.suggestions?.[0]?.description).toContain("Recreate");
    expect(collisions[1]!.message).toContain("scripts");
  });

  it("reports dynamic port failures", () => {
    const doc = mustApply(emptyDoc(), [{ op: "addPatch", patch: { id: "js", type: "javascript", settings: { broken: true } } }]).doc;
    expect(codes(doc)).toContain("warning:dynamic_ports_failed");
  });
});

describe("knob diagnostics", () => {
  const tuned = () =>
    mustApply(buildSampleDocument(), [
      { op: "addKnobPreset", preset: { name: "Proposal" } },
      { op: "addKnobPreset", preset: { name: "Shipped app" } },
      { op: "addKnob", knob: { id: "bounce", name: "Bounce", type: "number", value: 8, min: 0, max: 20 } },
      { op: "setInput", target: "pop.bounciness", value: { link: "$knob.bounce" } },
    ]).doc;
  const knobDiags = (doc: SonobeDocument) => getDiagnostics(doc, mockRegistry).filter((d) => d.knob !== undefined || d.code.includes("knob"));

  it("is quiet for knobs that are used, valid and in range", () => {
    expect(getDiagnostics(tuned(), mockRegistry)).toEqual([]);
  });

  it("reports the knob table: unused knobs, values out of range, missing values and presets, bad values", () => {
    const doc = mustApply(tuned(), [
      { op: "addKnob", knob: { id: "nudge", name: "Button Nudge", type: "number", value: 20 } },
      { op: "setKnobValue", id: "bounce", value: 25 },
    ]).doc;
    const edited = structuredClone(doc);
    edited.knobs!.active = "gone";
    delete edited.knobs!.knobs[1]!.values.shipped_app;
    edited.knobs!.knobs[1]!.values.old = 3;
    edited.knobs!.knobs.push({ id: "mode", name: "Mode", type: "enum", options: [{ key: "a", name: "A" }, { key: "b", name: "B" }], values: { proposal: "c", shipped_app: "a" } });
    const d = knobDiags(edited);
    expect(d.map((x) => `${x.severity}:${x.code}:${x.knob ?? ""}:${x.preset ?? ""}`)).toEqual([
      "warning:unknown_knob_preset::gone",
      "info:knob_out_of_range:bounce:proposal",
      "warning:unknown_knob_preset:nudge:old",
      "warning:knob_missing_value:nudge:shipped_app",
      "info:unused_knob:nudge:",
      "error:invalid_knob_value:mode:proposal",
      "info:unused_knob:mode:",
    ]);
    expect(d.every((x) => x.component === "main" && x.itemIds.length === 0)).toBe(true);
    expect(d[1]!.message).toBe("Bounce is 25 in Proposal, above its range 0–20.");
    expect(d[1]!.suggestions?.[0]?.ops).toEqual([{ op: "updateKnob", id: "bounce", max: 25 }]);
    expect(d[3]!.suggestions?.[0]?.ops).toEqual([{ op: "setKnobValue", id: "nudge", preset: "shipped_app", value: 20 }]);
    expect(d[4]!.message).toBe('Knob "Button Nudge" isn\'t used by anything, so moving it changes nothing.');
    expect(d[5]!.suggestions?.[0]?.ops).toEqual([{ op: "setKnobValue", id: "mode", preset: "proposal", value: "a" }]);
  });

  it("reports links to missing knobs and knobs that can't reach their input, with fixes", () => {
    const doc = edit(tuned(), (c) => {
      c.patches.pop!.inputs.speed = { link: "$knob.bounc" };
      c.patches.pop!.inputs.number = { link: "$knob.speedy" };
    });
    doc.knobs!.knobs.push({ id: "tint", name: "Tint", type: "color", values: { proposal: "#FF0000FF", shipped_app: "#FF0000FF" } });
    doc.components.main!.patches.grow!.inputs.start = { link: "$knob.tint" };
    const d = getDiagnostics(doc, mockRegistry);
    const missing = d.filter((x) => x.code === "unknown_knob");
    expect(missing.map((x) => x.port)).toEqual(["number", "speed"]);
    expect(missing[1]!.message).toContain("Did you mean Bounce (bounce)?");
    expect(missing[1]!.suggestions?.map((s) => s.description)).toEqual(["Read Bounce (bounce) instead", 'Make the knob "bounc"', "Disconnect it"]);
    expect(missing[1]!.suggestions?.[1]?.ops).toEqual([{ op: "addKnob", knob: { id: "bounc", name: "Bounc", type: "number", value: 10 } }]);
    const mismatch = d.find((x) => x.code === "knob_type_mismatch")!;
    expect(mismatch).toMatchObject({ severity: "error", itemIds: ["grow"], port: "start" });
    expect(mismatch.message).toContain('Knob "Tint" is a color, but');
  });

  it("suggests turning constant Variable Broadcasters into knobs", () => {
    const settings: PatchSpec["settings"] = [{ key: "name", name: "Name", type: "text", default: "", description: "Name." }];
    const registry = createRegistry([
      ...MOCK_PATCH_SPECS,
      { type: "variableBroadcaster", name: "Variable Broadcaster", category: "utility", summary: "Shares.", variants: ["number"], settings, inputs: [port("value", "variant", { default: 0 })], outputs: [] },
      { type: "variableReceiver", name: "Variable Receiver", category: "utility", summary: "Reads.", variants: ["number"], settings, inputs: [], outputs: [port("output", "variant")] },
    ]);
    const r = applyOps(
      emptyDoc(),
      [
        { op: "addPatch", patch: { id: "gap", type: "variableBroadcaster", typeParam: "number", settings: { name: "Gap" }, inputs: { value: 8 } } },
        { op: "addPatch", patch: { id: "gap_rx", type: "variableReceiver", typeParam: "number", settings: { name: "Gap" } } },
        { op: "addPatch", patch: { id: "pop", type: "popAnimation", inputs: { number: { link: "gap_rx.output" } } } },
      ],
      { registry },
    );
    const d = getDiagnostics(r.doc, registry).find((x) => x.code === "variables_could_be_knobs")!;
    expect(d).toMatchObject({ severity: "info", itemIds: ["gap"] });
    expect(d.message).toBe("1 Variable Broadcaster shares a constant in Main. Knobs would let you tune it in one panel and compare presets.");
    expect(d.hint).toContain('set_knobs({ "convertVariables": { "component": "main" } })');
  });
});
