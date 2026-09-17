/**
 * The canvas overlay, drawn in screen space so lines stay crisp at any zoom: hover and selection
 * outlines, handles and the rotation knob, smart guides and measurements, the marquee, insert
 * previews, and layout drop markers.
 */

import type { Id } from "@sonobe/core";
import type { ReactNode } from "react";
import { nodeQuad, type Point, type Rect } from "./geometry.ts";
import type { SelectionChrome } from "./handles.ts";
import type { InsertTool } from "./ops.ts";
import type { CanvasIndex } from "./sceneIndex.ts";
import { formatMeasurement, type Guide, type Measurement, type SpacingMark } from "./snapping.ts";
import { artboardToScreen, rectToScreen, type Viewport } from "./viewport.ts";

export interface OverlayDropTarget {
  /** The container that receives dropped files (artboard space). */
  rect: Rect;
  /** Where the pointer is (artboard space). */
  at: Point;
  label: string;
}

export interface OverlayDraft {
  guides: Guide[];
  measurements: Measurement[];
  /** Equal gaps between siblings while moving. */
  spacing?: SpacingMark[];
  /** Files being dragged over the canvas. */
  dropTarget?: OverlayDropTarget | null;
  marquee: Rect | null;
  insert: { tool: InsertTool; rect: Rect } | null;
  drop: { line: [Point, Point] | null; ghost: Rect } | null;
  /** A pill label at an artboard point (rotation angle, drawn size). */
  label: { text: string; at: Point } | null;
  /** Hide handles and the size label (while moving). */
  hideChrome: boolean;
}

export const EMPTY_DRAFT: OverlayDraft = { guides: [], measurements: [], marquee: null, insert: null, drop: null, label: null, hideChrome: false };

export interface CanvasOverlayProps {
  index: CanvasIndex;
  viewport: Viewport;
  selected: readonly Id[];
  hovered: Id | null;
  chrome: SelectionChrome | null;
  draft: OverlayDraft;
  /** ⌥ distances from the selection to the hovered layer. */
  altMeasure?: readonly Measurement[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Snap a coordinate to the pixel grid for 1px lines. */
const crisp = (n: number) => Math.round(n) + 0.5;
const points = (q: readonly (readonly number[])[]) => q.map((p) => `${r2(p[0]!)},${r2(p[1]!)}`).join(" ");

export function CanvasOverlay({ index, viewport, selected, hovered, chrome, draft, altMeasure = [] }: CanvasOverlayProps) {
  const toScreen = (p: Point) => artboardToScreen(viewport, p);
  const quads = (id: Id) => (index.entry(id)?.nodes ?? []).map((n) => nodeQuad(n).map(toScreen));
  const pills: ReactNode[] = [];

  const guides = draft.guides.map((g, i) => {
    const a = toScreen(g.axis === "x" ? [g.at, g.from] : [g.from, g.at]);
    const b = toScreen(g.axis === "x" ? [g.at, g.to] : [g.to, g.at]);
    return g.axis === "x" ? <line key={`g${i}`} className="sb-cv__guide" x1={crisp(a[0])} y1={a[1]} x2={crisp(a[0])} y2={b[1]} /> : <line key={`g${i}`} className="sb-cv__guide" x1={a[0]} y1={crisp(a[1])} x2={b[0]} y2={crisp(a[1])} />;
  });

  const measurements = [...draft.measurements, ...altMeasure].map((m, i) => {
    const a = toScreen(m.from);
    const b = toScreen(m.to);
    const tick = 4;
    const horizontal = m.axis === "x";
    const y = crisp(a[1]);
    const x = crisp(a[0]);
    pills.push(
      <div key={`m${i}`} className="sb-cv__pill" data-tone="guide" style={{ left: (a[0] + b[0]) / 2, top: (a[1] + b[1]) / 2 }}>
        {formatMeasurement(m.value)}
      </div>,
    );
    return horizontal ? (
      <g key={`m${i}`} className="sb-cv__measure">
        <line x1={a[0]} y1={y} x2={b[0]} y2={y} />
        <line x1={crisp(a[0])} y1={y - tick} x2={crisp(a[0])} y2={y + tick} />
        <line x1={crisp(b[0])} y1={y - tick} x2={crisp(b[0])} y2={y + tick} />
      </g>
    ) : (
      <g key={`m${i}`} className="sb-cv__measure">
        <line x1={x} y1={a[1]} x2={x} y2={b[1]} />
        <line x1={x - tick} y1={crisp(a[1])} x2={x + tick} y2={crisp(a[1])} />
        <line x1={x - tick} y1={crisp(b[1])} x2={x + tick} y2={crisp(b[1])} />
      </g>
    );
  });

  const spacing = (draft.spacing ?? []).map((mark, i) => {
    const s = rectToScreen(viewport, mark.rect);
    const tick = 3;
    const horizontal = mark.axis === "x";
    const cx = s.x + s.width / 2;
    const cy = s.y + s.height / 2;
    pills.push(
      <div key={`sp${i}`} className="sb-cv__pill" data-tone="guide" style={{ left: cx, top: cy }}>
        {formatMeasurement(mark.value)}
      </div>,
    );
    return (
      <g key={`sp${i}`} className="sb-cv__spacing">
        <rect x={s.x} y={s.y} width={Math.max(0, s.width)} height={Math.max(0, s.height)} />
        {horizontal ? (
          <>
            <line x1={s.x} y1={crisp(cy)} x2={s.x + s.width} y2={crisp(cy)} />
            <line x1={crisp(s.x)} y1={cy - tick} x2={crisp(s.x)} y2={cy + tick} />
            <line x1={crisp(s.x + s.width)} y1={cy - tick} x2={crisp(s.x + s.width)} y2={cy + tick} />
          </>
        ) : (
          <>
            <line x1={crisp(cx)} y1={s.y} x2={crisp(cx)} y2={s.y + s.height} />
            <line x1={cx - tick} y1={crisp(s.y)} x2={cx + tick} y2={crisp(s.y)} />
            <line x1={cx - tick} y1={crisp(s.y + s.height)} x2={cx + tick} y2={crisp(s.y + s.height)} />
          </>
        )}
      </g>
    );
  });

  const dropTarget = draft.dropTarget ? { rect: rectToScreen(viewport, draft.dropTarget.rect), at: toScreen(draft.dropTarget.at), label: draft.dropTarget.label } : null;
  if (dropTarget) {
    pills.push(
      <div key="drop" className="sb-cv__drop-label" style={{ left: dropTarget.at[0], top: dropTarget.at[1] + 18 }}>
        {dropTarget.label}
      </div>,
    );
  }

  if (chrome && !draft.hideChrome) {
    const bottom = Math.max(...chrome.quad.map((p) => p[1]));
    const centerX = chrome.quad.reduce((sum, p) => sum + p[0], 0) / 4;
    pills.push(
      <div key="size" className="sb-cv__pill" data-tone="selection" style={{ left: centerX, top: bottom + 8 }}>
        {chrome.sizeLabel}
      </div>,
    );
  }
  if (draft.label) {
    const at = toScreen(draft.label.at);
    pills.push(
      <div key="label" className="sb-cv__pill" data-tone="selection" style={{ left: at[0], top: at[1] + 10 }}>
        {draft.label.text}
      </div>,
    );
  }

  const marquee = draft.marquee ? rectToScreen(viewport, draft.marquee) : null;
  const insert = draft.insert ? { tool: draft.insert.tool, rect: rectToScreen(viewport, draft.insert.rect) } : null;
  const ghost = draft.drop ? rectToScreen(viewport, draft.drop.ghost) : null;
  const dropLine = draft.drop?.line ? draft.drop.line.map(toScreen) : null;

  return (
    <>
      <svg className="sb-cv__overlay" aria-hidden>
        {hovered && !selected.includes(hovered) && quads(hovered).map((q, i) => <polygon key={`h${i}`} className="sb-cv__hover" points={points(q)} />)}
        {selected.map((id) => quads(id).map((q, i) => <polygon key={`s${id}#${i}`} className="sb-cv__outline" points={points(q)} />))}
        {chrome && !draft.hideChrome && (
          <g>
            <polygon className="sb-cv__frame" points={points(chrome.quad)} />
            {chrome.knob && (
              <>
                <line className="sb-cv__knob-line" x1={chrome.knob.base[0]} y1={chrome.knob.base[1]} x2={chrome.knob.point[0]} y2={chrome.knob.point[1]} />
                <circle className="sb-cv__knob" cx={chrome.knob.point[0]} cy={chrome.knob.point[1]} r={4.5} />
              </>
            )}
            {chrome.handles.map((h) => (
              <rect
                key={h.handle}
                className="sb-cv__handle"
                x={r2(h.point[0] - 4)}
                y={r2(h.point[1] - 4)}
                width={8}
                height={8}
                rx={1.5}
                transform={Math.abs(chrome.angle) > 0.01 ? `rotate(${r2(chrome.angle)} ${r2(h.point[0])} ${r2(h.point[1])})` : undefined}
              />
            ))}
          </g>
        )}
        {guides}
        {spacing}
        {measurements}
        {dropTarget && <rect className="sb-cv__drop-target" x={crisp(dropTarget.rect.x)} y={crisp(dropTarget.rect.y)} width={Math.round(dropTarget.rect.width)} height={Math.round(dropTarget.rect.height)} rx={2} />}
        {marquee && <rect className="sb-cv__marquee" x={crisp(marquee.x)} y={crisp(marquee.y)} width={Math.round(marquee.width)} height={Math.round(marquee.height)} />}
        {insert &&
          (insert.tool === "oval" ? (
            <ellipse className="sb-cv__insert" cx={insert.rect.x + insert.rect.width / 2} cy={insert.rect.y + insert.rect.height / 2} rx={insert.rect.width / 2} ry={insert.rect.height / 2} />
          ) : (
            <rect className="sb-cv__insert" data-tool={insert.tool} x={insert.rect.x} y={insert.rect.y} width={insert.rect.width} height={insert.rect.height} />
          ))}
        {ghost && <rect className="sb-cv__ghost" x={ghost.x} y={ghost.y} width={ghost.width} height={ghost.height} />}
        {dropLine && <line className="sb-cv__drop" x1={dropLine[0]![0]} y1={dropLine[0]![1]} x2={dropLine[1]![0]} y2={dropLine[1]![1]} />}
      </svg>
      {pills}
    </>
  );
}
