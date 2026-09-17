/**
 * Saving from the person's side (⌘S, Save in the unsaved-changes prompt, closing the window). When
 * the project changed on disk while there were unsaved edits, the store refuses to write over it
 * ("disk_changed"); this asks which version to keep instead.
 */

import type { DialogService } from "./dialogs.ts";
import type { DocumentStore, FileResult } from "./document.ts";

export type SaveConflictChoice = "overwrite" | "reload" | "cancel";

/** Save, asking Save Anyway / Reload / Cancel when outside changes are waiting for a decision. */
export async function saveDocumentInteractively(document: DocumentStore, dialogs: Pick<DialogService, "choose">): Promise<FileResult> {
  const result = await document.getState().save();
  if (result.ok || result.errorCode !== "disk_changed") return result;
  const s = document.getState();
  const files = (s.externalChange?.paths ?? []).filter((p) => p !== ".");
  const what = files.length ? `${files.slice(0, 3).join(", ")}${files.length > 3 ? ` and ${files.length - 3} more` : ""} changed on disk` : "The project changed on disk";
  const choice = await dialogs.choose<SaveConflictChoice>({
    title: `"${s.doc.project.name}" changed outside Sonobe`,
    message: `${what} while you had unsaved changes. Save Anyway replaces those changes with your version. Reload uses the version on disk and drops your unsaved changes.`,
    actions: [
      { value: "overwrite", label: "Save Anyway", variant: "danger" },
      { value: "reload", label: "Reload", variant: "primary" },
      { value: "cancel", label: "Cancel" },
    ],
  });
  if (choice === "overwrite") return document.getState().save({ overwriteExternal: true });
  if (choice === "reload") {
    document.getState().acceptExternalChange();
    return { ok: false, cancelled: true, reloaded: true };
  }
  return { ok: false, cancelled: true };
}
