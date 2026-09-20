// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantCanvasContext } from "../assistant/types.ts";
import type { Rect } from "../canvas/geometry.ts";
import { rectToScreen, type Viewport } from "../canvas/viewport.ts";
import { DesignPreview, previewFrame } from "./DesignPreview.tsx";
import { designStore, initialDesignData, type DesignDraft, type DesignRequest } from "./designStore.ts";
import { PREVIEW_MESSAGE_TYPE } from "./previewShell.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIEWPORT: Viewport = { x: 100, y: 50, zoom: 0.5 };
const CARD: Rect = { x: 16, y: 146, width: 370, height: 200 };
const bounds = (id: string): Rect | null => (id === "card" ? CARD : null);

const draft = (over: Partial<DesignDraft> = {}): DesignDraft => ({ runId: "r1", turn: 1, toolUseId: "t1", html: "", fields: {}, status: "writing", since: Date.now(), progress: null, error: null, resync: false, ...over });

const context = (over: Partial<AssistantCanvasContext> = {}): AssistantCanvasContext => ({ component: { id: "main", name: "Main", size: [402, 874] }, screens: [{ id: "home", name: "Home" }], ...over });
const request = (over: Partial<DesignRequest> = {}): DesignRequest => ({ runId: "r1", text: "a checkout", context: context(), selection: [], ...over });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  designStore.setState(initialDesignData());
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function render(props: Partial<Parameters<typeof DesignPreview>[0]> = {}) {
  act(() => root.render(<DesignPreview viewport={VIEWPORT} bounds={bounds} componentId="main" rootId="main" artboard={[402, 874]} {...props} />));
}

function show(drafts: DesignDraft[], req: DesignRequest | null = null) {
  act(() => designStore.setState({ drafts, request: req }));
}

const wrapper = () => container.querySelector<HTMLElement>(".sb-design-preview");
const iframe = () => container.querySelector<HTMLIFrameElement>("iframe");
const nonceOf = (frame: HTMLIFrameElement) => /<script nonce="([0-9a-f]+)">/.exec(frame.getAttribute("srcdoc") ?? "")![1]!;

/** Where the preview sits on screen: its translate and size, and the frame's size and scale. */
function placement() {
  const style = wrapper()!.style;
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(style.transform)!;
  const frame = iframe()!.style;
  return { x: Number(m[1]), y: Number(m[2]), width: parseFloat(style.width), height: parseFloat(style.height), frame: [parseFloat(frame.width), parseFloat(frame.height)], scale: frame.transform };
}

const expected = (r: Rect) => {
  const s = rectToScreen(VIEWPORT, r);
  return { x: Math.round(s.x), y: Math.round(s.y), width: s.width, height: s.height, frame: [r.width, r.height], scale: `scale(${VIEWPORT.zoom})` };
};

/** Replace the frame's window with a recorder of what the canvas posts to it. */
function recordPosts(frame: HTMLIFrameElement) {
  const postMessage = vi.fn();
  Object.defineProperty(frame, "contentWindow", { configurable: true, value: { postMessage } });
  return postMessage;
}

/** Let the srcdoc shell load (happy-dom fires load on the next animation frame). */
async function load() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

describe("previewFrame", () => {
  const o = { componentId: "main", rootId: "main", artboard: [402, 874] as [number, number], bounds, fallbackReplace: null };

  it("places a new screen at its position and size, defaulting to the artboard", () => {
    expect(previewFrame(draft(), o)).toEqual({ x: 0, y: 0, width: 402, height: 874 });
    expect(previewFrame(draft({ fields: { position: [10, 20], width: 300 } }), o)).toEqual({ x: 10, y: 20, width: 300, height: 874 });
  });

  it("draws a replace over the layer it replaces, at the fields' size when they say", () => {
    expect(previewFrame(draft({ fields: { replace: "card" } }), o)).toEqual(CARD);
    expect(previewFrame(draft({ fields: { replace: "card", height: 240 } }), o)).toEqual({ ...CARD, height: 240 });
    expect(previewFrame(draft(), { ...o, fallbackReplace: "card" })).toEqual(CARD);
    expect(previewFrame(draft({ fields: { replace: "gone" } }), o)).toEqual({ x: 0, y: 0, width: 402, height: 874 });
  });

  it("is null for another component: the fields', else the box request's, else the root", () => {
    expect(previewFrame(draft({ fields: { component: "sheet" } }), o)).toBeNull();
    expect(previewFrame(draft(), { ...o, request: request({ context: context({ component: { id: "sheet", name: "Sheet", size: [402, 400] } }) }) })).toBeNull();
    expect(previewFrame(draft({ runId: "r2" }), { ...o, request: request({ context: context({ component: { id: "sheet", name: "Sheet", size: [402, 400] } }) }) })).not.toBeNull();
    expect(previewFrame(draft(), { ...o, componentId: "sheet" })).toBeNull();
    expect(previewFrame(draft({ fields: { component: "sheet" } }), { ...o, componentId: "sheet" })).not.toBeNull();
  });
});

describe("DesignPreview", () => {
  it("draws nothing without a draft", () => {
    render();
    expect(container.innerHTML).toBe("");
  });

  it("uses a locked-down frame: allow-scripts only, no features, no referrer", () => {
    show([draft({ fields: { name: "Checkout" } })]);
    render();
    const frame = iframe()!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("allow")).toBe("");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.getAttribute("title")).toBe("Design preview");
    expect(frame.getAttribute("aria-hidden")).toBe("true");
    expect(frame.getAttribute("tabindex")).toBe("-1");
    expect(frame.style.pointerEvents).toBe("none");
    expect(frame.getAttribute("srcdoc")).toContain("connect-src 'none'");
    expect(container.querySelector(".sb-design-preview__pill")?.textContent).toBe("Claude is writing “Checkout”");
  });

  it("sits at rectToScreen of a new screen, of the layer it replaces, and of the box's target until the fields arrive", () => {
    show([draft()]);
    render();
    expect(placement()).toEqual(expected({ x: 0, y: 0, width: 402, height: 874 }));

    show([draft({ fields: { position: [20, 40], width: 360, height: 600 } })]);
    expect(placement()).toEqual(expected({ x: 20, y: 40, width: 360, height: 600 }));

    show([draft({ fields: { replace: "card" }, html: "<div>" })]);
    expect(placement()).toEqual(expected(CARD));

    // The box's request picked the card: the preview waits over it until the html says otherwise.
    show([draft()], request({ context: context({ target: { id: "card", name: "Card", type: "group", frame: [16, 146, 370, 200] } }) }));
    expect(placement()).toEqual(expected(CARD));
    show([draft({ html: "<body>" })], designStore.getState().request);
    expect(placement()).toEqual(expected({ x: 0, y: 0, width: 402, height: 874 }));

    // Or the target the canvas passes.
    show([draft()]);
    render({ box: { id: "card", name: "Card", type: "group", isResult: false } });
    expect(placement()).toEqual(expected(CARD));
  });

  it("is hidden for another component", () => {
    show([draft({ fields: { component: "sheet" } })]);
    render();
    expect(iframe()).toBeNull();
    show([draft()], request({ context: context({ component: { id: "sheet", name: "Sheet", size: [402, 400] } }) }));
    expect(iframe()).toBeNull();
  });

  it("posts the renderable html with its nonce once loaded, at most every 120 ms, and the whole page at done", async () => {
    show([draft({ html: "<p>1</p><di" })]);
    render();
    const frame = iframe()!;
    const posts = recordPosts(frame);
    expect(posts).not.toHaveBeenCalled();
    await load();
    const nonce = nonceOf(frame);
    expect(posts.mock.calls).toEqual([[{ type: PREVIEW_MESSAGE_TYPE, nonce, html: "<p>1</p>" }, "*"]]);

    vi.useFakeTimers();
    show([draft({ html: "<p>1</p><p>2</p>" })]);
    show([draft({ html: "<p>1</p><p>2</p><p>3</p>" })]);
    expect(posts).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(120));
    expect(posts).toHaveBeenCalledTimes(2);
    expect(posts.mock.calls[1]![0]).toEqual({ type: PREVIEW_MESSAGE_TYPE, nonce, html: "<p>1</p><p>2</p><p>3</p>" });

    show([draft({ html: "<p>1</p><p>2</p><p>3</p><p>4" })]);
    act(() => vi.advanceTimersByTime(60));
    expect(posts).toHaveBeenCalledTimes(2);
    const page = "<html><body><p>1</p><p>2</p><p>3</p><p>4</p></body></html>";
    show([draft({ html: page, status: "adding" })]);
    expect(posts).toHaveBeenCalledTimes(3);
    expect(posts.mock.calls[2]![0]).toEqual({ type: PREVIEW_MESSAGE_TYPE, nonce, html: page });
    act(() => vi.advanceTimersByTime(500));
    expect(posts).toHaveBeenCalledTimes(3);
    expect(container.querySelector(".sb-design-preview__pill")?.textContent).toBe("Adding the layers…");
  });

  it("holds posts while a draft waits to resync", async () => {
    show([draft({ html: "<p>1</p>", resync: true })]);
    render();
    const posts = recordPosts(iframe()!);
    await load();
    expect(posts).not.toHaveBeenCalled();
    show([draft({ html: "<p>1</p><p>2</p>", resync: false, status: "adding" })]);
    expect(posts).toHaveBeenCalledTimes(1);
  });

  it("resets the frame with a new nonce when it loads a second page", async () => {
    show([draft({ html: "<p>Hi</p>" })]);
    render();
    const first = iframe()!;
    recordPosts(first);
    await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    act(() => {
      first.dispatchEvent(new Event("load"));
    });
    expect(warn).toHaveBeenCalledOnce();
    const second = iframe()!;
    expect(second).not.toBe(first);
    expect(nonceOf(second)).not.toBe(nonceOf(first));
    const posts = recordPosts(second);
    await load();
    expect(posts.mock.calls).toEqual([[{ type: PREVIEW_MESSAGE_TYPE, nonce: nonceOf(second), html: "<p>Hi</p>" }, "*"]]);
  });

  it("fades out once the layers are added, then goes away", () => {
    vi.useFakeTimers();
    show([draft({ html: "<p>Hi</p>", status: "adding" })]);
    render();
    expect(wrapper()!.dataset.state).toBe("live");
    show([draft({ html: "<p>Hi</p>", status: "added", since: Date.now() })]);
    expect(wrapper()!.dataset.state).toBe("leaving");
    act(() => vi.advanceTimersByTime(401));
    expect(wrapper()).toBeNull();
  });
});
