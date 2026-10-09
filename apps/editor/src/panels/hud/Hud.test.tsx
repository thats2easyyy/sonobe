// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorProvider } from "../../state/EditorProvider.tsx";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { CommandProvider } from "../../ui/commands/CommandProvider.tsx";
import { Hud, type HudProps } from "./Hud.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let session: EditorSession;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  session = createEditorSession({ host: null });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  session.dispose();
  vi.unstubAllGlobals();
});

function render(props: HudProps = {}) {
  act(() =>
    root.render(
      <CommandProvider attach={false}>
        <EditorProvider session={session} commands={false} clipboardEvents={false} rpc={false}>
          <Hud {...props} />
        </EditorProvider>
      </CommandProvider>,
    ),
  );
}

const tab = (name: string) => [...container.querySelectorAll<HTMLElement>("[role=tab]")].find((t) => t.textContent?.startsWith(name))!;

describe("Hud", () => {
  it("names itself the bottom panel", () => {
    render();
    expect(container.querySelector("section")?.getAttribute("aria-label")).toBe("Bottom panel");
    expect(container.querySelector("[role=tablist]")?.getAttribute("aria-label")).toBe("Bottom panel tabs");
  });

  it("counts errors and problems with the right plural", () => {
    session.console.getState().push("error", ["one"]);
    session.console.getState().flush();
    render();
    expect(tab("Console").querySelector("[aria-label]")?.getAttribute("aria-label")).toBe("1 error");
    act(() => {
      session.console.getState().push("error", ["two"]);
      session.console.getState().flush();
    });
    expect(tab("Console").querySelector("[aria-label]")?.getAttribute("aria-label")).toBe("2 errors");
  });

  it("toggles collapse on a double click of the empty bar only", () => {
    const onToggleCollapse = vi.fn();
    render({ onToggleCollapse });
    act(() => container.querySelector(".sb-hudx__bar")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onToggleCollapse).toHaveBeenCalledOnce();
    act(() => tab("Console").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onToggleCollapse).toHaveBeenCalledOnce();
  });

  it("says At rest, not 0 fps, while the prototype plays with nothing moving", () => {
    render();
    const readout = () => container.querySelector<HTMLElement>(".sb-hudx__stat")!;
    act(() => session.runtime.state.setState({ playing: true, resting: false, fps: 59.6, frameMs: 1.2 }));
    expect(readout().textContent).toBe("60 fps");
    expect(readout().getAttribute("aria-label")).toContain("Smooth, 60 fps");
    act(() => session.runtime.state.setState({ playing: true, resting: true, fps: 0 }));
    expect(readout().textContent).toBe("At rest");
    expect(readout().getAttribute("aria-label")).toContain("At rest: nothing in the prototype is moving");
    expect(readout().getAttribute("aria-label")).not.toMatch(/0 fps|Starting/);
    expect(readout().querySelector(".sb-hudx__dot")?.getAttribute("data-tone")).toBe("neutral");
    act(() => session.runtime.state.setState({ playing: false, resting: false, fps: 0 }));
    expect(readout().textContent).toBe("Paused");
  });

  it("judges the frame rate against the display's rate", () => {
    render();
    const tone = () => container.querySelector(".sb-hudx__dot")?.getAttribute("data-tone");
    act(() => session.runtime.state.setState({ playing: true, resting: false, fps: 60, displayHz: 60 }));
    expect(tone()).toBe("success");
    act(() => session.runtime.state.setState({ displayHz: 120 }));
    expect(tone()).toBe("warn");
  });

  it("profiles patches only while the Performance tab is showing", () => {
    const stop = vi.fn();
    const profile = vi.spyOn(session.runtime, "profilePatches").mockReturnValue(stop);
    render({ tab: "console" });
    expect(profile).not.toHaveBeenCalled();
    render({ tab: "performance" });
    expect(profile).toHaveBeenCalledOnce();
    render({ tab: "diagnostics" });
    expect(stop).toHaveBeenCalledOnce();
  });

  it("lists the slowest patches in a section of their own, each row a button that reveals the patch", () => {
    vi.spyOn(session.runtime, "runtime", "get").mockReturnValue({ patchTimings: () => [{ patchId: "spring", ms: 0.4 }, { patchId: "flip", ms: 0.1 }] } as never);
    render({ tab: "performance" });
    const section = container.querySelector<HTMLElement>('section[aria-label="Slowest patches"]')!;
    expect(section.querySelector("h3")?.textContent).toBe("Slowest patches");
    expect([...section.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["spring0.40 ms", "flip0.10 ms"]);
    expect(container.querySelector(".sb-perfx__stats")?.textContent).not.toContain("Slowest patches");
  });

  it("keeps the Diagnostics severity filter across tab switches", () => {
    session.document.getState().apply(
      [
        { op: "addPatch", patch: { id: "cyc_a", type: "add", typeParam: "number", inputs: { value2: 1 }, ui: { x: 0, y: 0 } } },
        { op: "addPatch", patch: { id: "cyc_b", type: "add", typeParam: "number", inputs: { value1: { link: "cyc_a.output" }, value2: 1 }, ui: { x: 200, y: 0 } } },
        { op: "connect", from: "cyc_b.output", to: "cyc_a.value1" },
      ],
      { label: "Feedback loop" },
    );
    render({ defaultTab: "diagnostics" });
    const info = () => [...container.querySelectorAll<HTMLElement>(".sb-hudchip")].find((c) => c.textContent?.startsWith("Info"))!;
    act(() => info().click());
    expect(info().getAttribute("aria-pressed")).toBe("false");
    act(() => tab("Console").click());
    act(() => tab("Diagnostics").click());
    expect(info().getAttribute("aria-pressed")).toBe("false");
  });

  it("hands focus to the selected tab when Clear console removes the toolbar", () => {
    session.console.getState().push("log", ["hello"]);
    session.console.getState().flush();
    render();
    const clear = container.querySelector<HTMLElement>('button[aria-label="Clear console"]')!;
    clear.focus();
    act(() => clear.click());
    expect(container.querySelector(".sb-hudview__toolbar")).toBeNull();
    expect(document.activeElement).toBe(tab("Console"));
  });

  it("only labels console rows that draw a level glyph", () => {
    session.console.getState().push("log", ["plain"]);
    session.console.getState().push("warn", ["careful"]);
    session.console.getState().flush();
    render();
    const icons = [...container.querySelectorAll(".sb-logrow__icon")];
    expect(icons.map((i) => i.getAttribute("role"))).toEqual([null, "img"]);
    expect(icons[0]!.getAttribute("aria-hidden")).toBe("true");
  });
});
