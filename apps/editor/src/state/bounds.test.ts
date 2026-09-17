import { describe, expect, it, vi } from "vitest";
import { createBoundsRegistry, isBoundsMethod, rectOfElement, type BoundsRect } from "./bounds.ts";

describe("bounds registry", () => {
  it("answers with the newest provider, falling back to defaults", async () => {
    const registry = createBoundsRegistry();
    const changes = vi.fn();
    registry.subscribe(changes);
    expect(registry.methods()).toEqual([]);
    expect(await registry.measure("canvas.bounds")).toBeNull();

    const offFallback = registry.register("viewer.layerBounds", () => ({ x: 0, y: 0, width: 10, height: 10 }), { fallback: true });
    const offPanel = registry.register("viewer.layerBounds", (params) => ({ x: 5, y: 6, width: 20, height: 30, scale: 2, layer: params.layerId }) as BoundsRect);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(registry.methods()).toEqual(["viewer.layerBounds"]);
    expect(await registry.measure("viewer.layerBounds", { layerId: "card" })).toEqual({ x: 5, y: 6, width: 20, height: 30, scale: 2 });

    offPanel();
    offPanel();
    expect(await registry.measure("viewer.layerBounds")).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    offFallback();
    expect(registry.methods()).toEqual([]);
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it("normalizes what providers return", async () => {
    const registry = createBoundsRegistry();
    registry.register("canvas.bounds", async () => ({ x: Number.NaN, y: 0, width: 1, height: 1 }));
    registry.register("graph.bounds", () => ({ x: 1, y: 2, width: -5, height: 4, scale: 0 }));
    expect(await registry.measure("canvas.bounds")).toBeNull();
    expect(await registry.measure("graph.bounds")).toEqual({ x: 1, y: 2, width: 0, height: 4 });
  });

  it("measures elements", () => {
    const el = { isConnected: true, getBoundingClientRect: () => ({ left: 10, top: 20, width: 300, height: 200 }) } as unknown as Element;
    expect(rectOfElement(el, 1.5)).toEqual({ x: 10, y: 20, width: 300, height: 200, scale: 1.5 });
    expect(rectOfElement(el, Number.NaN)).toEqual({ x: 10, y: 20, width: 300, height: 200 });
    expect(rectOfElement(null)).toBeNull();
    expect(rectOfElement({ isConnected: false } as Element)).toBeNull();
    expect(isBoundsMethod("graph.bounds")).toBe(true);
    expect(isBoundsMethod("document.info")).toBe(false);
  });
});
