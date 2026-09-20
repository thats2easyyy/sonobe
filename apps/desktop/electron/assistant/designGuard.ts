/**
 * The replace guard: before import_design replaces a layer, ask the person when it's one they didn't
 * pick and the Assistant didn't make in this chat, or one they changed since the Assistant made it.
 * Per chat and in memory: it fingerprints the screens the Assistant imported, layer by layer. Pure
 * functions over documents; the agent loop asks and runs the dry run.
 */

import type { Id, SonobeDocument } from "@sonobe/core";
import type { ConfirmPrompt } from "./guardrails.ts";

export interface ReplaceImpact { dropped: string[]; droppedCount: number; lostConnections: number }
export interface ReplaceCheck {
  reason: "untargeted" | "hand_edited";
  target: { id: Id; name: string };
  /** Display names of layers the person changed since the Assistant made them (first 5), for hand_edited. */
  changed: string[];
  changedCount: number;
}
export interface ReplaceGuard {
  /** Null: go ahead without asking. */
  check(request: { docId: string; component: Id; replace: Id; picked: Id | null }, doc: SonobeDocument): ReplaceCheck | null;
  /** A successful import_design: the screen is the Assistant's own now (records inside it or for the replaced id go). */
  remember(docId: string, component: Id, screenId: Id, doc: SonobeDocument): void;
  /** Another successful Assistant write: take its own edits into the records (only `affectedLayers` when given, else every record of the document). */
  refresh(docId: string, doc: SonobeDocument, affectedLayers?: readonly Id[]): void;
  tracks(docId: string): boolean;
  clear(): void;
}

export function createReplaceGuard(): ReplaceGuard {
  throw new Error("not implemented");
}

/** FNV-1a per layer of { type, name, props (without the root's position), parent, index, locked }. Deterministic key order. */
export function fingerprintSubtree(_doc: SonobeDocument, _component: Id, _rootId: Id): Map<Id, { hash: string; name: string }> {
  throw new Error("not implemented");
}

/** The confirmation for a replace (kind "replace"; the decline button keeps the person's work). */
export function replacePrompt(_check: ReplaceCheck, _impact: ReplaceImpact | null): ConfirmPrompt {
  throw new Error("not implemented");
}

/** The tool result Claude gets when the person keeps what's there. */
export function replaceDeclinedMessage(_check: ReplaceCheck): string {
  throw new Error("not implemented");
}

/** The declined chip's detail: "You kept “Home”" or "You kept your changes". */
export function replaceDeclinedDetail(_check: ReplaceCheck): string {
  throw new Error("not implemented");
}
