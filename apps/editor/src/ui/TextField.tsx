import type { ComponentPropsWithRef, KeyboardEvent, ReactNode } from "react";
import { cx } from "./lib/cx.ts";
import "./TextField.css";

export interface TextFieldProps extends Omit<ComponentPropsWithRef<"input">, "size" | "prefix"> {
  size?: "sm" | "md" | "lg";
  leading?: ReactNode;
  trailing?: ReactNode;
  invalid?: boolean;
  /** Monospace value text (ids, hex, code). */
  mono?: boolean;
  /** Enter pressed. */
  onCommit?: (value: string) => void;
  /** Escape pressed (the event won't close an enclosing popover). */
  onCancel?: () => void;
  containerClassName?: string;
}

export function TextField({
  size = "md",
  leading,
  trailing,
  invalid = false,
  mono = false,
  onCommit,
  onCancel,
  className,
  containerClassName,
  onKeyDown,
  disabled,
  ...rest
}: TextFieldProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Enter" && onCommit) {
      event.preventDefault();
      onCommit(event.currentTarget.value);
    } else if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };
  return (
    <div
      className={cx("sb-textfield", containerClassName)}
      data-size={size}
      data-invalid={invalid || undefined}
      data-disabled={disabled || undefined}
      data-mono={mono || undefined}
    >
      {leading && (
        <span className="sb-textfield__adornment" data-position="leading">
          {leading}
        </span>
      )}
      <input
        className={cx("sb-textfield__input", className)}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        spellCheck={false}
        onKeyDown={handleKeyDown}
        {...rest}
      />
      {trailing && (
        <span className="sb-textfield__adornment" data-position="trailing">
          {trailing}
        </span>
      )}
    </div>
  );
}

export interface TextAreaProps extends ComponentPropsWithRef<"textarea"> {
  invalid?: boolean;
  mono?: boolean;
  /** Grow with content up to max-height. Default true. */
  autoGrow?: boolean;
  /** Mod+Enter pressed. */
  onCommit?: (value: string) => void;
}

export function TextArea({ invalid = false, mono = false, autoGrow = true, onCommit, className, onKeyDown, ...rest }: TextAreaProps) {
  return (
    <textarea
      className={cx("sb-textarea", className)}
      data-invalid={invalid || undefined}
      data-mono={mono || undefined}
      data-autogrow={autoGrow || undefined}
      aria-invalid={invalid || undefined}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && onCommit && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          onCommit(event.currentTarget.value);
        }
      }}
      {...rest}
    />
  );
}
