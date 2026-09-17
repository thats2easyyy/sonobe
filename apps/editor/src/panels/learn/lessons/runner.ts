/**
 * Running a lesson: build a LessonContext from the editor session, evaluate the current step, and
 * start a lesson (loading its starter prototype after asking about unsaved changes). A starter is
 * marked with its lesson in the root component's meta, so progress resumes only while that practice
 * prototype is open.
 */

import { applyOps, type Id, type Registry, type SonobeDocument } from "@sonobe/core";
import type { SceneFrame, SceneNode } from "@sonobe/engine";
import type { DocumentStore } from "../../../state/document.ts";
import type { SelectionStore } from "../../../state/selection.ts";
import type { Lesson, LessonCheckResult, LessonConnectState, LessonContext, LessonStep, LessonTarget, LessonUiState } from "./types.ts";

export const DEFAULT_UI: LessonUiState = { viewMode: "split", drawer: "learn", hudTab: "console", hudCollapsed: true };
export const DEFAULT_CONNECT: LessonConnectState = { open: false, openCount: 0, copied: {} };

export interface LessonContextInput {
  doc: SonobeDocument;
  fired?: ReadonlyMap<string, number>;
  value?: (address: string) => unknown;
  copies?: (layerId: Id) => number;
  selection?: { layers?: readonly Id[]; patches?: readonly Id[] };
  ui?: Partial<LessonUiState>;
  connect?: Partial<LessonConnectState>;
  agentChanges?: number;
}

const EMPTY_FIRED: ReadonlyMap<string, number> = new Map();

export function createLessonContext(input: LessonContextInput): LessonContext {
  const component = input.doc.components[input.doc.project.root];
  if (!component) throw new Error("The prototype has no root component.");
  return {
    doc: input.doc,
    component,
    fired: input.fired ?? EMPTY_FIRED,
    value: input.value ?? (() => undefined),
    copies: input.copies ?? (() => 0),
    selection: { layers: input.selection?.layers ?? [], patches: input.selection?.patches ?? [] },
    ui: { ...DEFAULT_UI, ...input.ui },
    connect: { ...DEFAULT_CONNECT, ...input.connect, copied: { ...input.connect?.copied } },
    agentChanges: input.agentChanges ?? 0,
  };
}

/** Evaluate a step's check. A check that throws counts as not done. */
export function evaluateStep(step: LessonStep, ctx: LessonContext, start: LessonContext): Required<LessonCheckResult> {
  try {
    const result = step.check(ctx, start);
    return typeof result === "boolean" ? { done: result, hint: null } : { done: result.done, hint: result.hint ?? null };
  } catch {
    return { done: false, hint: null };
  }
}

export function stepTarget(step: LessonStep, ctx: LessonContext): LessonTarget | null {
  if (!step.target) return null;
  try {
    return typeof step.target === "function" ? step.target(ctx) : step.target;
  } catch {
    return null;
  }
}

/** Copies of a layer in a scene frame (loop replication makes one node per index). */
export function countLayerCopies(scene: SceneFrame | null | undefined, layerId: Id): number {
  if (!scene) return 0;
  let count = 0;
  const visit = (nodes: readonly SceneNode[]) => {
    for (const n of nodes) {
      if (n.layerId === layerId) count++;
      if (n.children?.length) visit(n.children);
    }
  };
  visit(scene.roots);
  return count;
}

/** Root component meta key that marks a lesson's practice prototype: `"lesson": "first-prototype"`. */
export const LESSON_META_KEY = "lesson";

/** The lesson a document is the practice prototype for, if any. */
export function lessonOfDocument(doc: SonobeDocument): string | undefined {
  const value = doc.components[doc.project.root]?.meta?.[LESSON_META_KEY];
  return typeof value === "string" ? value : undefined;
}

/**
 * Whether a lesson can run on the open document. A lesson with a starter checks its own practice
 * prototype (another prototype would make its checks meaningless); a lesson without one works with
 * whatever is open.
 */
export function isLessonDocumentOpen(lesson: Pick<Lesson, "id" | "starter">, doc: SonobeDocument): boolean {
  return !lesson.starter || lessonOfDocument(doc) === lesson.id;
}

/** Mark a document as a lesson's practice prototype (updateComponent meta, which merges keys). */
export function markLessonDocument(doc: SonobeDocument, lessonId: string, registry: Registry): SonobeDocument {
  const result = applyOps(doc, [{ op: "updateComponent", id: doc.project.root, meta: { [LESSON_META_KEY]: lessonId } }], { registry });
  if (!result.ok) throw new Error(`Couldn't mark the practice prototype: ${result.errors.map((e) => e.message).join("; ")}`);
  return result.doc;
}

/** The part of an EditorSession a lesson needs to start. */
export interface LessonSessionLike {
  readonly registry: Registry;
  readonly document: DocumentStore;
  readonly selection: SelectionStore;
  confirmDiscardChanges(action: "open" | "new" | "reload"): Promise<boolean>;
}

/**
 * Load a lesson's starter prototype (asking about unsaved changes first). Resolves false when the
 * person cancels. Lessons without a starter keep the open prototype.
 */
export async function loadLessonStarter(session: LessonSessionLike, lesson: Lesson): Promise<boolean> {
  if (!lesson.starter) return true;
  if (!(await session.confirmDiscardChanges("new"))) return false;
  const doc = markLessonDocument(lesson.starter(session.registry), lesson.id, session.registry);
  session.document.getState().replaceDocument(doc, { projectPath: null, saved: true, label: `Started lesson “${lesson.title}”` });
  session.selection.getState().setComponentPath([doc.project.root]);
  session.selection.getState().clear();
  return true;
}
