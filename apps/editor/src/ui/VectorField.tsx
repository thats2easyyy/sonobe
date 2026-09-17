import { Link2, Link2Off } from "lucide-react";
import { useRef, type CSSProperties } from "react";
import { IconButton } from "./IconButton.tsx";
import { ScrubNumberField, type NumberChangeMeta } from "./ScrubNumberField.tsx";
import { cx } from "./lib/cx.ts";
import { useLatest } from "./lib/hooks.ts";
import { MAX_DECIMALS, roundTo } from "./lib/scrubMath.ts";
import "./ScrubNumberField.css";

const DEFAULT_LABELS: Record<number, readonly string[]> = {
  2: ["X", "Y"],
  3: ["X", "Y", "Z"],
  4: ["X", "Y", "Z", "W"],
};

export interface VectorFieldProps {
  value: readonly number[];
  onChange?: (value: number[], meta: NumberChangeMeta & { component: number }) => void;
  onCommit?: (value: number[]) => void;
  /** Component labels; defaults to X Y (Z W). Use ["W","H"] for sizes, ["T","R","B","L"] for padding. */
  labels?: readonly string[];
  "aria-label": string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  /** Per-component mixed flags (or one flag for all). */
  mixed?: boolean | readonly boolean[];
  disabled?: boolean;
  linked?: boolean;
  onLinkedClick?: () => void;
  size?: "sm" | "md";
  /** Scale all components together (e.g. lock aspect ratio). */
  proportional?: boolean;
  /** Shows the link-proportions toggle when provided. */
  onProportionalChange?: (proportional: boolean) => void;
  className?: string;
}

/** A row of 2–4 scrub fields for points, sizes, anchors, and edges. */
export function VectorField({
  value,
  onChange,
  onCommit,
  labels,
  "aria-label": ariaLabel,
  unit,
  min,
  max,
  step,
  precision,
  mixed,
  disabled,
  linked,
  onLinkedClick,
  size = "md",
  proportional = false,
  onProportionalChange,
  className,
}: VectorFieldProps) {
  const names = labels ?? DEFAULT_LABELS[value.length] ?? value.map((_, i) => String(i + 1));
  const latestValue = useLatest(value);
  const pending = useRef<number[] | null>(null);

  const compute = (index: number, next: number): number[] => {
    const current = [...(pending.current ?? latestValue.current)];
    const previous = current[index] ?? 0;
    if (proportional && previous !== 0) {
      const ratio = next / previous;
      return current.map((c, i) => (i === index ? next : roundTo(c * ratio, MAX_DECIMALS)));
    }
    current[index] = next;
    return current;
  };

  const style = { "--sb-vector-count": value.length } as CSSProperties;

  return (
    <div role="group" aria-label={ariaLabel} className={cx("sb-vector", className)} data-with-link={onProportionalChange ? "" : undefined} style={style}>
      {value.map((component, index) => (
        <ScrubNumberField
          key={index}
          value={component}
          label={names[index]}
          aria-label={`${ariaLabel} ${names[index] ?? index + 1}`}
          unit={unit}
          min={min}
          max={max}
          step={step}
          precision={precision}
          mixed={Array.isArray(mixed) ? mixed[index] : (mixed as boolean | undefined)}
          disabled={disabled}
          linked={linked}
          onLinkedClick={onLinkedClick}
          size={size}
          onChange={(next, meta) => {
            const nextValue = compute(index, next);
            pending.current = nextValue;
            onChange?.(nextValue, { ...meta, component: index });
          }}
          onCommit={() => {
            onCommit?.(pending.current ?? [...latestValue.current]);
            pending.current = null;
          }}
        />
      ))}
      {onProportionalChange && (
        <IconButton
          size="sm"
          icon={proportional ? <Link2 size={13} /> : <Link2Off size={13} />}
          label={proportional ? "Unlink proportions" : "Link proportions"}
          active={proportional}
          disabled={disabled || linked}
          onClick={() => onProportionalChange(!proportional)}
        />
      )}
    </div>
  );
}
