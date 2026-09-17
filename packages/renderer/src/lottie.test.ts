// @vitest-environment happy-dom
import type { SceneFrame, SceneNode } from "@sonobe/engine";
import type { AnimationItem } from "lottie-web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaState } from "./host.ts";
import { advancePlayhead, frameForTime, isLottieData, readLottieSource } from "./lottie.ts";
import type { LottieLoader } from "./lottie.ts";
import { createDomRenderer } from "./renderer.ts";
import type { DomRenderer, DomRendererOptions } from "./renderer.ts";

const mat = (x = 0, y = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1];

/** 2 seconds at 30 fps. */
const DATA = { v: "5.7.4", nm: "Spinner", fr: 30, ip: 0, op: 60, w: 100, h: 100, layers: [] };

class FakeAnimation {
  config: Record<string, unknown>;
  isLoaded: boolean;
  totalFrames = 60;
  frameRate = 30;
  frames: number[] = [];
  destroyed = false;
  private readonly listeners = new Map<string, (() => void)[]>();

  constructor(config: Record<string, unknown>, loaded: boolean) {
    this.config = config;
    this.isLoaded = loaded;
  }

  goToAndStop(frame: number): void {
    this.frames.push(frame);
  }

  destroy(): void {
    this.destroyed = true;
  }

  addEventListener(name: string, cb: () => void): () => void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), cb]);
    return () => {};
  }

  fire(name: string): void {
    for (const cb of this.listeners.get(name) ?? []) cb();
  }
}

function fakePlayer(loaded = true) {
  const animations: FakeAnimation[] = [];
  const loader = vi.fn<LottieLoader>(() =>
    Promise.resolve({
      loadAnimation(config: Record<string, unknown>) {
        const anim = new FakeAnimation(config, loaded);
        (config.container as HTMLElement).appendChild(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
        animations.push(anim);
        return anim as unknown as AnimationItem;
      },
    } as never),
  );
  return { loader, animations };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("lottie helpers", () => {
  it("wraps looping playheads and clamps others", () => {
    expect(advancePlayhead(1.5, 1, 2, true)).toBeCloseTo(0.5);
    expect(advancePlayhead(0.25, -0.5, 2, true)).toBeCloseTo(1.75);
    expect(advancePlayhead(1.5, 1, 2, false)).toBe(2);
    expect(advancePlayhead(0.5, -1, 2, false)).toBe(0);
    expect(advancePlayhead(1, 1, 0, true)).toBe(0);
  });

  it("maps time to a drawable frame", () => {
    expect(frameForTime(0.5, 30, 60)).toBe(15);
    expect(frameForTime(2, 30, 60)).toBe(59);
    expect(frameForTime(-1, 30, 60)).toBe(0);
  });

  it("reads assets, URLs, JSON text, and inline animations", () => {
    const resolve = (id: string) => (id === "spin" ? "https://cdn.test/anim/spin%20v2.json?x=1" : undefined);
    expect(readLottieSource({ asset: "spin" }, resolve)).toEqual({ kind: "url", url: "https://cdn.test/anim/spin%20v2.json?x=1", label: "spin" });
    expect(readLottieSource("https://cdn.test/a/confetti.json", resolve)).toEqual({ kind: "url", url: "https://cdn.test/a/confetti.json", label: "confetti.json" });
    expect(readLottieSource({ url: "https://cdn.test/a/b%20c.json" }, resolve)).toMatchObject({ kind: "url", label: "b c.json" });
    expect(readLottieSource(DATA, resolve)).toEqual({ kind: "data", data: DATA, label: "Spinner" });
    expect(readLottieSource(JSON.stringify(DATA), resolve)).toMatchObject({ kind: "data", label: "Spinner" });
    expect(readLottieSource({ json: DATA }, resolve)).toMatchObject({ kind: "data" });
    expect(readLottieSource({ assetId: "gone" }, resolve)).toEqual({ kind: "missing", label: "gone" });
    expect(readLottieSource("{ nope", resolve)).toMatchObject({ kind: "invalid" });
    expect(readLottieSource({ layers: [] }, resolve)).toMatchObject({ kind: "invalid" });
    expect(readLottieSource(null, resolve)).toBeNull();
    expect(isLottieData(DATA)).toBe(true);
    expect(isLottieData([DATA])).toBe(false);
  });
});

describe("lottie layers", () => {
  let container: HTMLElement;
  let renderer: DomRenderer;
  let media: MediaState[];

  const make = (opts: Partial<DomRendererOptions>) => {
    renderer?.dispose();
    media = [];
    renderer = createDomRenderer(container, { resolveAssetUrl: (id) => `https://cdn.test/${id}.json`, onMediaState: (_k, _l, s) => media.push(s), captureInput: false, ...opts });
  };
  const lottie = (props: Record<string, unknown>, extra: Partial<SceneNode> = {}): SceneNode => ({
    key: "anim", layerId: "anim", type: "lottie", parentKey: null, x: 0, y: 0, width: 120, height: 120, transform: mat(), worldTransform: mat(), opacity: 1, visible: true, clip: false, props, children: [], ...extra,
  });
  const draw = (time: number, ...roots: SceneNode[]) => renderer.render({ frame: 1, time, size: [390, 844], background: { r: 1, g: 1, b: 1, a: 1 }, roots } as SceneFrame);
  const body = () => renderer.elementForKey("anim")!.querySelector(":scope > .sonobe-body") as HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    renderer.dispose();
    container.remove();
    vi.unstubAllGlobals();
  });

  it("plays inline data on the SceneFrame clock and reports time", async () => {
    const { loader, animations } = fakePlayer();
    make({ loadLottie: loader });
    draw(10, lottie({ animation: DATA }));
    await flush();
    const anim = animations[0]!;
    expect(anim.config).toMatchObject({ renderer: "svg", autoplay: false, loop: false });
    expect(anim.config.animationData).toEqual(DATA);
    expect(anim.config.animationData).not.toBe(DATA);
    expect(body().querySelector(".sonobe-lottie svg")).not.toBeNull();
    expect(media.at(-1)).toEqual({ currentTime: 0, duration: 2 });
    draw(10.5, lottie({ animation: DATA }));
    expect(anim.frames.at(-1)).toBe(15);
    expect(media.at(-1)).toEqual({ currentTime: 0.5, duration: 2 });
    draw(12.5, lottie({ animation: DATA }));
    expect(anim.frames.at(-1)).toBeCloseTo(15);
    draw(14, lottie({ animation: DATA, loop: false }));
    expect(anim.frames.at(-1)).toBe(59);
    expect(media.at(-1)).toEqual({ currentTime: 2, duration: 2 });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("hands the player unshared copies of inline data", async () => {
    const { loader, animations } = fakePlayer();
    make({ loadLottie: loader });
    const shared = { ty: "tr", p: { a: 0, k: [0, 0] } };
    const data = { ...DATA, layers: [{ ty: 4, shapes: [{ ty: "gr", it: [shared] }, { ty: "gr", it: [shared] }] }] };
    draw(0, lottie({ animation: data }));
    await flush();
    const copy = animations[0]!.config.animationData as typeof data;
    expect(copy).toEqual(data);
    expect(copy.layers[0]!.shapes[0]!.it[0]).not.toBe(copy.layers[0]!.shapes[1]!.it[0]);
  });

  it("honors playing, rate, scrub, restart, and fill mode", async () => {
    const { loader, animations } = fakePlayer();
    make({ loadLottie: loader });
    draw(0, lottie({ animation: DATA, rate: -1, fillMode: "fill" }));
    await flush();
    const anim = animations[0]!;
    expect(anim.frames.at(-1)).toBe(59);
    expect(body().querySelector("svg")!.getAttribute("preserveAspectRatio")).toBe("xMidYMid slice");
    draw(0.5, lottie({ animation: DATA, rate: -1 }));
    expect(anim.frames.at(-1)).toBeCloseTo(45);
    draw(1.5, lottie({ animation: DATA, rate: -1, playing: false }));
    expect(anim.frames.at(-1)).toBeCloseTo(45);
    draw(1.6, lottie({ animation: DATA, scrub: true, scrubTime: 1 }));
    expect(anim.frames.at(-1)).toBe(30);
    draw(1.7, lottie({ animation: DATA, scrub: true, scrubTime: 9 }));
    expect(anim.frames.at(-1)).toBe(59);
    draw(0.2, lottie({ animation: DATA, rate: 2 }));
    expect(anim.frames.at(-1)).toBe(0);
    draw(0.4, lottie({ animation: DATA, rate: 2, fillMode: "stretch" }));
    expect(anim.frames.at(-1)).toBeCloseTo(12);
    expect(body().querySelector("svg")!.getAttribute("preserveAspectRatio")).toBe("none");
  });

  it("skips drawing while hidden but keeps time", async () => {
    const { loader, animations } = fakePlayer();
    make({ loadLottie: loader });
    draw(0, lottie({ animation: DATA }));
    await flush();
    const anim = animations[0]!;
    const drawn = anim.frames.length;
    draw(0.5, lottie({ animation: DATA }, { opacity: 0 }));
    expect(anim.frames.length).toBe(drawn);
    draw(1, lottie({ animation: DATA }));
    expect(anim.frames.at(-1)).toBe(30);
  });

  it("waits for the player to finish loading before drawing", async () => {
    const { loader, animations } = fakePlayer(false);
    make({ loadLottie: loader });
    draw(0, lottie({ animation: DATA, scrub: true, scrubTime: 0.5 }));
    await flush();
    const anim = animations[0]!;
    expect(anim.frames).toEqual([]);
    expect(media).toEqual([]);
    anim.isLoaded = true;
    anim.fire("DOMLoaded");
    expect(anim.frames).toEqual([15]);
    expect(media.at(-1)).toEqual({ currentTime: 0.5, duration: 2 });
  });

  it("loads animations from asset URLs once and replaces them when the source changes", async () => {
    const fetchMock = vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify({ ...DATA, nm: url }))));
    vi.stubGlobal("fetch", fetchMock);
    const { loader, animations } = fakePlayer();
    make({ loadLottie: loader });
    draw(0, lottie({ animation: { assetId: "spin-once" } }), lottie({ animation: { assetId: "spin-once" } }, { key: "anim2", layerId: "anim2" }));
    await vi.waitFor(() => expect(animations.length).toBe(2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(animations[0]!.config.assetsPath).toBe("https://cdn.test/");
    expect(animations[0]!.config.animationData).not.toBe(animations[1]!.config.animationData);
    draw(0.1, lottie({ animation: DATA }), lottie({ animation: { assetId: "spin-once" } }, { key: "anim2", layerId: "anim2" }));
    await flush();
    expect(animations[0]!.destroyed).toBe(true);
    expect(animations.length).toBe(3);
    renderer.dispose();
    expect(animations[1]!.destroyed && animations[2]!.destroyed).toBe(true);
  });

  it("shows a placeholder when loading fails", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(url.includes("dot") ? new Response("PKzip") : url.includes("bad") ? new Response("{}") : new Response("nope", { status: 404 }))));
    const { loader } = fakePlayer();
    make({ loadLottie: loader });
    const label = (key: string) => renderer.elementForKey(key)!.querySelector(".sonobe-placeholder")?.textContent;
    draw(
      0,
      lottie({ animation: { assetId: "missing-file" } }, { key: "a", layerId: "a" }),
      lottie({ animation: { assetId: "dot-file" } }, { key: "b", layerId: "b" }),
      lottie({ animation: { assetId: "bad-file" } }, { key: "c", layerId: "c" }),
    );
    await vi.waitFor(() => expect(label("c")).toBeTruthy());
    await vi.waitFor(() => expect(label("a")).toBeTruthy());
    expect(label("a")).toBe("Couldn't load Lottie\nmissing-file");
    expect(label("b")).toMatch(/^dotLottie files aren't supported yet/);
    expect(label("c")).toBe("Not a Lottie animation\nbad-file");
  });

  it("shows a placeholder when the player module fails to load", async () => {
    make({ loadLottie: () => Promise.reject(new Error("chunk failed")) });
    draw(0, lottie({ animation: DATA }));
    await flush();
    await flush();
    expect(body().querySelector(".sonobe-placeholder")!.textContent).toBe("Lottie player failed to load");
  });
});
