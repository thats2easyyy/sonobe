/**
 * Engine frame cost. Each case prints its ms per frame and holds it to a budget. On a laptop the
 * budget is about three times what the case measures alone, which is about twice what it measures
 * with the whole suite running beside it (`npm test` slows a case by 1.3x to 1.9x here). So a
 * regression of 3x or more fails, and a smaller one shows in the printed figure and in the cases
 * that compare two measurements (Repeat, different layers). CI's runners are slow and uneven, and
 * get a generous budget. A frame at 120 fps is 8.3 ms, and the renderer and the browser need most of it.
 *
 *   npx vitest run packages/engine/src/runtime/benchmark.test.ts --reporter=default
 *
 * (Vitest hides a passing test's output from a coding agent unless the reporter is named.)
 */
import { describe, expect, it } from "vitest";
import { buildDoc, createMockRegistry, createTestRuntime, defineMock, pointerEvent, port, type PatchInput } from "../testing/index.ts";
import type { Runtime } from "../types.ts";

/** `local` beside each case: what it measured alone on an M-series laptop when the budget was set. */
const budget = (local: number, ci: number) => (process.env.CI ? ci : local);

/**
 * ms per step after `warm` untimed steps: the median of the batch means, so a garbage collection or a
 * busy neighbour moves it little. `before` runs ahead of every step (to dispatch input).
 */
function perFrame(rt: Runtime, { warm, frames, batches = 5, before }: { warm: number; frames: number; batches?: number; before?: (step: number) => void }): number {
  let n = 0;
  const step = () => {
    before?.(n++);
    rt.step();
  };
  for (let i = 0; i < warm; i++) step();
  const means: number[] = [];
  for (let b = 0; b < batches; b++) {
    const start = performance.now();
    for (let i = 0; i < frames; i++) step();
    means.push((performance.now() - start) / frames);
  }
  means.sort((a, b) => a - b);
  return means[batches >> 1]!;
}

/** Vitest prints this under the test's name. */
const report = (name: string, ms: number, note: string) => console.log(`engine: ${name} ${ms.toFixed(3)} ms/frame (${note})`);

const LAYER_TYPES = ["rectangle", "oval", "text", "rectangle", "group"] as const;
/** Props a design sets on some layers and not others; a shape is one subset of them. */
const SOMETIMES: [string, (i: number) => unknown][] = [
  ["size", (i) => [20 + (i % 7) * 4, 20 + (i % 5) * 4]],
  ["opacity", (i) => 0.5 + (i % 5) / 10],
  ["rotation", (i) => i % 90],
  ["scale", (i) => 1 + (i % 3) / 10],
  ["anchor", () => [0.5, 0.5]],
  ["shadowOpacity", () => 0.2],
  ["shadowRadius", (i) => i % 8],
  ["hitTest", () => true],
];

/** The type and props of layer `i` when a document's layers come in `shapes` shapes (type + which props are set). */
function shapedLayer(i: number, shapes: number): { type: (typeof LAYER_TYPES)[number]; props: Record<string, unknown> } {
  const shape = i % shapes;
  const type = LAYER_TYPES[shape % LAYER_TYPES.length]!;
  const props: Record<string, unknown> = { position: [(i % 20) * 19, Math.floor(i / 20) * 33] };
  // Scrambled, so neighbouring shapes don't differ by one prop.
  const bits = (shape * 2654435761) >>> 7;
  SOMETIMES.forEach(([key, value], k) => {
    if ((bits >> k) & 1) props[key] = value(i);
  });
  if (type === "text") props.text = `Layer ${i}`;
  else if (type !== "group") props.color = "#3366FFFF";
  return { type, props };
}

/** `count` layers of mixed types in `shapes` shapes: what an imported screen looks like to the scene build. */
const shapedLayers = (count: number, shapes: number) => Array.from({ length: count }, (_, i) => ({ id: `l${i}`, name: `Layer ${i}`, ...shapedLayer(i, shapes) }));

describe("runtime: performance", { retry: 2 }, () => {
  it("evaluates 500 simple patches within the frame budget", () => {
    const patches: Record<string, PatchInput> = { p0: { type: "splitter", inputs: { value: 1 } } };
    for (let i = 1; i < 500; i++) patches[`p${i}`] = { type: "add", inputs: { value1: { link: `p${i - 1}.output` }, value2: 1 } };
    const rt = createTestRuntime(buildDoc({ patches }));
    // 0.07 ms alone.
    const limit = budget(0.25, 12);
    const ms = perFrame(rt, { warm: 60, frames: 100 });
    report("500 chained patches", ms, `budget ${limit}`);
    expect(rt.getValue("p499.output")).toBe(500);
    expect(ms).toBeLessThan(limit);
  });

  it("replicates 1,000 tappable copies next to 20 empty lists within the frame budget", () => {
    // A patch that explains its empty output every frame keeps the empty-loop checks on: each empty
    // layer's trail is followed every frame.
    const nothing = defineMock({
      type: "nothing",
      name: "Nothing",
      inputs: [],
      outputs: [port("output", "number", { wholeLoop: true })],
      evaluate(ctx) {
        ctx.output("output", []);
        ctx.explainEmpty?.("it never has items");
      },
    });
    const reg = createMockRegistry([nothing]);
    const layers = [{ id: "row", type: "rectangle" as const, name: "Row", props: { opacity: { link: "rows.index" }, scale: { link: "grow.output" } } }];
    const patches: Record<string, PatchInput> = {
      rows: { type: "loop", inputs: { count: 1000 } },
      touch: { type: "interaction", inputs: { layer: { layer: "row" } } },
      toggle: { type: "switch", inputs: { flip: { link: "touch.tap" } } },
      grow: { type: "transition", inputs: { progress: { link: "toggle.on" }, start: 1, end: 1.1 } },
      none: { type: "nothing" },
    };
    for (let i = 0; i < 20; i++) {
      layers.push({ id: `empty${i}`, type: "rectangle", name: `Empty ${i}`, props: { opacity: { link: `none_${i}.output` }, scale: { link: `grow_${i}.output` } } } as never);
      patches[`none_${i}`] = { type: "splitter", inputs: { value: { link: "none.output" } } };
      patches[`touch_${i}`] = { type: "interaction", inputs: { layer: { layer: `empty${i}` } } };
      patches[`grow_${i}`] = { type: "transition", inputs: { progress: { link: `touch_${i}.down` } } };
    }
    const rt = createTestRuntime(buildDoc({ layers, patches }, reg), reg);
    // 0.87 ms alone.
    const limit = budget(3, 12);
    const ms = perFrame(rt, { warm: 30, frames: 40 });
    report("1,000 copies beside 20 empty lists", ms, `budget ${limit}`);
    expect(rt.scene().roots).toHaveLength(1000);
    expect(rt.issues().filter((i) => i.code === "empty_loop")).toHaveLength(20);
    expect(ms).toBeLessThan(limit);
  });

  it("repeats a layer 5,000 times through Repeat about as fast as through its own looped property", () => {
    const copies = (props: Record<string, unknown>) => {
      const rt = createTestRuntime(buildDoc({ layers: [{ id: "dot", type: "rectangle", name: "Dot", props: props as never }], patches: { rows: { type: "loop", inputs: { count: 5000 } } } }));
      const ms = perFrame(rt, { warm: 10, frames: 10 });
      expect(rt.scene().roots).toHaveLength(5000);
      return ms;
    };
    const auto = copies({ opacity: { link: "rows.index" } });
    // Repeat reads the loop's length; copying the whole loop into every copy would cost 5,000² per frame.
    const repeat = copies({ repeat: { link: "rows.index" } });
    report("5,000 copies by a looped property", auto, "the measure for Repeat");
    report("5,000 copies by Repeat", repeat, "budget 3x the looped property");
    expect(repeat).toBeLessThan(Math.max(budget(8, 24), auto * 3));
  });

  it("builds 500 different layers about as fast as 5 layers copied 100 times", () => {
    // An imported screen is hundreds of different layers. Their props inherit one defaults object per
    // layer type (compile.ts defaultsFor); with one per layer this ratio was about 5.
    const reg = createMockRegistry([]);
    const different = createTestRuntime(buildDoc({ layers: shapedLayers(500, 25) as never }, reg), reg);
    const copied = createTestRuntime(buildDoc({ layers: shapedLayers(5, 5).map((layer) => ({ ...layer, props: { ...layer.props, repeat: 100 } })) as never }, reg), reg);
    const copies = perFrame(copied, { warm: 30, frames: 40 });
    const layers = perFrame(different, { warm: 30, frames: 40 });
    report("5 layers x 100 copies", copies, "the measure for different layers");
    report("500 different layers in 25 shapes", layers, "budget 2.5x the copies");
    expect([different.scene().roots.length, copied.scene().roots.length]).toEqual([500, 500]);
    expect(layers).toBeLessThan(copies * 2.5);
  });

  it("runs a mixed document (patches, layers and a loop) under taps within the frame budget", () => {
    const reg = createMockRegistry([]);
    const layers: { id: string; type: string; name: string; props: Record<string, unknown>; children?: unknown[] }[] = [];
    const patches: Record<string, PatchInput> = {};
    const center = (card: number): [number, number] => [6 + (card % 4) * 96 + 45, 6 + Math.floor(card / 4) * 76 + 35];
    // 40 cards of 11 layers; a tap flips a switch that springs the card's scale and fade, and a chain of sums follows the spring.
    for (let c = 0; c < 40; c++) {
      const [x, y] = center(c);
      const children: unknown[] = [
        { id: `bg${c}`, type: "rectangle", name: `Bg ${c}`, props: { size: [90, 70], color: "#FFFFFFFF", cornerRadius: 12, opacity: { link: `fade${c}.output` } } },
        { id: `avatar${c}`, type: "oval", name: `Avatar ${c}`, props: { size: [24, 24], position: [8, 8], color: "#0A84FFFF" } },
        { id: `title${c}`, type: "text", name: `Title ${c}`, props: { text: `Card ${c}`, position: [38, 8], fontSize: 13 } },
        { id: `sub${c}`, type: "text", name: `Sub ${c}`, props: { text: "Tonight · 214 going", position: [38, 26], fontSize: 10 } },
      ];
      for (let k = 0; k < 6; k++) {
        const props: Record<string, unknown> = { size: [10, 6], position: [8 + k * 13, 54], color: "#30D158FF" };
        if (k === 0) props.opacity = { link: `sum${c}_18.output` };
        children.push({ id: `bar${c}_${k}`, type: "rectangle", name: `Bar ${c}.${k}`, props });
      }
      layers.push({ id: `card${c}`, type: "group", name: `Card ${c}`, props: { position: [x - 45, y - 35], size: [90, 70], scale: { link: `scale${c}.output` } }, children });
      patches[`touch${c}`] = { type: "interaction", inputs: { layer: { layer: `card${c}` } } };
      patches[`toggle${c}`] = { type: "switch", inputs: { flip: { link: `touch${c}.tap` } } };
      patches[`pop${c}`] = { type: "popAnimation", inputs: { number: { link: `toggle${c}.on` }, bounciness: 8 } };
      patches[`scale${c}`] = { type: "transition", inputs: { progress: { link: `pop${c}.output` }, start: 1, end: 1.08 } };
      patches[`fade${c}`] = { type: "transition", inputs: { progress: { link: `pop${c}.output` }, start: 1, end: 0.6 } };
      for (let k = 0; k < 19; k++) patches[`sum${c}_${k}`] = { type: "add", inputs: { value1: { link: k === 0 ? `pop${c}.output` : `sum${c}_${k - 1}.output` }, value2: 0.01 } };
    }
    // 60 still layers in a dozen shapes, below the cards.
    for (let d = 0; d < 60; d++) {
      const { type, props } = shapedLayer(d, 12);
      layers.push({ id: `still${d}`, type, name: `Still ${d}`, props: { ...props, position: [d * 6, 790] } });
    }
    // One layer copied 1,000 times, each copy tappable.
    layers.push({ id: "row", type: "rectangle", name: "Row", props: { size: [3, 3], position: [386, 840], color: "#FF375FFF", opacity: { link: "rows.index" }, scale: { link: "grow.output" } } });
    patches.rows = { type: "loop", inputs: { count: 1000 } };
    patches.rowTouch = { type: "interaction", inputs: { layer: { layer: "row" } } };
    patches.rowToggle = { type: "switch", inputs: { flip: { link: "rowTouch.tap" } } };
    patches.grow = { type: "transition", inputs: { progress: { link: "rowToggle.on" }, start: 1, end: 1.1 } };

    const rt = createTestRuntime(buildDoc({ layers: layers as never, patches }, reg), reg);
    // 1.5 ms alone (3.3 to 3.8 ms before layers shared their type's defaults and kept their references).
    const limit = budget(5, 24);
    // A tap on the next card every 6 frames, so a few springs are always running.
    const ms = perFrame(rt, {
      warm: 60,
      frames: 60,
      before: (step) => {
        const [x, y] = center(Math.floor(step / 6) % 40);
        if (step % 6 === 0) rt.dispatch([pointerEvent("down", x, y)]);
        else if (step % 6 === 1) rt.dispatch([pointerEvent("up", x, y)]);
      },
    });
    report("mixed: 964 patches, 501 layers, 1,000 copies, a tap every 6 frames", ms, `budget ${limit}`);
    expect(Object.keys(patches)).toHaveLength(964);
    expect(rt.scene().roots).toHaveLength(40 + 60 + 1000);
    // 60 taps over the 360 steps: the first 20 cards twice (on, then off), the others once.
    expect([rt.getValue("toggle0.on"), rt.getValue("toggle39.on")]).toEqual([false, true]);
    expect(rt.needsNextFrame).toBe(true);
    expect(ms).toBeLessThan(limit);
  });

  it("comes to rest on a still screen of 500 layers, whatever a frame costs", () => {
    const rt = createTestRuntime(buildDoc({ layers: shapedLayers(500, 25) as never }));
    for (let i = 0; i < 3; i++) rt.step();
    expect(rt.resting).toBe(true);
    expect(rt.scene().roots).toHaveLength(500);
  });
});
