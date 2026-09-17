import type { Color } from "@sonobe/core";
import { Pipette } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { IconButton } from "./IconButton.tsx";
import { ScrubNumberField } from "./ScrubNumberField.tsx";
import { SegmentedControl } from "./SegmentedControl.tsx";
import { TextField } from "./TextField.tsx";
import { clamp01, hsvaToRgba, parseHexColor, rgbaToHsva, toCssColor, toHex6, toHex8, type HSVA } from "./lib/colorMath.ts";
import { cx } from "./lib/cx.ts";
import { usePointerDrag } from "./lib/hooks.ts";
import "./ColorPicker.css";

/** A calm default palette: neutrals, then a hue ring at matched lightness. */
export const DEFAULT_SWATCHES: readonly string[] = [
  "#FFFFFFFF",
  "#D9D9D9FF",
  "#8C8C94FF",
  "#3A3A40FF",
  "#000000FF",
  "#00000000",
  "#F2555AFF",
  "#F7934CFF",
  "#F5C84CFF",
  "#5DC98AFF",
  "#3FC1C9FF",
  "#4F8EF7FF",
  "#7C6CF2FF",
  "#C86DD7FF",
  "#F26DA6FF",
  "#A7835AFF",
];

type EyeDropperCtor = new () => { open(): Promise<{ sRGBHex: string }> };

function eyeDropper(): EyeDropperCtor | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
}

const BLACK: Color = { r: 0, g: 0, b: 0, a: 1 };

/** Keep hue (and saturation) when the incoming color is gray or black, so thumbs don't jump. */
function mergeHsva(previous: HSVA, next: HSVA): HSVA {
  const gray = next.s === 0 || next.v === 0;
  return { h: gray ? previous.h : next.h, s: next.v === 0 ? previous.s : next.s, v: next.v, a: next.a };
}

type ColorMode = "hex" | "rgb" | "hsb";

export interface ColorPickerProps {
  /** "#RRGGBBAA". */
  value: string;
  onChange: (hex: string) => void;
  /** End of a gesture (drag end, typed commit, swatch click). */
  onCommit?: (hex: string) => void;
  showAlpha?: boolean;
  swatches?: readonly string[];
  className?: string;
}

export function ColorPicker({ value, onChange, onCommit, showAlpha = true, swatches = DEFAULT_SWATCHES, className }: ColorPickerProps) {
  const [hsva, setHsva] = useState<HSVA>(() => rgbaToHsva(parseHexColor(value) ?? BLACK));
  const [mode, setMode] = useState<ColorMode>("hex");
  const hsvaRef = useRef(hsva);
  const emitted = useRef(toHex8(parseHexColor(value) ?? BLACK));

  useEffect(() => {
    const parsed = parseHexColor(value);
    if (!parsed) return;
    const normalized = toHex8(parsed);
    if (normalized === emitted.current) return;
    emitted.current = normalized;
    const next = mergeHsva(hsvaRef.current, rgbaToHsva(parsed));
    hsvaRef.current = next;
    setHsva(next);
  }, [value]);

  const emit = (next: HSVA) => {
    hsvaRef.current = next;
    setHsva(next);
    const hex = toHex8(hsvaToRgba(next));
    if (hex !== emitted.current) {
      emitted.current = hex;
      onChange(hex);
    }
  };
  const update = (patch: Partial<HSVA>) => emit({ ...hsvaRef.current, ...patch });
  const commit = () => onCommit?.(emitted.current);

  const setColor = (color: Color, keepAlpha = false) => {
    const next = mergeHsva(hsvaRef.current, rgbaToHsva(keepAlpha ? { ...color, a: hsvaRef.current.a } : color));
    emit(next);
    commit();
  };

  const rgba = hsvaToRgba(hsva);
  const opaque = toCssColor({ ...rgba, a: 1 });
  const Dropper = eyeDropper();

  const pickFromScreen = async () => {
    if (!Dropper) return;
    try {
      const result = await new Dropper().open();
      const picked = parseHexColor(result.sRGBHex);
      if (picked) setColor(picked, true);
    } catch {
      // The person cancelled the eyedropper.
    }
  };

  return (
    <div className={cx("sb-colorpicker", className)}>
      <SaturationPad hsva={hsva} onChange={(s, v) => update({ s, v })} onCommit={commit} />
      <div className="sb-colorpicker__controls">
        {Dropper && (
          <IconButton size="sm" variant="secondary" icon={<Pipette size={13} />} label="Pick a color from the screen" onClick={pickFromScreen} />
        )}
        <div className="sb-colorpicker__sliders">
          <ColorSlider
            label="Hue"
            value={hsva.h / 360}
            valueText={`${Math.round(hsva.h)}°`}
            className="sb-colorpicker__hue"
            thumbColor={`hsl(${hsva.h} 100% 50%)`}
            onChange={(t) => update({ h: Math.min(359.999, t * 360) })}
            onCommit={commit}
          />
          {showAlpha && (
            <ColorSlider
              label="Opacity"
              value={hsva.a}
              valueText={`${Math.round(hsva.a * 100)}%`}
              className="sb-colorpicker__alpha sb-checker"
              trackStyle={{ "--sb-alpha-color": opaque } as CSSProperties}
              thumbColor={toCssColor(rgba)}
              onChange={(a) => update({ a })}
              onCommit={commit}
            />
          )}
        </div>
      </div>

      <div className="sb-colorpicker__fields">
        <SegmentedControl
          size="sm"
          aria-label="Color format"
          value={mode}
          onChange={setMode}
          options={[
            { value: "hex", label: "Hex" },
            { value: "rgb", label: "RGB" },
            { value: "hsb", label: "HSB" },
          ]}
        />
        <div className="sb-colorpicker__row" data-mode={mode}>
          {mode === "hex" && <HexInput color={rgba} onCommit={(color, hasAlpha) => setColor(color, !hasAlpha)} />}
          {mode === "rgb" &&
            (["r", "g", "b"] as const).map((channel) => (
              <ScrubNumberField
                key={channel}
                size="sm"
                label={channel.toUpperCase()}
                aria-label={channel === "r" ? "Red" : channel === "g" ? "Green" : "Blue"}
                value={Math.round(rgba[channel] * 255)}
                min={0}
                max={255}
                precision={0}
                pointerLock={false}
                onChange={(next) => emit(mergeHsva(hsvaRef.current, rgbaToHsva({ ...hsvaToRgba(hsvaRef.current), [channel]: next / 255 })))}
                onCommit={commit}
              />
            ))}
          {mode === "hsb" && (
            <>
              <ScrubNumberField size="sm" label="H" aria-label="Hue" unit="°" value={Math.round(hsva.h)} min={0} max={360} precision={0} pointerLock={false} onChange={(h) => update({ h: h % 360 })} onCommit={commit} />
              <ScrubNumberField size="sm" label="S" aria-label="Saturation" unit="%" scale={100} value={hsva.s} min={0} max={1} step={0.01} precision={0} pointerLock={false} onChange={(s) => update({ s })} onCommit={commit} />
              <ScrubNumberField size="sm" label="B" aria-label="Brightness" unit="%" scale={100} value={hsva.v} min={0} max={1} step={0.01} precision={0} pointerLock={false} onChange={(v) => update({ v })} onCommit={commit} />
            </>
          )}
          {showAlpha && (
            <ScrubNumberField
              size="sm"
              aria-label="Opacity"
              unit="%"
              scale={100}
              value={hsva.a}
              min={0}
              max={1}
              step={0.01}
              precision={0}
              pointerLock={false}
              className="sb-colorpicker__alpha-field"
              onChange={(a) => update({ a })}
              onCommit={commit}
            />
          )}
        </div>
      </div>

      {swatches.length > 0 && (
        <div className="sb-colorpicker__swatches" role="group" aria-label="Swatches">
          {swatches.map((swatch) => {
            const color = parseHexColor(swatch);
            if (!color) return null;
            const selected = toHex8(color) === toHex8(rgba);
            return (
              <button
                key={swatch}
                type="button"
                className="sb-colorpicker__swatch sb-checker"
                aria-label={`Use ${toHex8(color)}`}
                aria-pressed={selected}
                data-selected={selected || undefined}
                onClick={() => setColor(color)}
              >
                <span style={{ background: toCssColor(color) }} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SaturationPad({ hsva, onChange, onCommit }: { hsva: HSVA; onChange: (s: number, v: number) => void; onCommit: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = usePointerDrag<HTMLDivElement>({
    onMove: (event: PointerEvent<HTMLDivElement>) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      onChange(clamp01((event.clientX - rect.left) / rect.width), 1 - clamp01((event.clientY - rect.top) / rect.height));
    },
    onEnd: () => onCommit(),
  });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.01;
    let { s, v } = hsva;
    if (event.key === "ArrowLeft") s -= step;
    else if (event.key === "ArrowRight") s += step;
    else if (event.key === "ArrowUp") v += step;
    else if (event.key === "ArrowDown") v -= step;
    else return;
    event.preventDefault();
    onChange(clamp01(s), clamp01(v));
    onCommit();
  };
  return (
    <div
      ref={ref}
      className="sb-colorpicker__pad"
      style={{ "--sb-pad-hue": `hsl(${hsva.h} 100% 50%)` } as CSSProperties}
      role="slider"
      tabIndex={0}
      aria-label="Saturation and brightness"
      aria-valuenow={Math.round(hsva.s * 100)}
      aria-valuetext={`Saturation ${Math.round(hsva.s * 100)}%, brightness ${Math.round(hsva.v * 100)}%`}
      onKeyDown={onKeyDown}
      {...drag}
    >
      <span
        className="sb-colorpicker__pad-thumb"
        style={{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%`, background: toCssColor({ ...hsvaToRgba(hsva), a: 1 }) }}
      />
    </div>
  );
}

interface ColorSliderProps {
  label: string;
  value: number;
  valueText: string;
  className?: string;
  trackStyle?: CSSProperties;
  thumbColor: string;
  onChange: (value: number) => void;
  onCommit: () => void;
}

function ColorSlider({ label, value, valueText, className, trackStyle, thumbColor, onChange, onCommit }: ColorSliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = usePointerDrag<HTMLDivElement>({
    onMove: (event: PointerEvent<HTMLDivElement>) => {
      const rect = ref.current?.getBoundingClientRect();
      if (rect) onChange(clamp01((event.clientX - rect.left) / rect.width));
    },
    onEnd: () => onCommit(),
  });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.01;
    let next = value;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next += step;
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next -= step;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 1;
    else return;
    event.preventDefault();
    onChange(clamp01(next));
    onCommit();
  };
  return (
    <div
      ref={ref}
      className={cx("sb-colorpicker__slider", className)}
      style={trackStyle}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={valueText}
      onKeyDown={onKeyDown}
      {...drag}
    >
      <span className="sb-colorpicker__slider-fill" aria-hidden />
      <span className="sb-colorpicker__slider-thumb" style={{ left: `${value * 100}%`, background: thumbColor }} />
    </div>
  );
}

function HexInput({ color, onCommit }: { color: Color; onCommit: (color: Color, hasAlpha: boolean) => void }) {
  const hex = toHex6(color).slice(1);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const text = draft.trim().replace(/^#/, "");
    const parsed = parseHexColor(text);
    setDraft(null);
    if (parsed) onCommit(parsed, text.length === 4 || text.length === 8);
  };
  return (
    <TextField
      size="sm"
      mono
      aria-label="Hex color"
      containerClassName="sb-colorpicker__hex"
      leading={<span className="sb-colorpicker__hash">#</span>}
      value={draft ?? hex}
      maxLength={9}
      onFocus={(event) => {
        setDraft(hex);
        const el = event.currentTarget;
        requestAnimationFrame(() => el.select());
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onCommit={commit}
      onCancel={() => setDraft(null)}
    />
  );
}
