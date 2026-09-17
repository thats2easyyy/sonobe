import { LoaderCircle } from "lucide-react";
import type { ComponentPropsWithRef, ReactNode } from "react";
import { cx } from "./lib/cx.ts";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "ai";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  /** primary: the one main action. secondary: default. ghost: toolbars and low emphasis. ai: Claude actions. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  trailingIcon?: ReactNode;
  /** Shows a spinner and disables the button without changing its width. */
  loading?: boolean;
  fullWidth?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  trailingIcon,
  loading = false,
  fullWidth = false,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx("sb-btn", className)}
      data-variant={variant}
      data-size={size}
      data-loading={loading || undefined}
      data-full={fullWidth || undefined}
      data-icon-only={!children && !!icon ? "" : undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {icon && (
        <span className="sb-btn__icon" aria-hidden>
          {icon}
        </span>
      )}
      {children !== undefined && children !== null && <span className="sb-btn__label">{children}</span>}
      {trailingIcon && (
        <span className="sb-btn__icon" aria-hidden>
          {trailingIcon}
        </span>
      )}
      {loading && (
        <span className="sb-btn__spinner" aria-hidden>
          <LoaderCircle size={14} strokeWidth={2} />
        </span>
      )}
    </button>
  );
}
