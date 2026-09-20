import { applyOps, createEmptyDocument, type Op } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { getRegistry } from "../../state/registry.ts";
import { initialAssistantData, type AssistantData, type ChatItem, type ToolChip } from "../assistant/assistantStore.ts";
import type { AssistantCanvasContext } from "../assistant/types.ts";
import { initialDesignData, type DesignData, type DesignDraft, type DesignRequest, type DesignResult } from "./designStore.ts";
import { designFollowUp } from "./prompt.ts";
import { DESIGN_COPY, designResultChips, designRunState, designStatusLine, resultPlacement, toolStatusText, type ResultPlacement } from "./status.ts";

const context: AssistantCanvasContext = { component: { id: "main", name: "Main", size: [402, 874] }, screens: [{ id: "home", name: "Home" }] };
const withTarget: AssistantCanvasContext = { ...context, target: { id: "card", name: "Card", type: "group", frame: [16, 120, 370, 200] } };
const request = (extra: Partial<DesignRequest> = {}): DesignRequest => ({ runId: "r1", text: "a checkout", context, selection: [], ...extra });
const draftOf = (extra: Partial<DesignDraft> = {}): DesignDraft => ({ source: "assistant", key: "t1", runId: "r1", turn: 1, toolUseId: "t1", html: "", fields: {}, status: "writing", since: 0, progress: null, error: null, resync: false, ...extra });
const result = (extra: Partial<DesignResult> = {}): DesignResult => ({ kind: "added", layerId: "checkout", component: "main", name: "Checkout", txnId: "x1", dropped: [], droppedCount: 0, reply: "", ...extra });
const design = (extra: Partial<DesignData> = {}): DesignData => ({ ...initialDesignData(), open: true, request: request(), ...extra });
const chip = (name: string, extra: Partial<ToolChip> = {}): ToolChip => ({ toolUseId: `t-${name}`, name, title: name, detail: "", status: "running", changedDocument: false, ...extra });
const turn = (tools: ToolChip[] = [], text = "", runId = "r1"): ChatItem => ({ kind: "assistant", id: `a-${runId}-${text}`, runId, turn: 1, text, thinking: "", tools });
const running = (items: ChatItem[] = [], runId: string | null = "r1"): AssistantData => ({ ...initialAssistantData(), running: true, runId, items });
const idle = (items: ChatItem[] = []): AssistantData => ({ ...initialAssistantData(), items });
const line = (d: DesignData, a: AssistantData, now = 10_000, placement?: ResultPlacement) => designStatusLine(d, a, now, placement);
/** The result where Claude put it, covering nothing. */
const here: ResultPlacement = { state: "here", component: "Main", stack: null, covers: null };

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

  it("says what Claude is writing, with how much as a detail the live region doesn't announce", () => {
    const writing = draftOf({ html: "x".repeat(14 * 1024), fields: { name: "Checkout" } });
    expect(line(design({ drafts: [writing] }), running())).toEqual({ text: "Writing “Checkout”…", tone: "busy", detail: "14 KB" });
    // The text stays the same as the page grows.
    expect(line(design({ drafts: [{ ...writing, html: "x".repeat(15 * 1024) }] }), running())).toEqual({ text: "Writing “Checkout”…", tone: "busy", detail: "15 KB" });
    // Before the name arrives: the picked layer, else the screen.
    expect(line(design({ request: request({ context: withTarget }), drafts: [draftOf({ html: "<html>" })] }), running())).toMatchObject({ text: "Writing “Card”…", detail: "1 KB" });
    expect(line(design({ request: request({ context: withTarget }), drafts: [draftOf({ fields: { name: "Promo" } })] }), running())).toEqual({ text: "Writing “Promo”…", tone: "busy" });
    expect(line(design({ drafts: [draftOf({ html: "x".repeat(3000) })] }), running())).toMatchObject({ text: "Writing the screen…", detail: "3 KB" });
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

  it("waits for the person's answer to a replace, not on Claude", () => {
    const confirm = (runId: string, status: "pending" | "approved" = "pending"): ChatItem => ({ kind: "confirm", id: `c-${runId}`, runId, title: "Replace “Home”?", message: "…", count: 1, status, confirmKind: "replace" });
    const adding = design({ drafts: [draftOf({ status: "adding", fields: { replace: "home" } })] });
    expect(line(adding, running([confirm("r1")]))).toEqual({ text: "Waiting for your answer…", tone: "info" });
    // Once they answer, or for another run's card, it's the draft's line again.
    expect(line(adding, running([confirm("r1", "approved")]))?.text).toBe("Adding the layers…");
    expect(line(adding, running([confirm("r0")]))?.text).toBe("Adding the layers…");
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

  it("says what it added, and what it covers or what covers it now", () => {
    const at = (placement: Partial<ResultPlacement>) => line(design({ request: done(), result: result() }), idle(), 10_000, { ...here, ...placement });
    expect(line(design({ request: done(), result: result() }), idle())).toEqual({ text: "Added “Checkout”.", tone: "done" });
    expect(at({})).toEqual({ text: "Added “Checkout”.", tone: "done" });
    expect(at({ stack: "front", covers: "Home" })).toEqual({ text: "Added “Checkout”. It's in front of “Home”, so it covers it in the viewer too.", tone: "done" });
    expect(at({ stack: "front" })).toEqual({ text: "Added “Checkout”. It's in front of the other layers in “Main”, so it covers them in the viewer too.", tone: "done" });
    expect(at({ stack: "back" })).toEqual({ text: "Added “Checkout”. It's behind the other layers in “Main” now, so they cover it in the viewer.", tone: "done" });
  });

  it("says when the result was undone or deleted, while the reply runs too", () => {
    expect(line(design({ request: done(), result: result() }), idle(), 10_000, { ...here, state: "undone" })).toEqual({ text: "Undid “Checkout”.", tone: "info" });
    expect(line(design({ request: done(), result: result({ kind: "updated", name: "Card" }) }), idle(), 10_000, { ...here, state: "undone" })).toEqual({ text: "Undid the new version of “Card”.", tone: "info" });
    expect(line(design({ request: done(), result: result() }), idle(), 10_000, { ...here, state: "gone" })).toEqual({ text: "“Checkout” isn't on the canvas anymore.", tone: "info" });
    expect(line(design({ request: request({ imported: 1 }), result: result() }), running(), 10_000, { ...here, state: "undone" })?.text).toBe("Undid “Checkout”.");
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

describe("resultPlacement", () => {
  const screen = (id: string, name: string, size: [number, number] = [402, 874], type = "group") => ({ op: "addLayer" as const, layer: { id, type, name, props: { size } } });
  const docOf = (ops: Op[]) => {
    const built = applyOps(createEmptyDocument({ name: "Shop" }), ops, { registry: getRegistry() });
    expect(built.ok).toBe(true);
    return built.doc;
  };

  it("names the nearest screen behind a new one, else the other layers", () => {
    const doc = docOf([screen("home", "Home"), { op: "addLayer", layer: { id: "bg", type: "colorFill", name: "Background" } }, screen("badge", "Badge", [80, 30]), screen("checkout", "Checkout")]);
    expect(resultPlacement(doc, result())).toEqual({ state: "here", component: "Main", stack: "front", covers: "Home" });
    const demo = docOf([{ op: "addLayer", layer: { id: "bg", type: "colorFill", name: "Background" } }, screen("card", "Next Card", [370, 300]), screen("checkout", "Checkout")]);
    expect(resultPlacement(demo, result())).toMatchObject({ stack: "front", covers: null });
  });

  it("follows Send to Back, Undo, deletes, and what isn't a new top-level screen", () => {
    const doc = docOf([screen("checkout", "Checkout"), screen("home", "Home")]);
    expect(resultPlacement(doc, result())).toMatchObject({ state: "here", stack: "back", covers: null });
    expect(resultPlacement(doc, result({ undone: true })).state).toBe("undone");
    expect(resultPlacement(doc, result({ layerId: "gone" })).state).toBe("gone");
    expect(resultPlacement(doc, result({ kind: "updated", layerId: "home" }))).toMatchObject({ state: "here", stack: null });
    expect(resultPlacement(docOf([screen("checkout", "Checkout")]), result())).toMatchObject({ state: "here", stack: null });
  });
});

describe("designResultChips", () => {
  const finishedDesign = (extra: Partial<DesignResult> = {}, req: Partial<DesignRequest> = {}) => ({ request: request({ outcome: "completed", imported: 1, ...req }), result: result(extra) });
  const ids = (chips: ReturnType<typeof designResultChips>) => chips.map((c) => c.id);
  const front: ResultPlacement = { ...here, stack: "front", covers: "Home" };

  it("offers Undo while the import is the newest step, and Send to Back while it's in front of other layers", () => {
    expect(ids(designResultChips(finishedDesign(), "x1", front))).toEqual(["undo", "sendToBack", "interactive", "knobs", "darker"]);
    expect(ids(designResultChips(finishedDesign(), "x1", { ...front, covers: null }))).toEqual(["undo", "sendToBack", "interactive", "knobs", "darker"]);
    expect(ids(designResultChips(finishedDesign(), "x2"))).toEqual(["interactive", "knobs", "darker"]);
    expect(ids(designResultChips(finishedDesign({ txnId: null }), null))).toEqual(["interactive", "knobs", "darker"]);
    expect(ids(designResultChips(finishedDesign({ kind: "updated" }), "x1", front))).toEqual(["undo", "interactive", "knobs", "darker"]);
    // Sent to the back: nothing left to send.
    expect(ids(designResultChips(finishedDesign(), "x1", { ...here, stack: "back" }))).toEqual(["undo", "interactive", "knobs", "darker"]);
  });

  it("offers nothing once the result is undone or gone", () => {
    expect(designResultChips(finishedDesign(), "x1", { ...here, state: "undone" })).toEqual([]);
    expect(designResultChips(finishedDesign(), "x1", { ...here, state: "gone" })).toEqual([]);
  });

  it("keeps the other follow-ups after one that didn't import", () => {
    const onResult: AssistantCanvasContext = { ...context, target: { id: "checkout", name: "Checkout", type: "group", frame: [0, 0, 402, 874] } };
    const followedUp = (text: string, extra: Partial<DesignRequest> = {}) => designResultChips({ request: request({ outcome: "completed", text, context: onResult, ...extra }), result: result() }, "x2", here);
    expect(ids(followedUp(designFollowUp("interactive", "Checkout")))).toEqual(["knobs", "darker"]);
    expect(ids(followedUp("what does the Pay button do?"))).toEqual(["interactive", "knobs", "darker"]);
    // Not when it was about another layer, or didn't finish.
    expect(followedUp("make it rounder", { context: withTarget })).toEqual([]);
    expect(followedUp(designFollowUp("knobs", "Checkout"), { outcome: "stopped" })).toEqual([]);
  });

  it("labels the chips and writes their follow-ups", () => {
    expect(designResultChips(finishedDesign(), "x1", front)).toEqual([
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
