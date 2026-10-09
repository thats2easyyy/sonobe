// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostAdapter } from "../host/types.ts";
import type { DraftKeeper } from "../state/drafts.ts";
import type { EditorSession } from "../state/session.ts";
import { clearEditorErrors } from "./errorReports.ts";
import { RecoveryScreen } from "./RecoveryScreen.tsx";

vi.mock("./session.ts", () => ({ peekAppSession: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearEditorErrors();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

interface Fake {
  session: EditorSession;
  flush: ReturnType<typeof vi.fn>;
  setDocumentEdited: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  /** The draft write lands: the keeper holds the edits from here on. */
  land(): void;
}

/** As much of a session as the screen reads: whether the document is unsaved, and what the draft keeper holds. */
function fakeSession(options: { dirty?: boolean; drafts?: "kept" | "pending" | "unedited" | "none"; flush?: () => Promise<void> } = {}): Fake {
  let state = options.drafts ?? "kept";
  const flush = vi.fn(options.flush ?? (async () => undefined));
  const setDocumentEdited = vi.fn();
  const pause = vi.fn();
  const keeper: Pick<DraftKeeper, "flush" | "pending" | "current"> = { flush, pending: () => state === "pending", current: () => (state === "kept" ? { id: "draft-1", updatedAt: 1 } : null) };
  const session = {
    document: { getState: () => ({ dirty: options.dirty ?? true, doc: { project: { name: "Checkout Flow" } } }) },
    drafts: state === "none" ? null : keeper,
    host: { kind: "browser", setDocumentEdited } as unknown as HostAdapter,
    runtime: { pause },
  } as unknown as EditorSession;
  return { session, flush, setDocumentEdited, pause, land: () => (state = "kept") };
}

const error = new TypeError("layer is undefined");

async function mount(fake: Fake | null, reload: () => void = () => undefined) {
  await act(async () => {
    root.render(<RecoveryScreen error={error} componentStack={"\n    at Row\n    at Inspector"} session={fake?.session ?? null} reload={reload} />);
  });
}

const draft = () => container.querySelector(".sb-recovery__draft")?.textContent ?? null;
const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;

describe("RecoveryScreen", () => {
  it("says what happened and focuses Reload", async () => {
    await mount(null);
    expect(container.querySelector(".sb-recovery")?.getAttribute("role")).toBe("alert");
    expect(container.querySelector("h1")?.textContent).toBe("Sonobe hit a problem");
    expect(container.textContent).toContain("The editor couldn’t draw itself, so it stopped. Reload to start it again.");
    expect(document.activeElement).toBe(button("Reload Sonobe"));
    expect(container.querySelector("details")!.open).toBe(false);
  });

  it("says there were no unsaved changes when the editor never started, or the document was saved", async () => {
    await mount(null);
    expect(draft()).toBe("There were no unsaved changes.");

    const saved = fakeSession({ dirty: false });
    await mount(saved);
    expect(draft()).toBe("There were no unsaved changes.");
    expect(saved.flush).not.toHaveBeenCalled();
    expect(saved.setDocumentEdited).not.toHaveBeenCalled();
  });

  it("writes the draft, says it is kept, and stops the window counting as edited, so closing it leaves the draft", async () => {
    const fake = fakeSession({ drafts: "pending", flush: async () => fake.land() });
    await mount(fake);
    expect(fake.flush).toHaveBeenCalled();
    expect(draft()).toBe("Your unsaved changes to “Checkout Flow” are kept as a draft. After you reload, or quit and reopen Sonobe, the welcome screen lists it under Recovered.");
    expect(fake.setDocumentEdited).toHaveBeenCalledWith(false);
    expect(fake.pause).toHaveBeenCalled();
  });

  it("says an example copy with no edits had nothing to keep", async () => {
    const fake = fakeSession({ drafts: "unedited" });
    await mount(fake);
    expect(draft()).toBe("“Checkout Flow” had no edits to keep.");
    expect(fake.setDocumentEdited).toHaveBeenCalledWith(false);
  });

  it("says so when the draft couldn't be written or the host keeps none, and leaves the window edited", async () => {
    // flush() resolves when a write fails; the keeper still reports the edits as pending.
    const failed = fakeSession({ drafts: "pending" });
    await mount(failed);
    expect(draft()).toBe("Sonobe couldn't keep a draft of your unsaved changes to “Checkout Flow”, so reloading loses them.");
    expect(failed.setDocumentEdited).not.toHaveBeenCalled();

    const none = fakeSession({ drafts: "none" });
    await mount(none);
    expect(draft()).toBe("Sonobe couldn't keep a draft of your unsaved changes to “Checkout Flow”, so reloading loses them.");
    expect(none.setDocumentEdited).not.toHaveBeenCalled();
  });

  it("waits for the draft before it reloads, and clears the edited flag only when the draft is in", async () => {
    let finish!: () => void;
    const fake = fakeSession({ drafts: "pending" });
    const reload = vi.fn();
    await mount(fake, reload);
    expect(fake.setDocumentEdited).not.toHaveBeenCalled();

    // A slow write: Reload waits for it.
    fake.flush.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    await act(async () => button("Reload Sonobe").click());
    expect(reload).not.toHaveBeenCalled();
    expect(button("Reload Sonobe").disabled).toBe(true);

    fake.land();
    await act(async () => finish());
    expect(fake.setDocumentEdited).toHaveBeenCalledWith(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(fake.setDocumentEdited.mock.invocationCallOrder[0]!).toBeLessThan(reload.mock.invocationCallOrder[0]!);
  });

  it("reloads after a second and a half when the draft write never finishes, with the window still edited", async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeSession({ drafts: "pending", flush: () => new Promise<void>(() => undefined) });
      const reload = vi.fn();
      act(() => root.render(<RecoveryScreen error={error} componentStack={null} session={fake.session} reload={reload} />));
      await act(async () => button("Reload Sonobe").click());
      await act(async () => vi.advanceTimersByTimeAsync(1499));
      expect(reload).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(reload).toHaveBeenCalledTimes(1);
      expect(fake.setDocumentEdited).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("copies the message, the stack, where it was thrown, the version and the platform", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText }, userAgent: "TestBrowser/1.0", platform: "MacIntel" });
    await mount(null);
    await act(async () => button("Copy details").click());
    const text = writeText.mock.calls[0]![0];
    expect(text).toContain("TypeError: layer is undefined");
    expect(text).toContain(error.stack!.split("\n")[1]!.trim());
    expect(text).toContain("at Inspector");
    expect(text).toMatch(/Sonobe 0\.1\.0 · browser · darwin · TestBrowser\/1\.0$/);
    expect(button("Copied")).toBeTruthy();
  });

  it("opens the details with the text selected when the clipboard refuses", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: async () => Promise.reject(new Error("denied")) }, userAgent: "TestBrowser/1.0", platform: "MacIntel" });
    await mount(null);
    await act(async () => button("Copy details").click());
    expect(container.querySelector("details")!.open).toBe(true);
    expect(container.querySelector("pre")!.textContent).toContain("TypeError: layer is undefined");
    expect(button("Copy details")).toBeTruthy();
  });

  it("reports an issue with the error filled in", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await mount(fakeSession());
    act(() => button("Report an Issue…").click());
    const url = decodeURIComponent(String(open.mock.calls[0]![0]));
    expect(url).toContain("github.com/thats2easyyy/sonobe/issues/new");
    expect(url).toContain("TypeError: layer is undefined");
  });
});
