/**
 * In-node literal editors for unconnected inputs: scrub or type numbers, toggle booleans, pick
 * options, layers, and colors, edit text. Each change is one undoable setInput; scrubbing merges
 * into a single history step. Inputs a knob drives show the knob's chip instead.
 */

import { allLayers, decodeInput, defaultValue, encodeValue, formatColor, isColor, isDecodedLoop, type Value } from "@sonobe/core";
import { ChevronDown } from "lucide-react";
import { memo, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useStore } from "zustand";
import { ColorPicker } from "../../../ui/ColorPicker.tsx";
import { useContextMenu, type MenuEntry } from "../../../ui/Menu.tsx";
import { Popover } from "../../../ui/Popover.tsx";
import { createScrubSession, formatNumber, nudgeValue, parseNumberInput, type ScrubSession } from "../../../ui/lib/scrubMath.ts";
import { formatNumberShort, formatValue, shortHex } from "@sonobe/core/graph";
import { showKnobs } from "../../knobs/knobsStore.ts";
import type { PortModel } from "../model/types.ts";
import { usePatchEditor } from "../state/context.ts";

const stop = (event: { stopPropagation(): void }) => event.stopPropagation();

function currentValue(port: PortModel): Value {
  if (port.literal !== undefined) {
    const decoded = decodeInput(port.literal, port.type);
    if (decoded !== undefined && !isDecodedLoop(decoded)) return decoded;
  }
  return port.defaultValue ?? defaultValue(port.type);
}

/** The editor for an unconnected input. */
export const InlineValue = memo(function InlineValue({ port }: { port: PortModel }) {
  const decoded = port.literal !== undefined ? decodeInput(port.literal, port.type) : undefined;
  if (isDecodedLoop(decoded)) return <span className="sb-pe-value sb-pe-value--static sb-tabular">×{decoded.items.length}</span>;
  switch (port.type) {
    case "number":
    case "index":
      return <NumberValue port={port} />;
    case "boolean":
      return <BooleanValue port={port} />;
    case "enum":
      return <EnumValue port={port} />;
    case "color":
      return <ColorValue port={port} />;
    case "text":
      return <TextValue port={port} />;
    case "point":
    case "size":
    case "anchor":
    case "point3d":
    case "point4d":
      return <VectorValue port={port} />;
    case "layer":
      return <LayerValue port={port} />;
    case "pulse":
      return null;
    default: {
      const text = formatValue(currentValue(port), port.type, { maxText: 10 });
      return text === "—" ? null : <span className="sb-pe-value sb-pe-value--static">{text}</span>;
    }
  }
});

/**
 * An input a knob drives: a chip with the knob's name and running value instead of a cable (the node
 * size model in @sonobe/core/graph sizes it: 5 each side, a 10 pt glyph, 4 between the parts, the
 * name in the 10 pt sans and the value in the 10 pt mono, at most 110 wide). Clicking it shows the
 * knob in the Inspector's Knobs tab.
 */
export const KnobChip = memo(function KnobChip({ knob }: { knob: NonNullable<PortModel["knob"]> }) {
  const { session } = usePatchEditor();
  return (
    <button
      type="button"
      className="sb-pe-value sb-pe-value--knob nodrag nopan"
      aria-label={`Knob ${knob.name}${knob.valueText ? `, ${knob.valueText}` : ""}. Show it in Knobs`}
      onPointerDown={stop}
      onDoubleClick={stop}
      onClick={(event) => {
        event.stopPropagation();
        showKnobs(session, knob.id);
      }}
    >
      <svg className="sb-pe-value__knob" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="1.25" />
        <circle cx="5" cy="5" r="1.75" fill="currentColor" />
      </svg>
      <span className="sb-pe-value__name">{knob.name}</span>
      {knob.valueText && <span className="sb-pe-value__knob-value sb-tabular">{knob.valueText}</span>}
    </button>
  );
});

interface ScrubProps {
  value: number;
  port: PortModel;
  onChange: (value: number, coalesce: boolean) => void;
  "aria-label": string;
  isDefault: boolean;
  compact?: boolean;
}

/** A number chip: drag to scrub (⇧ ×10, ⌥ ×0.1), click to type, arrows to nudge, ⌥-click to reset. */
function ScrubChip({ value, port, onChange, "aria-label": ariaLabel, isDefault, compact = false }: ScrubProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const gesture = useRef<{ id: number; startX: number; lastX: number; moved: boolean; session: ScrubSession | null } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const integer = port.type === "index";
  const step = port.step ?? (integer ? 1 : Math.abs(value) < 2 && port.max !== undefined && port.max <= 1 ? 0.01 : 1);
  const { actions } = usePatchEditor();

  useLayoutEffect(() => {
    if (editing !== null) inputRef.current?.select();
  }, [editing !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const emit = (next: number, coalesce: boolean) => onChange(integer ? Math.max(0, Math.round(next)) : next, coalesce);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    if (event.altKey && port.literal !== undefined) {
      event.preventDefault();
      actions.setLiteral(port.address, null);
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    gesture.current = { id: event.pointerId, startX: event.clientX, lastX: event.clientX, moved: false, session: null };
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    if (!g.moved) {
      if (Math.abs(event.clientX - g.startX) < 3) return;
      g.moved = true;
      g.lastX = g.startX;
      g.session = createScrubSession({ startValue: value, step, min: port.min, max: port.max, pixelsPerStep: 2 });
      setScrubbing(true);
      document.documentElement.setAttribute("data-scrubbing", "");
    }
    const dx = event.clientX - g.lastX;
    g.lastX = event.clientX;
    emit(g.session!.move(dx, event), true);
  };
  const finish = (event: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    gesture.current = null;
    document.documentElement.removeAttribute("data-scrubbing");
    if (g.moved) setScrubbing(false);
    else setEditing(formatNumber(value, 4));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") commit();
    else if (event.key === "Escape") setEditing(null);
    else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = nudgeValue(value, event.key === "ArrowUp" ? 1 : -1, { step, min: port.min, max: port.max, modifiers: event });
      emit(next, false);
      setEditing(formatNumber(integer ? Math.round(next) : next, 4));
    }
  };
  const commit = () => {
    if (editing === null) return;
    const parsed = parseNumberInput(editing);
    setEditing(null);
    if (parsed === null) return;
    const clamped = Math.min(port.max ?? Infinity, Math.max(port.min ?? -Infinity, parsed));
    if (clamped !== value || port.literal === undefined) emit(clamped, false);
  };

  if (editing !== null) {
    return (
      <input
        ref={inputRef}
        className="sb-pe-value sb-pe-value--input nodrag nopan nowheel sb-tabular"
        data-compact={compact || undefined}
        aria-label={ariaLabel}
        value={editing}
        spellCheck={false}
        onChange={(e) => setEditing(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        onPointerDown={stop}
        onDoubleClick={stop}
      />
    );
  }
  return (
    <button
      type="button"
      className="sb-pe-value sb-pe-value--scrub nodrag nopan sb-tabular"
      data-default={isDefault || undefined}
      data-scrubbing={scrubbing || undefined}
      data-compact={compact || undefined}
      aria-label={`${ariaLabel}: ${formatNumberShort(value)}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={stop}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.stopPropagation();
          setEditing(formatNumber(value, 4));
        }
      }}
    >
      {formatNumberShort(value)}
    </button>
  );
}

function NumberValue({ port }: { port: PortModel }) {
  const { actions } = usePatchEditor();
  const value = Number(currentValue(port)) || 0;
  return <ScrubChip value={value} port={port} isDefault={port.literal === undefined} aria-label={port.name} onChange={(next, coalesce) => actions.setLiteral(port.address, next, { coalesce })} />;
}

const AXES: Record<string, string[]> = { point: ["X", "Y"], size: ["W", "H"], anchor: ["X", "Y"], point3d: ["X", "Y", "Z"], point4d: ["A", "B", "C", "D"] };

function VectorValue({ port }: { port: PortModel }) {
  const { actions } = usePatchEditor();
  const raw = currentValue(port);
  const values = Array.isArray(raw) ? (raw as number[]) : [];
  const axes = AXES[port.type] ?? [];
  return (
    <span className="sb-pe-vector">
      {axes.map((axis, i) => (
        <ScrubChip
          key={axis}
          compact
          value={values[i] ?? 0}
          port={{ ...port, step: port.type === "anchor" ? 0.05 : port.step }}
          isDefault={port.literal === undefined}
          aria-label={`${port.name} ${axis}`}
          onChange={(next, coalesce) => {
            const out = axes.map((_, j) => (j === i ? next : (values[j] ?? 0)));
            actions.setLiteral(port.address, out, { coalesce });
          }}
        />
      ))}
    </span>
  );
}

function BooleanValue({ port }: { port: PortModel }) {
  const { actions } = usePatchEditor();
  const on = currentValue(port) === true;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={port.name}
      className="sb-pe-check nodrag nopan"
      data-on={on || undefined}
      data-default={port.literal === undefined || undefined}
      onPointerDown={stop}
      onDoubleClick={stop}
      onClick={(e) => {
        e.stopPropagation();
        actions.setLiteral(port.address, !on);
      }}
    >
      <svg viewBox="0 0 10 10" aria-hidden>
        <path d="M2 5.2 L4.2 7.2 L8 2.8" />
      </svg>
    </button>
  );
}

function MenuChip({ label, ariaLabel, entries, isDefault, leading }: { label: string; ariaLabel: string; entries: () => MenuEntry[]; isDefault: boolean; leading?: ReactNode }) {
  const menu = useContextMenu();
  return (
    <>
      <button
        type="button"
        className="sb-pe-value sb-pe-value--menu nodrag nopan"
        data-default={isDefault || undefined}
        aria-label={`${ariaLabel}: ${label}`}
        aria-haspopup="menu"
        onPointerDown={stop}
        onDoubleClick={stop}
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          menu.openAt({ x: r.left, y: r.bottom + 2, width: 0, height: 0 }, entries(), e.currentTarget);
        }}
      >
        {leading}
        <span className="sb-pe-value__text">{label}</span>
        <ChevronDown size={10} strokeWidth={2.25} aria-hidden />
      </button>
      {menu.element}
    </>
  );
}

function EnumValue({ port }: { port: PortModel }) {
  const { actions } = usePatchEditor();
  const key = String(currentValue(port) ?? "");
  const options = port.enumOptions ?? [];
  const name = options.find((o) => o.key === key)?.name ?? key;
  return (
    <MenuChip
      label={name || "—"}
      ariaLabel={port.name}
      isDefault={port.literal === undefined}
      entries={() => options.map((o): MenuEntry => ({ id: o.key, label: o.name, checked: o.key === key, ...(o.description ? { description: o.description } : {}), onSelect: () => actions.setLiteral(port.address, o.key) }))}
    />
  );
}

function LayerValue({ port }: { port: PortModel }) {
  const { actions, session, componentId } = usePatchEditor();
  const value = currentValue(port) as { layerId?: string } | null;
  const layerId = value && typeof value === "object" ? value.layerId : undefined;
  const name = useStore(session.document, (s) => (layerId ? allLayers(s.doc.components[componentId]?.layers ?? []).find((l) => l.id === layerId)?.name : undefined));
  return (
    <MenuChip
      label={name ?? (layerId ? "Missing layer" : "None")}
      ariaLabel={port.name}
      isDefault={!layerId}
      entries={() => {
        const layers = allLayers(session.document.getState().doc.components[componentId]?.layers ?? []);
        return [
          { id: "__none", label: "None", checked: !layerId, onSelect: () => actions.setLiteral(port.address, null) },
          { type: "separator" },
          ...layers.map((l): MenuEntry => ({ id: l.id, label: l.name, checked: l.id === layerId, onSelect: () => actions.setLiteral(port.address, { layer: l.id }) })),
        ];
      }}
    />
  );
}

function ColorValue({ port }: { port: PortModel }) {
  const { actions } = usePatchEditor();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const raw = currentValue(port);
  const color = isColor(raw) ? raw : { r: 0, g: 0, b: 0, a: 1 };
  const hex = formatColor(color);
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        className="sb-pe-value sb-pe-value--color nodrag nopan"
        data-default={port.literal === undefined || undefined}
        aria-label={`${port.name}: ${shortHex(color)}`}
        onPointerDown={stop}
        onDoubleClick={stop}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <span className="sb-pe-swatch sb-checker" aria-hidden>
          <span style={{ background: `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${color.a})` }} />
        </span>
        <span className="sb-pe-value__text sb-tabular">{shortHex(color).slice(1)}</span>
      </button>
      <Popover open={open} onOpenChange={setOpen} anchor={anchor} placement="bottom-start" offset={6} aria-label={`${port.name} color`} className="sb-pe-colorpop">
        <ColorPicker value={hex} onChange={(next) => actions.setLiteral(port.address, encodeValue(next, "color"), { coalesce: true })} onCommit={(next) => actions.setLiteral(port.address, encodeValue(next, "color"), { coalesce: true })} />
      </Popover>
    </>
  );
}

function TextValue({ port }: { port: PortModel }) {
  const { actions } = usePatchEditor();
  const text = String(currentValue(port) ?? "");
  const [editing, setEditing] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (editing !== null) inputRef.current?.select();
  }, [editing !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    if (editing === null) return;
    const next = editing;
    setEditing(null);
    if (next !== text) actions.setLiteral(port.address, next);
  };
  if (editing !== null) {
    return (
      <input
        ref={inputRef}
        className="sb-pe-value sb-pe-value--input sb-pe-value--text nodrag nopan nowheel"
        aria-label={port.name}
        value={editing}
        spellCheck={false}
        onChange={(e) => setEditing(e.target.value)}
        onPointerDown={stop}
        onDoubleClick={stop}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(null);
        }}
        onBlur={commit}
      />
    );
  }
  return (
    <button
      type="button"
      className="sb-pe-value sb-pe-value--textchip nodrag nopan"
      data-default={port.literal === undefined || undefined}
      aria-label={`${port.name}: ${text}`}
      onPointerDown={stop}
      onDoubleClick={stop}
      onClick={(e) => {
        e.stopPropagation();
        setEditing(text);
      }}
    >
      <span className="sb-pe-value__text">{text ? text : <span className="sb-pe-value__placeholder">Empty</span>}</span>
    </button>
  );
}
