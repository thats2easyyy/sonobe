// @vitest-environment happy-dom
import type { InputEvent, SceneFrame, SceneNode } from "@sonobe/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDomRenderer } from "./renderer.ts";
import type { DomRenderer, DomRendererOptions } from "./renderer.ts";
import { writtenStyle } from "./style.ts";
import { DomTextMeasurer } from "./textMeasurer.ts";

const mat = (x = 0, y = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1];

function node(key: string, type: string, props: Record<string, unknown> = {}, extra: Partial<SceneNode> = {}): SceneNode {
  return { key, layerId: key, type, parentKey: null, x: 0, y: 0, width: 200, height: 100, transform: mat(), worldTransform: mat(), opacity: 1, visible: true, clip: false, props, children: [], ...extra };
}

const frame = (roots: SceneNode[]): SceneFrame => ({ frame: 3, time: 0.5, size: [390, 844], background: { r: 1, g: 1, b: 1, a: 1 }, roots });

describe("layer drawing", () => {
  let container: HTMLElement;
  let renderer: DomRenderer;
  const make = (opts: Partial<DomRendererOptions> = {}) => {
    renderer?.dispose();
    renderer = createDomRenderer(container, { resolveAssetUrl: (id) => `https://cdn.test/${id}.png`, ...opts });
    return renderer;
  };
  const draw = (...roots: SceneNode[]) => renderer.render(frame(roots));
  const el = (key: string) => renderer.elementForKey(key)!;
  const body = (key: string) => el(key).querySelector(":scope > .sonobe-body") as HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    make();
  });

  afterEach(() => {
    renderer.dispose();
    container.remove();
  });

  describe("group / rectangle / oval", () => {
    it("maps fill, radius, and clip", () => {
      draw(node("g", "group", { color: "#FF000080", cornerRadius: 12 }, { clip: true }));
      expect(writtenStyle(body("g"), "background-color")).toBe("rgba(255, 0, 0, 0.502)");
      expect(writtenStyle(body("g"), "border-radius")).toBe("12px");
      expect(writtenStyle(body("g"), "overflow")).toBe("hidden");
    });

    it("uses spec defaults: rectangles are light gray, groups transparent", () => {
      draw(node("r", "rectangle"), node("g", "group"));
      expect(writtenStyle(body("r"), "background-color")).toBe("rgba(217, 217, 217, 1)");
      expect(writtenStyle(body("g"), "background-color")).toBe("");
    });

    it("maps independent corner radii in CSS order", () => {
      draw(node("r", "rectangle", { cornerRadii: [1, 2, 3, 4] }));
      expect(writtenStyle(body("r"), "border-radius")).toBe("1px 2px 3px 4px");
      draw(node("r", "rectangle", { cornerRadius: 8, cornerRadii: [0, 0, 12, 12] }));
      expect(writtenStyle(body("r"), "border-radius")).toBe("0px 0px 12px 12px");
    });

    it("falls back to cornerRadius when cornerRadii is null, empty, or all zero", () => {
      // The engine resolves an unset cornerRadii (default null) to [0, 0, 0, 0].
      for (const cornerRadii of [[0, 0, 0, 0], null, undefined, [], [-4, 0, -1, 0]]) {
        draw(node("g", "group", { color: "#FFFFFFFF", cornerRadius: 24, cornerRadii, backgroundBlur: 12 }));
        expect(writtenStyle(body("g"), "border-radius"), JSON.stringify(cornerRadii)).toBe("24px");
        expect(writtenStyle(el("g"), "border-radius"), JSON.stringify(cornerRadii)).toBe("24px");
      }
      for (const type of ["image", "video", "gradient"]) {
        draw(node(type, type, { cornerRadius: 16, cornerRadii: [0, 0, 0, 0] }));
        expect(writtenStyle(body(type), "border-radius"), type).toBe("16px");
      }
    });

    it("positions strokes inside, centered, and outside the edge", () => {
      draw(node("r", "rectangle", { strokeWidth: 2, strokeColor: "#0000FFFF", cornerRadius: 10 }));
      const stroke = () => el("r").querySelector(".sonobe-stroke") as HTMLElement;
      expect(writtenStyle(stroke(), "left")).toBe("0px");
      expect(writtenStyle(stroke(), "border-width")).toBe("2px");
      expect(writtenStyle(stroke(), "border-color")).toBe("rgba(0, 0, 255, 1)");
      expect(writtenStyle(stroke(), "border-radius")).toBe("10px 10px 10px 10px");
      draw(node("r", "rectangle", { strokeWidth: 2, strokePosition: "center", cornerRadius: 10 }));
      expect(writtenStyle(stroke(), "left")).toBe("-1px");
      expect(writtenStyle(stroke(), "width")).toBe("202px");
      draw(node("r", "rectangle", { strokeWidth: 2, strokePosition: "outside", cornerRadius: 10 }));
      expect(writtenStyle(stroke(), "top")).toBe("-2px");
      expect(writtenStyle(stroke(), "border-radius")).toBe("12px 12px 12px 12px");
      draw(node("r", "rectangle", { strokeWidth: 0 }));
      expect(stroke()).toBeNull();
    });

    it("draws the stroke above children", () => {
      draw(node("g", "group", { strokeWidth: 1 }, { children: [node("child", "rectangle")] }));
      expect(el("g").lastElementChild!.className).toBe("sonobe-stroke");
    });

    it("shapes smooth corners with clip-path and a squircle stroke ring", () => {
      draw(node("r", "rectangle", { cornerRadius: 24, cornerSmoothing: 0.6, strokeWidth: 2, shadowOpacity: 0.5, shadowRadius: 10 }));
      expect(writtenStyle(body("r"), "clip-path")).toMatch(/^path\("M /);
      expect(writtenStyle(body("r"), "border-radius")).toBe("");
      expect(writtenStyle(body("r"), "box-shadow")).toBe("");
      expect(writtenStyle(el("r"), "filter")).toContain("drop-shadow(");
      const ring = el("r").querySelector(".sonobe-stroke-svg path")!;
      expect(ring.getAttribute("fill-rule")).toBe("evenodd");
      expect(ring.getAttribute("d")!.match(/M /g)!.length).toBe(2);
    });

    it("keeps children unclipped for smooth-cornered groups without clip", () => {
      draw(node("g", "group", { color: "#FFFFFFFF", cornerRadius: 20, cornerSmoothing: 1 }));
      expect(writtenStyle(body("g"), "clip-path")).toBe("");
      const fill = body("g").querySelector(".sonobe-fill") as HTMLElement;
      expect(writtenStyle(fill, "clip-path")).toMatch(/^path\(/);
      expect(writtenStyle(fill, "background-color")).toBe("rgba(255, 255, 255, 1)");
    });

    it("draws ovals as ellipses with box shadows", () => {
      draw(node("o", "oval", { color: "#00FF00FF", shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: [0, 4], shadowColor: "#000000FF" }));
      expect(writtenStyle(body("o"), "border-radius")).toBe("50%");
      expect(writtenStyle(body("o"), "box-shadow")).toBe("0px 4px 8px rgba(0, 0, 0, 0.5)");
    });

    it("uses drop-shadow for groups without a fill", () => {
      draw(node("g", "group", { shadowOpacity: 1, shadowRadius: 4 }));
      expect(writtenStyle(body("g"), "box-shadow")).toBe("");
      expect(writtenStyle(el("g"), "filter")).toBe("drop-shadow(0px 0px 4px rgba(0, 0, 0, 1))");
    });

    it("renders componentInstance children like a container", () => {
      draw(node("inst", "componentInstance", {}, { children: [node("inner", "rectangle")] }));
      expect(el("inner").parentElement).toBe(body("inst"));
    });
  });

  describe("effects", () => {
    it("maps blur, background blur, blend modes, and layer effects", () => {
      draw(node("r", "rectangle", { blur: 4, backgroundBlur: 20, blendMode: "plusLighter", cornerRadius: 8, effects: [{ kind: "colorControls", params: { saturation: 1.5 } }] }));
      expect(writtenStyle(el("r"), "filter")).toBe("blur(4px) saturate(1.5)");
      expect(writtenStyle(el("r"), "backdrop-filter")).toBe("blur(20px)");
      expect(writtenStyle(el("r"), "-webkit-backdrop-filter")).toBe("blur(20px)");
      expect(writtenStyle(el("r"), "border-radius")).toBe("8px");
      expect(writtenStyle(el("r"), "mix-blend-mode")).toBe("plus-lighter");
      draw(node("r", "rectangle", { blendMode: "colorDodge" }));
      expect(writtenStyle(el("r"), "mix-blend-mode")).toBe("color-dodge");
      expect(writtenStyle(el("r"), "filter")).toBe("");
    });
  });

  describe("text", () => {
    it("maps typography props", () => {
      draw(
        node("t", "text", {
          text: "Popular Events",
          fontFamily: "Inter",
          fontSize: 22,
          fontWeight: 600,
          italic: true,
          textColor: "#112233FF",
          textAlignment: "center",
          letterSpacing: -0.5,
          lineHeight: 28,
          verticalAlignment: "bottom",
          textDecoration: "underline",
          textTransform: "uppercase",
        }),
      );
      const text = body("t").querySelector(".sonobe-text") as HTMLElement;
      expect(text.textContent).toBe("Popular Events");
      expect(writtenStyle(text, "font-family")).toMatch(/^"Inter", system-ui/);
      expect(writtenStyle(text, "font-size")).toBe("22px");
      expect(writtenStyle(text, "font-weight")).toBe("600");
      expect(writtenStyle(text, "font-style")).toBe("italic");
      expect(writtenStyle(text, "color")).toBe("rgba(17, 34, 51, 1)");
      expect(writtenStyle(text, "text-align")).toBe("center");
      expect(writtenStyle(text, "letter-spacing")).toBe("-0.5px");
      expect(writtenStyle(text, "line-height")).toBe("28px");
      expect(writtenStyle(text, "text-decoration-line")).toBe("underline");
      expect(writtenStyle(text, "text-transform")).toBe("uppercase");
      expect(writtenStyle(body("t"), "justify-content")).toBe("flex-end");
    });

    it("writes the measurer's natural line height when lineHeight is 0", () => {
      const measurer = new DomTextMeasurer({ measureWidth: (t) => t.length * 10, measureLineHeight: (_f, size) => size * 1.25 });
      make({ textMeasurer: measurer });
      draw(node("t", "text", { text: "Hi", fontSize: 16 }));
      expect(writtenStyle(body("t").firstElementChild!, "line-height")).toBe("20px");
    });

    it("clamps max lines with an end ellipsis", () => {
      draw(node("t", "text", { text: "a b c d e f", maxLines: 2, lineHeight: 20 }));
      const text = body("t").firstElementChild!;
      expect(writtenStyle(text, "-webkit-line-clamp")).toBe("2");
      expect(writtenStyle(text, "display")).toBe("-webkit-box");
      expect(writtenStyle(text, "max-height")).toBe("40px");
      draw(node("t", "text", { text: "a b c d e f", maxLines: 2, truncation: "clip", lineHeight: 20 }));
      expect(writtenStyle(text, "-webkit-line-clamp")).toBe("");
      expect(writtenStyle(text, "overflow")).toBe("hidden");
    });

    it("truncates in the middle using the measurer", () => {
      make({ textMeasurer: new DomTextMeasurer({ measureWidth: (t) => [...t].length * 10, measureLineHeight: () => 20 }) });
      draw(node("t", "text", { text: "IMG_20260916_final_v2.png", maxLines: 1, truncation: "middle" }, { width: 120 }));
      const content = body("t").firstElementChild!.textContent!;
      expect(content).toContain("…");
      expect([...content].length).toBeLessThanOrEqual(12);
      expect(content.startsWith("IMG")).toBe(true);
      expect(content.endsWith("png")).toBe(true);
    });
  });

  describe("image", () => {
    it("resolves assets and maps fill modes", () => {
      draw(node("i", "image", { image: { assetId: "photo" }, fillMode: "fit", cornerRadius: 12 }));
      const img = body("i").querySelector("img")!;
      expect(img.getAttribute("src")).toBe("https://cdn.test/photo.png");
      expect(writtenStyle(img, "object-fit")).toBe("contain");
      expect(writtenStyle(body("i"), "overflow")).toBe("hidden");
      expect(writtenStyle(body("i"), "border-radius")).toBe("12px");
      draw(node("i", "image", { image: { url: "https://x.test/a.jpg" }, fillMode: "stretch" }));
      expect(img.getAttribute("src")).toBe("https://x.test/a.jpg");
      expect(writtenStyle(img, "object-fit")).toBe("fill");
    });

    it("tiles with a repeating background", () => {
      draw(node("i", "image", { image: { asset: "tile" }, fillMode: "tile" }));
      expect(body("i").querySelector("img")).toBeNull();
      expect(writtenStyle(body("i"), "background-image")).toBe('url("https://cdn.test/tile.png")');
      expect(writtenStyle(body("i"), "background-repeat")).toBe("repeat");
    });

    it("shows a placeholder for empty images only in editor mode", () => {
      draw(node("i", "image"));
      expect(body("i").children.length).toBe(0);
      make({ editorMode: true });
      draw(node("i", "image"));
      expect(body("i").querySelector(".sonobe-placeholder")!.textContent).toBe("No image");
    });
  });

  describe("video", () => {
    it("is muted unless audio is allowed and volume > 0", () => {
      draw(node("v", "video", { video: { url: "https://x.test/clip.mp4" }, volume: 1, loop: false, rate: 2 }));
      const video = body("v").querySelector("video")!;
      expect(video.muted).toBe(true);
      expect(video.loop).toBe(false);
      expect(video.playbackRate).toBe(2);
      expect(video.getAttribute("src")).toBe("https://x.test/clip.mp4");
      make({ allowAudio: true });
      draw(node("v", "video", { video: { url: "https://x.test/clip.mp4" }, volume: 0.5 }));
      expect(body("v").querySelector("video")!.muted).toBe(false);
      draw(node("v", "video", { video: { url: "https://x.test/clip.mp4" }, volume: 0 }));
      expect(body("v").querySelector("video")!.muted).toBe(true);
    });

    it("seeks while scrubbing and plays when playing", () => {
      const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
      const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
      draw(node("v", "video", { video: { url: "https://x.test/clip.mp4" }, playing: true }));
      expect(play).toHaveBeenCalled();
      draw(node("v", "video", { video: { url: "https://x.test/clip.mp4" }, scrub: true, scrubTime: 1.5 }));
      expect(body("v").querySelector("video")!.currentTime).toBe(1.5);
      play.mockRestore();
      pause.mockRestore();
    });
  });

  describe("shape", () => {
    it("draws a path with fill, stroke, and trimming", () => {
      draw(node("s", "shape", { shape: { path: "M0 0 L100 0 L100 100 Z" }, color: "#FF0000FF", strokeWidth: 3, strokeColor: "#000000FF", strokeStart: 0.25, strokeEnd: 0.75, lineCap: "butt", lineJoin: "miter" }));
      const path = body("s").querySelector("svg path")!;
      expect(path.getAttribute("d")).toBe("M0 0 L100 0 L100 100 Z");
      expect(path.getAttribute("fill")).toBe("rgba(255, 0, 0, 1)");
      expect(path.getAttribute("stroke-width")).toBe("3");
      expect(path.getAttribute("stroke-linecap")).toBe("butt");
      expect(path.getAttribute("stroke-linejoin")).toBe("miter");
      expect(path.getAttribute("pathLength")).toBe("1000");
      expect(path.getAttribute("stroke-dasharray")).toBe("500 2000");
      expect(path.getAttribute("stroke-dashoffset")).toBe("-250");
    });

    it("hides a fully trimmed stroke and clears trimming at full length", () => {
      draw(node("s", "shape", { shape: "M0 0 L10 10", strokeWidth: 2, strokeEnd: 0 }));
      const path = body("s").querySelector("svg path")!;
      expect(path.hasAttribute("stroke")).toBe(false);
      draw(node("s", "shape", { shape: "M0 0 L10 10", strokeWidth: 2, strokeEnd: 1 }));
      expect(path.getAttribute("stroke")).toBe("rgba(0, 0, 0, 1)");
      expect(path.hasAttribute("stroke-dasharray")).toBe(false);
    });

    it("fills with a gradient through a path clip", () => {
      draw(node("s", "shape", { shape: "M0 0 L10 10 L0 10 Z", gradient: { kind: "radial", stops: [{ offset: 0, color: { r: 1, g: 1, b: 1, a: 1 } }, { offset: 1, color: { r: 0, g: 0, b: 0, a: 1 } }], start: [0.5, 0.5], end: [1, 0.5] } }));
      const fill = body("s").querySelector(".sonobe-fill") as HTMLElement;
      expect(writtenStyle(fill, "background-image")).toMatch(/^radial-gradient\(circle 100px at 100px 50px/);
      expect(writtenStyle(fill, "clip-path")).toBe('path("M0 0 L10 10 L0 10 Z")');
      expect(body("s").querySelector("svg path")!.getAttribute("fill")).toBe("none");
    });
  });

  describe("gradient / colorFill / hitArea", () => {
    it("fills gradient layers from the default vertical gradient", () => {
      draw(node("g", "gradient"));
      expect(writtenStyle(body("g"), "background-image")).toBe("linear-gradient(180deg, rgba(255, 255, 255, 1) 0%, rgba(0, 0, 0, 1) 100%)");
    });

    it("fills color fills", () => {
      draw(node("f", "colorFill", { color: "#00000080" }));
      expect(writtenStyle(body("f"), "background-color")).toBe("rgba(0, 0, 0, 0.502)");
    });

    it("shows hit targets only when asked", () => {
      draw(node("h", "hitArea", { hitSlop: 8 }), node("r", "rectangle", { cornerRadius: 10 }));
      expect(el("h").querySelector(".sonobe-hit")).toBeNull();
      renderer.setShowHitTargets(true, ["r"]);
      const overlay = el("h").querySelector(".sonobe-hit") as HTMLElement;
      expect(overlay).not.toBeNull();
      expect(overlay.hasAttribute("data-slop")).toBe(true);
      expect(writtenStyle(overlay, "outline-offset")).toBe("8px");
      expect(writtenStyle(el("r").querySelector(".sonobe-hit")!, "border-radius")).toBe("10px");
      renderer.setShowHitTargets(false);
      expect(el("h").querySelector(".sonobe-hit")).toBeNull();
      make({ editorMode: true });
      draw(node("h", "hitArea"), node("h2", "hitArea", { showInEditor: false }));
      expect(el("h").querySelector(".sonobe-hit")).not.toBeNull();
      expect(el("h2").querySelector(".sonobe-hit")).toBeNull();
    });
  });

  describe("textField", () => {
    it("renders an input and emits text events", () => {
      const events: InputEvent[] = [];
      make({ onEvents: (e) => events.push(...e) });
      draw(node("field", "textField", { text: "hello", placeholder: "Email", keyboardType: "email", placeholderColor: "#FF000080" }));
      const input = body("field").querySelector("input")!;
      expect(input.value).toBe("hello");
      expect(input.getAttribute("placeholder")).toBe("Email");
      expect(input.getAttribute("inputmode")).toBe("email");
      expect(writtenStyle(input, "--sonobe-placeholder")).toBe("rgba(255, 0, 0, 0.502)");
      input.value = "hello!";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      expect(events).toContainEqual({ kind: "text", layerId: "field", key: "field", value: "hello!" });
      // The authored text didn't change, so typing is preserved.
      draw(node("field", "textField", { text: "hello" }));
      expect(input.value).toBe("hello!");
      draw(node("field", "textField", { text: "" }));
      expect(input.value).toBe("");
    });

    it("switches to a textarea when multiline and a password input when secure", () => {
      draw(node("field", "textField", { secure: true }));
      expect(body("field").querySelector("input")!.getAttribute("type")).toBe("password");
      draw(node("field", "textField", { multiline: true }));
      expect(body("field").querySelector("textarea")).not.toBeNull();
      expect(body("field").querySelector("input")).toBeNull();
    });

    it("focuses when the focused prop turns on", () => {
      const onFocusChange = vi.fn();
      make({ onFocusChange });
      draw(node("field", "textField", { focused: false }));
      draw(node("field", "textField", { focused: true }));
      const input = body("field").querySelector("input")!;
      expect(document.activeElement).toBe(input);
      expect(onFocusChange).toHaveBeenCalledWith("field");
    });

    it("emits focus, blur, and submit events keyed by SceneNode key", () => {
      const events: InputEvent[] = [];
      make({ onEvents: (e) => events.push(...e) });
      draw(node("field#2", "textField", {}, { layerId: "field" }));
      const input = body("field#2").querySelector("input")!;
      input.focus();
      input.value = "a";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter" }));
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter", isComposing: true }));
      input.blur();
      // Enter is also forwarded as a key event by input capture; only field events matter here.
      expect(events.filter((e) => e.kind !== "key")).toEqual([
        { kind: "focus", layerId: "field", key: "field#2", focused: true },
        { kind: "text", layerId: "field", key: "field#2", value: "a" },
        { kind: "submit", layerId: "field", key: "field#2" },
        { kind: "focus", layerId: "field", key: "field#2", focused: false },
      ]);
    });

    it("submits multiline fields only with a modifier", () => {
      const events: InputEvent[] = [];
      make({ onEvents: (e) => events.push(...e) });
      draw(node("notes", "textField", { multiline: true }));
      const area = body("notes").querySelector("textarea")!;
      area.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      expect(events.filter((e) => e.kind === "submit")).toEqual([]);
      const withMeta = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", metaKey: true });
      area.dispatchEvent(withMeta);
      expect(events.filter((e) => e.kind === "submit")).toEqual([{ kind: "submit", layerId: "notes", key: "notes" }]);
      expect(withMeta.defaultPrevented).toBe(true);
    });

    it("reports blur when a focused field is removed", () => {
      const events: InputEvent[] = [];
      make({ onEvents: (e) => events.push(...e) });
      draw(node("field", "textField", { focused: true }));
      draw();
      expect(events.at(-1)).toEqual({ kind: "focus", layerId: "field", key: "field", focused: false });
    });
  });

  describe("shader / lottie", () => {
    it("reports unavailable WebGL2 and shows an error placeholder", () => {
      const onShaderError = vi.fn();
      make({ onShaderError });
      draw(node("fx", "shader"));
      expect(body("fx").querySelector("canvas")).not.toBeNull();
      expect(onShaderError).toHaveBeenCalledTimes(1);
      expect(onShaderError.mock.calls[0]![0].error.message).toMatch(/WebGL2/);
      expect(body("fx").querySelector(".sonobe-placeholder")!.getAttribute("data-tone")).toBe("error");
      renderer.render({ ...frame([node("fx", "shader")]), time: 1 });
      expect(onShaderError).toHaveBeenCalledTimes(1);
    });

    it("shows a lottie placeholder for missing assets, and for empty layers in editor mode", () => {
      make({ resolveAssetUrl: () => undefined, loadLottie: () => new Promise(() => {}) });
      draw(node("l", "lottie", { animation: { assetId: "confetti" } }), node("empty", "lottie"));
      expect(body("l").querySelector(".sonobe-placeholder")!.textContent).toBe("Lottie · missing asset\nconfetti");
      expect(body("empty").children.length).toBe(0);
      make({ editorMode: true, loadLottie: () => new Promise(() => {}) });
      draw(node("empty", "lottie"));
      expect(body("empty").querySelector(".sonobe-placeholder")!.textContent).toBe("No animation");
    });
  });
});
