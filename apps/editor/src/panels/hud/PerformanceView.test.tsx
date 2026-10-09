// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorProvider } from "../../state/EditorProvider.tsx";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { CommandProvider } from "../../ui/commands/CommandProvider.tsx";
import { PerformanceView } from "./PerformanceView.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let session: EditorSession;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  session = createEditorSession({ host: null, autoplay: false });
  act(() =>
    root.render(
      <CommandProvider attach={false}>
        <EditorProvider session={session} commands={false} clipboardEvents={false} rpc={false}>
          <PerformanceView />
        </EditorProvider>
      </CommandProvider>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  session.dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Publish host stats and let the view take a sample of them (it samples every 500 ms). */
function publish(state: Partial<ReturnType<EditorSession["runtime"]["state"]["getState"]>>) {
  act(() => {
    session.runtime.state.setState(state);
    vi.advanceTimersByTime(500);
  });
}

const headline = () => container.querySelector(".sb-perfx__headline")!.textContent!;
const chart = (title: string) => [...container.querySelectorAll<HTMLElement>(".sb-perfx__chart")].find((c) => c.textContent?.startsWith(title))!;

describe("PerformanceView", () => {
  it("shows the frame rate while frames run", () => {
    publish({ playing: true, resting: false, fps: 59.7, frameMs: 2, displayHz: 60 });
    expect(headline()).toContain("60fps");
    expect(headline()).toContain("Smooth");
    expect(chart("Frame rate").querySelector("[aria-label]")?.getAttribute("aria-label")).toContain("average 60 fps");
  });

  it("says At rest, with no rate, while the prototype plays with nothing moving", () => {
    publish({ playing: true, resting: true, fps: 0, frameMs: 2, displayHz: 60 });
    expect(headline()).toContain("–fps");
    expect(headline()).toContain("At rest");
    expect(headline()).not.toMatch(/Starting|Choppy/);
    expect(chart("Frame rate").querySelector("[aria-label]")?.getAttribute("aria-label")).toBe("Frame rate: the prototype is at rest");
    expect(container.textContent).toContain("0slow samples");
  });

  it("follows the host through a wake, between two samples: never 0 fps, never Starting", () => {
    publish({ playing: true, resting: true, fps: 0, frameMs: 2, displayHz: 60 });
    const seen: string[] = [];
    // What the host publishes on a tap: at rest still for a stats interval, then the rate.
    for (const state of [{ frame: 12 }, { resting: false, fps: 59.8 }, { fps: 60 }, { resting: true, fps: 0 }]) {
      act(() => session.runtime.state.setState(state));
      seen.push(headline().replace("Clear chart", ""));
    }
    expect(seen).toEqual(["–fpsAt rest", "60fpsSmooth", "60fpsSmooth", "–fpsAt rest"]);
  });

  it("shows no rate while the prototype starts", () => {
    publish({ playing: true, resting: false, fps: 0, frameMs: 0, displayHz: 0 });
    expect(headline()).toContain("–fpsStarting");
  });

  it("judges frames against the display's rate and its frame budget", () => {
    const budget = () => [...container.querySelectorAll(".sb-perfx__stat")].find((s) => s.textContent?.startsWith("Frame budget used"))!.textContent;
    // Until the display's rate is known, it is taken to be 60 Hz.
    publish({ playing: true, resting: false, fps: 60, frameMs: 4, displayHz: 0 });
    expect(headline()).toContain("Smooth");
    expect(budget()).toContain("of 17 ms");
    publish({ displayHz: 120 });
    expect(headline()).toContain("Some dropped frames");
    expect(budget()).toContain("of 8.3 ms");
  });
});
