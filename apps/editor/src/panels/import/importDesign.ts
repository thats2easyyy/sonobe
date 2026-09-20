/**
 * Import a design into the open prototype: capture a page (the desktop app renders URLs and HTML in a
 * hidden window; the browser editor renders HTML in a sandboxed iframe), download its images, plan the
 * layers with @sonobe/import, store new image files, and apply everything as one undo step. Pasting a
 * design capture (from a browser extension or a plugin) goes through the same path.
 */

import { deviceScreenSize, type Id } from "@sonobe/core";
import { globalFetcher, ImportPlanError, looksLikeCapture, parseCapture, planImport, resolveCaptureFiles, type DesignCapture, type ImportPlan, type ImportSummary, type ResolvedImage } from "@sonobe/import";
import { getDesktopHostApi } from "../../host/detect.ts";
import type { DesktopHostApi } from "../../host/types.ts";
import type { EditorSession } from "../../state/session.ts";
import { hologramStore } from "./hologram.ts";
import { captureHtmlInIframe } from "./iframeCapture.ts";

export interface ImportDesignRequest {
  url?: string;
  html?: string;
  name?: string;
  width?: number;
  height?: number;
  selector?: string;
  waitFor?: string;
  waitMs?: number;
  fullPage?: boolean;
  colorScheme?: "light" | "dark";
  /** Add Scroll patches for long pages and scroll containers. Default true. */
  scrolling?: boolean;
  /** An earlier screen to replace, keeping the ids and wiring of layers found again. */
  replace?: Id;
}

export type CaptureOutcome = { ok: true; capture: DesignCapture; images: ReadonlyMap<string, ResolvedImage | null>; notes?: string[] } | { ok: false; message: string; hint?: string; cancelled?: boolean };

export interface ImportOutcome {
  ok: boolean;
  /** The import was cancelled before it changed anything. */
  cancelled?: boolean;
  screenId?: Id;
  screenName?: string;
  summary?: ImportSummary;
  notes?: string[];
  message?: string;
  hint?: string;
}

export interface ImportDeps {
  desktop?: Pick<DesktopHostApi, "captureDesign" | "fetchCaptureFile" | "cancelCaptureDesign" | "onCaptureDesignProgress"> | null;
  captureHtml?: typeof captureHtmlInIframe;
}

/** How the dialog follows and stops an import. */
export interface ImportControl {
  /** Cancels the import: the capture stops, nothing is applied, and the outcome says cancelled. */
  signal?: AbortSignal;
  /** What the import is doing now ("Downloading images: 7 of 28"). */
  onProgress?(message: string): void;
}

const CANCELLED = { ok: false as const, cancelled: true, message: "The import was cancelled." };

/** Settle with `promise`, or with null as soon as `signal` aborts. */
function unlessAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T | null> {
  if (!signal) return promise;
  promise.catch(() => undefined);
  if (signal.aborted) return Promise.resolve(null);
  return new Promise<T | null>((resolve, reject) => {
    const onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** The screen size imports use: the current component's size, else the device's. */
export function importViewport(session: EditorSession): [number, number] {
  const doc = session.document.getState().doc;
  const component = doc.components[session.currentComponentId()];
  const size = component?.size ?? deviceScreenSize(doc.project.device);
  return [Math.round(size[0]), Math.round(size[1])];
}

/** Whether this editor can import from a URL (the desktop app can; a browser tab can't read other sites). */
export function canImportUrl(deps: ImportDeps = {}): boolean {
  const desktop = deps.desktop === undefined ? getDesktopHostApi() : deps.desktop;
  return typeof desktop?.captureDesign === "function";
}

export async function captureDesign(session: EditorSession, request: ImportDesignRequest, deps: ImportDeps = {}, control: ImportControl = {}): Promise<CaptureOutcome> {
  const { signal } = control;
  if (signal?.aborted) return CANCELLED;
  const [deviceWidth, deviceHeight] = importViewport(session);
  const width = request.width ?? deviceWidth;
  const height = request.height ?? deviceHeight;
  const desktop = deps.desktop === undefined ? getDesktopHostApi() : deps.desktop;
  if (typeof desktop?.captureDesign === "function") {
    // The main process follows and stops the capture by this id (an AbortSignal can't cross the bridge).
    const captureId = `capture-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const unsubscribe = desktop.onCaptureDesignProgress?.((progress) => {
      if (progress.captureId === captureId) control.onProgress?.(progress.message);
    });
    const cancel = () => desktop.cancelCaptureDesign?.(captureId);
    signal?.addEventListener("abort", cancel, { once: true });
    let reply;
    try {
      reply = await unlessAborted(
        desktop.captureDesign({
          ...(request.url !== undefined ? { url: request.url } : { html: request.html ?? "" }),
          width,
          height,
          ...(request.selector ? { selector: request.selector } : {}),
          ...(request.waitFor ? { waitFor: request.waitFor } : {}),
          ...(request.waitMs ? { waitMs: request.waitMs } : {}),
          ...(request.fullPage === false ? { fullPage: false } : {}),
          ...(request.colorScheme ? { colorScheme: request.colorScheme } : {}),
          captureId,
        }),
        signal,
      );
    } finally {
      unsubscribe?.();
      signal?.removeEventListener("abort", cancel);
    }
    if (!reply || signal?.aborted || (!reply.ok && reply.code === "cancelled")) return CANCELLED;
    if (!reply.ok) return { ok: false, message: reply.message, ...(reply.hint ? { hint: reply.hint } : {}) };
    try {
      return { ok: true, capture: parseCapture(reply.capture), images: new Map(reply.images.map(([key, image]) => [key, image ? { ...image, bytes: new Uint8Array(image.bytes) } : null])), ...(reply.notes?.length ? { notes: reply.notes } : {}) };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
  if (request.url !== undefined) {
    return { ok: false, message: "Importing from a URL needs the Sonobe desktop app.", hint: "A browser tab can't read another site's layout. Open Sonobe's desktop app, or paste the page's HTML instead." };
  }
  try {
    control.onProgress?.("Rendering the HTML");
    const capture = await (deps.captureHtml ?? captureHtmlInIframe)({
      html: request.html ?? "",
      width,
      height,
      ...(request.selector ? { selector: request.selector } : {}),
      ...(request.waitFor ? { waitFor: request.waitFor } : {}),
      ...(request.waitMs ? { waitMs: request.waitMs } : {}),
      ...(request.fullPage === false ? { fullPage: false } : {}),
      ...(signal ? { signal } : {}),
    });
    const images = await resolveCaptureFiles(capture, {
      fetch: globalFetcher({ mode: "cors" }),
      ...(signal ? { signal } : {}),
      onFile: (_key, _status, done, total) => control.onProgress?.(`Downloading images: ${done} of ${total}`),
    });
    return { ok: true, capture, images };
  } catch (err) {
    if (signal?.aborted) return CANCELLED;
    return { ok: false, message: err instanceof Error ? err.message : String(err), hint: request.selector ? `Check that "${request.selector}" matches an element in the HTML.` : undefined };
  }
}

/** Add a captured design to the current component as one undo step, and select the new screen. */
export async function importCapture(session: EditorSession, capture: DesignCapture, images: ReadonlyMap<string, ResolvedImage | null>, options: { name?: string; scrolling?: boolean; position?: [number, number]; replace?: Id; signal?: AbortSignal } = {}): Promise<ImportOutcome> {
  const state = session.document.getState();
  const componentId = session.currentComponentId();
  const component = state.doc.components[componentId];
  if (!component) return { ok: false, message: "There's no component to import into." };
  if (component.kind === "patchComponent") return { ok: false, message: `“${component.name}” is a patch component, which holds only patches.`, hint: "Exit the component, then import into the prototype." };
  let plan: ImportPlan;
  try {
    plan = await planImport(capture, state.doc, images, {
      component: componentId,
      isRetired: (id) => state.isRetiredId(componentId, id),
      ...(options.name?.trim() ? { name: options.name.trim() } : {}),
      ...(options.scrolling !== undefined ? { scrolling: options.scrolling } : {}),
      ...(options.position ? { position: options.position } : {}),
      ...(options.replace ? { replace: options.replace } : {}),
    });
  } catch (err) {
    if (err instanceof ImportPlanError) return { ok: false, message: err.message, ...(err.hint ? { hint: err.hint } : {}) };
    throw err;
  }
  // The last point where a cancel stops the import: from here on it lands as one undo step.
  if (options.signal?.aborted) return CANCELLED;
  for (const file of plan.files) session.assets.storeBytes(file.file, file.bytes);
  const result = session.document.getState().apply(plan.ops, { label: `${options.replace ? "Re-import" : "Import"} “${plan.screenName}”` });
  if (!result.ok) {
    const error = result.errors[0];
    return { ok: false, message: error?.message ?? "The design couldn't be added.", ...(error?.hint ? { hint: error.hint } : {}) };
  }
  const screenId = result.idMap[plan.screenRef] ?? result.idMap[`$${plan.screenRef}`];
  if (screenId) {
    session.selection.getState().select({ layers: [screenId] });
    // The canvas builds the new screen as a hologram (the dialog, pasted captures).
    hologramStore(session).getState().build({ componentId, screenId });
  }
  return { ok: true, ...(screenId ? { screenId } : {}), screenName: plan.screenName, summary: plan.summary, notes: plan.notes };
}

/** Capture and import in one go. A cancel (control.signal) never applies anything. */
export async function importDesign(session: EditorSession, request: ImportDesignRequest, deps: ImportDeps = {}, control: ImportControl = {}): Promise<ImportOutcome> {
  const captured = await captureDesign(session, request, deps, control);
  if (!captured.ok) return { ok: false, message: captured.message, ...(captured.hint ? { hint: captured.hint } : {}), ...(captured.cancelled ? { cancelled: true } : {}) };
  control.onProgress?.("Adding the layers");
  const outcome = await importCapture(session, captured.capture, captured.images, { ...(request.name ? { name: request.name } : {}), ...(request.scrolling !== undefined ? { scrolling: request.scrolling } : {}), ...(request.replace ? { replace: request.replace } : {}), ...(control.signal ? { signal: control.signal } : {}) });
  return outcome.ok && captured.notes?.length ? { ...outcome, notes: [...(outcome.notes ?? []), ...captured.notes] } : outcome;
}

/** A design capture in pasted text, or null when the text isn't one. Throws CaptureFormatError for a broken capture. */
export function captureFromText(text: string | null | undefined): DesignCapture | null {
  if (!text || !text.includes("sonobe.design-capture")) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return looksLikeCapture(value) ? parseCapture(value) : null;
}

/** "46 layers · 16 texts · 5 images · scrolls". */
export function summaryText(summary: ImportSummary): string {
  const parts = [`${summary.layers} layer${summary.layers === 1 ? "" : "s"}`];
  if (summary.texts) parts.push(`${summary.texts} text${summary.texts === 1 ? "" : "s"}`);
  if (summary.images) parts.push(`${summary.images} image${summary.images === 1 ? "" : "s"}`);
  if (summary.fields) parts.push(`${summary.fields} text field${summary.fields === 1 ? "" : "s"}`);
  if (summary.scrolls) parts.push(summary.scrolls === 1 ? "scrolls" : `${summary.scrolls} scroll areas`);
  return parts.join(" · ");
}

export type ImportNotify = (options: {
  title: string;
  description?: string;
  details?: readonly string[];
  tone?: "neutral" | "info" | "success" | "warn" | "danger" | "ai";
  action?: { label: string; onClick: () => void };
  duration?: number | "persistent";
}) => void;

/** Notes the toast after an import shows before its "N more" button. */
const TOAST_NOTES = 2;

/**
 * The toast after an import: the summary and the first notes. When there are more (host notes such
 * as SF Symbols come after the converter's), "N more" lists every note in a toast that stays open.
 */
export function notifyImported(notify: ImportNotify, title: string, outcome: Pick<ImportOutcome, "screenName" | "summary" | "notes">): void {
  const notes = outcome.notes ?? [];
  const more = notes.length - TOAST_NOTES;
  notify({
    title,
    description: [outcome.summary ? summaryText(outcome.summary) : "", ...notes.slice(0, TOAST_NOTES)].filter(Boolean).join(" "),
    tone: "success",
    ...(more > 0
      ? {
          action: {
            label: `${more} more ${more === 1 ? "note" : "notes"}`,
            onClick: () => notify({ title: outcome.screenName ? `Import notes for “${outcome.screenName}”` : "Import notes", details: notes, tone: "info", duration: "persistent" }),
          },
        }
      : {}),
  });
}

/** Paste a design capture (copied from a browser extension or a plugin) as a new screen. */
export async function pasteDesignCapture(session: EditorSession, text: string, notify: ImportNotify, deps: ImportDeps = {}): Promise<ImportOutcome | null> {
  let capture: DesignCapture | null;
  try {
    capture = captureFromText(text);
  } catch (err) {
    notify({ title: "That design couldn't be pasted.", description: err instanceof Error ? err.message : String(err), tone: "warn" });
    return null;
  }
  if (!capture) return null;
  const desktop = deps.desktop === undefined ? getDesktopHostApi() : deps.desktop;
  const fetchFile = desktop?.fetchCaptureFile;
  // The desktop app downloads from any site; a browser tab only from sites that allow CORS.
  const images = await resolveCaptureFiles(capture, { fetch: fetchFile ? async (url) => fetchFile.call(desktop, url).then((file) => (file ? { bytes: new Uint8Array(file.bytes), mime: file.mime } : null)) : globalFetcher({ mode: "cors" }) });
  const outcome = await importCapture(session, capture, images);
  if (outcome.ok) notifyImported(notify, `Pasted “${outcome.screenName}”`, outcome);
  else notify({ title: outcome.message ?? "That design couldn't be pasted.", ...(outcome.hint ? { description: outcome.hint } : {}), tone: "warn" });
  return outcome;
}
