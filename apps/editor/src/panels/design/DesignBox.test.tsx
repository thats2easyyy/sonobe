// @vitest-environment happy-dom
import { findLayer } from "@sonobe/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { Toaster, toast } from "../../ui/Toast.tsx";
import { assistantStore, initialAssistantData } from "../assistant/assistantStore.ts";
import { createAssistantController, type AssistantController } from "../assistant/controller.ts";
import { fakeAssistantHost, usage, type FakeAssistantHost } from "../assistant/testing.ts";
import type { AssistantEvent, AssistantRunResult } from "../assistant/types.ts";
import type { Rect } from "../canvas/geometry.ts";
import { canvasContext } from "./context.ts";
import { DesignBox } from "./DesignBox.tsx";
import { attachDesign, designStore, initialDesignData, type DesignRequest, type DesignResult } from "./designStore.ts";
import { claudePrompt, designFollowUp } from "./prompt.ts";

// Each test gets its own controller over its own fake host; the box and sendDesign share it.
const h = vi.hoisted(() => ({ controller: null as AssistantController | null }));
vi.mock("../assistant/controller.ts", async (importOriginal) => ({ ...(await importOriginal<typeof import("../assistant/controller.ts")>()), sharedAssistantController: () => h.controller! }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = "sk-ant-api03-test-key-1234";
const bounds = (_id: string): Rect | null => null;

let container: HTMLDivElement;
let root: Root;
let session: EditorSession;
let host: FakeAssistantHost | null;
let detach: () => void;
let clipboard: string[];

/** A reply the test drives: send() resolves when `end` is called. */
function heldReply(fake: FakeAssistantHost, runId: string): { end(outcome?: AssistantRunResult["outcome"]): Promise<void> } {
  let resolve!: (result: AssistantRunResult) => void;
  fake.nextResult = () => new Promise<AssistantRunResult>((r) => (resolve = r));
  return {
    async end(outcome = "completed") {
      await act(async () => {
        fake.emit({ type: "run_finished", runId, outcome, usage: usage(1000) });
        resolve({ runId, outcome, usage: usage(1000) });
        await Promise.resolve();
      });
    },
  };
}

beforeEach(() => {
  clipboard = [];
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
  detach();
  h.controller?.dispose();
  h.controller = null;
  delete (window as { sonobeHost?: unknown }).sonobeHost;
  session.dispose();
  container.remove();
  toast.clear();
  document.body.innerHTML = "";
});

/** Mount the box in a canvas panel body, with `host` as window.sonobeHost (null: the browser), and attach the design state to it as EditorApp does. */
async function mount(withHost: FakeAssistantHost | null = fakeAssistantHost({ key: KEY })) {
  host = withHost;
  if (host) (window as { sonobeHost?: unknown }).sonobeHost = host;
  h.controller = createAssistantController(host, assistantStore);
  detach = attachDesign(session, host);
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
const chipLabels = () => [...container.querySelectorAll(".sb-design-box__chips button")].map((b) => b.textContent);
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

const emit = (...events: AssistantEvent[]) =>
  act(() => {
    for (const event of events) host!.emit(event);
  });

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

/** The box's finished request, as its run leaves it. */
const request = (over: Partial<DesignRequest> = {}): DesignRequest => ({ runId: "r1", text: "a checkout screen", context: { component: { id: "main", name: "Main", size: [402, 874] }, screens: [] }, selection: [], outcome: "completed", ...over });

/** A result the box's last request imported. */
const showResult = (over: Partial<DesignResult>) => act(() => designStore.setState({ request: request({ imported: 1 }), result: result(over) }));

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
    showResult({ layerId: screen.id, txnId: screen.txnId });
    select([screen.id]);
    expect(chip()).toBe("Change “Checkout”");
    expect(field().placeholder).toBe("Ask for changes, or make it interactive…");
    expect(field().getAttribute("aria-label")).toBe("Describe a change to “Checkout”");
  });

  it("sends on Return with the canvas's context, tagged as from the canvas, and clears the field", async () => {
    await mount();
    select(["card"]);
    type("  make it darker  ");
    press("Enter");
    await settle();
    expect(host!.sent).toHaveLength(1);
    expect(host!.sent[0]!.text).toBe("make it darker");
    expect(host!.sent[0]!.context).toEqual(canvasContext(session, { id: "card", name: "Event Card", type: session.document.getState().doc.components.main!.layers.find((l) => l.id === "card")!.type, isResult: false }, bounds));
    expect(host!.sent[0]!.context?.target?.id).toBe("card");
    expect(assistantStore.getState().items.find((i) => i.kind === "user")).toMatchObject({ text: "make it darker", origin: "canvas" });
    expect(field().value).toBe("");
  });

  it("walks the status line through a design: thinking, writing, adding, then what it added, with Stop while it runs", async () => {
    const fake = fakeAssistantHost({ key: KEY });
    const reply = heldReply(fake, "r1");
    await mount(fake);
    type("a checkout screen");
    press("Enter");
    emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5" }, { type: "turn_started", runId: "r1", turn: 1 });
    expect(statusText()).toBe("Thinking…");
    expect(buttonNamed("Stop")).not.toBeNull();

    const page = `<main data-name="Checkout">${"x".repeat(14 * 1024)}</main>`;
    emit({ type: "design_draft", runId: "r1", turn: 1, toolUseId: "t1", offset: 0, append: page.slice(0, 14 * 1024), fields: { name: "Checkout" }, done: false });
    expect(statusText()).toBe("Writing “Checkout”… 14 KB");
    emit({ type: "design_draft", runId: "r1", turn: 1, toolUseId: "t1", offset: 14 * 1024, append: page.slice(14 * 1024), done: true, html: page });
    expect(statusText()).toBe("Adding the layers…");
    emit({ type: "tool_started", runId: "r1", toolUseId: "t1", name: "import_design", title: "Import design", detail: "Checkout" }, { type: "tool_progress", runId: "r1", toolUseId: "t1", detail: "Downloading images: 3 of 7" });
    expect(statusText()).toBe("Adding the layers… Downloading images: 3 of 7");

    const screen = addScreen("Checkout");
    emit(
      { type: "tool_finished", runId: "r1", toolUseId: "t1", name: "import_design", status: "done", detail: "Imported", changedDocument: true, imported: { docId: "d1", screenId: screen.id, txnId: screen.txnId, name: "Checkout", replaced: null, dropped: [], droppedCount: 0, lostConnections: 0 } },
      { type: "turn_started", runId: "r1", turn: 2 },
      { type: "text_delta", runId: "r1", turn: 2, delta: "Added a checkout with Apple Pay and a promo code field." },
    );
    await reply.end();
    // The new screen is in front of the demo's last top-level layer, and it's selected for follow-ups.
    expect(statusText()).toBe("Added “Checkout”. It's in front of “Next Card”, so it covers it in the viewer too.");
    expect(session.selection.getState().layers).toEqual([screen.id]);
    expect(chip()).toBe("Change “Checkout”");
    expect(container.querySelector(".sb-design-box__reply")?.textContent).toBe("Added a checkout with Apple Pay and a promo code field.");
    expect(buttonNamed("Stop")).toBeNull();
    expect(chipLabels()).toEqual(["Undo", "Send to Back", "Make it interactive", "Add knobs", "Try a darker version"]);

    click(buttonNamed("Add knobs"));
    await settle();
    expect(fake.sent.at(-1)!.text).toBe(designFollowUp("knobs", "Checkout"));
    expect(fake.sent.at(-1)!.text).toBe("Turn the main colors, corner radius and spacing of “Checkout” into knobs I can tune, and link its layers to them. Group them under “Checkout”.");
  });

  it("shows a reply without an import as the status line, with no chips", async () => {
    const fake = fakeAssistantHost({ key: KEY });
    fake.nextResult = (_request, send) => {
      send({ type: "run_started", runId: "r2", model: "claude-sonnet-5" });
      send({ type: "turn_started", runId: "r2", turn: 1 });
      send({ type: "text_delta", runId: "r2", turn: 1, delta: "An event card with a photo and a like button." });
      send({ type: "run_finished", runId: "r2", outcome: "completed", usage: usage(1000) });
      return { runId: "r2", outcome: "completed", usage: usage(1000) };
    };
    await mount(fake);
    type("what's on this screen?");
    press("Enter");
    await settle();
    expect(statusText()).toBe("An event card with a photo and a like button.");
    expect(container.querySelector(".sb-design-box__reply")).toBeNull();
    expect(container.querySelector(".sb-design-box__chips")).toBeNull();
  });

  it("asks before a replace with the confirmation's own labels, focused on keeping the person's work", async () => {
    await mount();
    emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5" }, {
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
    const card = container.querySelector('.sb-design-box [role="alertdialog"]')!;
    expect(card.getAttribute("aria-label")).toBe("Replace “Home”?");
    expect([...card.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Keep “Home”", "Replace"]);
    expect(document.activeElement?.textContent).toBe("Keep “Home”");
    await act(async () => {
      buttonNamed("Keep “Home”")!.click();
      await Promise.resolve();
    });
    expect(host!.confirmations).toEqual([["c1", false]]);
    emit({ type: "confirm_resolved", runId: "r1", confirmationId: "c1", approved: false });
    expect(container.querySelector('.sb-design-box [role="alertdialog"]')).toBeNull();
  });

  it("offers Undo only while the import is the newest change", async () => {
    await mount();
    const screen = addScreen("Checkout");
    showResult({ layerId: screen.id, txnId: screen.txnId });
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
    showResult({ layerId: screen.id, txnId: screen.txnId, coveredScreen: "Next Card" });
    click(buttonNamed("Send to Back"));
    expect(session.selection.getState().layers).toEqual([screen.id]);
    expect(session.document.getState().doc.components.main!.layers[0]!.id).toBe(screen.id);
    expect(buttonNamed("Send to Back")).toBeNull();

    showResult({ layerId: screen.id, txnId: null, coveredScreen: null });
    expect(buttonNamed("Send to Back")).toBeNull();
    showResult({ kind: "updated", layerId: "card", coveredScreen: "Background" });
    expect(buttonNamed("Send to Back")).toBeNull();
  });

  it("shows no chips for a result the box's current request didn't import", async () => {
    await mount();
    const screen = addScreen("Checkout");
    act(() => designStore.setState({ request: request({ runId: null, outcome: undefined }), result: result({ layerId: screen.id, txnId: screen.txnId }) }));
    expect(container.querySelector(".sb-design-box__chips")).toBeNull();
    act(() => designStore.setState({ request: null }));
    expect(container.querySelector(".sb-design-box__chips")).toBeNull();
  });

  it("without an API key keeps the text, explains, and copies a prompt for Claude Code", async () => {
    await mount(fakeAssistantHost({}));
    type("a checkout screen");
    press("Enter");
    expect(host!.sent).toEqual([]);
    expect(field().value).toBe("a checkout screen");
    expect(box()!.textContent).toContain("Designing on the canvas uses your own Anthropic API key, kept in your keychain.");

    await act(async () => {
      buttonNamed("Copy for Claude Code")!.click();
      await Promise.resolve();
    });
    expect(clipboard).toEqual([claudePrompt({ docName: "Photo Zoom", text: "a checkout screen", context: canvasContext(session, null, bounds), browser: false })]);
    expect(clipboard[0]).toContain("import it with import_design (component \"main\")");
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
    expect(clipboard).toHaveLength(1);
    expect(clipboard[0]).toMatch(/^In my open Sonobe prototype “Photo Zoom”, redesign “Event Card” \(layer card, .+\): make it darker/);
    expect(clipboard[0]).toContain("that I can paste into Sonobe's File → Import Design → Paste HTML.");
    expect(clipboard[0]).not.toMatch(/import_design|get_outline/);
    expect(document.body.textContent).toContain("Paste it into Claude, then paste the HTML it writes into File → Import Design.");
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
    emit({ type: "run_started", runId: "sheet", model: "claude-sonnet-5" });
    expect(field().disabled).toBe(true);
    expect(buttonNamed("Stop")).toBeNull();
    expect(statusText()).toBe("The Assistant is working on a reply in the chat. Wait for it, or stop it there.");
  });

  it("Escape stops the box's reply, then closes the box and returns focus to the canvas", async () => {
    const fake = fakeAssistantHost({ key: KEY });
    const reply = heldReply(fake, "r1");
    await mount(fake);
    type("a checkout screen");
    press("Enter");
    emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5" });
    press("Escape");
    await settle();
    expect(fake.stops).toBe(1);
    expect(box()).not.toBeNull();
    await reply.end("stopped");
    expect(statusText()).toBe("Stopped. Nothing was added.");

    act(() => designStore.getState().closeBox());
    act(() => designStore.getState().openBox());
    await settle();
    press("Escape");
    expect(designStore.getState().open).toBe(false);
    expect(document.activeElement).toBe(container.querySelector(".sb-cv"));
  });

  it("runs the status line's action", async () => {
    await mount();
    act(() => designStore.setState({ request: request({ readOnly: true }) }));
    expect(statusText()).toBe("Claude is set to Read only in Settings, so the Assistant can look but not edit. Change it in Settings → Claude.");
    const { appPanels } = await import("../../app/appPanels.ts");
    click(buttonNamed("Open Settings"));
    expect(appPanels.getState().open).toBe("settings");
    appPanels.getState().hide();

    act(() => designStore.setState({ request: request({ outcome: "budget" }) }));
    expect(statusText()).toBe("This chat used its token budget. Start a new chat to keep designing.");
    await act(async () => {
      buttonNamed("New chat")!.click();
      await Promise.resolve();
    });
    expect(host!.resets).toBe(1);

    act(() => designStore.setState({ request: request({ outcome: "error", error: { code: "invalid_key", message: "Anthropic didn't accept this API key." } }) }));
    expect(statusText()).toBe("Anthropic didn't accept this API key.");
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
    expect(container.querySelector(".sb-design-box__code-label")?.textContent).toBe("Code: placemark");

    await act(async () => {
      buttonNamed("Unlink code folder")!.click();
      await Promise.resolve();
    });
    await settle();
    expect(buttonNamed("Match my code…")).not.toBeNull();

    host!.nextLink = () => ({ status: host!.folder, error: "Pick your app's folder, not your whole home folder." });
    await act(async () => {
      buttonNamed("Match my code…")!.click();
      await Promise.resolve();
    });
    await settle();
    expect(container.querySelector('.sb-design-box [role="alert"]')?.textContent).toBe("Pick your app's folder, not your whole home folder.");

    host!.folder = { linked: { name: "placemark", path: "~/code/placemark", persisted: false }, missing: true };
    await act(async () => {
      await h.controller!.refresh();
    });
    expect(container.querySelector(".sb-design-box__code-label")?.textContent).toBe("Code: placemark (missing)");
    expect(buttonNamed("Link again…")).not.toBeNull();
    expect(host!.folderCalls).toEqual(["link", "unlink", "link"]);
  });
});
