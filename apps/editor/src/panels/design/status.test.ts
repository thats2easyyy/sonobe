import { describe, expect, it } from "vitest";
import { initialAssistantData, type AssistantData, type ChatItem, type ToolChip } from "../assistant/assistantStore.ts";
import type { AssistantCanvasContext } from "../assistant/types.ts";
import { initialDesignData, type DesignData, type DesignDraft, type DesignRequest, type DesignResult } from "./designStore.ts";
import { DESIGN_COPY, designResultChips, designRunState, designStatusLine, toolStatusText } from "./status.ts";

const context: AssistantCanvasContext = { component: { id: "main", name: "Main", size: [402, 874] }, screens: [{ id: "home", name: "Home" }] };
const withTarget: AssistantCanvasContext = { ...context, target: { id: "card", name: "Card", type: "group", frame: [16, 120, 370, 200] } };
const request = (extra: Partial<DesignRequest> = {}): DesignRequest => ({ runId: "r1", text: "a checkout", context, selection: [], ...extra });
const draftOf = (extra: Partial<DesignDraft> = {}): DesignDraft => ({ source: "assistant", key: "t1", runId: "r1", turn: 1, toolUseId: "t1", html: "", fields: {}, status: "writing", since: 0, progress: null, error: null, resync: false, ...extra });
const result = (extra: Partial<DesignResult> = {}): DesignResult => ({ kind: "added", layerId: "checkout", component: "main", name: "Checkout", txnId: "x1", dropped: [], droppedCount: 0, coveredScreen: null, reply: "", ...extra });
const design = (extra: Partial<DesignData> = {}): DesignData => ({ ...initialDesignData(), open: true, request: request(), ...extra });
const chip = (name: string, extra: Partial<ToolChip> = {}): ToolChip => ({ toolUseId: `t-${name}`, name, title: name, detail: "", status: "running", changedDocument: false, ...extra });
const turn = (tools: ToolChip[] = [], text = "", runId = "r1"): ChatItem => ({ kind: "assistant", id: `a-${runId}-${text}`, runId, turn: 1, text, thinking: "", tools });
const running = (items: ChatItem[] = [], runId: string | null = "r1"): AssistantData => ({ ...initialAssistantData(), running: true, runId, items });
const idle = (items: ChatItem[] = []): AssistantData => ({ ...initialAssistantData(), items });
const line = (d: DesignData, a: AssistantData, now = 10_000) => designStatusLine(d, a, now);

describe("toolStatusText", () => {
  it("puts every tool step in words", () => {
    const text = (name: string, detail = "", title = "Something") => toolStatusText({ name, title, detail });
    for (const name of ["get_document_info", "get_outline", "get_layers", "get_items", "find", "get_selection"]) expect(text(name)).toBe("Reading your prototype…");
    expect(text("get_guide")).toBe("Reading Sonobe's guide…");
    expect(text("get_screenshot")).toBe("Looking at the screen…");
    expect(text("list_code_files")).toBe("Looking through your code…");
    expect(text("search_code")).toBe("Looking through your code…");
    expect(text("read_code_file", "src/theme.ts")).toBe("Reading src/theme.ts…");
    expect(text("read_code_file")).toBe("Looking through your code…");
    for (const name of ["add_patches", "connect", "set_values", "apply_ops"]) expect(text(name)).toBe("Wiring it up…");
    for (const name of ["add_layers", "update_layers", "rename", "delete_items"]) expect(text(name)).toBe("Editing layers…");
    for (const name of ["sim_dispatch", "sim_step", "sim_reset"]) expect(text(name)).toBe("Testing it…");
    for (const name of ["begin_work", "finish_work", "reveal"]) expect(text(name)).toBe("");
    expect(text("list_examples", "", "List examples")).toBe("List examples…");
  });
});

describe("designStatusLine while the box's reply runs", () => {
  it("thinks before any text or tool", () => {
    expect(line(design({ request: request({ runId: null }) }), running([], null))).toEqual({ text: "Thinking…", tone: "busy" });
    expect(line(design(), running([turn([], "Let me look.")]))).toEqual({ text: "Thinking…", tone: "busy" });
  });

  it("names the tool step, keeping the line through quiet steps", () => {
    expect(line(design(), running([turn([chip("get_screenshot")])]))).toEqual({ text: "Looking at the screen…", tone: "busy" });
    expect(line(design(), running([turn([chip("read_code_file", { detail: "src/theme.ts" })])]))).toEqual({ text: "Reading src/theme.ts…", tone: "busy" });
    expect(line(design(), running([turn([chip("get_outline", { status: "done" }), chip("begin_work")])]))).toEqual({ text: "Thinking…", tone: "busy" });
  });

  it("says what Claude is writing, and how much", () => {
    const writing = draftOf({ html: "x".repeat(14 * 1024), fields: { name: "Checkout" } });
    expect(line(design({ drafts: [writing] }), running())).toEqual({ text: "Writing “Checkout”… 14 KB", tone: "busy" });
    // Before the name arrives: the picked layer, else the screen.
    expect(line(design({ request: request({ context: withTarget }), drafts: [draftOf({ html: "<html>" })] }), running())?.text).toBe("Writing “Card”… 1 KB");
    expect(line(design({ request: request({ context: withTarget }), drafts: [draftOf({ fields: { name: "Promo" } })] }), running())?.text).toBe("Writing “Promo”…");
    expect(line(design({ drafts: [draftOf({ html: "x".repeat(3000) })] }), running())?.text).toBe("Writing the screen… 3 KB");
    // Another run's draft (a sheet reply) isn't the box's.
    expect(line(design({ drafts: [draftOf({ runId: "r0", fields: { name: "Old" } })] }), running())?.text).toBe("Thinking…");
  });

  it("says it's adding the layers, with the tool's progress", () => {
    expect(line(design({ drafts: [draftOf({ status: "adding" })] }), running())).toEqual({ text: "Adding the layers…", tone: "busy" });
    expect(line(design({ drafts: [draftOf({ status: "adding", progress: "Downloading images: 3 of 7" })] }), running())).toEqual({ text: "Adding the layers… Downloading images: 3 of 7", tone: "busy" });
    // An import with no draft (a URL source) runs as a plain tool.
    expect(line(design(), running([turn([chip("import_design", { title: "Import design" })])]))?.text).toBe("Adding the layers…");
  });

  it("says an import didn't work, while Claude may retry", () => {
    expect(line(design({ drafts: [draftOf({ status: "failed", error: "The page didn't load." })] }), running())).toEqual({ text: "Adding the layers didn't work: The page didn't load.", tone: "error" });
    // A retry writes a new draft.
    expect(line(design({ drafts: [draftOf({ status: "failed", error: "The page didn't load." }), draftOf({ toolUseId: "t2", fields: { name: "Checkout" } })] }), running())?.text).toBe("Writing “Checkout”…");
  });

  it("shows the done line as soon as the screen lands", () => {
    expect(line(design({ request: request({ imported: 1 }), drafts: [draftOf({ status: "added" })], result: result() }), running([turn([chip("finish_work")])]))).toEqual({ text: "Added “Checkout”.", tone: "done" });
  });

  it("says the chat is busy with a reply from the sheet", () => {
    expect(line(design({ request: null }), running([], "r5"))).toEqual({ text: "The Assistant is working on a reply in the chat. Wait for it, or stop it there.", tone: "info" });
    expect(line(design({ request: request({ outcome: "completed" }) }), running([], "r5"))?.text).toBe(DESIGN_COPY.busy);
    expect(designRunState(design(), running([], "r5"))).toBe("busy");
    expect(designRunState(design(), running())).toBe("running");
    expect(designRunState(design(), idle())).toBe("idle");
  });
});

describe("designStatusLine when the reply is done", () => {
  const done = (extra: Partial<DesignRequest> = {}) => request({ outcome: "completed", imported: 1, ...extra });

  it("says what it added, and what it covers", () => {
    expect(line(design({ request: done(), result: result() }), idle())).toEqual({ text: "Added “Checkout”.", tone: "done" });
    expect(line(design({ request: done(), result: result({ coveredScreen: "Home" }) }), idle())).toEqual({ text: "Added “Checkout”. It's in front of “Home”, so it covers it in the viewer too.", tone: "done" });
  });

  it("says what it updated, and which layers weren't in the new design", () => {
    expect(line(design({ request: done(), result: result({ kind: "updated" }) }), idle())?.text).toBe("Updated “Checkout”.");
    expect(line(design({ request: done(), result: result({ kind: "updated", name: "Card", dropped: ["Promo Badge", "Divider"], droppedCount: 2 }) }), idle())?.text).toBe("Updated “Card”. 2 layers weren't in the new design: Promo Badge, Divider.");
    expect(line(design({ request: done(), result: result({ kind: "updated", name: "Card", dropped: ["Divider"], droppedCount: 1 }) }), idle())?.text).toBe("Updated “Card”. 1 layer wasn't in the new design: Divider.");
    const many = ["A", "B", "C", "D", "E", "F", "G"];
    expect(line(design({ request: done(), result: result({ kind: "updated", name: "Card", dropped: many, droppedCount: 9 }) }), idle())?.text).toBe("Updated “Card”. 9 layers weren't in the new design: A, B, C, D, E, and 4 more.");
  });

  it("shows Claude's reply when nothing was imported", () => {
    const items = [turn([], "It has two tabs and a card."), turn([], "Other run", "r0")];
    expect(line(design({ request: request({ outcome: "completed" }), result: result() }), idle(items))).toEqual({ text: "It has two tabs and a card.", tone: "info" });
    expect(line(design({ request: request({ outcome: "completed" }) }), idle())).toBeNull();
    expect(line(design({ request: null }), idle(items))).toBeNull();
  });

  it("says whether Stop left anything behind", () => {
    expect(line(design({ request: request({ outcome: "stopped" }), drafts: [draftOf({ status: "stopped" })] }), idle())).toEqual({ text: "Stopped. Nothing was added.", tone: "info" });
    expect(line(design({ request: request({ outcome: "stopped", imported: 1 }), result: result() }), idle())).toEqual({ text: "Stopped.", tone: "info" });
    expect(line(design({ request: request({ outcome: "stopped" }) }), idle([turn([chip("update_layers", { status: "done", changedDocument: true })])]))?.text).toBe("Stopped.");
  });

  it("says the design got too long", () => {
    expect(line(design({ request: request({ outcome: "max_tokens" }), drafts: [draftOf({ status: "failed", error: "too_long" })] }), idle())).toEqual({
      text: "The design got too long to finish, so nothing was added. Ask for a simpler screen, or one part at a time.",
      tone: "warn",
    });
    expect(line(design({ request: request({ outcome: "max_tokens" }) }), idle())?.text).toBe("The reply reached the length limit and was cut off.");
  });

  it("says an import didn't work", () => {
    expect(line(design({ request: request({ outcome: "completed" }), drafts: [draftOf({ status: "failed", error: "The page didn't load." })] }), idle([turn([], "Sorry, that didn't work.")]))).toEqual({ text: "Adding the layers didn't work: The page didn't load.", tone: "error" });
    expect(line(design({ request: request({ outcome: "completed" }) }), idle([turn([chip("import_design", { status: "error", detail: "Sonobe couldn't load http://localhost:3000." })])]))?.text).toBe("Adding the layers didn't work: Sonobe couldn't load http://localhost:3000.");
  });

  it("points to Settings in Read only", () => {
    expect(line(design({ request: request({ outcome: "completed", readOnly: true }) }), idle())).toEqual({
      text: "Claude is set to Read only in Settings, so the Assistant can look but not edit. Change it in Settings → Claude.",
      tone: "warn",
      action: "settings",
    });
  });

  it("offers a new chat when the budget runs out", () => {
    expect(line(design({ request: request({ outcome: "budget" }) }), idle())).toEqual({ text: "This chat used its token budget. Start a new chat to keep designing.", tone: "warn", action: "new_chat" });
  });

  it("shows the Assistant's errors, with the API key for key problems", () => {
    const failed = (code: string, message: string) => line(design({ request: request({ outcome: "error", error: { code, message } }) }), idle());
    expect(failed("network", "Sonobe couldn't reach the Anthropic API. Check your internet connection and try again.")).toEqual({ text: "Sonobe couldn't reach the Anthropic API. Check your internet connection and try again.", tone: "error" });
    expect(failed("rate_limited", "Your API key hit its rate limit. Wait a moment, then send your message again.")).toEqual({ text: "Your API key hit its rate limit. Wait a moment, then send your message again.", tone: "error" });
    for (const code of ["no_key", "invalid_key", "permission_denied"]) expect(failed(code, "Key trouble.")).toEqual({ text: "Key trouble.", tone: "error", action: "api_key" });
  });

  it("covers the other ways a reply ends", () => {
    expect(line(design({ request: request({ outcome: "refusal" }) }), idle())?.text).toBe("Claude declined this request. Try rephrasing what you'd like to build.");
    expect(line(design({ request: request({ outcome: "max_turns" }) }), { ...idle(), limits: { maxTurns: 30, tokenBudget: 1_500_000, deleteConfirmThreshold: 10 } })?.text).toBe("The Assistant paused after 30 steps. Send a message (like “keep going”) to continue.");
  });
});

describe("designResultChips", () => {
  const finishedDesign = (extra: Partial<DesignResult> = {}, req: Partial<DesignRequest> = {}) => ({ request: request({ outcome: "completed", imported: 1, ...req }), result: result(extra) });
  const ids = (chips: ReturnType<typeof designResultChips>) => chips.map((c) => c.id);

  it("offers Undo while the import is the newest step, and Send to Back when it covers a screen", () => {
    expect(ids(designResultChips(finishedDesign({ coveredScreen: "Home" }), "x1"))).toEqual(["undo", "sendToBack", "interactive", "knobs", "darker"]);
    expect(ids(designResultChips(finishedDesign(), "x2"))).toEqual(["interactive", "knobs", "darker"]);
    expect(ids(designResultChips(finishedDesign({ txnId: null }), null))).toEqual(["interactive", "knobs", "darker"]);
    expect(ids(designResultChips(finishedDesign({ kind: "updated", coveredScreen: "Home" }), "x1"))).toEqual(["undo", "interactive", "knobs", "darker"]);
  });

  it("labels the chips and writes their follow-ups", () => {
    expect(designResultChips(finishedDesign({ coveredScreen: "Home" }), "x1")).toEqual([
      { id: "undo", label: "Undo" },
      { id: "sendToBack", label: "Send to Back" },
      { id: "interactive", label: "Make it interactive", message: "Make “Checkout” interactive: wire its buttons and controls with patches so they respond, and tell me what you wired." },
      { id: "knobs", label: "Add knobs", message: "Turn the main colors, corner radius and spacing of “Checkout” into knobs I can tune, and link its layers to them. Group them under “Checkout”." },
      { id: "darker", label: "Try a darker version", message: "Try a darker version of “Checkout”." },
    ]);
  });

  it("shows nothing until the box's reply that imported it is done", () => {
    expect(designResultChips({ request: request({ imported: 1 }), result: result() }, "x1")).toEqual([]);
    expect(designResultChips({ request: request({ outcome: "completed" }), result: result() }, "x1")).toEqual([]);
    expect(designResultChips({ request: null, result: result() }, "x1")).toEqual([]);
  });
});
