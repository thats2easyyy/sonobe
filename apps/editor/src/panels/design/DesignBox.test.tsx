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
import { canvasContext, designTarget } from "./context.ts";
import { DesignBox } from "./DesignBox.tsx";
import { applyPreviewUpdate, attachDesign, designStore, initialDesignData, type DesignRequest, type DesignResult } from "./designStore.ts";
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
/** What the live region says (screen readers hear it). */
const statusText = () => container.querySelector('.sb-design-box [role="status"]')?.textContent;
/** The status line as it shows, with its detail. */
const statusShown = () => container.querySelector(".sb-design-box__status-body")?.textContent;
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

const result = (over: Partial<DesignResult>): DesignResult => ({ kind: "added", layerId: "card", component: "main", name: "Checkout", txnId: null, dropped: [], droppedCount: 0, reply: "", ...over });

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

  it("moves focus to its field each time it's opened, even when it's already open", async () => {
    await mount();
    const canvas = container.querySelector<HTMLElement>(".sb-cv")!;
    act(() => canvas.focus());
    expect(document.activeElement).toBe(canvas);
    // Redesign with Claude… on another layer, from the Layers menu or ⌘K.
    select(["card"]);
    act(() => designStore.getState().openBox());
    expect(chip()).toBe("Redesign “Event Card”");
    expect(document.activeElement).toBe(field());
  });

  it("shows Claude Code's draft on the canvas, with Hide preview", async () => {
    await mount();
    const update = { docId: "photo", key: "cc-1", author: { kind: "agent" as const, name: "Claude" }, client: { id: "cc-1", label: "Claude Code" }, name: "Checkout", component: null, replace: null, width: null, height: null, position: null, html: "<p>Hi</p>", status: "writing" as const, draftRevision: 1 };
    act(() => {
      applyPreviewUpdate(session, update);
    });
    const row = () => container.querySelector(".sb-design-box__mcp");
    expect(row()?.textContent).toBe("Claude Code is writing “Checkout” on the canvas.Hide preview");
    act(() => {
      applyPreviewUpdate(session, { ...update, status: "adding", draftRevision: 2 });
    });
    expect(row()?.querySelector("p")?.textContent).toBe("Claude Code is adding “Checkout” to the canvas…");
    click(buttonNamed("Hide preview"));
    expect(designStore.getState().drafts[0]?.status).toBe("stopped");
    expect(row()).toBeNull();
    expect(document.activeElement).toBe(field());
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

    const page = `<main data-name="Checkout">${"x".repeat(15 * 1024)}</main>`;
    emit({ type: "design_draft", runId: "r1", turn: 1, toolUseId: "t1", offset: 0, append: page.slice(0, 14 * 1024), fields: { name: "Checkout" }, done: false });
    // The size shows, but the live region only speaks when the phase changes.
    expect(statusText()).toBe("Writing “Checkout”…");
    expect(statusShown()).toBe("Writing “Checkout”…14 KB");
    expect(container.querySelector(".sb-design-box__status-detail")?.getAttribute("aria-hidden")).toBe("true");
    emit({ type: "design_draft", runId: "r1", turn: 1, toolUseId: "t1", offset: 14 * 1024, append: page.slice(14 * 1024, 15 * 1024), done: false });
    expect(statusText()).toBe("Writing “Checkout”…");
    expect(statusShown()).toBe("Writing “Checkout”…15 KB");
    emit({ type: "design_draft", runId: "r1", turn: 1, toolUseId: "t1", offset: 15 * 1024, append: page.slice(15 * 1024), done: true, html: page });
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
    // The new screen is in front of the demo's layers (none of them a screen), and it's selected for follow-ups.
    expect(statusText()).toBe("Added “Checkout”. It's in front of the other layers in “Main”, so it covers them in the viewer too.");
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

  it("asks before a replace with the confirmation's own labels, focused on keeping the person's work, and says it's waiting", async () => {
    const fake = fakeAssistantHost({ key: KEY });
    const reply = heldReply(fake, "r1");
    await mount(fake);
    type("a new home screen");
    press("Enter");
    const page = "<main data-name='Home'>Home</main>";
    emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5" }, { type: "design_draft", runId: "r1", turn: 1, toolUseId: "t1", offset: 0, append: page, fields: { name: "Home", replace: "home" }, done: true, html: page });
    expect(statusText()).toBe("Adding the layers…");
    emit({
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
    // Focus lands on a button, so the card's title names it and its message describes it.
    expect(document.getElementById(card.getAttribute("aria-labelledby")!)?.textContent).toBe("Replace “Home”?");
    expect(document.getElementById(card.getAttribute("aria-describedby")!)?.textContent).toBe("Claude wants to rebuild “Home”, which you didn't ask it to change. You can undo it afterwards.");
    expect([...card.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Keep “Home”", "Replace"]);
    expect(document.activeElement?.textContent).toBe("Keep “Home”");
    // Nothing is being added while the person decides.
    expect(statusText()).toBe("Waiting for your answer…");
    await act(async () => {
      buttonNamed("Keep “Home”")!.click();
      await Promise.resolve();
    });
    expect(host!.confirmations).toEqual([["c1", false]]);
    emit({ type: "confirm_resolved", runId: "r1", confirmationId: "c1", approved: false });
    expect(container.querySelector('.sb-design-box [role="alertdialog"]')).toBeNull();
    await reply.end();
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
    // Its screen is gone, so the line says so and there's nothing left to follow up on.
    expect(statusText()).toBe("Undid “Checkout”.");
    expect(container.querySelector(".sb-design-box__chips")).toBeNull();
    // Redo brings it back, with its line and chips.
    act(() => {
      session.document.getState().redo();
    });
    expect(statusText()).toMatch(/^Added “Checkout”\./);
    expect(buttonNamed("Undo")).not.toBeNull();
    // ⌘Z undoes it the same way, and a delete takes it off the canvas.
    act(() => {
      session.document.getState().undo();
    });
    expect(statusText()).toBe("Undid “Checkout”.");
    act(() => {
      session.document.getState().redo();
      session.document.getState().apply([{ op: "removeLayer", component: "main", id: screen.id }], { label: "Delete" });
    });
    expect(statusText()).toBe("“Checkout” isn't on the canvas anymore.");
    expect(container.querySelector(".sb-design-box__chips")).toBeNull();
  });

  it("keeps an undone redesign undone through the next edit, and the layer Undo brought back isn't Claude's", async () => {
    await mount();
    const card = () => findLayer(session.document.getState().doc.components.main!.layers, "card")!.layer;
    const rename = (id: string, name: string) =>
      act(() => {
        session.document.getState().apply([{ op: "updateLayer", component: "main", id, name }], { label: "Rename" });
      });
    // A replace keeps the layer's id, as import_design's does.
    let txnId = "";
    act(() => {
      session.document.getState().apply([{ op: "removeLayer", component: "main", id: "card" }, { op: "addLayer", component: "main", layer: { id: "card", type: "group", name: "Card v2", props: { position: [16, 146], size: [370, 300] } } }], { label: "Import “Card v2”" });
      txnId = session.document.getState().lastChange!.txnId!;
    });
    select(["card"]);
    showResult({ kind: "updated", layerId: "card", name: "Card v2", txnId, reply: "A bolder card." });
    expect(statusText()).toBe("Updated “Card v2”.");
    expect(chip()).toBe("Change “Card v2”");

    click(buttonNamed("Undo"));
    expect(card().name).toBe("Event Card");
    expect(statusText()).toBe("Undid the new version of “Card v2”.");
    expect(chip()).toBe("Redesign “Event Card”");
    // Redo, then an edit: the redesign is back, and stays Claude's.
    act(() => {
      session.document.getState().redo();
    });
    rename("next_card", "Upcoming Card");
    expect(statusText()).toBe("Updated “Card v2”.");
    expect(chipLabels()).toEqual(["Make it interactive", "Add knobs", "Try a darker version"]);
    expect(chip()).toBe("Change “Card v2”");

    // Undo it again, then edit: the edit empties the redo stack, and the old card is still the person's.
    act(() => {
      session.document.getState().undo();
      session.document.getState().undo();
    });
    rename("like_button", "Heart");
    expect(session.document.getState().redoEntries()).toEqual([]);
    expect(card().name).toBe("Event Card");
    expect(statusText()).toBe("Undid the new version of “Card v2”.");
    expect(container.querySelector(".sb-design-box__chips")).toBeNull();
    expect(container.querySelector(".sb-design-box__reply")).toBeNull();
    expect(chip()).toBe("Redesign “Event Card”");
  });

  it("offers Send to Back while a new screen is in front of other layers, and says where it is after", async () => {
    await mount();
    const screen = addScreen("Checkout");
    showResult({ layerId: screen.id, txnId: screen.txnId });
    expect(statusText()).toBe("Added “Checkout”. It's in front of the other layers in “Main”, so it covers them in the viewer too.");
    click(buttonNamed("Send to Back"));
    expect(session.selection.getState().layers).toEqual([screen.id]);
    expect(session.document.getState().doc.components.main!.layers[0]!.id).toBe(screen.id);
    expect(buttonNamed("Send to Back")).toBeNull();
    expect(statusText()).toBe("Added “Checkout”. It's behind the other layers in “Main” now, so they cover it in the viewer.");
    // It reads the document, so reopening the box doesn't bring the chip back.
    act(() => designStore.getState().closeBox());
    act(() => designStore.getState().openBox());
    expect(buttonNamed("Send to Back")).toBeNull();
    // Undoing the move does.
    act(() => {
      session.document.getState().undo();
    });
    expect(buttonNamed("Send to Back")).not.toBeNull();

    showResult({ kind: "updated", layerId: "card" });
    expect(buttonNamed("Send to Back")).toBeNull();
  });

  it("names the screen a new one covers", async () => {
    await mount();
    const home = addScreen("Home");
    const screen = addScreen("Checkout");
    showResult({ layerId: screen.id, txnId: screen.txnId });
    expect(findLayer(session.document.getState().doc.components.main!.layers, home.id)).toBeDefined();
    expect(statusText()).toBe("Added “Checkout”. It's in front of “Home”, so it covers it in the viewer too.");
  });

  it("keeps the other follow-ups after one that only wired the screen", async () => {
    const fake = fakeAssistantHost({ key: KEY });
    await mount(fake);
    const screen = addScreen("Checkout");
    select([screen.id]);
    act(() => designStore.setState({ request: request({ imported: 1, context: canvasContext(session, designTarget(session, designStore.getState()), bounds) }), result: result({ layerId: screen.id, txnId: screen.txnId, reply: "Added a checkout." }) }));
    fake.nextResult = (_request, send) => {
      send({ type: "run_started", runId: "r2", model: "claude-sonnet-5" });
      send({ type: "turn_started", runId: "r2", turn: 1 });
      send({ type: "text_delta", runId: "r2", turn: 1, delta: "The Pay button now bounces when you tap it." });
      send({ type: "run_finished", runId: "r2", outcome: "completed", usage: usage(1000) });
      return { runId: "r2", outcome: "completed", usage: usage(1000) };
    };
    click(buttonNamed("Make it interactive"));
    await settle();
    expect(statusText()).toBe("The Pay button now bounces when you tap it.");
    expect(chipLabels()).toEqual(["Add knobs", "Try a darker version"]);
    // The status line is the new reply; the import's reply doesn't stay under it.
    expect(container.querySelector(".sb-design-box__reply")).toBeNull();
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
    // Screen readers hear why nothing was sent, and the field points at the notice.
    expect(statusText()).toBe("Nothing was sent. Designing here needs your own Anthropic API key, or you can open it in Claude Code.");
    expect(field().getAttribute("aria-describedby")).toBe(container.querySelector(".sb-design-box__notice p")!.id);

    await act(async () => {
      buttonNamed("Copy for Claude Code")!.click();
      await Promise.resolve();
    });
    expect(clipboard).toEqual([claudePrompt({ docName: "Photo Zoom", text: "a checkout screen", context: canvasContext(session, null, bounds), browser: false })]);
    expect(clipboard[0]).toContain('preview_design (component "main")');
    expect(clipboard[0]).toContain('then import_design with "preview": true');
    expect(document.body.textContent).toContain("Prompt copied");
    expect(document.body.textContent).toContain("Paste it into Claude Code in your app's folder.");

    click(buttonNamed("Add API key…"));
    expect(assistantStore.getState().open).toBe(true);
  });

  it("without an API key, offers Open in Claude Code first, and opens the request in Terminal with the folder it linked", async () => {
    const fake = fakeAssistantHost({});
    await mount(fake);
    const footer = () => [...container.querySelectorAll(".sb-design-box__footer button")].map((b) => b.textContent || b.getAttribute("aria-label"));
    // Before Return, plan users find it in the footer.
    expect(footer()).toEqual(["Match my code…", "Open in Claude Code", "Open chat", "Close"]);
    type("a checkout screen");
    press("Enter");
    const notice = container.querySelector(".sb-design-box__notice")!;
    expect(notice.textContent).toContain("Designing on the canvas uses your own Anthropic API key, kept in your keychain. With a Claude plan, open it in Claude Code instead: it draws on this canvas as it writes.");
    expect([...notice.querySelectorAll("button")].map((b) => [b.textContent, b.dataset.variant])).toEqual([
      ["Open in Claude Code", "ai"],
      ["Add API key…", "secondary"],
      ["Copy for Claude Code", "secondary"],
    ]);
    expect(footer()).not.toContain("Open in Claude Code");

    await act(async () => {
      buttonNamed("Open in Claude Code")!.click();
      await Promise.resolve();
    });
    await settle();
    expect(fake.handoffs).toEqual([claudePrompt({ docName: "Photo Zoom", text: "a checkout screen", context: canvasContext(session, null, bounds), browser: false })]);
    expect(fake.sent).toEqual([]);
    expect(document.body.textContent).toContain("Opened Claude Code");
    expect(document.body.textContent).toContain("In Terminal, in “noddit”. It designs on this canvas as it writes.");
    // The folder picked for it is linked, the way Match my code… links one.
    expect(container.querySelector(".sb-design-box__code-label")?.textContent).toBe("Code: noddit");
    expect(field().value).toBe("a checkout screen");
  });

  it("says why Claude Code didn't open, with Copy prompt, and stays quiet when the folder dialog is cancelled", async () => {
    const fake = fakeAssistantHost({});
    fake.nextHandoff = () => ({ ok: false, cancelled: true });
    await mount(fake);
    select(["card"]);
    type("make it darker");
    press("Enter");
    const open = async () => {
      await act(async () => {
        buttonNamed("Open in Claude Code")!.click();
        await Promise.resolve();
      });
      await settle();
    };
    await open();
    expect(fake.handoffs).toHaveLength(1);
    expect(document.querySelector(".sb-toast")).toBeNull();

    fake.nextHandoff = () => ({ ok: false, error: "Open in Claude Code works on macOS for now. Copy the prompt instead, and paste it into Claude Code in your app's folder." });
    await open();
    const toastEl = document.querySelector<HTMLElement>(".sb-toast")!;
    expect(toastEl.dataset.tone).toBe("danger");
    expect(toastEl.textContent).toContain("Couldn't open Claude Code");
    expect(toastEl.textContent).toContain("Open in Claude Code works on macOS for now. Copy the prompt instead, and paste it into Claude Code in your app's folder.");
    const action = toastEl.querySelector<HTMLButtonElement>(".sb-toast__action")!;
    expect(action.textContent).toBe("Copy prompt");
    await act(async () => {
      action.click();
      await Promise.resolve();
    });
    expect(clipboard).toEqual([fake.handoffs[1]]);
    expect(clipboard[0]).toContain('preview_design (replace "card", component "main")');
    expect(document.body.textContent).toContain("Prompt copied");
  });

  it("says Claude Code can't reach the canvas when the organization's MCP servers leave Sonobe's out", async () => {
    const fake = fakeAssistantHost({});
    fake.nextHandoff = () => ({ ok: true, folder: "~/code/noddit", withoutSonobe: true });
    await mount(fake);
    type("a checkout screen");
    await act(async () => {
      buttonNamed("Open in Claude Code")!.click();
      await Promise.resolve();
    });
    await settle();
    const toastEl = document.querySelector<HTMLElement>(".sb-toast")!;
    expect(toastEl.dataset.tone).toBe("warn");
    expect(toastEl.textContent).toContain("Opened Claude Code without Sonobe");
    expect(toastEl.textContent).toContain("In Terminal, in “noddit”. Your organization's MCP servers for Claude Code don't include Sonobe's, so it can't design on this canvas. Terminal says what to ask your admin.");
    expect(toastEl.textContent).not.toContain("It designs on this canvas as it writes.");
  });

  it("offers Open in Claude Code in the footer with a key, and asks for a description first", async () => {
    await mount();
    await act(async () => {
      buttonNamed("Open in Claude Code")!.click();
      await Promise.resolve();
    });
    expect(host!.handoffs).toEqual([]);
    expect(document.body.textContent).toContain("Describe the screen first");
    expect(document.activeElement).toBe(field());

    type("a checkout screen");
    await act(async () => {
      buttonNamed("Open in Claude Code")!.click();
      await Promise.resolve();
    });
    await settle();
    expect(host!.handoffs).toHaveLength(1);
    expect(host!.sent).toEqual([]);
    expect(document.body.textContent).toContain("Opened Claude Code");
  });

  it("holds Open in Claude Code while the box's reply runs, then offers it the request the Assistant couldn't finish", async () => {
    const fake = fakeAssistantHost({ key: KEY });
    const reply = heldReply(fake, "r1");
    await mount(fake);
    type("a checkout screen");
    press("Enter");
    emit({ type: "run_started", runId: "r1", model: "claude-sonnet-5" });
    expect(buttonNamed("Open in Claude Code")!.disabled).toBe(true);
    await reply.end("budget");
    expect(field().value).toBe("");
    expect(buttonNamed("Open in Claude Code")!.disabled).toBe(false);
    await act(async () => {
      buttonNamed("Open in Claude Code")!.click();
      await Promise.resolve();
    });
    await settle();
    expect(fake.handoffs).toEqual([claudePrompt({ docName: "Photo Zoom", text: "a checkout screen", context: canvasContext(session, null, bounds), browser: false })]);
  });

  it("leaves out Open in Claude Code on other platforms and with an older preload", async () => {
    const windows = fakeAssistantHost({});
    Object.defineProperty(windows, "platform", { value: "win32" });
    await mount(windows);
    type("a checkout screen");
    press("Enter");
    expect(buttonNamed("Open in Claude Code")).toBeNull();
    expect(container.querySelector(".sb-design-box__notice p")?.textContent).toBe("Designing on the canvas uses your own Anthropic API key, kept in your keychain.");
    expect(buttonNamed("Add API key…")?.dataset.variant).toBe("ai");

    act(() => root.unmount());
    detach();
    h.controller!.dispose();
    root = createRoot(container);
    const older = fakeAssistantHost({ key: KEY });
    delete older.assistant!.openInClaudeCode;
    await mount(older);
    expect(buttonNamed("Open in Claude Code")).toBeNull();
  });

  it("in the browser, copies the browser prompt and offers Import Design", async () => {
    await mount(null);
    expect(box()!.textContent).toContain("Claude designs on the canvas in the Sonobe desktop app, with your own API key or Claude Code. Here, copy a prompt for Claude, then paste the HTML it writes.");
    expect(buttonNamed("Open chat")).toBeNull();
    expect(buttonNamed("Match my code…")).toBeNull();
    // The field's button copies too, and says so.
    expect(field().getAttribute("aria-describedby")).toBe(container.querySelector(".sb-design-box__notice p")!.id);
    expect(container.querySelector(".sb-assistant-composer__send")?.getAttribute("aria-label")).toBe("Copy prompt");
    select(["card"]);
    type("make it darker");
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".sb-design-box__notice button")!.click();
      await Promise.resolve();
    });
    expect(clipboard).toHaveLength(1);
    expect(clipboard[0]).toMatch(/^In my open Sonobe prototype, redesign layer card \(.+, in component main\): make it darker/);
    expect(clipboard[0]).toContain("Prototype: “Photo Zoom”");
    expect(clipboard[0]).toContain("Layer card: “Event Card”");
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
    expect(container.querySelector(".sb-design-box__code-label")?.textContent).toBe("Code: noddit");

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

    host!.folder = { linked: { name: "noddit", path: "~/code/noddit", persisted: false }, missing: true };
    await act(async () => {
      await h.controller!.refresh();
    });
    expect(container.querySelector(".sb-design-box__code-label")?.textContent).toBe("Code: noddit (missing)");
    expect(buttonNamed("Link again…")).not.toBeNull();
    expect(host!.folderCalls).toEqual(["link", "unlink", "link"]);
  });
});
