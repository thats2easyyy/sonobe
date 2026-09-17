import { Check, Minus } from "lucide-react";
import type { ComponentPropsWithRef, ReactNode } from "react";
import { cx } from "./lib/cx.ts";
import "./Toggle.css";

type ButtonProps = Omit<ComponentPropsWithRef<"button">, "onChange" | "children">;

export interface ToggleProps extends ButtonProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  size?: "sm" | "md";
  /** Visible label; clicking it toggles too. */
  label?: ReactNode;
}

/** On/off switch for settings that apply immediately. */
export function Toggle({ checked, onChange, size = "md", label, className, onClick, ...rest }: ToggleProps) {
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cx("sb-toggle", !label && className)}
      data-size={size}
      data-checked={checked || undefined}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onChange?.(!checked);
      }}
      {...rest}
    >
      <span className="sb-toggle__thumb" aria-hidden />
    </button>
  );
  if (!label) return control;
  return (
    <label className={cx("sb-choice", className)} data-disabled={rest.disabled || undefined}>
      {control}
      <span className="sb-choice__label">{label}</span>
    </label>
  );
}

export interface CheckboxProps extends ButtonProps {
  checked: boolean;
  /** Some but not all items are checked. */
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  label?: ReactNode;
}

/** Checkbox for boolean ports and multi-choice lists. Supports a mixed state. */
export function Checkbox({ checked, indeterminate = false, onChange, label, className, onClick, ...rest }: CheckboxProps) {
  const control = (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      className={cx("sb-checkbox", !label && className)}
      data-checked={checked || indeterminate || undefined}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onChange?.(indeterminate ? true : !checked);
      }}
      {...rest}
    >
      {indeterminate ? <Minus size={11} strokeWidth={3} aria-hidden /> : checked ? <Check size={11} strokeWidth={3} aria-hidden /> : null}
    </button>
  );
  if (!label) return control;
  return (
    <label className={cx("sb-choice", className)} data-disabled={rest.disabled || undefined}>
      {control}
      <span className="sb-choice__label">{label}</span>
    </label>
  );
}
