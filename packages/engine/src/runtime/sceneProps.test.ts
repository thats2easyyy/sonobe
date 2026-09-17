import { describe, expect, it } from "vitest";
import { buildDoc, createTestRuntime } from "../testing/index.ts";
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
