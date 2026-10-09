// @vitest-environment happy-dom
import { Component, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualScheduler } from "../runtime/scheduler.ts";
import { createEditorSession, type EditorSession } from "../state/session.ts";
import { ErrorBoundary } from "../ui/ErrorBoundary.tsx";
import { clearEditorErrors, errorDetails, installErrorReporting, recentEditorErrors, reportEditorError, rootErrorOptions, showLastResort } from "./errorReports.ts";

const app = vi.hoisted(() => ({ session: null as EditorSession | null }));
vi.mock("./session.ts", () => ({ peekAppSession: () => app.session }));

let session: EditorSession;
let target: EventTarget;
let uninstall: () => void;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  session = createEditorSession({ host: null, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
  app.session = session;
  target = new EventTarget();
  uninstall = installErrorReporting(target as Window);
});

afterEach(() => {
  uninstall();
  clearEditorErrors();
  session.dispose();
  app.session = null;
  vi.restoreAllMocks();
});

const entries = () => {
  session.console.getState().flush();
  return session.console.getState().entries.map(({ level, source, message }) => ({ level, source, message }));
};
const windowError = (error: unknown, message = error instanceof Error ? error.message : String(error)) => target.dispatchEvent(Object.assign(new Event("error"), { error, message }));
const rejection = (reason: unknown) => target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason }));
const options = () => rootErrorOptions(document.createElement("div"));

describe("editor error reports", () => {
  it("puts an error that reaches the window in the console once, as the editor's, with what to do", () => {
    windowError(new TypeError("layer is undefined"));
    expect(entries()).toEqual([
      { level: "error", source: "editor", message: "Something in the editor failed. If it keeps happening, save your work and restart Sonobe, or use Help → Report an Issue. (TypeError: layer is undefined)" },
    ]);
    // The browser prints what it raises on the window itself.
    expect(console.error).not.toHaveBeenCalled();
  });

  it("names the part a boundary caught the error in, and prints it, since React no longer does", () => {
    const boundary = new ErrorBoundary({ name: "The Inspector" });
    options().onCaughtError!(new Error("no such layer"), { componentStack: "\n    at Row\n    at Inspector", errorBoundary: boundary });
    expect(entries()).toEqual([
      { level: "error", source: "editor", message: "The Inspector hit a problem and stopped drawing. If it keeps happening, save your work and restart Sonobe, or use Help → Report an Issue. (Error: no such layer)" },
    ]);
    expect(recentEditorErrors()).toMatchObject([{ where: "The Inspector", componentStack: "at Row\n    at Inspector" }]);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("reports an error once however many handlers it reaches", () => {
    const error = new Error("no such layer");
    options().onCaughtError!(error, { componentStack: "", errorBoundary: new ErrorBoundary({ name: "Layers" }) });
    windowError(error);
    rejection(error);
    expect(reportEditorError(error)).toBe(false);
    expect(entries()).toHaveLength(1);
  });

  it("gives a boundary that isn't the editor's no name", () => {
    class Other extends Component<{ children?: ReactNode }> {
      render() {
        return this.props.children;
      }
    }
    options().onCaughtError!(new Error("elsewhere"), { componentStack: "", errorBoundary: new Other({}) });
    expect(entries()[0]!.message).toMatch(/^Something in the editor failed\./);
  });

  it("leaves out a ResizeObserver loop notice and a cancelled request", () => {
    windowError(null, "ResizeObserver loop completed with undelivered notifications.");
    rejection(Object.assign(new Error("The user aborted a request."), { name: "AbortError" }));
    rejection(new DOMException("Share canceled", "AbortError"));
    expect(entries()).toEqual([]);
  });

  it("reports a promise that rejected with nobody waiting, whatever it rejected with", () => {
    rejection(new Error("couldn't read the folder"));
    rejection("offline");
    rejection({ code: 7 });
    expect(entries().map((entry) => entry.message.match(/\((.*)\)$/)?.[1])).toEqual(["Error: couldn't read the folder", "offline", '{"code":7}']);
  });

  it("logs an error React recovered from as a warning, which doesn't open the console", () => {
    options().onRecoverableError!(new Error("drawn twice"), { componentStack: "" });
    expect(entries()).toEqual([{ level: "warn", source: "editor", message: "The editor hit a problem while drawing and recovered by drawing again. (Error: drawn twice)" }]);
    expect(session.console.getState().counts.error).toBe(0);
  });

  it("stops listening when uninstalled", () => {
    uninstall();
    windowError(new Error("late"));
    expect(entries()).toEqual([]);
  });

  it("keeps the last ten reports, and never starts a session to hold one", () => {
    app.session = null;
    for (let i = 0; i < 12; i++) windowError(new Error(`failure ${i}`));
    expect(recentEditorErrors().map((report) => report.summary)).toEqual(Array.from({ length: 10 }, (_, i) => `Error: failure ${i + 2}`));
    expect(entries()).toEqual([]);
  });

  it("leaves a prototype's own failure to the runtime host: one line, from the prototype", () => {
    session.runtime.stepFrame();
    vi.spyOn(session.runtime.runtime, "step").mockImplementationOnce(() => {
      throw new Error("Loop ran away");
    });
    session.runtime.stepFrame();
    expect(entries()).toEqual([{ level: "error", source: "prototype", message: "The prototype stopped: Loop ran away" }]);
    expect(recentEditorErrors()).toEqual([]);
  });

  it("writes details with the error, its stack, where it was thrown, earlier errors, and the version line", () => {
    windowError(new RangeError("too many rows"));
    const error = new TypeError("layer is undefined");
    const details = errorDetails(error, "\n    at Row\n    at Inspector");
    expect(details).toContain("TypeError: layer is undefined");
    expect(details).toContain(error.stack!.split("\n")[1]!.trim());
    expect(details).toContain("Component stack\nat Row\n    at Inspector");
    expect(details).toMatch(/Earlier editor errors\n\d\d:\d\d:\d\d RangeError: too many rows/);
    expect(details).toMatch(/\nSonobe 0\.1\.0 · browser · \w+ · .+$/);
  });

  describe("the last resort", () => {
    it("fills an emptied container with a plain message, both errors and a Reload that writes the draft first", async () => {
      const container = document.createElement("div");
      const first = new Error("no such layer");
      ErrorBoundary.getDerivedStateFromError(first);
      const reload = vi.fn();
      const flush = vi.fn(async () => undefined);
      app.session = { ...session, document: { getState: () => ({ ...session.document.getState(), dirty: true }) }, drafts: { flush, pending: () => false, current: () => null } } as unknown as EditorSession;

      showLastResort(container, new Error("the recovery screen broke"), reload);
      expect(container.querySelector(".sb-recovery")?.getAttribute("role")).toBe("alert");
      expect(container.querySelector("h1")?.textContent).toBe("Sonobe hit a problem");
      const details = container.querySelector("pre")!.textContent!;
      expect(details.indexOf("Error: no such layer")).toBeGreaterThanOrEqual(0);
      expect(details.indexOf("Error: the recovery screen broke")).toBeGreaterThan(details.indexOf("Error: no such layer"));

      container.querySelector("button")!.click();
      expect(reload).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(flush).toHaveBeenCalledTimes(1);
    });

    it("goes up when nothing caught a render error", () => {
      const container = document.createElement("div");
      rootErrorOptions(container).onUncaughtError!(new Error("no boundary"), { componentStack: "" });
      expect(container.textContent).toContain("Sonobe hit a problem");
      expect(container.textContent).toContain("Error: no boundary");
      expect(entries()).toHaveLength(1);
    });
  });
});
