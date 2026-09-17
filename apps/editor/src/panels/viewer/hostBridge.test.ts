// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorSession } from "../../state/session.ts";
import { getPreviewHostApi, getViewerWindowApi, registerBoundsProvider, toPreviewStatus, toViewerWindowStatus, type BoundsProvider } from "./hostBridge.ts";

afterEach(() => {
  delete (window as { sonobeHost?: unknown }).sonobeHost;
});

const provider: BoundsProvider = () => ({ x: 1, y: 2, width: 3, height: 4 });
const fakeSession = (extra: Record<string, unknown>) => ({ host: null, ...extra }) as unknown as EditorSession;

describe("toPreviewStatus", () => {
  it("normalizes host statuses and rejects other values", () => {
    expect(toPreviewStatus({ running: true, urls: ["http://a/p", 7, ""], clients: 2.7 })).toEqual({ running: true, url: "http://a/p", urls: ["http://a/p"], lanReachable: true, clients: 2, error: null });
    expect(toPreviewStatus({ running: false, url: "", lanReachable: false, error: "Port in use" })).toEqual({ running: false, url: null, urls: [], lanReachable: false, clients: 0, error: "Port in use" });
    expect(toPreviewStatus(null)).toBeNull();
    expect(toPreviewStatus({ url: "http://a" })).toBeNull();
  });
});

describe("host capabilities", () => {
  it("finds the phone preview API only when every method exists", () => {
    expect(getPreviewHostApi()).toBeNull();
    (window as { sonobeHost?: unknown }).sonobeHost = { getPreviewStatus: async () => ({}), startPreview: async () => ({}) };
    expect(getPreviewHostApi()).toBeNull();
    const onPreviewStatus = vi.fn(() => () => undefined);
    (window as { sonobeHost?: unknown }).sonobeHost = { getPreviewStatus: async () => ({}), startPreview: async () => ({}), stopPreview: async () => ({}), onPreviewStatus };
    const api = getPreviewHostApi();
    expect(api).not.toBeNull();
    api!.onPreviewStatus!(() => undefined);
    expect(onPreviewStatus).toHaveBeenCalledOnce();
  });

  it("wraps the host's viewer window and its status events", async () => {
    expect(getViewerWindowApi()).toBeNull();
    const listeners: ((status: unknown) => void)[] = [];
    const popOutViewer = vi.fn(async (options?: { alwaysOnTop?: boolean }) => ({ open: true, alwaysOnTop: options?.alwaysOnTop ?? false, error: null }));
    (window as { sonobeHost?: unknown }).sonobeHost = {
      popOutViewer,
      closeViewerWindow: async () => ({ open: false, alwaysOnTop: false, error: null }),
      getViewerWindowStatus: async () => ({ open: false, alwaysOnTop: false, error: null }),
      onViewerWindowStatus: (cb: (status: unknown) => void) => {
        listeners.push(cb);
        return () => undefined;
      },
    };
    const api = getViewerWindowApi()!;
    expect(await api.popOut()).toEqual({ open: true, alwaysOnTop: false, error: null });
    expect(popOutViewer).toHaveBeenLastCalledWith();
    expect(await api.popOut({ alwaysOnTop: true })).toEqual({ open: true, alwaysOnTop: true, error: null });
    expect(await api.close!()).toMatchObject({ open: false });
    expect(await api.getStatus!()).toMatchObject({ open: false });
    const seen = vi.fn();
    api.onStatus!(seen);
    listeners[0]!({ open: true, alwaysOnTop: true });
    expect(seen).toHaveBeenCalledWith({ open: true, alwaysOnTop: true, error: null });
  });

  it("reads window statuses from older hosts", () => {
    expect(toViewerWindowStatus(undefined)).toEqual({ open: true, alwaysOnTop: false, error: null });
    expect(toViewerWindowStatus(false)).toEqual({ open: false, alwaysOnTop: false, error: null });
    expect(toViewerWindowStatus({ ok: false })).toEqual({ open: false, alwaysOnTop: false, error: null });
    expect(toViewerWindowStatus({ open: false, error: "No display available." })).toEqual({ open: false, alwaysOnTop: false, error: "No display available." });
  });
});

describe("registerBoundsProvider", () => {
  it("uses session.bounds.register and its returned unregister", () => {
    const off = vi.fn();
    const register = vi.fn(() => off);
    const r = registerBoundsProvider(fakeSession({ bounds: { register } }), "canvas.bounds", provider);
    expect(r.via).toBe("registry");
    expect(register).toHaveBeenCalledWith("canvas.bounds", provider);
    r.dispose();
    expect(off).toHaveBeenCalledOnce();
  });

  it("falls back to unregister, set, or a session-level register function", () => {
    const unregister = vi.fn();
    registerBoundsProvider(fakeSession({ boundsRegistry: { register: vi.fn(), unregister } }), "graph.bounds", provider).dispose();
    expect(unregister).toHaveBeenCalledWith("graph.bounds", provider);

    const set = vi.fn();
    registerBoundsProvider(fakeSession({ bounds: { set } }), "viewer.layerBounds", provider).dispose();
    expect(set.mock.calls).toEqual([
      ["viewer.layerBounds", provider],
      ["viewer.layerBounds", null],
    ]);

    const off = vi.fn();
    const registerBounds = vi.fn(() => off);
    const r = registerBoundsProvider(fakeSession({ registerBoundsProvider: registerBounds }), "canvas.bounds", provider);
    expect(r.via).toBe("registry");
    r.dispose();
    expect(off).toHaveBeenCalledOnce();
  });

  it("registers on the desktop RPC bridge when there's no registry, failing when the target is off screen", async () => {
    const handlers = new Map<string, (params: unknown) => unknown>();
    const off = vi.fn();
    const rpc = {
      handle: vi.fn((method: string, fn: (params: unknown) => unknown) => {
        handlers.set(method, fn);
        return off;
      }),
      methods: () => [...handlers.keys()],
      fail: vi.fn((code: string, message: string) => ({ failed: code, message })),
    };
    let rect: ReturnType<BoundsProvider> = { x: 0, y: 0, width: 10, height: 10, scale: 2 };
    const r = registerBoundsProvider(fakeSession({ host: { rpc } }), "canvas.bounds", () => rect);
    expect(r.via).toBe("rpc");
    expect(await handlers.get("canvas.bounds")!(undefined)).toEqual(rect);
    rect = null;
    expect(await handlers.get("canvas.bounds")!(undefined)).toEqual({ failed: "target_unavailable", message: expect.stringContaining("Canvas") });
    // Something already answers it: leave it alone.
    expect(registerBoundsProvider(fakeSession({ host: { rpc } }), "canvas.bounds", provider).via).toBe("none");
    r.dispose();
    expect(off).toHaveBeenCalledOnce();
  });

  it("does nothing without a registry or a bridge", () => {
    const r = registerBoundsProvider(fakeSession({}), "canvas.bounds", provider);
    expect(r.via).toBe("none");
    expect(() => r.dispose()).not.toThrow();
  });
});
