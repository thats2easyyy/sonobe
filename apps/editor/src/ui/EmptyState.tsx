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
  /** tile: a centered block with an icon tile. inline: a left-aligned line of text with its action after it. */
  variant?: "tile" | "inline";
  className?: string;
}

export function EmptyState({ icon, title, description, actions, size = "md", variant = "tile", className }: EmptyStateProps) {
  const inline = variant === "inline";
  const mark = icon && (
    <span className="sb-empty__icon" aria-hidden>
      {icon}
    </span>
  );
  return (
    <div className={cx("sb-empty", className)} data-size={size} data-variant={variant}>
      {!inline && mark}
      <div className="sb-empty__title">
        {inline && mark}
        {inline ? <span>{title}</span> : title}
      </div>
      {description && <div className="sb-empty__description">{description}</div>}
      {actions && <div className="sb-empty__actions">{actions}</div>}
    </div>
  );
}
