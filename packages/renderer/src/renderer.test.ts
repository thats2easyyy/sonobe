// @vitest-environment happy-dom
import type { SceneFrame, SceneNode } from "@sonobe/engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDomRenderer, lisIndices } from "./renderer.ts";
import type { DomRenderer } from "./renderer.ts";
import { writtenStyle } from "./style.ts";

function mat(x = 0, y = 0): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1];
}

function node(key: string, type: string, props: Record<string, unknown> = {}, children: SceneNode[] = [], extra: Partial<SceneNode> = {}): SceneNode {
  const x = extra.x ?? 0;
  const y = extra.y ?? 0;
  return {
    key,
    layerId: key.split("#")[0]!.split("/").at(-1)!,
    type,
    parentKey: null,
    x,
    y,
    width: 100,
    height: 50,
    transform: mat(x, y),
    worldTransform: mat(x, y),
    opacity: 1,
    visible: true,
    clip: false,
    props,
    children,
    ...extra,
  };
}

function frame(roots: SceneNode[], extra: Partial<SceneFrame> = {}): SceneFrame {
  return { frame: 1, time: 0, size: [390, 844], background: { r: 1, g: 1, b: 1, a: 1 }, roots, ...extra };
}

const stageKeys = (parent: Element) =>
  [...parent.children].filter((e) => e.classList.contains("sonobe-layer")).map((e) => (e as HTMLElement).dataset.key);

describe("createDomRenderer", () => {
  let container: HTMLElement;
  let renderer: DomRenderer;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    renderer = createDomRenderer(container, { resolveAssetUrl: (id) => `/assets/${id}` });
  });

  afterEach(() => {
    renderer.dispose();
    container.remove();
  });

  it("creates a stage sized to the frame with the background color", () => {
    renderer.render(frame([], { size: [402, 874], background: { r: 0, g: 0, b: 0, a: 1 } }));
    expect(renderer.stage.parentElement).toBe(container);
    expect(renderer.stage.style.width).toBe("402px");
    expect(renderer.stage.style.height).toBe("874px");
    expect(writtenStyle(renderer.stage, "background-color")).toBe("rgba(0, 0, 0, 1)");
  });

  it("adds, reorders, and removes keyed nodes while reusing elements", () => {
    const a = node("a", "rectangle");
    const b = node("b", "rectangle");
    const c = node("c", "rectangle");
    renderer.render(frame([a, b, c]));
    expect(stageKeys(renderer.stage)).toEqual(["a", "b", "c"]);
    const elA = renderer.elementForKey("a");
    const elC = renderer.elementForKey("c");

    renderer.render(frame([c, a, b]));
    expect(stageKeys(renderer.stage)).toEqual(["c", "a", "b"]);
    expect(renderer.elementForKey("a")).toBe(elA);
    expect(renderer.elementForKey("c")).toBe(elC);
    expect(renderer.getStats().moved).toBe(1);

    renderer.render(frame([c, a]));
    expect(stageKeys(renderer.stage)).toEqual(["c", "a"]);
    expect(renderer.elementForKey("b")).toBeUndefined();
    expect(renderer.getStats().removed).toBe(1);

    const d = node("d", "oval");
    renderer.render(frame([d, c, a]));
    expect(stageKeys(renderer.stage)).toEqual(["d", "c", "a"]);
    expect(renderer.getStats().created).toBe(4);
    expect(renderer.getStats().moved).toBe(1);
  });

  it("moves only the elements outside the longest stable run", () => {
    const keys = ["a", "b", "c", "d", "e"];
    renderer.render(frame(keys.map((k) => node(k, "rectangle"))));
    renderer.render(frame(["b", "c", "d", "e", "a"].map((k) => node(k, "rectangle"))));
    expect(stageKeys(renderer.stage)).toEqual(["b", "c", "d", "e", "a"]);
    expect(renderer.getStats().moved).toBe(1);
    renderer.render(frame(["e", "d", "c", "b", "a"].map((k) => node(k, "rectangle"))));
    expect(stageKeys(renderer.stage)).toEqual(["e", "d", "c", "b", "a"]);
  });

  it("nests children inside the parent's body", () => {
    renderer.render(frame([node("card", "group", {}, [node("title", "text", { text: "Hi" }), node("icon", "oval")])]));
    const card = renderer.elementForKey("card")!;
    const body = card.querySelector(":scope > .sonobe-body")!;
    expect(stageKeys(body)).toEqual(["title", "icon"]);
    expect(renderer.elementForKey("title")!.parentElement).toBe(body);
  });

  it("writes nothing when the same frame renders again", () => {
    const f = frame([
      node("card", "group", { color: "#FFFFFFFF", cornerRadius: 16, shadowOpacity: 0.3, shadowRadius: 12, strokeWidth: 1 }, [
        node("title", "text", { text: "Hello", fontSize: 20 }),
        node("path", "shape", { shape: { path: "M0 0 L10 10" }, strokeWidth: 2, strokeEnd: 0.5 }),
      ]),
      node("pic", "image", { image: { assetId: "photo" }, cornerRadius: 8, cornerSmoothing: 0.6, strokeWidth: 2 }),
    ]);
    renderer.render(f);
    const before = renderer.getStats();
    renderer.render(structuredClone(f));
    const after = renderer.getStats();
    expect(after.styleWrites).toBe(before.styleWrites);
    expect(after.attrWrites).toBe(before.attrWrites);
    expect(after.created).toBe(before.created);
  });

  it("writes only the changed style when one prop changes", () => {
    renderer.render(frame([node("r", "rectangle", { color: "#FF0000FF" })]));
    const before = renderer.getStats().styleWrites;
    renderer.render(frame([node("r", "rectangle", { color: "#00FF00FF" })]));
    expect(renderer.getStats().styleWrites - before).toBe(1);
    expect(writtenStyle(renderer.elementForKey("r")!.firstElementChild!, "background-color")).toBe("rgba(0, 255, 0, 1)");
  });

  it("writes only the transform when a box layer only moves", () => {
    const props = () => ({ color: "#FF0000FF", cornerRadius: 12, shadowOpacity: 0.4, shadowRadius: 6, strokeWidth: 2, strokeColor: "#000000FF", position: [0, 0] });
    renderer.render(frame([node("r", "rectangle", props())]));
    const before = renderer.getStats().styleWrites;
    renderer.render(frame([node("r", "rectangle", { ...props(), position: [10, 20] }, [], { x: 10, y: 20 })]));
    expect(renderer.getStats().styleWrites - before).toBe(1);
    expect(writtenStyle(renderer.elementForKey("r")!, "transform")).toBe("matrix(1, 0, 0, 1, 10, 20)");
    // Same matrix again: no string built, nothing written.
    renderer.render(frame([node("r", "rectangle", { ...props(), position: [10, 20] }, [], { x: 10, y: 20 })]));
    expect(renderer.getStats().styleWrites - before).toBe(1);
  });

  it("still redraws a box layer when a prop, its size, or the hit-target overlay changes", () => {
    renderer.render(frame([node("r", "rectangle", { color: "#FF0000FF" })]));
    renderer.render(frame([node("r", "rectangle", { color: "#00FF00FF" }, [], { x: 5 })]));
    const body = renderer.elementForKey("r")!.firstElementChild!;
    expect(writtenStyle(body, "background-color")).toBe("rgba(0, 255, 0, 1)");
    renderer.render(frame([node("r", "rectangle", { color: "#00FF00FF" }, [], { x: 5, width: 140 })]));
    expect(writtenStyle(renderer.elementForKey("r")!, "width")).toBe("140px");
    renderer.setShowHitTargets(true, ["r"]);
    expect(renderer.elementForKey("r")!.querySelector(".sonobe-hit")).not.toBeNull();
    renderer.setShowHitTargets(false);
    expect(renderer.elementForKey("r")!.querySelector(".sonobe-hit")).toBeNull();
  });

  it("reads props inherited from shared defaults", () => {
    renderer.render(frame([node("r", "rectangle", Object.create({ color: "#0000FFFF", cornerRadius: 8 }) as Record<string, unknown>)]));
    const body = renderer.elementForKey("r")!.firstElementChild!;
    expect(writtenStyle(body, "background-color")).toBe("rgba(0, 0, 255, 1)");
    expect(writtenStyle(body, "border-radius")).toBe("8px");
  });

  it("moves a keyed node to a new parent without recreating it", () => {
    const child = node("child", "rectangle");
    renderer.render(frame([node("g1", "group", {}, [child]), node("g2", "group")]));
    const el = renderer.elementForKey("child");
    renderer.render(frame([node("g1", "group"), node("g2", "group", {}, [child])]));
    expect(renderer.elementForKey("child")).toBe(el);
    expect(el!.parentElement!.parentElement).toBe(renderer.elementForKey("g2"));
    expect(renderer.getStats().created).toBe(3);
  });

  it("recreates the element when a key changes type", () => {
    renderer.render(frame([node("x", "rectangle")]));
    const el = renderer.elementForKey("x");
    renderer.render(frame([node("x", "text", { text: "now text" })]));
    expect(renderer.elementForKey("x")).not.toBe(el);
    expect(renderer.elementForKey("x")!.dataset.type).toBe("text");
    expect(el!.isConnected).toBe(false);
  });

  it("maps transform, size, opacity, and visibility", () => {
    const rotated = [0.5, 0.866, 0, 0, -0.866, 0.5, 0, 0, 0, 0, 1, 0, 10, 20, 0, 1];
    const perspective = [1, 0, 0, 0, 0, 1, 0, -0.002, 0, 0, 1, 0, 5, 5, 0, 1];
    renderer.render(
      frame([
        node("a", "rectangle", {}, [], { transform: rotated, width: 120.5, height: 60, opacity: 0.25 }),
        node("b", "rectangle", {}, [], { transform: perspective, visible: false }),
        node("c", "rectangle", {}, [], { transform: [], x: 7, y: 9 }),
      ]),
    );
    const a = renderer.elementForKey("a")!;
    expect(writtenStyle(a, "transform")).toBe("matrix(0.5, 0.866, -0.866, 0.5, 10, 20)");
    expect(a.style.width).toBe("120.5px");
    expect(a.style.opacity).toBe("0.25");
    const b = renderer.elementForKey("b")!;
    expect(writtenStyle(b, "transform")).toMatch(/^matrix3d\(1, 0, 0, 0, 0, 1, 0, -0.002/);
    expect(b.style.display).toBe("none");
    expect(writtenStyle(renderer.elementForKey("c")!, "transform")).toBe("matrix(1, 0, 0, 1, 7, 9)");
  });

  it("hides layers whose enabled prop is off", () => {
    renderer.render(frame([node("a", "rectangle", { enabled: false })]));
    expect(renderer.elementForKey("a")!.style.display).toBe("none");
  });

  it("renders clones as keyed copies of the source subtree", () => {
    const source = node("card", "group", { color: "#FF0000FF" }, [node("title", "text", { text: "Original" })], { x: 40, y: 80 });
    const clone = node("copy", "clone", { source: { layerId: "card" } }, [], { x: 200, y: 80 });
    renderer.render(frame([source, clone]));
    const copyEl = renderer.elementForKey("copy")!;
    const inner = renderer.elementForKey("copy⧉card")!;
    expect(inner.parentElement!.parentElement).toBe(copyEl);
    expect(writtenStyle(inner, "transform")).toBe("matrix(1, 0, 0, 1, 0, 0)");
    expect(renderer.elementForKey("copy⧉title")!.textContent).toBe("Original");
    renderer.render(frame([node("card", "group", {}, [node("title", "text", { text: "Changed" })], { x: 40, y: 80 }), clone]));
    expect(renderer.elementForKey("copy⧉title")!.textContent).toBe("Changed");
  });

  it("guards against clones that copy themselves", () => {
    const group = node("g", "group", {}, [node("c", "clone", { source: "g" })]);
    renderer.render(frame([group]));
    expect(renderer.elementForKey("c")).toBeDefined();
    expect(renderer.getStats().created).toBeLessThan(40);
  });

  it("keeps duplicate keys as separate elements", () => {
    renderer.render(frame([node("dup", "rectangle"), node("dup", "rectangle")]));
    expect(renderer.stage.querySelectorAll(".sonobe-layer").length).toBe(2);
  });

  it("scales the stage", () => {
    renderer.render(frame([]));
    renderer.setScale(0.5);
    expect(writtenStyle(renderer.stage, "transform")).toBe("scale(0.5)");
  });

  it("restores the container on dispose", () => {
    renderer.render(frame([node("a", "rectangle")]));
    renderer.dispose();
    expect(container.querySelector(".sonobe-stage")).toBeNull();
    expect(container.hasAttribute("tabindex")).toBe(false);
    expect(container.style.touchAction).toBe("");
  });
});

describe("lisIndices", () => {
  it("finds the longest increasing run and ignores new items", () => {
    expect([...lisIndices([1, 2, 3, 0])].sort()).toEqual([0, 1, 2]);
    expect(lisIndices([-1, -1]).size).toBe(0);
    expect([...lisIndices([0, -1, 1])].sort()).toEqual([0, 2]);
    expect(lisIndices([3, 2, 1, 0]).size).toBe(1);
  });
});
