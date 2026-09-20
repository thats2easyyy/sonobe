/**
 * The Design with Claude box's status line: what Claude is doing right now (thinking, a tool step,
 * writing the page, adding the layers), what it made, and what went wrong, with the action that helps.
 * Also the chips under a result (Undo, Send to Back and the follow-ups).
 */

import { draftKb, type AssistantData, type ToolChip } from "../assistant/assistantStore.ts";
import type { AssistantError } from "../assistant/types.ts";
import { activeDraft, DRAFT_TOO_LONG, runReply, type DesignData, type DesignDraft, type DesignRequest, type DesignResult } from "./designStore.ts";
import { designFollowUp, type DesignFollowUpKind } from "./prompt.ts";

export interface DesignStatusLine { text: string; tone: "busy" | "done" | "info" | "warn" | "error"; action?: "api_key" | "new_chat" | "settings" }

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

/** "Added “Checkout”." and its variants, for the screen Claude just made. */
function doneLine(result: DesignResult): DesignStatusLine {
  if (result.kind === "added") {
    return { text: result.coveredScreen ? `Added “${result.name}”. It's in front of “${result.coveredScreen}”, so it covers it in the viewer too.` : `Added “${result.name}”.`, tone: "done" };
  }
  const n = result.droppedCount;
  if (n <= 0) return { text: `Updated “${result.name}”.`, tone: "done" };
  return { text: `Updated “${result.name}”. ${n} ${plural(n, "layer wasn't", "layers weren't")} in the new design: ${nameList(result.dropped, n)}.`, tone: "done" };
}

/** "Writing “Checkout”… 14 KB": the page's name once Claude has written it, else the layer the box picked. */
function writingLine(draft: DesignDraft, request: DesignRequest): DesignStatusLine {
  const target = request.context.target;
  const name = draft.fields.name ?? (target && (draft.fields.replace === undefined || draft.fields.replace === target.id) ? target.name : undefined);
  const kb = draftKb(draft.html.length);
  return { text: `Writing ${name ? `“${name}”` : "the screen"}…${kb > 0 ? ` ${kb} KB` : ""}`, tone: "busy" };
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

function runningLine(design: DesignData, assistant: AssistantData, request: DesignRequest, now: number): DesignStatusLine {
  const drafts = request.runId === null ? [] : design.drafts.filter((d) => d.runId === request.runId);
  const draft = activeDraft({ ...design, drafts }, now) ?? drafts.at(-1) ?? null;
  if (draft?.status === "writing") return writingLine(draft, request);
  if (draft?.status === "adding") return { text: draft.progress ? `${DESIGN_COPY.adding} ${draft.progress}` : DESIGN_COPY.adding, tone: "busy" };
  // The running step, ignoring quiet ones and import_design's chip while its page is still being written.
  const tool = runTools(assistant, request.runId).findLast((t) => t.status === "running" && !t.draft && toolStatusText(t) !== "");
  if (tool) return { text: tool.name === "import_design" ? DESIGN_COPY.adding : toolStatusText(tool), tone: "busy" };
  if (draft?.status === "failed" && draft.error !== DRAFT_TOO_LONG) return failedLine(draft.error);
  if (request.imported && design.result) return doneLine(design.result);
  return { text: DESIGN_COPY.thinking, tone: "busy" };
}

function finishedLine(design: DesignData, assistant: AssistantData, request: DesignRequest): DesignStatusLine | null {
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
  if (imported && design.result) return doneLine(design.result);
  const reply = runReply(assistant, request.runId);
  return reply ? { text: reply, tone: "info" } : null;
}

export function designStatusLine(design: DesignData, assistant: AssistantData, now: number): DesignStatusLine | null {
  const state = designRunState(design, assistant);
  if (state === "busy") return { text: DESIGN_COPY.busy, tone: "info" };
  const { request } = design;
  if (!request) return null;
  // A finished run whose outcome hasn't reached this store yet still reads as running.
  if (state === "running" || request.outcome === undefined) return runningLine(design, assistant, request, now);
  return finishedLine(design, assistant, request);
}

export interface DesignResultChip {
  id: "undo" | "sendToBack" | DesignFollowUpKind;
  label: string;
  /** What a follow-up chip sends to Claude. */
  message?: string;
}

/**
 * The chips under the box's result, once its reply is done: Undo while the import is still the newest
 * undo step (`newestTxnId`: historyEntries(1)[0]?.txnId), Send to Back when the new screen covers
 * another one, then the follow-ups. Empty unless the box's last request imported the result.
 */
export function designResultChips(design: Pick<DesignData, "request" | "result">, newestTxnId: string | null): DesignResultChip[] {
  const { request, result } = design;
  if (!result || !request?.imported || request.outcome === undefined) return [];
  const chips: DesignResultChip[] = [];
  if (result.txnId !== null && result.txnId === newestTxnId) chips.push({ id: "undo", label: "Undo" });
  if (result.kind === "added" && result.coveredScreen) chips.push({ id: "sendToBack", label: "Send to Back" });
  chips.push(
    { id: "interactive", label: "Make it interactive", message: designFollowUp("interactive", result.name) },
    { id: "knobs", label: "Add knobs", message: designFollowUp("knobs", result.name) },
    { id: "darker", label: "Try a darker version", message: designFollowUp("darker", result.name) },
  );
  return chips;
}
