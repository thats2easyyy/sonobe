import { FileWarning } from "lucide-react";
import { useDocument, useEditorSession } from "../state/EditorProvider.tsx";
import { saveDocumentInteractively } from "../state/saveFlow.ts";
import { Button } from "../ui/Button.tsx";
import { toast } from "../ui/Toast.tsx";

const fileList = (paths: readonly string[]) => {
  const files = paths.filter((p) => p !== ".");
  return files.length ? ` (${files.slice(0, 2).join(", ")}${files.length > 2 ? ` +${files.length - 2}` : ""})` : "";
};

/**
 * Shown when the open project changed on disk while there were unsaved edits here, or when an
 * outside change left a file Sonobe can't read.
 */
export function ExternalChangeBanner() {
  const session = useEditorSession();
  const change = useDocument((s) => s.externalChange);
  const problem = useDocument((s) => s.diskProblem);
  const name = useDocument((s) => s.doc.project.name);
  if (change) {
    return (
      <div className="sb-banner" role="status">
        <FileWarning size={14} aria-hidden />
        <span className="sb-banner__text">
          <strong>{name}</strong> changed outside Sonobe{fileList(change.paths)}. Reload to use that version, or keep your edits and save over it.
        </span>
        <div className="sb-banner__actions">
          <Button size="sm" variant="ghost" onClick={() => session.document.getState().dismissExternalChange()}>
            Keep My Edits
          </Button>
          <Button size="sm" variant="primary" onClick={() => session.document.getState().acceptExternalChange()}>
            Reload
          </Button>
        </div>
      </div>
    );
  }
  if (!problem) return null;
  const save = async () => {
    const result = await saveDocumentInteractively(session.document, session.dialogs);
    if (!result.ok && !result.cancelled) toast({ title: "Couldn't save", description: result.error ?? "Something went wrong.", tone: "danger" });
  };
  return (
    <div className="sb-banner" role="alert">
      <FileWarning size={14} aria-hidden />
      <span className="sb-banner__text">
        <strong>{name}</strong> changed outside Sonobe{fileList(problem.paths)} and can't be opened as it is: {problem.message.split("\n")[0]} Save to write your version over it.
      </span>
      <div className="sb-banner__actions">
        <Button size="sm" variant="primary" onClick={() => void save()}>
          Save
        </Button>
      </div>
    </div>
  );
}
