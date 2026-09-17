import type { PatchDefinition, SceneFrame, SceneNode } from "@sonobe/engine";
import { buildDoc, createMockRegistry, createTestRuntime, runFrames, runPatch, sequenceDefinition, tap } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { definitions } from "./index.ts";

const registryWith = (extra: readonly PatchDefinition[] = []) => createMockRegistry([...definitions, ...extra]);

function nodesOf(frame: SceneFrame, layerId: string): SceneNode[] {
  const out: SceneNode[] = [];
  const visit = (node: SceneNode) => {
    if (node.layerId === layerId) out.push(node);
    node.children.forEach(visit);
  };
  frame.roots.forEach(visit);
  return out;
}

describe("loop patches in a running prototype", () => {
  it("lays out repeated cards, then shows the tapped card's name and opens a sheet", () => {
    const registry = registryWith();
    const doc = buildDoc(
      {
        layers: [{ id: "card", type: "rectangle", name: "Card", props: { position: { link: "grid.position" }, size: { link: "grid.size" } } }],
        patches: {
          names: { type: "loopBuilder", typeParam: "text", inputCount: 3, inputs: { item0: "Tokyo", item1: "Lisbon", item2: "Oaxaca" } },
          grid: { type: "gridLayout", inputs: { index: { link: "names.index" }, columns: 3, origin: [16, 120], width: 370, itemHeight: 120, spacing: 8 } },
          tap_card: { type: "interaction", inputs: { layer: { layer: "card" } } },
          which: { type: "loopOptionSwitch", inputs: { select: { link: "tap_card.tap" } } },
          chosen: { type: "loopSelect", typeParam: "text", inputs: { loop: { link: "names.loop" }, index: { link: "which.option" } } },
          tapped_any: { type: "loopAny", inputs: { loop: { link: "tap_card.tap" } } },
          open: { type: "switch", inputs: { turnOn: { link: "tapped_any.output" } } },
        },
      },
      registry,
    );
    const rt = createTestRuntime(doc, registry);
    const [first] = runFrames(rt, 1);
    expect(nodesOf(first!, "card").map((n) => [n.x, n.y, n.width, n.height])).toEqual([
      [16, 120, 118, 120],
      [142, 120, 118, 120],
      [268, 120, 118, 120],
    ]);
    expect(rt.getValue("chosen.output")).toBe("Tokyo");
    expect(rt.getValue("open.on")).toBe(false);

    runFrames(rt, 2, tap(327, 180));
    expect(rt.getValue("which.option")).toBe(2);
    expect(rt.getValue("chosen.output")).toBe("Oaxaca");
    expect(rt.getValue("tapped_any.output")).toBe(true);
    expect(rt.getValue("open.on")).toBe(true);

    runFrames(rt, 2);
    expect(rt.getValue("tapped_any.output")).toBe(false);
    expect(rt.getValue("chosen.output")).toBe("Oaxaca");
    expect(rt.issues()).toEqual([]);
  });

  it("appends, undoes, counts, and packs list items frame by frame", () => {
    const adds = sequenceDefinition("adds", "pulse", [false, true, true, true, false, false]);
    const undos = sequenceDefinition("undos", "pulse", [false, false, false, false, true, false]);
    const registry = registryWith([adds, undos]);
    const doc = buildDoc(
      {
        layers: [{ id: "label", type: "text", name: "Label", props: { text: { link: "shown.output" } } }],
        patches: {
          adds: { type: "adds" },
          undos: { type: "undos" },
          added: { type: "loopAppend", typeParam: "text", inputs: { value: "dot", append: { link: "adds.value" } } },
          shown: { type: "loopRemoveLast", typeParam: "text", inputs: { loop: { link: "added.output" }, removeLast: { link: "undos.value" } } },
          count: { type: "loopCount", inputs: { loop: { link: "shown.output" } } },
          packed: { type: "loopToArray", inputs: { loop: { link: "shown.output" } } },
        },
      },
      registry,
    );
    const rt = createTestRuntime(doc, registry);
    const counts: unknown[] = [];
    for (let i = 0; i < 6; i++) {
      rt.step();
      counts.push(rt.getValue("count.count"));
    }
    expect(counts).toEqual([0, 1, 2, 3, 2, 2]);
    expect(rt.getValue("packed.array")).toEqual(["dot", "dot"]);
    expect(nodesOf(rt.scene(), "label").map((n) => n.props.text)).toEqual(["dot", "dot"]);
    expect(rt.issues()).toEqual([]);
  });

  it("muting a loop patch never changes how many copies a layer makes", () => {
    const registry = registryWith();
    const base = buildDoc(
      {
        layers: [
          { id: "card", type: "rectangle", name: "Card", props: { position: { link: "pos.loop" }, size: [10, 10] } },
          { id: "total", type: "rectangle", name: "Total", props: { size: [10, 10], opacity: { link: "sum.sum" } } },
        ],
        patches: {
          pos: { type: "loopBuilder", typeParam: "point", inputCount: 3, inputs: { item0: [0, 0], item1: [20, 0], item2: [40, 0] } },
          fades: { type: "loopBuilder", typeParam: "number", inputCount: 3, inputs: { item0: 0.1, item1: 0.2, item2: 0.3 } },
          sum: { type: "loopSum", typeParam: "number", inputs: { loop: { link: "fades.loop" } } },
        },
      },
      registry,
    );
    const run = (muted: readonly string[]) => {
      const doc = structuredClone(base);
      for (const id of muted) doc.components.main!.patches[id]!.muted = true;
      const rt = createTestRuntime(doc, registry);
      const frame = rt.step();
      return { cards: nodesOf(frame, "card").length, totals: nodesOf(frame, "total").map((n) => n.props.opacity as number), loop: rt.getRawValue("pos.loop") };
    };
    const live = run([]);
    expect([live.cards, live.totals.length]).toEqual([3, 1]);
    expect(live.totals[0]).toBeCloseTo(0.6, 9);
    const muted = run(["pos", "sum"]);
    expect([muted.cards, muted.totals]).toEqual([3, [0]]);
    expect((muted.loop as { items: unknown[] }).items).toEqual([[0, 0], [20, 0], [40, 0]]);

    for (const type of ["loopAny", "loopAll"]) {
      const definition = definitions.find((d) => d.type === type)!;
      expect(runPatch(definition, [{ loop: { loop: [true, true] } }], { muted: true }).frames[0]!.outputs.output).toBe(false);
    }
  });

  it("shuffles a grid deterministically and follows a new Count", () => {
    const registry = registryWith();
    const docFor = (count: number) =>
      buildDoc(
        {
          layers: [{ id: "tile", type: "rectangle", name: "Tile", props: { position: { link: "grid.position" }, size: { link: "grid.size" } } }],
          patches: {
            start: { type: "whenPrototypeStarts" },
            rows: { type: "loop", inputs: { count } },
            order: { type: "loopShuffle", typeParam: "index", inputs: { loop: { link: "rows.index" }, shuffle: { link: "start.started" } } },
            grid: { type: "gridLayout", inputs: { index: { link: "order.output" }, columns: 2, width: 316, itemHeight: 100, spacing: 8 } },
            total: { type: "loopSum", inputs: { loop: { link: "order.output" } } },
          },
        },
        registry,
      );
    const positions = (frame: SceneFrame) => nodesOf(frame, "tile").map((n) => [n.x, n.y]);
    const inOrder = [
      [0, 0],
      [162, 0],
      [0, 108],
      [162, 108],
    ];

    const rt = createTestRuntime(docFor(4), registry);
    const [frame0] = runFrames(rt, 1);
    const shuffled = positions(frame0!);
    expect([...shuffled].sort()).toEqual([...inOrder].sort());
    expect(shuffled).not.toEqual(inOrder);
    expect(rt.getValue("total.sum")).toBe(6);

    const again = createTestRuntime(docFor(4), registry);
    expect(positions(runFrames(again, 1)[0]!)).toEqual(shuffled);

    rt.updateDocument(docFor(2));
    const [smaller] = runFrames(rt, 1);
    expect(positions(smaller!)).toHaveLength(2);
    expect(rt.getValue("total.sum")).toBe(1);
    expect(rt.issues()).toEqual([]);
  });

  it("turns JSON data into unique labels", () => {
    const registry = registryWith();
    const doc = buildDoc(
      {
        layers: [{ id: "tag", type: "text", name: "Tag", props: { text: { link: "unique_tags.output" } } }],
        patches: {
          tags: { type: "loopOverArray", inputs: { array: { json: ["design", "music", "design", "travel", "music"] } } },
          unique_tags: { type: "loopDedupe", typeParam: "text", inputs: { loop: { link: "tags.items" } } },
          reversed: { type: "loopReverse", typeParam: "text", inputs: { loop: { link: "unique_tags.output" } } },
          packed: { type: "loopToArray", inputs: { loop: { link: "reversed.output" } } },
        },
      },
      registry,
    );
    const rt = createTestRuntime(doc, registry);
    const [frame] = runFrames(rt, 1);
    expect(nodesOf(frame!, "tag").map((n) => n.props.text)).toEqual(["design", "music", "travel"]);
    expect(rt.getValue("packed.array")).toEqual(["travel", "music", "design"]);
    expect(rt.issues()).toEqual([]);
  });
});
