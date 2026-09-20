/**
 * The Design with Claude box's status line: what Claude is doing right now (thinking, a tool step,
 * writing the page, adding the layers), what it made, and what went wrong, with the action that helps.
 * Also the chips under a result (Undo, Send to Back and the follow-ups).
 */

import { artboardSize, findLayer, type LayerNode, type SonobeDocument } from "@sonobe/core";
import { draftKb, type AssistantData, type ToolChip } from "../assistant/assistantStore.ts";
import type { AssistantError } from "../assistant/types.ts";
import { activeDraft, DRAFT_TOO_LONG, runReply, type DesignData, type DesignDraft, type DesignRequest, type DesignResult } from "./designStore.ts";
import { designFollowUp, type DesignFollowUpKind } from "./prompt.ts";

export interface DesignStatusLine {
  /** What the live region says: it changes only when the phase does. */
  text: string;
  tone: "busy" | "done" | "info" | "warn" | "error";
  action?: "api_key" | "new_chat" | "settings";
  /** Shown after the text but not announced, since it changes as Claude writes ("14 KB"). */
  detail?: string;
}

const READ_TOOLS = new Set(["get_document_info", "get_outline", "get_layers", "get_items", "find", "get_selection"]);
const CODE_SEARCH_TOOLS = new Set(["list_code_files", "search_code"]);
const WIRING_TOOLS = new Set(["add_patches", "connect", "set_values", "apply_ops"]);
const LAYER_TOOLS = new Set(["add_layers", "update_layers", "rename", "delete_items"]);
/** Steps that don't change what the line says. */
const QUIET_TOOLS = new Set(["begin_work", "finish_work", "reveal"]);
/** Errors the person fixes with their API key (the box opens the sheet's key setup). */
const KEY_ERRORS = new Set(["no_key", "invalid_key", "permission_denied"]);

export const DESIGN_COPY = {
  thinking: "Thinking…",
  adding: "Adding the layers…",
  waiting: "Waiting for your answer…",
  busy: "The Assistant is working on a reply in the chat. Wait for it, or stop it there.",
  stopped: "Stopped.",
  stoppedNothingAdded: "Stopped. Nothing was added.",
  tooLong: "The design got too long to finish, so nothing was added. Ask for a simpler screen, or one part at a time.",
  cutOff: "The reply reached the length limit and was cut off.",
  readOnly: "Claude is set to Read only in Settings, so the Assistant can look but not edit. Change it in Settings → Claude.",
  budget: "This chat used its token budget. Start a new chat to keep designing.",
  refusal: "Claude declined this request. Try rephrasing what you'd like to build.",
} as const;

/** A tool step in words ("Reading your prototype…"). Empty for steps that keep the line that was showing (begin_work, finish_work, reveal). */
export function toolStatusText(chip: { name: string; title: string; detail: string }): string {
  const { name, detail } = chip;
  if (QUIET_TOOLS.has(name)) return "";
  if (READ_TOOLS.has(name)) return "Reading your prototype…";
  if (name === "get_guide") return "Reading Sonobe's guide…";
  if (name === "get_screenshot") return "Looking at the screen…";
  if (CODE_SEARCH_TOOLS.has(name)) return "Looking through your code…";
  if (name === "read_code_file") return detail ? `Reading ${detail}…` : "Looking through your code…";
  if (WIRING_TOOLS.has(name)) return "Wiring it up…";
  if (LAYER_TOOLS.has(name)) return "Editing layers…";
  if (name.startsWith("sim_")) return "Testing it…";
  return `${chip.title || name}…`;
}

/** Whether the reply running now is the box's, another one (from the chat sheet), or none. */
export function designRunState(design: Pick<DesignData, "request">, assistant: Pick<AssistantData, "running" | "runId">): "idle" | "running" | "busy" {
  if (!assistant.running) return "idle";
  const { request } = design;
  if (request && request.outcome === undefined && (request.runId === null || assistant.runId === null || request.runId === assistant.runId)) return "running";
  return "busy";
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "Promo Badge, Divider", or the first five and ", and N more". */
function nameList(names: readonly string[], count: number): string {
  const shown = names.slice(0, 5);
  const more = Math.max(count, names.length) - shown.length;
  return more > 0 ? `${shown.join(", ")}, and ${more} more` : shown.join(", ");
}

/** Where the box's result is now, read from the document each time it's shown. */
export interface ResultPlacement {
  /** "undone": its import is on the redo stack; "gone": its screen isn't in its component anymore. */
  state: "here" | "undone" | "gone";
  /** Its component's name. */
  component: string;
  /** A new top-level screen beside others: "front" with layers behind it, "back" behind all of them. Else null. */
  stack: "front" | "back" | null;
  /** The nearest screen behind it (a group or component instance at least the artboard's size), when it's in front. */
  covers: string | null;
}

const pair = (value: unknown): [number, number] | null => (Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === "number" && Number.isFinite(n)) ? [value[0] as number, value[1] as number] : null);

/** A layer that reads as a screen: a group or component instance at least the artboard's size. */
function isScreen(layer: LayerNode, [width, height]: [number, number]): boolean {
  const size = pair(layer.props.size);
  return (layer.type === "group" || layer.type === "componentInstance") && size !== null && size[0] >= width - 1 && size[1] >= height - 1;
}

/** Where the result is in `doc`. `undone`: its txnId is among the document's redo entries. */
export function resultPlacement(doc: SonobeDocument, result: DesignResult, undone: boolean): ResultPlacement {
  const component = doc.components[result.component];
  const place: ResultPlacement = { state: "here", component: component?.name ?? result.component, stack: null, covers: null };
  if (undone) return { ...place, state: "undone" };
  const loc = component ? findLayer(component.layers, result.layerId) : undefined;
  if (!loc) return { ...place, state: "gone" };
  if (result.kind !== "added" || loc.parent !== null || loc.siblings.length < 2) return place;
  if (loc.index === 0) return { ...place, stack: "back" };
  const size = artboardSize(doc, result.component);
  const screen = loc.siblings.slice(0, loc.index).findLast((layer) => isScreen(layer, size));
  return { ...place, stack: "front", covers: screen?.name ?? null };
}

/** "Added “Checkout”." and its variants, for the screen Claude just made, as the document has it now. */
function doneLine(result: DesignResult, placement: ResultPlacement | undefined): DesignStatusLine {
  if (placement?.state === "undone") return { text: result.kind === "added" ? `Undid “${result.name}”.` : `Undid the new version of “${result.name}”.`, tone: "info" };
  if (placement?.state === "gone") return { text: `“${result.name}” isn't on the canvas anymore.`, tone: "info" };
  if (result.kind === "added") {
    const added = `Added “${result.name}”.`;
    if (placement?.stack === "back") return { text: `${added} It's behind the other layers in “${placement.component}” now, so they cover it in the viewer.`, tone: "done" };
    if (placement?.stack !== "front") return { text: added, tone: "done" };
    return { text: placement.covers ? `${added} It's in front of “${placement.covers}”, so it covers it in the viewer too.` : `${added} It's in front of the other layers in “${placement.component}”, so it covers them in the viewer too.`, tone: "done" };
  }
  const n = result.droppedCount;
  if (n <= 0) return { text: `Updated “${result.name}”.`, tone: "done" };
  return { text: `Updated “${result.name}”. ${n} ${plural(n, "layer wasn't", "layers weren't")} in the new design: ${nameList(result.dropped, n)}.`, tone: "done" };
}

/** "Writing “Checkout”…" with "14 KB" as its detail: the page's name once Claude has written it, else the layer the box picked. */
function writingLine(draft: DesignDraft, request: DesignRequest): DesignStatusLine {
  const target = request.context.target;
  const name = draft.fields.name ?? (target && (draft.fields.replace === undefined || draft.fields.replace === target.id) ? target.name : undefined);
  const kb = draftKb(draft.html.length);
  return { text: `Writing ${name ? `“${name}”` : "the screen"}…`, tone: "busy", ...(kb > 0 ? { detail: `${kb} KB` } : {}) };
}

/** What the box says about an MCP client's live draft on the canvas ("Claude Code is writing “Checkout” on the canvas."). */
export function mcpDraftText(draft: DesignDraft): string {
  const writer = draft.mcp?.client?.label.trim() || draft.mcp?.author.name || "Claude";
  const what = draft.fields.name ? `“${draft.fields.name}”` : "a screen";
  return draft.status === "adding" ? `${writer} is adding ${what} to the canvas…` : `${writer} is writing ${what} on the canvas.`;
}

const failedLine = (detail: string | null): DesignStatusLine => ({ text: detail ? `Adding the layers didn't work: ${detail}` : "Adding the layers didn't work.", tone: "error" });

function errorLine(error: AssistantError | undefined): DesignStatusLine {
  if (!error) return { text: "The Assistant stopped with an error.", tone: "error" };
  return { text: error.message, tone: "error", ...(KEY_ERRORS.has(error.code) ? { action: "api_key" as const } : {}) };
}

/** The run's tool chips, oldest first. */
function runTools(assistant: Pick<AssistantData, "items">, runId: string | null): ToolChip[] {
  if (runId === null) return [];
  return assistant.items.flatMap((item) => (item.kind === "assistant" && item.runId === runId ? item.tools : []));
}

function runningLine(design: DesignData, assistant: AssistantData, request: DesignRequest, now: number, placement: ResultPlacement | undefined): DesignStatusLine {
  // A replace or a deletion waits on the card under the line, not on Claude.
  if (assistant.items.some((i) => i.kind === "confirm" && i.status === "pending" && i.runId === request.runId)) return { text: DESIGN_COPY.waiting, tone: "info" };
  const drafts = request.runId === null ? [] : design.drafts.filter((d) => d.runId === request.runId);
  const draft = activeDraft({ ...design, drafts }, now) ?? drafts.at(-1) ?? null;
  if (draft?.status === "writing") return writingLine(draft, request);
  if (draft?.status === "adding") return { text: draft.progress ? `${DESIGN_COPY.adding} ${draft.progress}` : DESIGN_COPY.adding, tone: "busy" };
  // The running step, ignoring quiet ones and import_design's chip while its page is still being written.
  const tool = runTools(assistant, request.runId).findLast((t) => t.status === "running" && !t.draft && toolStatusText(t) !== "");
  if (tool) return { text: tool.name === "import_design" ? DESIGN_COPY.adding : toolStatusText(tool), tone: "busy" };
  if (draft?.status === "failed" && draft.error !== DRAFT_TOO_LONG) return failedLine(draft.error);
  if (request.imported && design.result) return doneLine(design.result, placement);
  return { text: DESIGN_COPY.thinking, tone: "busy" };
}

function finishedLine(design: DesignData, assistant: AssistantData, request: DesignRequest, placement: ResultPlacement | undefined): DesignStatusLine | null {
  const drafts = request.runId === null ? [] : design.drafts.filter((d) => d.runId === request.runId);
  const imported = (request.imported ?? 0) > 0;
  switch (request.outcome) {
    case "stopped": {
      const changed = imported || runTools(assistant, request.runId).some((t) => t.changedDocument);
      return { text: changed ? DESIGN_COPY.stopped : DESIGN_COPY.stoppedNothingAdded, tone: "info" };
    }
    case "max_tokens":
      return { text: drafts.some((d) => d.error === DRAFT_TOO_LONG) ? DESIGN_COPY.tooLong : DESIGN_COPY.cutOff, tone: "warn" };
    case "budget":
      return { text: DESIGN_COPY.budget, tone: "warn", action: "new_chat" };
    case "error":
      return errorLine(request.error);
    case "refusal":
      return { text: DESIGN_COPY.refusal, tone: "warn" };
    case "max_turns": {
      const steps = assistant.limits?.maxTurns;
      return { text: `The Assistant paused after ${steps ? `${steps} steps` : "its step limit"}. Send a message (like “keep going”) to continue.`, tone: "info" };
    }
  }
  if (request.readOnly) return { text: DESIGN_COPY.readOnly, tone: "warn", action: "settings" };
  const latest = drafts.at(-1);
  if (latest?.status === "failed" && latest.error !== DRAFT_TOO_LONG) return failedLine(latest.error);
  if (!drafts.length) {
    // An import from a URL or a capture streams no draft: its chip says how it went.
    const chip = runTools(assistant, request.runId).findLast((t) => t.name === "import_design");
    if (chip?.status === "error" && !imported) return failedLine(chip.detail);
  }
  if (imported && design.result) return doneLine(design.result, placement);
  const reply = runReply(assistant, request.runId);
  return reply ? { text: reply, tone: "info" } : null;
}

/** The line for the box's request. `placement`: where its result is now (resultPlacement); without it, the result counts as where Claude put it, covering nothing. */
export function designStatusLine(design: DesignData, assistant: AssistantData, now: number, placement?: ResultPlacement): DesignStatusLine | null {
  const state = designRunState(design, assistant);
  if (state === "busy") return { text: DESIGN_COPY.busy, tone: "info" };
  const { request } = design;
  if (!request) return null;
  // A finished run whose outcome hasn't reached this store yet still reads as running.
  if (state === "running" || request.outcome === undefined) return runningLine(design, assistant, request, now, placement);
  return finishedLine(design, assistant, request, placement);
}

export interface DesignResultChip {
  id: "undo" | "sendToBack" | DesignFollowUpKind;
  label: string;
  /** What a follow-up chip sends to Claude. */
  message?: string;
}

/**
 * The chips under the box's result, once its reply is done. After the import: Undo while it's still
 * the newest undo step (`newestTxnId`: historyEntries(1)[0]?.txnId), Send to Back while the new screen
 * is in front of other layers (`placement`), then the follow-ups. After a follow-up on the result that
 * didn't import (wiring, knobs), the other follow-ups. Empty once the result is undone or gone.
 */
export function designResultChips(design: Pick<DesignData, "request" | "result">, newestTxnId: string | null, placement?: ResultPlacement): DesignResultChip[] {
  const { request, result } = design;
  if (!result || !request || request.outcome === undefined || (placement && placement.state !== "here")) return [];
  const followUps: DesignResultChip[] = [
    { id: "interactive", label: "Make it interactive", message: designFollowUp("interactive", result.name) },
    { id: "knobs", label: "Add knobs", message: designFollowUp("knobs", result.name) },
    { id: "darker", label: "Try a darker version", message: designFollowUp("darker", result.name) },
  ];
  if (!request.imported) {
    const onResult = request.outcome === "completed" && request.context.component.id === result.component && request.context.target?.id === result.layerId;
    return onResult ? followUps.filter((chip) => chip.message !== request.text) : [];
  }
  const chips: DesignResultChip[] = [];
  if (result.txnId !== null && result.txnId === newestTxnId) chips.push({ id: "undo", label: "Undo" });
  if (result.kind === "added" && placement?.stack === "front") chips.push({ id: "sendToBack", label: "Send to Back" });
  return [...chips, ...followUps];
}
