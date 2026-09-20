import { applyOps, findLayer } from "@sonobe/core";
import { buildDoc, MOCK_DEFINITIONS } from "@sonobe/engine/testing";
import { createPatchRegistry } from "@sonobe/patches";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserHost, createMemoryProjectStorage } from "../../host/browserHost.ts";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { canImportUrl, captureFromText, importDesign, pasteDesignCapture, summaryText } from "./importDesign.ts";
import { withCaptureScript } from "./iframeCapture.ts";

const registry = createPatchRegistry({ definitions: MOCK_DEFINITIONS });
let session: EditorSession | null = null;
afterEach(() => {
  session?.dispose();
  session = null;
});

function setup() {
  const doc = buildDoc({ layers: [{ id: "card", type: "rectangle", props: { size: [100, 100] } }], patches: {} }, registry);
  const host = createBrowserHost({ storage: createMemoryProjectStorage(), channelName: null, recentKey: null, fileSystemAccess: false });
  session = createEditorSession({ host, registry, document: doc, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
  return session;
}

const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

const capture = {
  format: "sonobe.design-capture",
  version: 1,
  source: { kind: "url", title: "Checkout" },
  viewport: { width: 390, height: 844 },
  root: {
    kind: "frame",
    name: "Checkout",
    box: [0, 0, 390, 844],
    fill: "#FFFFFFFF",
    children: [
      { kind: "image", name: "Product", image: "img1", fit: "cover", box: [0, 0, 390, 200] },
      { kind: "text", text: "Pay now", box: [20, 700, 60, 20], style: { fontFamily: "system-ui", fontSize: 17, fontWeight: 600, color: "#000000FF", lineHeight: 20 } },
    ],
  },
  images: { img1: { url: "http://localhost:3000/product.png", name: "product" } },
};

describe("importDesign", () => {
  it("captures through the desktop app, stores image bytes, applies one undo step and selects the screen", async () => {
    const s = setup();
    const desktop = { captureDesign: vi.fn(async () => ({ ok: true as const, capture, images: [["img1", { bytes: PNG, mime: "image/png", width: 1, height: 1 }]] as [string, { bytes: Uint8Array; mime: string; width?: number; height?: number }][] })) };
    const before = s.document.getState().revision;
    const outcome = await importDesign(s, { url: "http://localhost:3000/checkout", selector: "#pay" }, { desktop });
    expect(outcome).toMatchObject({ ok: true, screenId: "checkout", screenName: "Checkout", summary: { images: 1, texts: 1 } });
    expect(desktop.captureDesign).toHaveBeenCalledWith(expect.objectContaining({ url: "http://localhost:3000/checkout", selector: "#pay", width: 390, height: 844 }));
    const state = s.document.getState();
    expect(state.revision).toBe(before + 1);
    const asset = Object.values(state.doc.assets)[0]!;
    expect(s.assets.peekBytes(asset.file)).toBeDefined();
    expect(findLayer(state.doc.components.main!.layers, "product")?.layer.props.image).toEqual({ asset: asset.id });
    expect(s.selection.getState().layers).toEqual(["checkout"]);
    expect(summaryText(outcome.summary!)).toBe("3 layers · 1 text · 1 image");
    // The whole import undoes in one step.
    state.undo();
    expect(s.document.getState().doc.components.main!.layers.map((l) => l.id)).toEqual(["card"]);
  });

  it("explains failures from the desktop app and URLs in the browser", async () => {
    const s = setup();
    const failed = await importDesign(s, { url: "http://localhost:3000/" }, { desktop: { captureDesign: async () => ({ ok: false, code: "capture_failed", message: "Couldn't load http://localhost:3000/", hint: "Start the dev server." }) } });
    expect(failed).toMatchObject({ ok: false, message: "Couldn't load http://localhost:3000/", hint: "Start the dev server." });
    expect(canImportUrl({ desktop: null })).toBe(false);
    const browser = await importDesign(s, { url: "http://localhost:3000/" }, { desktop: null });
    expect(browser.message).toContain("needs the Sonobe desktop app");
    const html = await importDesign(s, { html: "<p>hi</p>" }, { desktop: null, captureHtml: async () => capture as never });
    expect(html.ok).toBe(true);
  });

  it("pastes a capture copied from another tool and reports broken ones", async () => {
    const s = setup();
    const notify = vi.fn();
    const outcome = await pasteDesignCapture(s, JSON.stringify({ ...capture, images: {} }), notify);
    expect(outcome?.ok).toBe(true);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Pasted “Checkout”", tone: "success" }));
    expect(captureFromText('{"hello": "sonobe.design-capture?"}')).toBeNull();
    expect(await pasteDesignCapture(s, JSON.stringify({ format: "sonobe.design-capture", version: 1 }), notify)).toBeNull();
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ title: "That design couldn't be pasted.", tone: "warn" }));
  });

  it("forwards the app's progress, and a cancel stops the capture and applies nothing", async () => {
    const s = setup();
    const before = s.document.getState().revision;
    type Progress = { captureId: string; stage: string; message: string };
    let listener: ((p: Progress) => void) | undefined;
    let pending: ((reply: { ok: false; code: string; message: string }) => void) | undefined;
    const desktop = {
      captureDesign: vi.fn((request: { captureId?: string }) => {
        listener?.({ captureId: request.captureId!, stage: "loading", message: "Loading http://localhost:3000/" });
        listener?.({ captureId: "someone-else", stage: "loading", message: "Another capture" });
        return new Promise<{ ok: false; code: string; message: string }>((resolve) => (pending = resolve));
      }),
      cancelCaptureDesign: vi.fn((captureId: string) => pending?.({ ok: false, code: "cancelled", message: `cancelled ${captureId}` })),
      onCaptureDesignProgress: vi.fn((cb: (p: Progress) => void) => {
        listener = cb;
        return () => (listener = undefined);
      }),
    };
    const controller = new AbortController();
    const messages: string[] = [];
    const running = importDesign(s, { url: "http://localhost:3000/" }, { desktop: desktop as never }, { signal: controller.signal, onProgress: (m) => messages.push(m) });
    await Promise.resolve();
    controller.abort();
    const outcome = await running;
    expect(outcome).toMatchObject({ ok: false, cancelled: true });
    expect(messages).toEqual(["Loading http://localhost:3000/"]);
    const captureId = (desktop.captureDesign.mock.calls[0]![0] as { captureId: string }).captureId;
    expect(desktop.cancelCaptureDesign).toHaveBeenCalledWith(captureId);
    expect(listener).toBeUndefined();
    expect(s.document.getState().revision).toBe(before);
  });

  it("applies nothing when the capture comes back after a cancel", async () => {
    const s = setup();
    const before = s.document.getState().revision;
    const controller = new AbortController();
    // An older app without cancelCaptureDesign: the capture finishes anyway.
    const desktop = { captureDesign: vi.fn(async () => (controller.abort(), { ok: true as const, capture, images: [] as [string, null][] })) };
    const outcome = await importDesign(s, { url: "http://localhost:3000/" }, { desktop }, { signal: controller.signal });
    expect(outcome.cancelled).toBe(true);
    expect(s.document.getState().revision).toBe(before);
    // In the browser, a cancel during the iframe capture removes it and imports nothing.
    const iframe = new AbortController();
    const html = importDesign(s, { html: "<p>hi</p>" }, { desktop: null, captureHtml: (request) => new Promise((_, reject) => request.signal?.addEventListener("abort", () => reject(request.signal?.reason))) }, { signal: iframe.signal });
    iframe.abort();
    expect(await html).toMatchObject({ ok: false, cancelled: true });
    expect(s.document.getState().revision).toBe(before);
  });

  it("refuses patch components", async () => {
    const s = setup();
    const r = applyOps(s.document.getState().doc, [{ op: "addComponent", component: { id: "logic", name: "Logic", kind: "patchComponent" } } as never], { registry });
    if (r.ok) {
      s.document.getState().apply(r.applied, { label: "add component" });
      s.selection.getState().enterComponent("logic");
      const outcome = await importDesign(s, { html: "<p>hi</p>" }, { desktop: null, captureHtml: async () => capture as never });
      expect(outcome).toMatchObject({ ok: false, message: expect.stringContaining("patch component") });
    }
  });
});

describe("withCaptureScript", () => {
  it("appends the walker before </body>, escaping script ends", () => {
    const page = withCaptureScript("<html><body><p>Hi</p></body></html>", "n1", { selector: "</script><b>" });
    expect(page.indexOf("<script>")).toBeGreaterThan(page.indexOf("<p>Hi</p>"));
    expect(page.endsWith("</script></body></html>")).toBe(true);
    expect(page).not.toContain('"</script><b>"');
    expect(withCaptureScript("<p>fragment</p>", "n2", {})).toMatch(/^<p>fragment<\/p><script>/);
  });
});
