/** The inspector's item header: icon, an editable name, a subtitle, actions, and optional detail below. */

import { useState, type ReactNode } from "react";
import { Tooltip } from "../../ui/Tooltip.tsx";

export interface InspectorHeaderProps {
  icon: ReactNode;
  name: string;
  /** Shown when the name is empty (a patch without a custom name shows its type name). */
  placeholder?: string;
  /** Enables renaming in place. */
  onRename?: (name: string) => void;
  /** Allow an empty name (patches fall back to their type name). */
  allowEmpty?: boolean;
  subtitle?: ReactNode;
  /** Shown when the pointer rests on the subtitle (the item's id). */
  subtitleTooltip?: string;
  /** Sits after the subtitle ("Learn more"). */
  subtitleAction?: ReactNode;
  /** Color (CSS value) of a small dot before the subtitle, e.g. a patch category color. */
  subtitleDot?: string;
  actions?: ReactNode;
  children?: ReactNode;
}

export function InspectorHeader({ icon, name, placeholder, onRename, allowEmpty = false, subtitle, subtitleTooltip, subtitleAction, subtitleDot, actions, children }: InspectorHeaderProps) {
  return (
    <div className="sb-insp-header">
      <div className="sb-insp-header__main">
        <span className="sb-insp-header__icon" aria-hidden>
          {icon}
        </span>
        {onRename ? <NameInput value={name} placeholder={placeholder} allowEmpty={allowEmpty} onRename={onRename} /> : <div className="sb-insp-header__name">{name || placeholder}</div>}
        {actions && <div className="sb-insp-header__actions">{actions}</div>}
        {(subtitle || subtitleAction) && (
          <div className="sb-insp-header__meta">
            {subtitle && (
              <Tooltip content={subtitleTooltip} placement="bottom-start">
                <div className="sb-insp-header__subtitle">
                  {subtitleDot && <span className="sb-insp-header__dot" style={{ background: subtitleDot }} aria-hidden />}
                  <span className="sb-insp-header__subtitle-text">{subtitle}</span>
                </div>
              </Tooltip>
            )}
            {subtitleAction}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function NameInput({ value, placeholder, allowEmpty, onRename }: { value: string; placeholder?: string; allowEmpty: boolean; onRename: (name: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const next = draft.trim();
    setDraft(null);
    if (next === value || (!next && !allowEmpty)) return;
    onRename(next);
  };
  return (
    <input
      className="sb-insp-header__name sb-insp-header__name-input"
      aria-label="Name"
      spellCheck={false}
      autoComplete="off"
      value={draft ?? value}
      placeholder={placeholder}
      onFocus={() => setDraft(value)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setDraft(null);
          requestAnimationFrame(() => (event.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}
