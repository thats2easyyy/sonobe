// @vitest-environment happy-dom
import { findLayer } from "@sonobe/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { currentComponentId } from "../../state/selection.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { Toaster, toast } from "../../ui/Toast.tsx";
import { assistantStore, initialAssistantData } from "../assistant/assistantStore.ts";
import { createAssistantController, type AssistantController } from "../assistant/controller.ts";
import { fakeAssistantHost, usage, type FakeAssistantHost } from "../assistant/testing.ts";
import type { AssistantCodeFolderLinkResult, AssistantCodeFolderStatus } from "../assistant/types.ts";
import type { Rect } from "../canvas/geometry.ts";
import type { DesignTarget } from "./context.ts";
import { DesignBox, followUps } from "./DesignBox.tsx";
import { designStore, initialDesignData, sendDesign, type DesignData, type DesignDraft, type DesignResult } from "./designStore.ts";
import type { DesignStatusLine } from "./status.ts";

// The design state package's functions are stubs in this package's tests: stand-ins that follow their contracts.
const h = vi.hoisted(() => ({
  controller: null as AssistantController | null,
  status: null as ((design: DesignData, assistant: { running: boolean }) => DesignStatusLine | null) | null,
}));

vi.mock("../assistant/controller.ts", async (importOriginal) => ({ ...(await importOriginal<typeof import("../assistant/controller.ts")>()), sharedAssistantController: () => h.controller! }));

vi.mock("./designStore.ts", async (importOriginal) => ({ ...(await importOriginal<typeof import("./designStore.ts")>()), sendDesign: vi.fn(async () => undefined) }));

vi.mock("./context.ts", () => ({
  designTarget(session: EditorSession, design: Pick<DesignData, "newScreen" | "result">): DesignTarget | null {
    const ids = session.selection.getState().layers;
    if (design.newScreen || ids.length !== 1) return null;
    const found = findLayer(session.document.getState().doc.components[currentComponentId(session.selection.getState())]!.layers, ids[0]!);
    return found ? { id: found.layer.id, name: found.layer.name, type: found.layer.type, isResult: design.result?.layerId === found.layer.id } : null;
  },
  canvasContext: (_session: EditorSession, target: DesignTarget | null) => ({
    component: { id: "main", name: "Main", size: [402, 874] },
    screens: [],
    ...(target ? { target: { id: target.id, name: target.name, type: target.type, frame: [0, 0, 1, 1] } } : {}),
  }),
}));

vi.mock("./status.ts", () => ({
  designStatusLine: (design: DesignData, assistant: { running: boolean }): DesignStatusLine | null => {
    if (h.status) return h.status(design, assistant);
    const d = design.drafts.at(-1);
    if (d?.status === "writing") return { text: `Writing “${d.fields.name ?? "the screen"}”… ${Math.round(d.html.length / 1024)} KB`, tone: "busy" };
    if (d?.status === "adding") return { text: "Adding the layers…", tone: "busy" };
    if (assistant.running) return { text: "Thinking…", tone: "busy" };
    if (design.result) return { text: `Added “${design.result.name}”.`, tone: "done" };
    return null;
  },
  toolStatusText: () => "",
}));

vi.mock("./prompt.ts", () => ({
  claudePrompt: ({ docName, text, context, browser }: { docName: string; text: string; context: { component: { id: string }; target?: { id: string } }; browser: boolean }) =>
    `${browser ? "browser" : "desktop"} prompt for “${docName}”: ${text} (${context.component.id}${context.target ? ` → ${context.target.id}` : ""})`,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = "sk-ant-api03-test-key-1234";
const bounds = (_id: string): Rect | null => null;

let container: HTMLDivElement;
let root: Root;
let session: EditorSession;
let host: FakeAssistantHost | null;
let folder: AssistantCodeFolderStatus;
let linkResult: (() => AssistantCodeFolderLinkResult) | null;
let clipboard: string[];

/** A fake desktop host with the code folder methods and status. */
function desktopHost(options: { key?: string } = { key: KEY }): FakeAssistantHost {
  const fake = fakeAssistantHost(options);
  const status = fake.assistant!.status;
  fake.assistant!.status = async () => ({ ...(await status()), codeFolder: folder });
  fake.assistant!.linkCodeFolder = async () => {
    if (linkResult) return linkResult();
    folder = { linked: { name: "noddit", path: "~/code/noddit", persisted: true }, missing: false };
    return { status: folder };
  };
  fake.assistant!.unlinkCodeFolder = async () => (folder = { linked: null, missing: false });
  return fake;
}

beforeEach(() => {
  folder = { linked: null, missing: false };
  linkResult = null;
  clipboard = [];
  h.status = null;
  vi.mocked(sendDesign).mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => void clipboard.push(text) } });
  designStore.setState({ ...initialDesignData(), open: true });
  assistantStore.setState(initialAssistantData());
  session = createEditorSession({ host: null, scheduler: createManualScheduler(), textMeasurer: "approximate", autoplay: false });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  h.controller?.dispose();
  h.controller = null;
  delete (window as { sonobeHost?: unknown }).sonobeHost;
  session.dispose();
  container.remove();
  toast.clear();
  document.body.innerHTML = "";
});

/** Mount the box in a canvas panel body, with `host` as window.sonobeHost (null: the browser). */
async function mount(withHost: FakeAssistantHost | null = desktopHost()) {
  host = withHost;
  if (host) (window as { sonobeHost?: unknown }).sonobeHost = host;
  h.controller = createAssistantController(host, assistantStore);
  await act(async () => {
    root.render(
      <>
        <div className="sb-panel__body">
          <div className="sb-cv" tabIndex={0} />
          <DesignBox session={session} bounds={bounds} />
        </div>
        <Toaster />
      </>,
    );
    await Promise.resolve();
  });
  await settle();
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const box = () => container.querySelector<HTMLElement>(".sb-design-box");
const field = () => container.querySelector<HTMLTextAreaElement>(".sb-design-box textarea")!;
const chip = () => container.querySelector(".sb-design-box__chip-label")?.textContent;
const statusText = () => container.querySelector('.sb-design-box [role="status"]')?.textContent;
const buttonNamed = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === name || b.getAttribute("aria-label") === name) ?? null;

function click(target: Element | null) {
  act(() => {
    (target as HTMLElement).click();
  });
}

function type(text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field(), text);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(key: string, target: Element = field()) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

const select = (layers: string[]) => act(() => session.selection.getState().select({ layers, patches: [], comments: [] }));

/** Add a top-level screen as one undo step; returns its id and txnId. */
function addScreen(name: string): { id: string; txnId: string } {
  let out = { id: "", txnId: "" };
  act(() => {
    const result = session.document.getState().apply([{ op: "addLayer", component: "main", layer: { ref: "screen", type: "group", name, props: { size: [402, 874] } } }], { label: `Import “${name}”` });
    out = { id: result.idMap.screen!, txnId: session.document.getState().lastChange!.txnId! };
  });
  return out;
}

const result = (over: Partial<DesignResult>): DesignResult => ({ kind: "added", layerId: "card", component: "main", name: "Checkout", txnId: null, dropped: [], droppedCount: 0, coveredScreen: null, reply: "", ...over });

const draft = (over: Partial<DesignDraft> = {}): DesignDraft => ({ runId: "r1", turn: 1, toolUseId: "t1", html: "", fields: {}, status: "writing", since: Date.now(), progress: null, error: null, resync: false, ...over });

describe("DesignBox", () => {
  it("renders only while the box is open, and focuses its field", async () => {
    await mount();
    expect(document.activeElement).toBe(field());
    act(() => designStore.getState().closeBox());
    expect(box()).toBeNull();
  });

  it("follows the selection: a new screen, a redesign, × for a new screen until the selection changes, and a change to Claude's screen", async () => {
    await mount();
    expect(chip()).toBe("New screen · 402 × 874");
    expect(field().placeholder).toBe("Describe a screen, like “a checkout with Apple Pay and a promo code”");
    expect(field().getAttribute("aria-label")).toBe("Describe a screen for Claude");

    select(["card"]);
    expect(chip()).toBe("Redesign “Event Card”");
    expect(field().placeholder).toBe("What should change in “Event Card”?");
    expect(field().getAttribute("aria-label")).toBe("Describe a change to “Event Card”");

    click(buttonNamed("Design a new screen instead"));
    expect(chip()).toBe("New screen · 402 × 874");
    select(["like_button"]);
    expect(chip()).toBe("Redesign “Like Button”");
    select(["card", "like_button"]);
    expect(chip()).toBe("New screen · 402 × 874");

    const screen = addScreen("Checkout");
    act(() => designStore.setState({ result: result({ layerId: screen.id, txnId: screen.txnId }) }));
    select([screen.id]);
    expect(chip()).toBe("Change “Checkout”");
    expect(field().placeholder).toBe("Ask for changes, or make it interactive…");
    expect(field().getAttribute("aria-label")).toBe("Describe a change to “Checkout”");
  });

  it("sends on Return through sendDesign with the canvas's bounds, and clears the field", async () => {
    await mount();
    select(["card"]);
    type("  make it darker  ");
    press("Enter");
    expect(sendDesign).toHaveBeenCalledWith(session, "make it darker", bounds);
    expect(field().value).toBe("");
  });

  it("walks the status line through a design: thinking, writing, adding, then what it added, with Stop while it runs", async () => {
    let finish!: () => void;
    vi.mocked(sendDesign).mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    await mount();
    type("a checkout screen");
    press("Enter");
    act(() => {
      host!.emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5" });
      host!.emit({ type: "turn_started", runId: "r1", turn: 1 });
    });
    expect(statusText()).toBe("Thinking…");
    expect(buttonNamed("Stop")).not.toBeNull();

    act(() => designStore.setState({ request: { runId: "r1", text: "a checkout screen", context: { component: { id: "main", name: "Main", size: [402, 874] }, screens: [] }, selection: [] }, drafts: [draft({ fields: { name: "Checkout" }, html: "x".repeat(14 * 1024) })] }));
    expect(statusText()).toBe("Writing “Checkout”… 14 KB");
    act(() => designStore.setState({ drafts: [draft({ fields: { name: "Checkout" }, html: "<html></html>", status: "adding" })] }));
    expect(statusText()).toBe("Adding the layers…");

    const screen = addScreen("Checkout");
    await act(async () => {
      designStore.setState({ drafts: [draft({ status: "added" })], result: result({ layerId: screen.id, txnId: screen.txnId, reply: "Added a checkout with Apple Pay and a promo code field." }) });
      host!.emit({ type: "text_delta", runId: "r1", turn: 1, delta: "Added a checkout with Apple Pay and a promo code field." });
      host!.emit({ type: "run_finished", runId: "r1", outcome: "completed", usage: usage(1000) });
      finish();
      await Promise.resolve();
    });
    expect(statusText()).toBe("Added “Checkout”.");
    expect(container.querySelector(".sb-design-box__reply")?.textContent).toBe("Added a checkout with Apple Pay and a promo code field.");
    expect(buttonNamed("Stop")).toBeNull();
    expect([...container.querySelectorAll(".sb-design-box__chips button")].map((b) => b.textContent)).toEqual(["Undo", "Make it interactive", "Add knobs", "Try a darker version"]);

    click(buttonNamed("Add knobs"));
    expect(sendDesign).toHaveBeenLastCalledWith(session, followUps("Checkout").knobs, bounds);
    expect(followUps("Checkout")).toEqual({
      interactive: "Make “Checkout” interactive: wire its buttons and controls with patches so they respond, and tell me what you wired.",
      knobs: "Turn the main colors, corner radius and spacing of “Checkout” into knobs I can tune, and link its layers to them. Group them under “Checkout”.",
      darker: "Try a darker version of “Checkout”.",
    });
  });

  it("shows a reply without an import on its own", async () => {
    await mount();
    type("what's on this screen?");
    press("Enter");
    await act(async () => {
      host!.emit({ type: "run_started", runId: "r2", model: "claude-sonnet-5" });
      host!.emit({ type: "turn_started", runId: "r2", turn: 1 });
      host!.emit({ type: "text_delta", runId: "r2", turn: 1, delta: "An event card with a photo and a like button." });
      host!.emit({ type: "run_finished", runId: "r2", outcome: "completed", usage: usage(1000) });
      await Promise.resolve();
    });
    expect(container.querySelector(".sb-design-box__reply")?.textContent).toBe("An event card with a photo and a like button.");
    expect(container.querySelector(".sb-design-box__chips")).toBeNull();
  });

  it("asks before a replace with the confirmation's own labels, focused on keeping the person's work", async () => {
    await mount();
    act(() => {
      host!.emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5" });
      host!.emit({
        type: "confirm_required",
        runId: "r1",
        confirmationId: "c1",
        toolUseId: "t1",
        title: "Replace “Home”?",
        message: "Claude wants to rebuild “Home”, which you didn't ask it to change. You can undo it afterwards.",
        count: 1,
        kind: "replace",
        approveLabel: "Replace",
        declineLabel: "Keep “Home”",
      });
    });
    const card = container.querySelector('.sb-design-box [role="alertdialog"]')!;
    expect(card.getAttribute("aria-label")).toBe("Replace “Home”?");
    expect([...card.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Keep “Home”", "Replace"]);
    expect(document.activeElement?.textContent).toBe("Keep “Home”");
    await act(async () => {
      buttonNamed("Keep “Home”")!.click();
      await Promise.resolve();
    });
    expect(host!.confirmations).toEqual([["c1", false]]);
    expect(container.querySelector('.sb-design-box [role="alertdialog"]')).toBeNull();
  });

  it("offers Undo only while the import is the newest change", async () => {
    await mount();
    const screen = addScreen("Checkout");
    act(() => designStore.setState({ result: result({ layerId: screen.id, txnId: screen.txnId }) }));
    expect(buttonNamed("Undo")).not.toBeNull();
    act(() => {
      session.document.getState().apply([{ op: "updateLayer", component: "main", id: "card", name: "Renamed Card" }], { label: "Rename" });
    });
    expect(buttonNamed("Undo")).toBeNull();
    act(() => {
      session.document.getState().undo();
    });
    click(buttonNamed("Undo"));
    expect(findLayer(session.document.getState().doc.components.main!.layers, screen.id)).toBeUndefined();
    // Its screen is gone, so there's nothing left to follow up on.
    expect(container.querySelector(".sb-design-box__chips")).toBeNull();
  });

  it("offers Send to Back only for a new screen that covers another, and sends it behind", async () => {
    await mount();
    const screen = addScreen("Checkout");
    act(() => designStore.setState({ result: result({ layerId: screen.id, txnId: screen.txnId, coveredScreen: "Event Card" }) }));
    click(buttonNamed("Send to Back"));
    expect(session.selection.getState().layers).toEqual([screen.id]);
    expect(session.document.getState().doc.components.main!.layers[0]!.id).toBe(screen.id);
    expect(buttonNamed("Send to Back")).toBeNull();

    act(() => designStore.setState({ result: result({ layerId: screen.id, txnId: null, coveredScreen: null }) }));
    expect(buttonNamed("Send to Back")).toBeNull();
    act(() => designStore.setState({ result: result({ kind: "updated", layerId: "card", coveredScreen: "Background" }) }));
    expect(buttonNamed("Send to Back")).toBeNull();
  });

  it("without an API key keeps the text, explains, and copies a prompt for Claude Code", async () => {
    await mount(desktopHost({}));
    type("a checkout screen");
    press("Enter");
    expect(sendDesign).not.toHaveBeenCalled();
    expect(field().value).toBe("a checkout screen");
    expect(box()!.textContent).toContain("Designing on the canvas uses your own Anthropic API key, kept in your keychain.");

    await act(async () => {
      buttonNamed("Copy for Claude Code")!.click();
      await Promise.resolve();
    });
    expect(clipboard).toEqual(["desktop prompt for “Photo Zoom”: a checkout screen (main)"]);
    expect(document.body.textContent).toContain("Prompt copied");
    expect(document.body.textContent).toContain("Paste it into Claude Code in your app's folder.");

    click(buttonNamed("Add API key…"));
    expect(assistantStore.getState().open).toBe(true);
  });

  it("in the browser, copies the browser prompt and offers Import Design", async () => {
    await mount(null);
    expect(box()!.textContent).toContain("Claude designs on the canvas in the Sonobe desktop app, with your own API key or Claude Code. Here, copy a prompt for Claude, then paste the HTML it writes.");
    expect(buttonNamed("Open chat")).toBeNull();
    expect(buttonNamed("Match my code…")).toBeNull();
    select(["card"]);
    type("make it darker");
    await act(async () => {
      buttonNamed("Copy prompt")!.click();
      await Promise.resolve();
    });
    expect(clipboard).toEqual(["browser prompt for “Photo Zoom”: make it darker (main → card)"]);
    expect(document.body.textContent).toContain("Paste it into Claude, then paste the HTML it writes into File → Import Design.");
    expect(sendDesign).not.toHaveBeenCalled();
  });

  it("shows the usage meter only at half the budget or more", async () => {
    await mount();
    const limits = { maxTurns: 30, tokenBudget: 1_500_000, deleteConfirmThreshold: 10 };
    act(() => assistantStore.setState({ usage: { ...usage(2_000_000), budgetTokens: 700_000 }, limits }));
    expect(container.querySelector('[role="meter"]')).toBeNull();
    act(() => assistantStore.setState({ usage: { ...usage(2_000_000), budgetTokens: 750_000 }, limits }));
    expect(container.querySelector('[role="meter"]')).not.toBeNull();
  });

  it("disables sending while a reply from the chat is running", async () => {
    await mount();
    act(() => host!.emit({ type: "run_started", runId: "sheet", model: "claude-sonnet-5" }));
    expect(field().disabled).toBe(true);
    expect(buttonNamed("Stop")).toBeNull();
  });

  it("Escape stops the box's reply, then closes the box and returns focus to the canvas", async () => {
    vi.mocked(sendDesign).mockImplementation(() => new Promise<void>(() => undefined));
    await mount();
    type("a checkout screen");
    press("Enter");
    press("Escape");
    await settle();
    expect(host!.stops).toBe(1);
    expect(box()).not.toBeNull();

    act(() => designStore.getState().closeBox());
    act(() => designStore.getState().openBox());
    await settle();
    press("Escape");
    expect(designStore.getState().open).toBe(false);
    expect(document.activeElement).toBe(container.querySelector(".sb-cv"));
  });

  it("runs the status line's action", async () => {
    await mount();
    h.status = () => ({ text: "Claude is set to Read only in Settings, so the Assistant can look but not edit. Change it in Settings → Claude.", tone: "warn", action: "settings" });
    act(() => designStore.setState({ drafts: [] }));
    const { appPanels } = await import("../../app/appPanels.ts");
    click(buttonNamed("Open Settings"));
    expect(appPanels.getState().open).toBe("settings");
    appPanels.getState().hide();

    h.status = () => ({ text: "This chat used its token budget. Start a new chat to keep designing.", tone: "warn", action: "new_chat" });
    act(() => designStore.setState({ drafts: [] }));
    await act(async () => {
      buttonNamed("New chat")!.click();
      await Promise.resolve();
    });
    expect(host!.resets).toBe(1);

    h.status = () => ({ text: "Anthropic didn't accept this API key.", tone: "error", action: "api_key" });
    act(() => designStore.setState({ drafts: [] }));
    click(buttonNamed("API key"));
    expect(assistantStore.getState().open).toBe(true);
  });

  it("links a code folder, shows it as a chip, and explains when linking fails or the folder is missing", async () => {
    await mount();
    await act(async () => {
      buttonNamed("Match my code…")!.click();
      await Promise.resolve();
    });
    await settle();
    expect(container.querySelector(".sb-design-box__code-label")?.textContent).toBe("Code: noddit");

    await act(async () => {
      buttonNamed("Unlink code folder")!.click();
      await Promise.resolve();
    });
    await settle();
    expect(buttonNamed("Match my code…")).not.toBeNull();

    linkResult = () => ({ status: folder, error: "Pick your app's folder, not your whole home folder." });
    await act(async () => {
      buttonNamed("Match my code…")!.click();
      await Promise.resolve();
    });
    await settle();
    expect(container.querySelector('.sb-design-box [role="alert"]')?.textContent).toBe("Pick your app's folder, not your whole home folder.");

    folder = { linked: { name: "noddit", path: "~/code/noddit", persisted: false }, missing: true };
    await act(async () => {
      await h.controller!.refresh();
    });
    expect(container.querySelector(".sb-design-box__code-label")?.textContent).toBe("Code: noddit (missing)");
    expect(buttonNamed("Link again…")).not.toBeNull();
  });
});
