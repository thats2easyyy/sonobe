import type { ComponentPropsWithRef, ReactNode } from "react";
import { Tooltip } from "./Tooltip.tsx";
import { cx } from "./lib/cx.ts";
import type { Placement } from "./lib/position.ts";
import "./Button.css";

export interface IconButtonProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  icon: ReactNode;
  /** Accessible name; also the default tooltip. */
  label: string;
  shortcut?: string | readonly string[];
  /** Custom tooltip content, or false to hide it. */
  tooltip?: ReactNode | false;
  tooltipPlacement?: Placement;
  variant?: "ghost" | "secondary" | "solid";
  size?: "xs" | "sm" | "md" | "lg";
  /** Toggle state; sets aria-pressed. */
  active?: boolean;
  /** Small dot for unread / attention. */
  badge?: boolean;
}

export function IconButton({
  icon,
  label,
  shortcut,
  tooltip,
  tooltipPlacement = "bottom",
  variant = "ghost",
  size = "md",
  active,
  badge = false,
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      aria-label={label}
      aria-pressed={active}
      className={cx("sb-iconbtn", className)}
      data-variant={variant}
      data-size={size}
      data-active={active || undefined}
      {...rest}
    >
      {icon}
      {badge && <span className="sb-iconbtn__badge" aria-hidden />}
    </button>
  );
  if (tooltip === false) return button;
  return (
    <Tooltip content={tooltip ?? label} shortcut={shortcut} placement={tooltipPlacement}>
      {button}
    </Tooltip>
  );
}
