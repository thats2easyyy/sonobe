// @vitest-environment happy-dom
import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadable } from "./loadable.tsx";
import { Toaster, toast } from "./Toast.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => toast.clear());
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function Settings({ title }: { title: string }) {
  return <div className="settings">{title}</div>;
}

/** An import the test settles by hand, and how many times it was asked for. */
function deferredImport() {
  const calls: { resolve: (component: ComponentType<{ title: string }>) => void; reject: (error: Error) => void }[] = [];
  const load = () => new Promise<ComponentType<{ title: string }>>((resolve, reject) => calls.push({ resolve, reject }));
  return { load, calls };
}

/** Let settled promises run, without running any timer. */
const settle = () => act(async () => undefined);
const text = (selector: string) => document.querySelector(selector)?.textContent ?? null;
const loading = <span className="loading">Loading…</span>;

describe("loadable", () => {
  it("renders a preloaded surface in its first commit, without its fallback", async () => {
    const { load, calls } = deferredImport();
    const Surface = loadable(load, { name: "Settings" });
    const ready = Surface.preload();
    calls[0]!.resolve(Settings);
    await ready;

    let fallbackRenders = 0;
    const Fallback = () => {
      fallbackRenders++;
      return loading;
    };
    act(() => root.render(<Surface title="Motion" fallback={<Fallback />} />));

    expect(text(".settings")).toBe("Motion");
    expect(fallbackRenders).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it("shows the fallback, then the surface once its code arrives, with no timer in between", async () => {
    const { load, calls } = deferredImport();
    const Surface = loadable(load, { name: "Settings" });
    act(() => root.render(<Surface title="Motion" fallback={loading} />));
    expect(text(".loading")).toBe("Loading…");

    // Timers are faked and never advanced. (e2e/boot.spec.ts checks the same in a browser, where React's 300 ms hold on Suspense applies.)
    calls[0]!.resolve(Settings);
    await settle();
    expect(text(".settings")).toBe("Motion");
    expect(document.querySelector(".loading")).toBeNull();
  });

  it("leaves a surface that's on screen alone while another loads", async () => {
    const assistant = deferredImport();
    const settings = deferredImport();
    const Assistant = loadable(assistant.load, { name: "The Assistant" });
    const SettingsDialog = loadable(settings.load, { name: "Settings" });
    const App = ({ settingsOpen }: { settingsOpen: boolean }) => (
      <>
        <Assistant title="Chat" />
        {settingsOpen && <SettingsDialog title="Motion" />}
      </>
    );
    act(() => root.render(<App settingsOpen={false} />));
    assistant.calls[0]!.resolve(({ title }) => <aside className="assistant">{title}</aside>);
    await settle();
    const sheet = document.querySelector<HTMLElement>(".assistant")!;

    act(() => root.render(<App settingsOpen />));
    expect(document.querySelector(".assistant")).toBe(sheet);
    expect(sheet.style.display).toBe("");

    settings.calls[0]!.resolve(Settings);
    await settle();
    expect(text(".settings")).toBe("Motion");
    expect(document.querySelector(".assistant")).toBe(sheet);
  });

  it("imports once however often preload() is called, and never rejects", async () => {
    const { load, calls } = deferredImport();
    const Surface = loadable(load, { name: "Settings" });
    const first = Surface.preload();
    const second = Surface.preload();
    expect(calls).toHaveLength(1);
    calls[0]!.reject(new Error("offline"));
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    await expect(Surface.preload()).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("says so in place when a panel's code can't load", async () => {
    const { load, calls } = deferredImport();
    const Surface = loadable(load, { name: "The patch editor" });
    act(() => root.render(<Surface title="Patches" fallback={loading} />));
    calls[0]!.reject(new Error("offline"));
    await settle();

    expect(text(".sb-empty__title")).toBe("The patch editor didn't load");
    expect(text(".sb-empty__description")).toBe("Restart Sonobe to try again.");
    expect(document.querySelector(".loading")).toBeNull();
  });

  it("tells a dialog's caller each time it opens that its code can't load, with a toast", async () => {
    const { load, calls } = deferredImport();
    const Surface = loadable(load, { name: "Settings" });
    const onLoadError = vi.fn();
    const App = ({ open }: { open: boolean }) => (
      <>
        {open && <Surface title="Motion" onLoadError={onLoadError} />}
        <Toaster />
      </>
    );
    const toasts = () => [...document.querySelectorAll(".sb-toast__title")].map((el) => el.textContent);
    act(() => root.render(<App open />));
    calls[0]!.reject(new Error("offline"));
    await settle();

    expect(onLoadError).toHaveBeenCalledTimes(1);
    expect(toasts()).toEqual(["Settings didn't load"]);
    expect(document.querySelector(".settings")).toBeNull();

    act(() => root.render(<App open={false} />));
    act(() => root.render(<App open />));
    await settle();
    expect(onLoadError).toHaveBeenCalledTimes(2);
    expect(toasts()).toEqual(["Settings didn't load"]);
    expect(calls).toHaveLength(1);
  });
});
