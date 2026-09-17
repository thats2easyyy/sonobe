import { ShieldAlert } from "lucide-react";
import { useEditorSession, useScriptTrust } from "../state/EditorProvider.tsx";
import { Button } from "../ui/Button.tsx";

/**
 * Shown while a project's JavaScript patches wait for trust (a project from disk with scripts, after
 * "Not Now" on the prompt). The button asks again through the same dialog.
 */
export function ScriptTrustBanner() {
  const session = useEditorSession();
  const required = useScriptTrust((s) => s.required);
  const trusted = useScriptTrust((s) => s.trusted);
  const count = useScriptTrust((s) => s.scriptCount);
  const requesting = useScriptTrust((s) => s.requesting);
  if (!required || trusted || count === 0) return null;
  return (
    <div className="sb-banner" data-tone="info" role="status">
      <ShieldAlert size={14} aria-hidden />
      <span className="sb-banner__text">
        This prototype has {count === 1 ? "a JavaScript patch" : `${count} JavaScript patches`}. {count === 1 ? "It's" : "They're"} paused until you trust this project.
      </span>
      <div className="sb-banner__actions">
        <Button size="sm" variant="primary" loading={requesting} onClick={() => void session.runtime.requestScriptTrust()}>
          Review Scripts…
        </Button>
      </div>
    </div>
  );
}
