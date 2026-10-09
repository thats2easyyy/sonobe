// @vitest-environment happy-dom
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearEditorErrors } from "./errorReports.ts";
import { mountEditor } from "./mount.tsx";

const recovery = vi.hoisted(() => ({ broken: false }));
vi.mock("./session.ts", () => ({ peekAppSession: () => null }));
vi.mock("./RecoveryScreen.tsx", async (importOriginal) => {
  const original = await importOriginal<typeof import("./RecoveryScreen.tsx")>();
  return {
    RecoveryScreen: (props: Parameters<typeof original.RecoveryScreen>[0]) => {
      if (recovery.broken) throw new Error("the recovery screen broke");
      return original.RecoveryScreen(props);
    },
  };
});

// Not an act environment: under act() React rethrows an error nothing caught instead of calling the
// root's handler, and the last resort is that handler's work.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  recovery.broken = false;
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  root.unmount();
  container.remove();
  clearEditorErrors();
  vi.restoreAllMocks();
});

function Broken(): never {
  throw new Error("no such layer");
}

const shown = (text: string) => vi.waitFor(() => expect(container.textContent).toContain(text));

describe("mountEditor", () => {
  it("renders the editor", async () => {
    root = mountEditor(container, <main>Editor</main>);
    await shown("Editor");
    expect(container.querySelector(".sb-recovery")).toBeNull();
  });

  it("shows the recovery screen, never an empty window, when the editor throws on its first render", async () => {
    root = mountEditor(container, <Broken />);
    await shown("Sonobe hit a problem");
    expect(container.querySelector(".sb-recovery h1")?.textContent).toBe("Sonobe hit a problem");
    await shown("There were no unsaved changes.");
    expect(container.querySelector("pre")!.textContent).toContain("Error: no such layer");
    expect([...container.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Reload Sonobe", "Copy details", "Report an Issue…"]);
  });

  it("leaves the last resort in the window when the recovery screen throws too, with what broke first", async () => {
    recovery.broken = true;
    root = mountEditor(container, <Broken />);
    await shown("The editor stopped and couldn't show its recovery screen.");
    const details = container.querySelector("pre")!.textContent!;
    expect(details).toContain("Error: no such layer");
    expect(details).toContain("Error: the recovery screen broke");
    expect(container.querySelector("button")!.textContent).toBe("Reload Sonobe");
  });
});
