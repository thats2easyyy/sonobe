import { Link2 } from "lucide-react";
import { useRef, useState } from "react";
import { ColorPicker, DEFAULT_SWATCHES } from "./ColorPicker.tsx";
import { Popover } from "./Popover.tsx";
import { ScrubNumberField } from "./ScrubNumberField.tsx";
import { parseHexColor, toCssColor, toHex6, toHex8 } from "./lib/colorMath.ts";
import { cx } from "./lib/cx.ts";
import type { Placement } from "./lib/position.ts";
import "./ColorPicker.css";

export interface ColorFieldProps {
  /** "#RRGGBBAA" (document encoding). */
  value: string;
  onChange?: (hex: string) => void;
  onCommit?: (hex: string) => void;
  "aria-label": string;
  showAlpha?: boolean;
  swatches?: readonly string[];
  mixed?: boolean;
  disabled?: boolean;
  /** Driven by a patch. */
  linked?: boolean;
  size?: "sm" | "md";
  pickerPlacement?: Placement;
  className?: string;
}

/** Swatch + hex + opacity in one field; the swatch opens the full picker. */
export function ColorField({
  value,
  onChange,
  onCommit,
  "aria-label": ariaLabel,
  showAlpha = true,
  swatches = DEFAULT_SWATCHES,
  mixed = false,
  disabled = false,
  linked = false,
  size = "md",
  pickerPlacement = "bottom-start",
  className,
}: ColorFieldProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const draftRef = useRef<string | null>(null);
  const [draft, setDraftState] = useState<string | null>(null);
  const color = parseHexColor(value) ?? { r: 0, g: 0, b: 0, a: 1 };
  const hex6 = toHex6(color).slice(1);
  const readOnly = disabled || linked;

  const setDraft = (next: string | null) => {
    draftRef.current = next;
    setDraftState(next);
  };

  const commitHex = () => {
    const current = draftRef.current;
    if (current === null) return;
    setDraft(null);
    const text = current.trim().replace(/^#/, "");
    const parsed = parseHexColor(text);
    if (!parsed) return;
    const hasAlpha = text.length === 4 || text.length === 8;
    const next = toHex8(hasAlpha ? parsed : { ...parsed, a: color.a });
    if (next !== toHex8(color)) {
      onChange?.(next);
      onCommit?.(next);
    }
  };

  return (
    <div
      ref={setAnchor}
      className={cx("sb-colorfield", className)}
      data-size={size}
      data-disabled={disabled || undefined}
      data-linked={linked || undefined}
      data-open={open || undefined}
    >
      <button
        type="button"
        className="sb-colorfield__swatch sb-checker"
        aria-label={`${ariaLabel}: #${toHex8(color).slice(1)}. Open color picker`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={readOnly}
        onClick={() => setOpen((o) => !o)}
      >
        {!mixed && (
          <span
            className="sb-colorfield__fill"
            style={{ background: `linear-gradient(90deg, ${toCssColor({ ...color, a: 1 })} 50%, ${toCssColor(color)} 50%)` }}
          />
        )}
      </button>
      <input
        className="sb-colorfield__hex"
        aria-label={`${ariaLabel} hex`}
        value={mixed && draft === null ? "" : (draft ?? hex6)}
        placeholder={mixed ? "Mixed" : undefined}
        readOnly={readOnly}
        maxLength={9}
        spellCheck={false}
        autoComplete="off"
        onFocus={(event) => {
          if (readOnly) return;
          setDraft(mixed ? "" : hex6);
          const el = event.currentTarget;
          requestAnimationFrame(() => el.select());
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitHex}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitHex();
          } else if (event.key === "Escape" && draftRef.current !== null) {
            event.preventDefault();
            event.stopPropagation();
            setDraft(null);
            event.currentTarget.blur();
          }
        }}
      />
      {showAlpha && (
        <ScrubNumberField
          className="sb-colorfield__alpha"
          size={size}
          aria-label={`${ariaLabel} opacity`}
          value={color.a}
          scale={100}
          unit="%"
          min={0}
          max={1}
          step={0.01}
          precision={0}
          mixed={mixed}
          placeholder="–"
          disabled={disabled}
          linked={linked}
          onChange={(a) => onChange?.(toHex8({ ...color, a }))}
          onCommit={(a) => onCommit?.(toHex8({ ...color, a }))}
        />
      )}
      {linked && (
        <span className="sb-colorfield__link" aria-hidden>
          <Link2 size={12} strokeWidth={2} />
        </span>
      )}
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchor={anchor}
        placement={pickerPlacement}
        role="dialog"
        aria-label={`${ariaLabel} color picker`}
        initialFocus="container"
        className="sb-colorpicker-popover"
      >
        <ColorPicker value={toHex8(color)} onChange={(hex) => onChange?.(hex)} onCommit={onCommit} showAlpha={showAlpha} swatches={swatches} />
      </Popover>
    </div>
  );
}
