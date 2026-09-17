/** Collapsible inspector section with a "More" disclosure for advanced rows. Open state persists per section id. */

import { ChevronRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { readJSON, writeJSON } from "../../ui/lib/storage.ts";

export const SECTION_STORAGE_KEY = "sonobe.inspector.sections";

const isRecord = (value: unknown): value is Record<string, boolean> => !!value && typeof value === "object" && !Array.isArray(value);

function readOpen(id: string, fallback: boolean): boolean {
  const saved = readJSON(SECTION_STORAGE_KEY, isRecord)?.[id];
  return typeof saved === "boolean" ? saved : fallback;
}

function writeOpen(id: string, open: boolean): void {
  writeJSON(SECTION_STORAGE_KEY, { ...(readJSON(SECTION_STORAGE_KEY, isRecord) ?? {}), [id]: open });
}

export interface InspectorSectionProps {
  /** Stable id for remembering open state ("layer.fill"). */
  id: string;
  title: ReactNode;
  children?: ReactNode;
  /** Advanced rows behind "More". */
  more?: ReactNode;
  moreCount?: number;
  /** Buttons after the title. */
  actions?: ReactNode;
  defaultOpen?: boolean;
}

export function InspectorSection({ id, title, children, more, moreCount = 0, actions, defaultOpen = true }: InspectorSectionProps) {
  const bodyId = useId();
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));
  const [showMore, setShowMore] = useState(false);
  const toggle = () => {
    setOpen((current) => {
      writeOpen(id, !current);
      return !current;
    });
  };
  return (
    <section className="sb-insp-section" data-open={open || undefined} aria-label={typeof title === "string" ? title : undefined}>
      <header className="sb-insp-section__header">
        <button type="button" className="sb-insp-section__toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
          <ChevronRight size={12} strokeWidth={2} className="sb-insp-section__chevron" aria-hidden />
          {title}
        </button>
        {actions && <div className="sb-insp-section__actions">{actions}</div>}
      </header>
      {open && (
        <div id={bodyId} className="sb-insp-section__body">
          {children}
          {moreCount > 0 && (
            <>
              {showMore && more}
              <button type="button" className="sb-insp-section__more" aria-expanded={showMore} onClick={() => setShowMore((s) => !s)}>
                {showMore ? "Less" : `More (${moreCount})`}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
