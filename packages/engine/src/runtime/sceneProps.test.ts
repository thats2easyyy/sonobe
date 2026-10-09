import { resolveLayerProps } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { buildDoc, createMockRegistry, createTestRuntime, type ComponentInput } from "../testing/index.ts";
import type { SceneNode } from "../types.ts";
import { defaultsFor } from "./compile.ts";
import { plainProps, plainSceneFrame } from "./scene.ts";

describe("scene node props", () => {
  const doc = () =>
    buildDoc({
      layers: [
        { id: "card", type: "rectangle", name: "Card", props: { position: [10, 20], size: [100, 40], color: "#FF0000FF" } },
        { id: "dot", type: "oval", name: "Dot", props: { size: [8, 8], opacity: { loop: [0.25, 0.5, 1] } } },
      ],
    });

  it("reads defaults through the prototype and keeps only bound values as own properties", () => {
    const rt = createTestRuntime(doc());
    const frame = rt.step();
    const card = frame.roots[0]!;
    expect(card.props.color).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(card.props.cornerRadius).toBe(0);
    expect(card.props.enabled).toBe(true);
    expect(Object.keys(card.props).sort()).toEqual(["color", "position", "size"]);
    expect(Object.keys(plainProps(card.props))).toEqual(expect.arrayContaining(["color", "position", "size", "cornerRadius", "enabled", "opacity"]));

    const dots = frame.roots.slice(1);
    expect(dots.map((d) => d.key)).toEqual(["dot#0", "dot#1", "dot#2"]);
    expect(dots.map((d) => d.props.opacity)).toEqual([0.25, 0.5, 1]);
    // Every copy shares one defaults object.
    expect(Object.getPrototypeOf(dots[0]!.props)).toBe(Object.getPrototypeOf(dots[2]!.props));
    expect(dots[1]!.props.enabled).toBe(true);
  });

  it("flattens frames for JSON and structured clone", () => {
    const frame = createTestRuntime(doc()).step();
    const plain = plainSceneFrame(frame);
    const copied = JSON.parse(JSON.stringify(plain)) as typeof frame;
    expect(copied.roots[0]!.props.cornerRadius).toBe(0);
    expect(structuredClone(plain).roots[3]!.props.enabled).toBe(true);
    for (let i = 0; i < frame.roots.length; i++) {
      const node = frame.roots[i]!;
      for (const key in node.props) expect(copied.roots[i]!.props[key]).toEqual(node.props[key]);
    }
    expect(plain.roots[0]!.key).toBe("card");
  });
});

describe("layer defaults", () => {
  const defaultsOf = (node: SceneNode) => Object.getPrototypeOf(node.props) as Record<string, unknown>;

  it("shares one defaults object per layer type, across layers, documents and compiles", () => {
    const reg = createMockRegistry([]);
    const one = createTestRuntime(
      buildDoc({ layers: [{ id: "a", type: "rectangle", name: "A", props: { opacity: 0.5 } }, { id: "b", type: "rectangle", name: "B", props: { cornerRadius: 4, position: [10, 10] } }, { id: "o", type: "oval", name: "O", props: {} }] }, reg),
      reg,
    );
    const [a, b, o] = one.step().roots;
    expect(defaultsOf(a!)).toBe(defaultsOf(b!));
    expect(defaultsOf(o!)).not.toBe(defaultsOf(a!));
    const doc = buildDoc({ layers: [{ id: "x", type: "oval", name: "X", props: { size: [8, 8] } }, { id: "y", type: "rectangle", name: "Y", props: {} }] }, reg);
    const two = createTestRuntime(doc, reg);
    const [x, y] = two.step().roots;
    expect(defaultsOf(x!)).toBe(defaultsOf(o!));
    expect(defaultsOf(y!)).toBe(defaultsOf(a!));
    // A structural edit compiles again: still the same objects, so a renderer comparing props by prototype keeps its fast path.
    two.updateDocument(buildDoc({ layers: [{ id: "x", type: "oval", name: "X", props: { size: [8, 8] } }, { id: "z", type: "rectangle", name: "Z", props: {} }] }, reg));
    expect(two.step().roots.map(defaultsOf)).toEqual([defaultsOf(o!), defaultsOf(a!)]);
    expect(defaultsOf(two.scene().roots[1]!)).toBe(defaultsOf(a!));
  });

  it("gives a component instance layer defaults of its own, with its component's size and published inputs", () => {
    const component = (id: string, size: [number, number], title: string): ComponentInput => ({
      id,
      kind: "layerComponent",
      size,
      inputs: { title: { type: "text", default: title } },
      layers: [{ id: "label", type: "text", name: "Label", props: { text: { link: "$in.title" } } }],
    });
    const plain: ComponentInput = { id: "plain", kind: "layerComponent", size: [30, 30], layers: [{ id: "dot", type: "oval", name: "Dot", props: {} }] };
    const reg = createMockRegistry([]);
    const doc = buildDoc(
      {
        components: [component("card", [200, 100], "Untitled"), component("chip", [80, 24], "Chip"), plain],
        layers: [
          { id: "c1", type: "componentInstance", name: "Card", component: "card", props: {} },
          { id: "c2", type: "componentInstance", name: "Chip", component: "chip", props: {} },
          { id: "c3", type: "componentInstance", name: "Plain", component: "plain", props: {} },
          { id: "c4", type: "componentInstance", name: "Plain again", component: "plain", props: {} },
        ],
      },
      reg,
    );
    const [c1, c2, c3, c4] = createTestRuntime(doc, reg).step().roots;
    expect([c1!.props.title, c1!.props.size]).toEqual(["Untitled", [200, 100]]);
    expect([c2!.props.title, c2!.props.size]).toEqual(["Chip", [80, 24]]);
    expect([c3!.props.title, c3!.props.size]).toEqual([undefined, [30, 30]]);
    // Two instances with no published inputs resolve to the layer type's own props list: each still has its own defaults.
    expect(new Set([c1, c2, c3, c4].map((c) => defaultsOf(c!))).size).toBe(4);
    const base = defaultsFor(resolveLayerProps(doc, doc.project.root, { type: "componentInstance" }, reg)!);
    expect([base.title, base.size]).toEqual([undefined, [100, 100]]);
  });

  it("never writes a bound value into the shared defaults", () => {
    const reg = createMockRegistry([]);
    // Every prop of a rectangle bound, most to a value that isn't the default, some to a loop and some to a link.
    const props = resolveLayerProps(buildDoc({}, reg), "main", { type: "rectangle" }, reg)!;
    const shared = defaultsFor(props);
    const fresh = () => defaultsFor([...props]);
    expect(fresh()).not.toBe(shared);
    expect(fresh()).toEqual(shared);
    const bound: Record<string, unknown> = {};
    for (const p of props) {
      if (p.type === "number") bound[p.key] = p.key === "opacity" ? { link: "fade.output" } : 3;
      else if (p.type === "boolean") bound[p.key] = p.key === "enabled";
      else if (p.type === "color") bound[p.key] = { loop: ["#FF0000FF", "#00FF00FF"] };
      else if (p.type === "point" || p.type === "size" || p.type === "anchor") bound[p.key] = [7, 9];
    }
    expect(Object.keys(bound).length).toBeGreaterThan(15);
    const rt = createTestRuntime(
      buildDoc({ layers: [{ id: "all", type: "rectangle", name: "All", props: bound as never }, { id: "none", type: "rectangle", name: "None", props: {} }], patches: { fade: { type: "transition", inputs: { progress: 0.5 } } } }, reg),
      reg,
    );
    for (let i = 0; i < 5; i++) rt.step();
    const roots = rt.scene().roots;
    expect(roots.map((n) => n.key)).toEqual(["all#0", "all#1", "none"]);
    expect([roots[0]!.props.cornerRadius, roots[0]!.props.opacity, roots[2]!.props.cornerRadius, roots[2]!.props.opacity]).toEqual([3, 0.5, 0, 1]);
    expect(defaultsOf(roots[0]!)).toBe(shared);
    expect(shared).toEqual(fresh());
  });
});
