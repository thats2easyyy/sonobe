import type { ReactNode } from "react";
import { cx } from "./lib/cx.ts";
import "./EmptyState.css";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  /** Say why it's empty and what to do next. */
  description?: ReactNode;
  actions?: ReactNode;
  size?: "sm" | "md";
  className?: string;
}

export function EmptyState({ icon, title, description, actions, size = "md", className }: EmptyStateProps) {
  return (
    <div className={cx("sb-empty", className)} data-size={size}>
      {icon && (
        <div className="sb-empty__icon" aria-hidden>
          {icon}
        </div>
      )}
      <div className="sb-empty__title">{title}</div>
      {description && <div className="sb-empty__description">{description}</div>}
      {actions && <div className="sb-empty__actions">{actions}</div>}
    </div>
  );
}
