import type { ComponentPropsWithRef, ReactNode } from "react";
import { cx } from "./lib/cx.ts";
import "./Badge.css";

export type BadgeTone = "neutral" | "accent" | "success" | "warn" | "danger" | "info" | "ai";

export interface BadgeProps extends ComponentPropsWithRef<"span"> {
  tone?: BadgeTone;
  variant?: "soft" | "solid" | "outline";
  size?: "sm" | "md";
  /** Leading status dot. */
  dot?: boolean;
  icon?: ReactNode;
}

/** Compact label for status, counts, and types (e.g. "×12" loop counts, "3 warnings"). */
export function Badge({ tone = "neutral", variant = "soft", size = "md", dot = false, icon, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cx("sb-badge", className)} data-tone={tone} data-variant={variant} data-size={size} {...rest}>
      {dot && <span className="sb-badge__dot" aria-hidden />}
      {icon && (
        <span className="sb-badge__icon" aria-hidden>
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
