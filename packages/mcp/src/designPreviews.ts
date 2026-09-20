/**
 * preview_design's drafts: the page an agent is writing, drawn on the person's canvas as it grows,
 * until import_design imports it ("preview": true) or the agent clears it. MCP servers are created per
 * HTTP request, so drafts live beside the host, one per document and session (the relay's client id,
 * else the author's name, as working badges are kept). A draft left alone for 15 minutes is dropped,
 * and cleared from the canvas, the next time the host's drafts are used. Browser-safe.
 */

import type { Author, Id } from "@sonobe/core";
import { isHostError, type DesignPreviewUpdate, type SonobeHost, type WorkClient } from "./host.ts";

/** Most characters one draft holds (import_design's html limit). */
export const MAX_DRAFT_CHARS = 1_500_000;
/** A draft nobody touched for this long is dropped. */
export const DRAFT_IDLE_MS = 15 * 60_000;

/** What a draft says about the screen; null leaves it to import_design's default. */
export interface DesignDraftFields {
  name: string | null;
  component: Id | null;
  replace: Id | null;
  width: number | null;
  height: number | null;
  position: [number, number] | null;
}

export const NO_DRAFT_FIELDS: DesignDraftFields = { name: null, component: null, replace: null, width: null, height: null, position: null };

export interface DesignDraft {
  docId: Id;
  /** The session it belongs to (sessionKey). */
  key: string;
  author: Author;
  client?: WorkClient;
  fields: DesignDraftFields;
  html: string;
  /** Its latest update's count (DesignPreviewUpdate.draftRevision, preview_design's draftRevision). */
  revision: number;
  touchedAt: number;
}

/** Whose draft a call works on: the relay's client id, else the author's name, as setWorking keeps badges. */
export function sessionKey(author: Author, client: WorkClient | undefined): string {
  return client?.id ?? author.name;
}

/** Whether the person sees drafts: the host draws them on a canvas. */
export function showsDesignPreviews(host: SonobeHost): boolean {
  return host.capabilities.designPreview === true && typeof host.showDesignPreview === "function";
}

/** A draft's size in bytes (UTF-8). */
export function draftBytes(html: string): number {
  return new TextEncoder().encode(html).length;
}

/** A size as results show it: rounded KB, at least 1 once there's any html. */
export function draftKb(bytes: number): number {
  return bytes > 0 ? Math.max(1, Math.round(bytes / 1024)) : 0;
}

/** One call's view of its draft (withDraft). */
export interface DraftTurn {
  /** The session's draft on this document, if it has one. */
  get(): DesignDraft | undefined;
  /** Keep a new or changed draft as its session's draft. */
  keep(draft: DesignDraft): void;
  /** Forget a draft (imported or cleared); update it with "cleared" to take it off the canvas. */
  drop(draft: DesignDraft): void;
  /**
   * Give the draft its next revision and send it to the canvas with this status (hosts without a canvas
   * only count it). Resolves to a note for the result when the canvas didn't take it, else null.
   */
  update(draft: DesignDraft, status: DesignPreviewUpdate["status"]): Promise<string | null>;
}

interface HostDrafts {
  drafts: Map<string, DesignDraft>;
  /** The last revision per draft, kept after it ends so the session's next draft continues the count. */
  revisions: Map<string, number>;
  /**
   * The call running now on each draft. Calls on one draft take turns, so its updates reach the canvas
   * in the order they came; other sessions' and documents' drafts don't wait for it.
   */
  turns: Map<string, Promise<unknown>>;
}

const hosts = new WeakMap<SonobeHost, HostDrafts>();

const slot = (docId: Id, key: string) => `${docId}\n${key}`;

/** Run `fn` once the calls before it on the draft at `at` are done. */
function inTurn<T>(state: HostDrafts, at: string, fn: () => Promise<T>): Promise<T> {
  const run = (state.turns.get(at) ?? Promise.resolve()).then(fn);
  const done = run.catch(() => undefined);
  state.turns.set(at, done);
  void done.then(() => {
    if (state.turns.get(at) === done) state.turns.delete(at);
  });
  return run;
}

/**
 * Run `fn` on the session's draft on `docId` once the calls before it on that draft are done. Drafts
 * left alone too long are dropped and cleared from the canvas, each in its own draft's turn, so no call
 * waits on another draft's canvas.
 */
export function withDraft<T>(host: SonobeHost, now: () => number, docId: Id, key: string, fn: (drafts: DraftTurn) => Promise<T>): Promise<T> {
  let state = hosts.get(host);
  if (!state) hosts.set(host, (state = { drafts: new Map(), revisions: new Map(), turns: new Map() }));
  const { drafts, revisions } = state;
  const at = slot(docId, key);

  const update = async (draft: DesignDraft, status: DesignPreviewUpdate["status"]): Promise<string | null> => {
    const draftAt = slot(draft.docId, draft.key);
    draft.revision = (revisions.get(draftAt) ?? 0) + 1;
    revisions.set(draftAt, draft.revision);
    draft.touchedAt = now();
    if (!showsDesignPreviews(host)) return null;
    const message: DesignPreviewUpdate = {
      docId: draft.docId,
      key: draft.key,
      author: draft.author,
      ...(draft.client ? { client: draft.client } : {}),
      ...draft.fields,
      html: status === "cleared" ? null : draft.html,
      status,
      draftRevision: draft.revision,
    };
    try {
      await host.showDesignPreview!(message);
      return null;
    } catch (err) {
      const why = isHostError(err) ? `${err.message}${err.hint ? ` ${err.hint}` : ""}` : err instanceof Error ? err.message : String(err);
      return `The canvas didn't ${status === "cleared" ? "clear" : "show"} the draft: ${why}`;
    }
  };

  const t = now();
  for (const [draftAt, draft] of drafts) {
    if (t - draft.touchedAt <= DRAFT_IDLE_MS) continue;
    // Checked again in the draft's turn, since a call already waiting on it may touch it first.
    void inTurn(state, draftAt, async () => {
      if (drafts.get(draftAt) !== draft || now() - draft.touchedAt <= DRAFT_IDLE_MS) return;
      drafts.delete(draftAt);
      await update(draft, "cleared");
    });
  }

  const turn: DraftTurn = {
    get: () => drafts.get(at),
    keep: (draft) => void drafts.set(slot(draft.docId, draft.key), draft),
    drop: (draft) => {
      const draftAt = slot(draft.docId, draft.key);
      if (drafts.get(draftAt) === draft) drafts.delete(draftAt);
    },
    update,
  };
  return inTurn(state, at, () => fn(turn));
}
