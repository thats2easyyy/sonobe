/**
 * The editor for a knob's running value, used by Knobs tab rows and by knob-driven fields in the
 * Inspector. Numbers get a slider over the knob's soft range (with ticks for the other presets) and
 * a field that also takes values past it; every other type uses the Inspector's own control for a
 * port shaped like the knob (knobAsPort), so declarations drive both.
 */

import { knobAsPort, knobZeroLiteral, type InputValue, type Knob, type Literal } from "@sonobe/core";
import { ScrubNumberField } from "../../ui/ScrubNumberField.tsx";
import { Slider, type SliderTick } from "../../ui/Slider.tsx";
import { decimalsOf } from "../../ui/lib/scrubMath.ts";
import { ValueControl, type FieldActions } from "../inspector/controls.tsx";
import { summarizeField, type FieldUpdate } from "../inspector/model.ts";
import { knobValueText, type KnobTickModel } from "./model.ts";
import type { KnobEdit } from "./useKnobEdit.ts";

export interface KnobControlProps {
  knob: Knob;
  value: Literal;
  edit: KnobEdit;
  /** Accessible name. Default: the knob's name. */
  label?: string;
  /** Read-only (the running preset is locked). */
  disabled?: boolean;
  /** Other presets' values, marked on the slider; clicking one copies it into the running preset. */
  ticks?: readonly KnobTickModel[];
  /** Only the number field, no slider (narrow Inspector rows). */
  compact?: boolean;
  /** ↑ and ↓ belong to the surrounding list (Knobs tab rows). */
  rowKeys?: boolean;
}

const hasSlider = (knob: Knob) => knob.type === "number" && knob.min !== undefined && knob.max !== undefined && knob.max > knob.min;

export function KnobControl({ knob, value, edit, label = knob.name, disabled = false, ticks = [], compact = false, rowKeys = false }: KnobControlProps) {
  if (knob.type === "number") {
    const n = typeof value === "number" ? value : 0;
    const step = knob.step;
    const unit = knob.unit;
    const precision = step !== undefined ? Math.min(6, decimalsOf(step) + 1) : 3;
    const slider = hasSlider(knob) && !compact;
    const tune = (next: number, continuous: boolean) => {
      if (!disabled) edit.tune(knob.id, next, continuous);
    };
    const sliderTicks: SliderTick[] = ticks
      .filter((t) => typeof t.value === "number")
      .map((t) => ({ value: t.value as number, label: `${t.name}: ${knobValueText(knob, t.value)}`, color: t.color, ...(disabled ? {} : { onSelect: () => edit.tune(knob.id, t.value) }) }));
    return (
      <div className="sb-knob-control" data-slider={slider || undefined}>
        {slider && (
          <Slider
            aria-label={label}
            value={n}
            min={knob.min!}
            max={knob.max!}
            {...(step !== undefined ? { step } : {})}
            ticks={sliderTicks}
            valueText={(v) => knobValueText(knob, v)}
            arrowKeys={rowKeys ? "horizontal" : "both"}
            disabled={disabled}
            onChange={(next) => tune(next, true)}
            onCommit={() => edit.end()}
          />
        )}
        <ScrubNumberField
          size="sm"
          className="sb-knob-control__field"
          aria-label={slider ? `${label} value` : label}
          value={n}
          {...(knob.min !== undefined ? { min: knob.min } : {})}
          {...(knob.max !== undefined ? { max: knob.max } : {})}
          softRange
          step={step ?? 1}
          precision={precision}
          {...(unit ? { unit } : {})}
          disabled={disabled}
          onChange={(next, meta) => tune(next, meta.source === "scrub")}
          onCommit={() => edit.end()}
        />
      </div>
    );
  }
  // Points keep a soft range too: their fields don't clamp what's typed.
  const { min: _min, max: _max, ...port } = knobAsPort(knob);
  const shaped = knob.type === "point" ? port : knobAsPort(knob);
  const field = summarizeField(shaped, [{ id: knob.id, address: `$knob.${knob.id}`, stored: value, fallback: knobZeroLiteral(knob) }]);
  const resolve = (update: FieldUpdate): InputValue => (typeof update === "function" ? update(value, 0) : update);
  const write = (update: FieldUpdate, continuous: boolean) => {
    if (disabled) return;
    const next = resolve(update);
    if (next !== null && next !== undefined) edit.tune(knob.id, next as Literal, continuous);
  };
  const actions: FieldActions = {
    change: (update) => write(update, true),
    set: (update) => write(update, false),
    commit: () => edit.end(),
    reset: () => undefined,
    disconnect: () => undefined,
  };
  return (
    <fieldset className="sb-knob-control" disabled={disabled}>
      <ValueControl field={field} actions={actions} label={label} />
    </fieldset>
  );
}
