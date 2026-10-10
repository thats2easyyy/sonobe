import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { ErrorBoundary, SurfaceProblem } from "../ui/ErrorBoundary.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { useOptionalCommands } from "../ui/commands/CommandProvider.tsx";
import type { ShortcutScope } from "../ui/commands/shortcutManager.ts";
import { cx } from "../ui/lib/cx.ts";

export interface PanelProps {
  id?: string;
  title: ReactNode;
  "aria-label"?: string;
  icon?: ReactNode;
  /** Content after the title (breadcrumbs, tools, meta text). */
  headerContent?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  /** Shortcut scope for keys pressed while focus or the pointer is in this panel. */
  scope?: ShortcutScope;
  /** "sunken" for work surfaces (viewer, canvas, patch editor). */
  surface?: "panel" | "sunken";
  className?: string;
  bodyClassName?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/** A shell panel: header with title and actions, a body that fills the rest. */
export function Panel({
  id,
  title,
  "aria-label": ariaLabel,
  icon,
  headerContent,
  actions,
  footer,
  scope,
  surface = "panel",
  className,
  bodyClassName,
  style,
  children,
}: PanelProps) {
  const commands = useOptionalCommands();
  return (
    <section
      id={id}
      className={cx("sb-panel", className)}
      data-surface={surface}
      data-shortcut-scope={scope}
      aria-label={ariaLabel ?? (typeof title === "string" ? title : undefined)}
      style={style}
      onPointerEnter={scope && commands ? () => commands.shortcuts.setContextScopes([scope]) : undefined}
    >
      <header className="sb-panel__header">
        {icon && (
          <span className="sb-panel__icon" aria-hidden>
            {icon}
          </span>
        )}
        <h2 className="sb-panel__title">{title}</h2>
        {headerContent && <div className="sb-panel__header-content">{headerContent}</div>}
        {actions && <div className="sb-panel__actions">{actions}</div>}
      </header>
      <div className={cx("sb-panel__body", bodyClassName)}>{children}</div>
      {footer && <footer className="sb-panel__footer">{footer}</footer>}
    </section>
  );
}

export interface PanelBoundaryProps extends Pick<PanelProps, "title" | "scope" | "surface"> {
  /** What the panel is called when it fails, as a sentence starts: "The Inspector". */
  name: string;
  children: ReactNode;
}

/**
 * Contains a shell panel (ARCHITECTURE §9, Error containment): when it throws while drawing, a panel
 * with the same title says so, with Try again, and the panels beside it keep working.
 */
export function PanelBoundary({ name, children, ...panel }: PanelBoundaryProps) {
  return (
    <ErrorBoundary
      name={name}
      fallback={({ retry }) => (
        <Panel {...panel}>
          <SurfaceProblem name={name} kind="render" onRetry={retry} />
        </Panel>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

export interface PanelRailProps {
  /** Which panel this stands for; the shell finds the rail by it to move focus. */
  panel?: string;
  title: string;
  side: "left" | "right";
  icon: ReactNode;
  shortcut?: string;
  onExpand: () => void;
}

/** What a collapsed side panel leaves behind: a slim rail that brings it back. */
export function PanelRail({ panel, title, side, icon, shortcut, onExpand }: PanelRailProps) {
  return (
    <div className="sb-rail" data-side={side} data-panel={panel} role="region" aria-label={`${title} (hidden)`}>
      <IconButton
        size="sm"
        icon={side === "left" ? <PanelLeftOpen size={14} strokeWidth={1.75} /> : <PanelRightOpen size={14} strokeWidth={1.75} />}
        label={`Show ${title}`}
        shortcut={shortcut}
        tooltipPlacement={side === "left" ? "right" : "left"}
        onClick={onExpand}
      />
      <button type="button" className="sb-rail__label" tabIndex={-1} onClick={onExpand}>
        <span className="sb-rail__icon" aria-hidden>
          {icon}
        </span>
        {title}
      </button>
    </div>
  );
}
