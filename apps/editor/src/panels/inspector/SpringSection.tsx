/** Spring patches: perceptual presets, a live curve with a motion preview, and handoff code for engineers. */

import type { Id, PatchNode, PatchSpec } from "@sonobe/core";
import { springPreset, toDurationBounce, type SpringConfig, type SpringPresetKey } from "@sonobe/engine";
import { Copy, Play } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useSelection } from "../../state/EditorProvider.tsx";
import { currentComponentId } from "../../state/selection.ts";
import { IconButton } from "../../ui/IconButton.tsx";
import { TabPanel, Tabs } from "../../ui/Tabs.tsx";
import { toast } from "../../ui/Toast.tsx";
import { InspectorSection } from "./Section.tsx";
import { activePreset, handoffSnippets, planPreset, SPRING_INPUTS, SPRING_PRESETS, springConfigForNode, springCurveGeometry, type HandoffTarget } from "./spring.ts";
import { useInspectorEdit } from "./useInspectorEdit.ts";

export interface SpringSectionProps {
  patchId: Id;
  node: PatchNode;
  spec: PatchSpec;
  /** For undo labels. */
  subject: string;
}

const glyphs = new Map<SpringPresetKey, string>();

function presetGlyph(key: SpringPresetKey): string {
  let path = glyphs.get(key);
  if (!path) {
    path = springCurveGeometry(springPreset(key), 28, 14, 2).path;
    glyphs.set(key, path);
  }
  return path;
}

export function SpringSection({ patchId, node, spec, subject }: SpringSectionProps) {
  const edit = useInspectorEdit();
  const componentId = useSelection(currentComponentId);
  const reading = useMemo(() => springConfigForNode(node, spec), [node, spec]);
  const active = activePreset(node, spec);
  const [preview, setPreview] = useState<SpringPresetKey | null>(null);
  const buttons = useRef(new Map<SpringPresetKey, HTMLButtonElement>());
  if (!reading) return null;
  const described = SPRING_PRESETS.find((p) => p.key === (preview ?? active));
  const apply = (key: SpringPresetKey) => {
    const preset = SPRING_PRESETS.find((p) => p.key === key)!;
    edit.apply(planPreset(componentId, patchId, node.type, key), `Apply ${preset.name} spring to ${subject}`);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = Math.max(0, SPRING_PRESETS.findIndex((p) => p.key === active));
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % SPRING_PRESETS.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + SPRING_PRESETS.length) % SPRING_PRESETS.length;
    else return;
    event.preventDefault();
    const key = SPRING_PRESETS[next]!.key;
    apply(key);
    buttons.current.get(key)?.focus();
  };
  const linkedNames = reading.linked.map((key) => spec.inputs.find((p) => p.key === key)?.name ?? key);

  return (
    <InspectorSection id="patch.spring" title="Spring">
      <div className="sb-insp-presets" role="radiogroup" aria-label="Spring feel" onKeyDown={onKeyDown}>
        {SPRING_PRESETS.map((preset, i) => {
          const selected = preset.key === active;
          return (
            <button
              key={preset.key}
              ref={(el) => {
                if (el) buttons.current.set(preset.key, el);
                else buttons.current.delete(preset.key);
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected || (active === null && i === 0) ? 0 : -1}
              className="sb-insp-preset"
              data-selected={selected || undefined}
              onPointerEnter={() => setPreview(preset.key)}
              onPointerLeave={() => setPreview(null)}
              onFocus={() => setPreview(preset.key)}
              onBlur={() => setPreview(null)}
              onClick={() => apply(preset.key)}
            >
              <svg className="sb-insp-preset__glyph" viewBox="0 0 28 14" aria-hidden>
                <path d={presetGlyph(preset.key)} />
              </svg>
              <span className="sb-insp-preset__name">{preset.name}</span>
            </button>
          );
        })}
      </div>
      <p className="sb-insp-hint">{described ? described.description : "A custom spring. Pick a feel to start from a named preset."}</p>
      {linkedNames.length > 0 && (
        <p className="sb-insp-hint" data-tone="warn">
          {linkedNames.join(" and ")} {linkedNames.length === 1 ? "is" : "are"} driven by a patch, so the preview uses the default.
        </p>
      )}
      <SpringCurve config={reading.config} />
      <HandoffCode config={reading.config} />
    </InspectorSection>
  );
}

const CURVE_W = 240;
const CURVE_H = 84;

function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

/** The spring's 0 → 1 step response with settle time, overshoot, and a replayable motion preview. */
export function SpringCurve({ config }: { config: SpringConfig }) {
  const geometry = useMemo(() => springCurveGeometry(config, CURVE_W, CURVE_H), [config.mass, config.stiffness, config.damping]); // eslint-disable-line react-hooks/exhaustive-deps
  const [frame, setFrame] = useState<number | null>(null);
  const raf = useRef<number | null>(null);

  useEffect(() => () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
  }, []);

  const play = () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    const last = geometry.values.length - 1;
    if (prefersReducedMotion()) {
      setFrame(last);
      return;
    }
    const started = performance.now();
    const tick = (now: number) => {
      const next = Math.min(last, Math.floor(((now - started) / 1000) * 60));
      setFrame(next);
      raf.current = next < last ? requestAnimationFrame(tick) : null;
    };
    raf.current = requestAnimationFrame(tick);
  };

  const { duration, bounce } = toDurationBounce(config);
  const value = frame === null ? 0 : (geometry.values[frame] ?? 1);
  const settle = geometry.settleTime === null ? "doesn't settle" : `settles in ${geometry.settleTime.toFixed(2)} s`;
  const overshoot = Math.round(geometry.overshoot * 100);
  return (
    <div className="sb-spring">
      <svg className="sb-spring__svg" viewBox={`0 0 ${CURVE_W} ${CURVE_H}`} preserveAspectRatio="none" role="img" aria-label={`Spring curve: ${settle}, ${overshoot}% overshoot`}>
        <line className="sb-spring__guide" x1={0} x2={CURVE_W} y1={geometry.startY} y2={geometry.startY} />
        <line className="sb-spring__target" x1={0} x2={CURVE_W} y1={geometry.targetY} y2={geometry.targetY} />
        <path className="sb-spring__curve" d={geometry.path} vectorEffect="non-scaling-stroke" />
        {frame !== null && <circle className="sb-spring__dot" cx={geometry.x(frame / 60)} cy={geometry.y(value)} r={3} />}
      </svg>
      <div className="sb-spring__track" aria-hidden>
        <span className="sb-spring__runner" style={{ transform: `translateX(${value * 100}%)` } as CSSProperties}>
          <span className="sb-spring__ball" />
        </span>
      </div>
      <div className="sb-spring__meta">
        <span className="sb-spring__stats sb-tabular" title={`Duration ${duration.toFixed(2)} s · Bounce ${bounce.toFixed(2)}`}>
          {settle[0]!.toUpperCase() + settle.slice(1)} · {overshoot}% overshoot
        </span>
        <IconButton size="xs" icon={<Play size={12} />} label="Preview the motion" onClick={play} />
      </div>
    </div>
  );
}

/** Copyable spring code for SwiftUI, Android, CSS linear(), and motion. */
export function HandoffCode({ config }: { config: SpringConfig }) {
  const idBase = useId();
  const [tab, setTab] = useState<HandoffTarget>("swiftui");
  const snippets = useMemo(() => handoffSnippets(config), [config.mass, config.stiffness, config.damping]); // eslint-disable-line react-hooks/exhaustive-deps
  const copy = (code: string) => {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard) return;
    clipboard.writeText(code).then(
      () => toast({ id: "handoff-copied", title: "Copied spring code", tone: "success" }),
      () => toast({ id: "handoff-copied", title: "Couldn't copy to the clipboard", tone: "warn" }),
    );
  };
  return (
    <div className="sb-insp-handoff">
      <Tabs size="sm" variant="pill" aria-label="Handoff code" idBase={idBase} value={tab} onChange={setTab} items={snippets.map((s) => ({ value: s.id, label: s.label }))} />
      {snippets.map((snippet) => (
        <TabPanel key={snippet.id} idBase={idBase} value={snippet.id} active={tab === snippet.id} className="sb-insp-code">
          <pre className="sb-insp-code__pre sb-mono sb-selectable">{snippet.code}</pre>
          <IconButton size="xs" icon={<Copy size={12} />} label={`Copy ${snippet.label} code`} className="sb-insp-code__copy" onClick={() => copy(snippet.code)} />
        </TabPanel>
      ))}
    </div>
  );
}

export { SPRING_INPUTS };
