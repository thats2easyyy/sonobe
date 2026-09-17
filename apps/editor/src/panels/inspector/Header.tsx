/** The inspector's item header: icon, an editable name, a subtitle, actions, and optional detail below. */

import { useState, type CSSProperties, type ReactNode } from "react";

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
  /** Accent color (CSS value) for the icon tile and top edge, e.g. a patch category color. */
  accent?: string;
  actions?: ReactNode;
  children?: ReactNode;
}

export function InspectorHeader({ icon, name, placeholder, onRename, allowEmpty = false, subtitle, accent, actions, children }: InspectorHeaderProps) {
  return (
    <div className="sb-insp-header" data-accent={accent ? "" : undefined} style={accent ? ({ "--sb-insp-accent": accent } as CSSProperties) : undefined}>
      <div className="sb-insp-header__main">
        <span className="sb-insp-header__icon" aria-hidden>
          {icon}
        </span>
        <div className="sb-insp-header__text">
          {onRename ? <NameInput value={name} placeholder={placeholder} allowEmpty={allowEmpty} onRename={onRename} /> : <div className="sb-insp-header__name">{name || placeholder}</div>}
          {subtitle && <div className="sb-insp-header__subtitle">{subtitle}</div>}
        </div>
        {actions && <div className="sb-insp-header__actions">{actions}</div>}
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
