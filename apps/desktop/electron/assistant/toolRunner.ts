/**
 * The Assistant's tool runner, shared by both engines: the API-key agent loop (agent.ts) and the
 * subscription engine's MCP endpoint (acp/). One call at a time, it pins document tools to the
 * window's document (and refuses a write that names another window's), asks before a replace the
 * person may not want and before big deletions, keeps the replace guard's records, and reports the
 * call as activity chips. It returns what goes back to Claude as a neutral ToolCallResult; each engine
 * turns that into its own wire shape.
 */

import type { SonobeDocument } from "@sonobe/core";
import { IMPORT_META_KEY, type ImportResultMeta, type RemovalSummary } from "@sonobe/mcp";
import { createReplaceGuard, replaceDeclinedDetail, replaceDeclinedMessage, replacePrompt, type ReplaceCheck, type ReplaceGuard, type ReplaceImpact } from "./designGuard.ts";
import { deleteConfirmation, deletionPrompt, estimateRemovals, isDestructiveApplyOps, isReadOnlyRefusal, removalsFromResult, type ConfirmPrompt } from "./guardrails.ts";
import type { AssistantEvent, AssistantImported, AssistantLimits, AssistantSendRequest } from "./protocol.ts";
import { describeToolInput, describeToolResult, type AssistantToolInfo, type LocalTools, type ToolBridge, type ToolCallResult } from "./toolBridge.ts";

/** The replace guard and the copy around it (designGuard.ts). */
export interface ReplaceGuardKit {
  create(): ReplaceGuard;
  prompt(check: ReplaceCheck, impact: ReplaceImpact | null): ConfirmPrompt;
  /** `preview`: the declined call was import_design { preview: true }. */
  declinedMessage(check: ReplaceCheck, options?: { preview?: boolean }): string;
  declinedDetail(check: ReplaceCheck): string;
}

export const REPLACE_GUARD: ReplaceGuardKit = { create: createReplaceGuard, prompt: replacePrompt, declinedMessage: replaceDeclinedMessage, declinedDetail: replaceDeclinedDetail };

/** The document a window shows. */
export interface WindowDocument {
  docId: string;
  projectPath: string | null;
}

/**
 * What a document's preview_design draft holds for the replace guard, as the server's last answer to
 * this chat said (preview_design's result names the draft's merged fields): import_design
 * { preview: true } imports it.
 */
export interface PreviewDraft {
  component: string | null;
  replace: string | null;
}

/** Per reply: what the Assistant removed without asking, and the confirmations still open (Stop settles them). */
export interface RunGuards {
  removedWithoutAsking: number;
  /** `optionId`: the choice on a permission card (the subscription engine's); Sonobe's own confirmations ignore it. */
  confirmations: Map<string, (approved: boolean, optionId?: string) => void>;
}

export interface ToolRunScope {
  conversationId: string;
  runId: string;
  request: AssistantSendRequest;
  emit(event: AssistantEvent): void;
  signal: AbortSignal;
  bridge: ToolBridge;
  localTools?: LocalTools;
  /** Every tool Claude has in this reply, by name. */
  tools: ReadonlyMap<string, AssistantToolInfo>;
  limits: AssistantLimits;
  log(level: "info" | "warn" | "error", message: string): void;
  newId(): string;
  /** The document this conversation's window shows, looked up before each document call. */
  documentFor?(conversationId: string): Promise<WindowDocument | null>;
  readDocument?(docId: string): Promise<SonobeDocument>;
  /** This chat's replace guard, made on first use. */
  guard(): ReplaceGuard;
  guardIfAny(): ReplaceGuard | null;
  replaceGuard: ReplaceGuardKit;
  active: RunGuards;
  /** This chat's preview_design drafts, by document. */
  previews: Map<string, PreviewDraft>;
  /** Send tool_started for each call (false: the engine announces its calls itself). */
  announce: boolean;
  readOnlyNoticeSent: { value: boolean };
}

export interface ToolRunOptions {
  /** Overrides scope.announce for this call (the subscription engine announces a call only once). */
  announce?: boolean;
  /** The call's progress for the caller too; while it waits on the person, a heartbeat every heartbeatMs. */
  onProgress?(message: string): void;
  /** Default 10 s. */
  heartbeatMs?: number;
}

/** What goes back to Claude. `plainText`: Sonobe answered itself (nothing ran, or the person declined), in this one text. */
export interface ToolRunResult extends ToolCallResult {
  plainText?: string;
}

export interface ToolRunner {
  run(call: { id: string; name: string; input: unknown }, options?: ToolRunOptions): Promise<ToolRunResult>;
}

const DESIGN_TOOL = "import_design";
const PREVIEW_TOOL = "preview_design";
const HEARTBEAT_MS = 10_000;
const WAITING = "Waiting for your answer in Sonobe";

/** Nothing runs when the window's document can't be told: it could land in another window's document. */
const NO_WINDOW_DOCUMENT = "Sonobe couldn't tell which prototype this window has open, so nothing ran. Try again in a moment.";
const NO_REPLACE_CHECK = "Sonobe couldn't read the prototype to check what this replace would change, so nothing ran. Try again in a moment.";
/** A write that names another window's document: a chat's edits stay in its own window's prototype. */
const otherWindow = (tool: string, docId: string) =>
  `This chat edits the prototype in its own window, so ${tool} didn't run on “${docId}”. Leave out docId to change this window's prototype, or ask the person to open the chat in the other window.`;

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Results Sonobe made up for a call Stop cut off: the bridge gave up on it, but the server may have
 * run it anyway (a handler past its last look at the signal finishes), so what the call changed is unknown.
 */
const cutOff = new WeakSet<ToolCallResult>();

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** A teaching error's code (results.ts `failure` in @sonobe/mcp), or null. */
const errorCode = (result: ToolCallResult): string | null => {
  const error = result.structuredContent?.error;
  return isRecord(error) && typeof error.code === "string" ? error.code : null;
};

/** The tool's input schema has a `key` property. */
function declares(info: AssistantToolInfo, key: string): boolean {
  const properties = info.inputSchema.properties;
  return !!properties && typeof properties === "object" && Object.hasOwn(properties, key);
}

/** import_design's result summary (its `_meta`), which survives a screenshot dropping structuredContent. */
export function importMeta(result: ToolCallResult): ImportResultMeta | null {
  const raw = result.meta?.[IMPORT_META_KEY];
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const str = (value: unknown) => (typeof value === "string" ? value : null);
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const docId = str(m.docId);
  const component = str(m.component);
  if (docId === null || component === null) return null;
  const dropped = (Array.isArray(m.dropped) ? m.dropped : []).flatMap((d: unknown) => {
    const { id, name } = (d ?? {}) as { id?: unknown; name?: unknown };
    return typeof id === "string" && typeof name === "string" ? [{ id, name }] : [];
  });
  return {
    docId,
    component,
    dryRun: m.dryRun === true,
    screenId: str(m.screenId),
    screenName: str(m.screenName) ?? "",
    txnId: str(m.txnId),
    replaced: str(m.replaced),
    dropped,
    droppedCount: count(m.droppedCount),
    lostConnections: count(m.lostConnections),
    kept: typeof m.kept === "number" ? m.kept : null,
  };
}

const plain = (text: string, isError = false): ToolRunResult => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}), plainText: text });

export function createToolRunner(scope: ToolRunScope): ToolRunner {
  const { conversationId, runId, request, emit, signal, bridge, localTools, tools, log, active, replaceGuard } = scope;
  const localNames = new Set(localTools?.infos.map((t) => t.name) ?? []);

  /** Ask the person; Stop declines. While it waits, the caller's onProgress gets a heartbeat, so its client doesn't time the call out. */
  const confirm = (toolUseId: string, prompt: ConfirmPrompt, hooks: ToolRunOptions): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      if (signal.aborted) {
        resolve(false);
        return;
      }
      const confirmationId = scope.newId();
      const beat = hooks.onProgress;
      const heartbeat = beat ? setInterval(() => beat(WAITING), hooks.heartbeatMs ?? HEARTBEAT_MS) : null;
      const settle = (approved: boolean) => {
        if (!active.confirmations.delete(confirmationId)) return;
        if (heartbeat) clearInterval(heartbeat);
        signal.removeEventListener("abort", onAbort);
        emit({ type: "confirm_resolved", runId, confirmationId, approved });
        resolve(approved);
      };
      const onAbort = () => settle(false);
      active.confirmations.set(confirmationId, settle);
      signal.addEventListener("abort", onAbort, { once: true });
      emit({
        type: "confirm_required",
        runId,
        confirmationId,
        toolUseId,
        title: prompt.title,
        message: prompt.message,
        count: prompt.count,
        ...(prompt.kind ? { kind: prompt.kind } : {}),
        ...(prompt.approveLabel ? { approveLabel: prompt.approveLabel } : {}),
        ...(prompt.declineLabel ? { declineLabel: prompt.declineLabel } : {}),
      });
      beat?.(WAITING);
    });

  /** Run a tool. Stop cancels it (a cancelled call changes nothing unless its edit had already started); the chip follows its progress. */
  const callTool = async (name: string, input: Record<string, unknown>, progress?: { toolUseId: string; hooks: ToolRunOptions }): Promise<ToolCallResult> => {
    try {
      return await bridge.call(name, input, {
        signal,
        ...(progress
          ? {
              onProgress: (detail: string) => {
                emit({ type: "tool_progress", runId, toolUseId: progress.toolUseId, detail });
                progress.hooks.onProgress?.(detail);
              },
            }
          : {}),
      });
    } catch (err) {
      if (signal.aborted) {
        const cancelled: ToolCallResult = { content: [{ type: "text", text: `The person pressed Stop while ${name} was running, so it was cancelled. Anything it had already applied stays; check list_history before trying again.` }], isError: true };
        cutOff.add(cancelled);
        return cancelled;
      }
      log("warn", `Assistant tool ${name} failed: ${errorMessage(err)}`);
      return { content: [{ type: "text", text: `The ${name} tool failed: ${errorMessage(err)}` }], isError: true };
    }
  };

  /** One of the Assistant's own tools (the code folder's), scoped to this chat and reply. */
  const callLocal = async (own: LocalTools, name: string, input: Record<string, unknown>, projectPath: string | null): Promise<ToolCallResult> => {
    try {
      return await own.call(name, input, { conversationId, runId, projectPath, signal });
    } catch (err) {
      if (signal.aborted) return { content: [{ type: "text", text: `The person pressed Stop while ${name} was running, so it was cancelled.` }], isError: true };
      log("warn", `Assistant tool ${name} failed: ${errorMessage(err)}`);
      return { content: [{ type: "text", text: `The ${name} tool failed: ${errorMessage(err)}` }], isError: true };
    }
  };

  /** The document this window shows, looked up per call (the person may switch windows mid-reply); null when it can't be told. */
  const windowDocument = async (documentFor: NonNullable<ToolRunScope["documentFor"]>): Promise<WindowDocument | null> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return (await documentFor(conversationId)) ?? null;
      } catch (err) {
        if (attempt >= 2) {
          log("warn", `Assistant couldn't tell which document its window shows: ${errorMessage(err)}`);
          return null;
        }
      }
    }
  };

  /**
   * Keep the replace guard's records current: a screen the Assistant imported is its own, and its
   * later edits inside one aren't the person's. Only a write whose result says what it changed is
   * taken in: a dry run's layers may hold the person's edits, and a call that names no layers
   * (begin_work, undo, save_document) mustn't pass the person's edits off as the Assistant's. A
   * record that goes stale that way just asks before the next replace. `before`: the document a
   * replace was checked against, so the guard keeps the person's own screen it replaced.
   */
  const track = async (info: AssistantToolInfo, input: Record<string, unknown>, component: string | undefined, result: ToolCallResult, imported: AssistantImported | undefined, before: SonobeDocument | undefined): Promise<void> => {
    if (!scope.readDocument) return;
    try {
      if (imported) {
        const doc = await scope.readDocument(imported.docId);
        scope.guard().remember(imported.docId, component ?? doc.project.root, imported.screenId, doc, imported.replaced !== null ? before : undefined);
        return;
      }
      const data = result.structuredContent;
      const changed = data?.changed;
      if (info.readOnly || info.name === DESIGN_TOOL || input.dryRun === true || data?.dryRun === true || !(changed === "all" || changed === "partial") || (result.isError && changed !== "partial")) return;
      const docId = typeof data?.docId === "string" ? data.docId : typeof input.docId === "string" ? input.docId : null;
      const guard = scope.guardIfAny();
      if (docId === null || !guard?.tracks(docId)) return;
      const affected = data?.affected as { components?: unknown; layers?: unknown } | undefined;
      const ids = (list: unknown) => (Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : []);
      const components = ids(affected?.components);
      const layers = ids(affected?.layers);
      if (!components.length || !layers.length) return;
      guard.refresh(docId, await scope.readDocument(docId), { components, layers });
    } catch (err) {
      log("warn", `Assistant couldn't update what it knows about its screens: ${errorMessage(err)}`);
    }
  };

  /**
   * Keep this chat's view of the server's preview_design draft: preview_design's result names the
   * draft's fields as the server merged them (a draft an earlier chat left keeps its replace), a draft
   * the server doesn't have is forgotten, and a preview import drops it once it's layers. A failed call
   * leaves the draft as it was. A result without the fields leaves the draft unknown, and the next
   * preview import asks the server with a dry run, as it does after a call Stop cut off (the server
   * may have taken that one, a new replace included).
   */
  const trackDraft = (name: string, input: Record<string, unknown>, result: ToolCallResult): void => {
    if (name !== PREVIEW_TOOL && !(name === DESIGN_TOOL && input.preview === true)) return;
    const data = result.structuredContent;
    const docId = typeof data?.docId === "string" ? data.docId : typeof input.docId === "string" ? input.docId : null;
    if (docId === null) return;
    if (result.isError) {
      if (errorCode(result) === "no_draft" || cutOff.has(result)) scope.previews.delete(docId);
      return;
    }
    if (name === DESIGN_TOOL) {
      const meta = importMeta(result);
      if (meta && !meta.dryRun && meta.screenId) scope.previews.delete(meta.docId);
      return;
    }
    const field = (value: unknown) => (typeof value === "string" ? value : null);
    if (input.clear !== true && data && Object.hasOwn(data, "replace")) scope.previews.set(docId, { component: field(data.component), replace: field(data.replace) });
    else scope.previews.delete(docId);
  };

  const declined = (id: string, name: string): ToolRunResult => {
    emit({ type: "tool_finished", runId, toolUseId: id, name, status: "declined", detail: "You declined the deletion", changedDocument: false });
    return plain("The person chose not to delete these items, so nothing changed. Ask what they'd like to do instead.");
  };

  const stopped = (id: string, name: string, result: ToolCallResult): ToolRunResult => {
    emit({ type: "tool_finished", runId, toolUseId: id, name, status: "error", detail: "Stopped", changedDocument: false });
    return { ...result, isError: true };
  };

  const finished = (id: string, info: AssistantToolInfo, result: ToolCallResult, imported?: AssistantImported): ToolRunResult => {
    if (!scope.readOnlyNoticeSent.value && isReadOnlyRefusal(result)) {
      scope.readOnlyNoticeSent.value = true;
      emit({ type: "notice", runId, tone: "warn", message: "Claude is set to Read only in Settings, so the Assistant can look but not edit. Change it in Settings → Claude." });
    }
    const status = result.isError ? "error" : "done";
    // A preview draws on the canvas and changes nothing in the document.
    const changedDocument = !info.readOnly && !result.isError && info.name !== PREVIEW_TOOL;
    emit({ type: "tool_finished", runId, toolUseId: id, name: info.name, status, detail: describeToolResult(result), changedDocument, ...(imported ? { imported } : {}) });
    return result;
  };

  return {
    async run(call, options = {}) {
      const { id, name } = call;
      const info = tools.get(name);
      const title = info?.title ?? name;
      const input = isRecord(call.input) ? call.input : null;
      if (options.announce ?? scope.announce) emit({ type: "tool_started", runId, toolUseId: id, name, title, detail: describeToolInput(input) });
      const failed = (message: string): ToolRunResult => {
        emit({ type: "tool_finished", runId, toolUseId: id, name, status: "error", detail: message, changedDocument: false });
        return plain(message, true);
      };
      if (!info) return failed(`There's no tool named ${name}.`);
      if (!input) return failed("The tool input wasn't a JSON object, so nothing ran.");

      const own = localTools && localNames.has(name) ? localTools : null;
      const documentTool = !own && declares(info, "docId");
      const pinDocId = documentTool && input.docId === undefined;
      // Claude may read another window's prototype (to copy from it), but not change it.
      const namesOther = documentTool && input.docId !== undefined && !info.readOnly;
      const documentFor = pinDocId || namesOther || own ? scope.documentFor : undefined;
      const shown = documentFor ? await windowDocument(documentFor) : null;
      if (documentFor && !shown) return failed(NO_WINDOW_DOCUMENT);
      if (namesOther && shown && input.docId !== shown.docId) return failed(otherWindow(name, String(input.docId)));
      if (own) {
        const result = await callLocal(own, name, input, shown?.projectPath ?? null);
        return signal.aborted ? stopped(id, name, result) : finished(id, info, result);
      }

      // The input as it runs, never written back to history: pinned to this window's document, and a
      // design the canvas box starts goes into the component the box was showing. An append, or an
      // import of the preview draft, keeps the draft's own component, wherever Claude started it.
      const callInput: Record<string, unknown> = { ...input };
      if (pinDocId && shown) callInput.docId = shown.docId;
      const previewImport = name === DESIGN_TOOL && callInput.preview === true;
      const startsDesign = (name === PREVIEW_TOOL && callInput.html !== undefined) || (name === DESIGN_TOOL && !previewImport);
      if (startsDesign && request.context && callInput.component === undefined) callInput.component = request.context.component.id;
      const progress = { toolUseId: id, hooks: options };

      // An import of the preview draft takes the draft's replace and component unless it names its own.
      // A draft this chat has no word of (one an earlier chat left, which the server keeps for the
      // Assistant) is asked about with a dry run, whose summary names its replace.
      const docId = typeof callInput.docId === "string" ? callInput.docId : null;
      let draft = previewImport && docId !== null ? scope.previews.get(docId) : undefined;
      let dryRun: ToolCallResult | undefined;
      if (previewImport && !draft && callInput.replace === undefined && callInput.dryRun !== true && scope.readDocument && docId !== null) {
        dryRun = await callTool(DESIGN_TOOL, { ...callInput, dryRun: true, screenshot: false }, progress);
        trackDraft(name, callInput, dryRun);
        if (signal.aborted) return stopped(id, name, dryRun);
        if (dryRun.isError) return finished(id, info, dryRun);
        const meta = importMeta(dryRun);
        if (meta) draft = { component: meta.component, replace: meta.replaced };
      }
      const component = typeof callInput.component === "string" ? callInput.component : (draft?.component ?? undefined);
      const replace = typeof callInput.replace === "string" ? callInput.replace : callInput.replace === undefined ? (draft?.replace ?? undefined) : undefined;

      // Replacing a layer the person didn't pick, or a screen they changed since the Assistant made it,
      // asks first, naming what would go (from a dry run). The guard needs to know the document.
      let before: SonobeDocument | undefined;
      if (name === DESIGN_TOOL && replace !== undefined && callInput.dryRun !== true && scope.readDocument && docId !== null) {
        let check: ReplaceCheck | null;
        try {
          const doc = await scope.readDocument(docId);
          before = doc;
          check = scope.guard().check({ docId, component: component ?? doc.project.root, replace, picked: request.context?.target?.id ?? null }, doc);
        } catch (err) {
          log("warn", `Assistant couldn't check a replace: ${errorMessage(err)}`);
          return failed(NO_REPLACE_CHECK);
        }
        if (check) {
          const preview = dryRun ?? (await callTool(DESIGN_TOOL, { ...callInput, dryRun: true, screenshot: false }, progress));
          trackDraft(name, callInput, preview);
          if (signal.aborted) return stopped(id, name, preview);
          if (preview.isError) return finished(id, info, preview);
          const meta = importMeta(preview);
          const impact: ReplaceImpact | null = meta ? { dropped: meta.dropped.map((d) => d.name), droppedCount: meta.droppedCount, lostConnections: meta.lostConnections } : null;
          if (!(await confirm(id, replaceGuard.prompt(check, impact), options))) {
            emit({ type: "tool_finished", runId, toolUseId: id, name, status: "declined", detail: replaceGuard.declinedDetail(check), changedDocument: false });
            return plain(replaceGuard.declinedMessage(check, { preview: previewImport }));
          }
        }
      }

      // Count what a destructive call removes before it runs (a dry run counts cascades), and ask when
      // it, plus what this reply already removed without asking, goes over the threshold.
      let removal: RemovalSummary | null = null;
      if (name === "apply_ops" && isDestructiveApplyOps(callInput)) {
        const preview = await callTool("apply_ops", { ...callInput, dryRun: true });
        removal = (!preview.isError ? removalsFromResult(preview) : null) ?? estimateRemovals(callInput);
      } else if (name === "delete_items" && callInput.dryRun !== true && active.removedWithoutAsking > 0) {
        const preview = await callTool("delete_items", { ...callInput, dryRun: true });
        removal = preview.isError ? null : removalsFromResult(preview);
      }
      let approved = false;
      const prompt = deletionPrompt(removal, active.removedWithoutAsking, scope.limits.deleteConfirmThreshold);
      if (prompt) {
        if (!(await confirm(id, prompt, options))) return declined(id, name);
        approved = true;
      }
      let result = await callTool(name, callInput, progress);
      // The server's draft moved on even when Stop came after it answered.
      trackDraft(name, callInput, result);
      if (signal.aborted) return stopped(id, name, result);
      if (name === "delete_items") {
        const pending = deleteConfirmation(result);
        if (pending) {
          if (!approved) {
            const count = pending.count || (Array.isArray(callInput.ids) ? callInput.ids.length : 0);
            approved = await confirm(id, { count, title: count ? `Delete ${count} items?` : "Delete these items?", message: `${pending.summary} You can undo it afterwards.` }, options);
            if (!approved) return declined(id, name);
          }
          result = await callTool(name, { ...callInput, confirmToken: pending.token }, progress);
        }
      }
      if (approved) active.removedWithoutAsking = 0;
      else if (!result.isError || result.structuredContent?.changed === "partial") {
        const done = removalsFromResult(result) ?? (name === "apply_ops" ? removal : null);
        if (done) active.removedWithoutAsking += done.total;
      }

      const meta = name === DESIGN_TOOL && !result.isError ? importMeta(result) : null;
      const imported: AssistantImported | undefined =
        meta && !meta.dryRun && meta.screenId
          ? { docId: meta.docId, screenId: meta.screenId, txnId: meta.txnId, name: meta.screenName, replaced: meta.replaced, dropped: meta.dropped.slice(0, 20).map((d) => d.name), droppedCount: meta.droppedCount, lostConnections: meta.lostConnections }
          : undefined;
      await track(info, callInput, component, result, imported, before);
      return finished(id, info, result, imported);
    },
  };
}
