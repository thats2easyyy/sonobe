import { FileWarning } from "lucide-react";
import { useDocument, useEditorSession } from "../state/EditorProvider.tsx";
import { Button } from "../ui/Button.tsx";

/** Shown when the open project changed on disk while there were unsaved edits here. */
export function ExternalChangeBanner() {
  const session = useEditorSession();
  const change = useDocument((s) => s.externalChange);
  const name = useDocument((s) => s.doc.project.name);
  if (!change) return null;
  const files = change.paths.filter((p) => p !== ".");
  return (
    <div className="sb-banner" role="status">
      <FileWarning size={14} aria-hidden />
      <span className="sb-banner__text">
        <strong>{name}</strong> changed outside Sonobe{files.length ? ` (${files.slice(0, 2).join(", ")}${files.length > 2 ? ` +${files.length - 2}` : ""})` : ""}. Reload to use that version, or keep your edits and save over it.
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
