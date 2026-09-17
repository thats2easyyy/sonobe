import type { MouseEvent, ReactNode } from "react";
import { Tooltip } from "../../ui/Tooltip.tsx";

export interface FilterChipProps {
  pressed: boolean;
  /** Receives the click so callers can solo on Option/Alt-click. */
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
  icon?: ReactNode;
  label: string;
  count?: number;
  tone?: "neutral" | "danger" | "warn" | "info";
  hint?: string;
}

/** A toggle pill for HUD filters (levels, severities). */
export function FilterChip({ pressed, onToggle, icon, label, count, tone = "neutral", hint }: FilterChipProps) {
  const chip = (
    <button type="button" className="sb-hudchip" aria-pressed={pressed} data-tone={tone} onClick={onToggle}>
      {icon && (
        <span className="sb-hudchip__icon" aria-hidden>
          {icon}
        </span>
      )}
      <span>{label}</span>
      {count !== undefined && <span className="sb-hudchip__count sb-tabular">{count}</span>}
    </button>
  );
  return hint ? (
    <Tooltip content={hint} placement="top">
      {chip}
    </Tooltip>
  ) : (
    chip
  );
}
