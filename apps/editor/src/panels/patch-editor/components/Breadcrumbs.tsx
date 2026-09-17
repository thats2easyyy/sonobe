/**
 * The patch editor's component path. It doesn't use React Flow, so the shell can show it in the
 * panel header before the patch editor chunk has loaded.
 */

import { ChevronRight } from "lucide-react";
import { useStore } from "zustand";
import { useEditorSession } from "../../../state/EditorProvider.tsx";
import { selectBreadcrumbs } from "../../../state/selection.ts";
import type { EditorSession } from "../../../state/session.ts";

export interface PatchEditorBreadcrumbsProps {
  /** Default: the nearest EditorProvider's session. */
  session?: EditorSession;
  className?: string;
}

/** Component path: click a crumb to go back up (⌥↑ exits one level). */
export function PatchEditorBreadcrumbs({ session: provided, className }: PatchEditorBreadcrumbsProps) {
  const fallback = useEditorSession();
  const session = provided ?? fallback;
  const path = useStore(session.selection, (s) => s.componentPath);
  const components = useStore(session.document, (s) => s.doc.components);
  const crumbs = selectBreadcrumbs({ componentPath: path }, { components } as never);
  return (
    <nav className={`sb-pe-crumbs${className ? ` ${className}` : ""}`} aria-label="Component path">
      {crumbs.map((crumb, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={crumb.path.join("/")} className="sb-pe-crumbs__item">
            {i > 0 && <ChevronRight size={12} aria-hidden className="sb-pe-crumbs__sep" />}
            {last ? (
              <span aria-current="page">{crumb.name}</span>
            ) : (
              <button type="button" onClick={() => session.selection.getState().setComponentPath(crumb.path)}>
                {crumb.name}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
