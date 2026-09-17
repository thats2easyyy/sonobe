/**
 * Feature detection for services other owners add to the EditorSession: the dialog service
 * (`session.dialogs`, else the app-wide default store) and a script-trust service for projects
 * whose JavaScript patches may run.
 */

import { getDefaultDialogs, type DialogStore } from "../state/dialogs.ts";

const isDialogStore = (value: unknown): value is DialogStore => !!value && typeof (value as DialogStore).getState === "function" && typeof (value as DialogStore).confirm === "function";

/** The session's dialog store, or the app-wide one hosts use when they have none. */
export function dialogsFor(session: unknown): DialogStore {
  const own = (session as { dialogs?: unknown } | null)?.dialogs;
  return isDialogStore(own) ? own : getDefaultDialogs();
}

/** Projects trusted to run JavaScript patches, as a session may expose them. */
export interface ProjectTrustService {
  list(): readonly string[];
  revoke(path: string): void;
  subscribe?(listener: () => void): () => void;
}

/** A trust service on the session (`scriptTrust` or `trust`), when one exists. */
export function trustServiceFor(session: unknown): ProjectTrustService | null {
  const source = session as Record<string, unknown> | null;
  for (const key of ["scriptTrust", "trust"]) {
    const candidate = source?.[key] as Partial<ProjectTrustService> | undefined;
    if (candidate && typeof candidate.list === "function" && typeof candidate.revoke === "function") return candidate as ProjectTrustService;
  }
  return null;
}
