/**
 * The patch editor's component path. It doesn't use React Flow, so the shell can show it in the
 * panel header before the patch editor chunk has loaded.
 */

import { ChevronRight, Ellipsis } from "lucide-react";
import { useLayoutEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { Menu } from "../../../ui/Menu.tsx";
import { Tooltip } from "../../../ui/Tooltip.tsx";
import { useEditorSession } from "../../../state/EditorProvider.tsx";
import type { EditorSession } from "../../../state/session.ts";

export interface PatchEditorBreadcrumbsProps {
  /** Default: the nearest EditorProvider's session. */
  session?: EditorSession;
  className?: string;
}

/** A crumb's tooltip shows the full name only while the crumb is clipped. */
function Crumb({ name, current, onSelect }: { name: string; current: boolean; onSelect: () => void }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => setClipped(el.scrollWidth > el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, name]);
  return (
    <Tooltip content={name} disabled={!clipped}>
      {current ? (
        <span ref={setEl} aria-current="page">
          {name}
        </span>
      ) : (
        <button ref={setEl} type="button" onClick={onSelect}>
          {name}
        </button>
      )}
    </Tooltip>
  );
}

/** Component path: click a crumb to go back up (⌥↑ exits one level). A path of three or more folds its middle into a menu. */
export function PatchEditorBreadcrumbs({ session: provided, className }: PatchEditorBreadcrumbsProps) {
  const fallback = useEditorSession();
  const session = provided ?? fallback;
  const path = useStore(session.selection, (s) => s.componentPath);
  // Only the names on the path, as one string: an edit inside a component makes a new `components`, and the crumbs don't show it.
  const names = useStore(session.document, (s) => JSON.stringify(path.map((id) => s.doc.components[id]?.name ?? null)));
  const crumbs = useMemo(() => {
    const list = JSON.parse(names) as (string | null)[];
    // Missing components are skipped, as selectBreadcrumbs does.
    return path.flatMap((_, i) => (typeof list[i] === "string" ? [{ name: list[i]!, path: path.slice(0, i + 1) }] : []));
  }, [names, path]);
  const goTo = (target: string[]) => session.selection.getState().setComponentPath(target);
  const folded = crumbs.length >= 3 ? crumbs.slice(1, -1) : [];
  const shown = folded.length ? [crumbs[0]!, crumbs.at(-1)!] : crumbs;
  return (
    <nav className={`sb-pe-crumbs${className ? ` ${className}` : ""}`} aria-label="Component path">
      <ChevronRight size={12} aria-hidden className="sb-pe-crumbs__sep sb-pe-crumbs__lead" />
      {shown.map((crumb, i) => {
        const last = crumb === crumbs.at(-1);
        return (
          <span key={crumb.path.join("/")} className="sb-pe-crumbs__item" data-current={last || undefined}>
            {i > 0 && <ChevronRight size={12} aria-hidden className="sb-pe-crumbs__sep" />}
            {i === 1 && folded.length > 0 && (
              <>
                <Menu
                  aria-label="Parent components"
                  entries={folded.map((c) => ({ id: c.path.join("/"), label: c.name, onSelect: () => goTo(c.path) }))}
                >
                  <button type="button" className="sb-pe-crumbs__more" aria-label={`${folded.length} more ${folded.length === 1 ? "level" : "levels"}`}>
                    <Ellipsis size={12} aria-hidden />
                  </button>
                </Menu>
                <ChevronRight size={12} aria-hidden className="sb-pe-crumbs__sep" />
              </>
            )}
            <Crumb name={crumb.name} current={last} onSelect={() => goTo(crumb.path)} />
          </span>
        );
      })}
    </nav>
  );
}
