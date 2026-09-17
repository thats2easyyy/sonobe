/**
 * Floating-element positioning for popovers, menus, submenus, and tooltips: place on a preferred
 * side, flip when the opposite side has more room, shift to stay inside the viewport, and report
 * the space available so content can scroll instead of overflowing.
 */

export type Side = "top" | "right" | "bottom" | "left";
export type Align = "start" | "center" | "end";
export type Placement = Side | `${Side}-start` | `${Side}-end`;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface PositionOptions {
  placement?: Placement;
  /** Gap between anchor and floating element. Default 6. */
  offset?: number;
  /** Minimum distance from viewport edges. Default 8. */
  padding?: number;
  /** Flip to the opposite side when it has more room. Default true. */
  flip?: boolean;
  /** Shift along the alignment axis (e.g. -4 to line a submenu's first item up with its parent). */
  crossOffset?: number;
}

export interface PositionResult {
  x: number;
  y: number;
  side: Side;
  align: Align;
  placement: Placement;
  maxWidth: number;
  maxHeight: number;
}

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

export function splitPlacement(placement: Placement): [Side, Align] {
  const [side, align] = placement.split("-") as [Side, Align | undefined];
  return [side, align ?? "center"];
}

const clampRange = (value: number, lo: number, hi: number) => (hi < lo ? lo : Math.min(hi, Math.max(lo, value)));

export function computePosition(anchor: Rect, floating: Size, viewport: Size, options: PositionOptions = {}): PositionResult {
  const offset = options.offset ?? 6;
  const padding = options.padding ?? 8;
  const [preferred, align] = splitPlacement(options.placement ?? "bottom-start");
  const space: Record<Side, number> = {
    top: anchor.y - offset - padding,
    bottom: viewport.height - anchor.y - anchor.height - offset - padding,
    left: anchor.x - offset - padding,
    right: viewport.width - anchor.x - anchor.width - offset - padding,
  };
  const vertical = (s: Side) => s === "top" || s === "bottom";
  const needed = (s: Side) => (vertical(s) ? floating.height : floating.width);

  let side = preferred;
  if (options.flip !== false && space[side] < needed(side) && space[OPPOSITE[side]] > space[side]) {
    side = OPPOSITE[side];
  }

  const maxHeight = Math.max(0, vertical(side) ? space[side] : viewport.height - padding * 2);
  const maxWidth = Math.max(0, vertical(side) ? viewport.width - padding * 2 : space[side]);
  const w = Math.min(floating.width, maxWidth);
  const h = Math.min(floating.height, maxHeight);
  const alignOn = (start: number, length: number, size: number) =>
    align === "start" ? start : align === "end" ? start + length - size : start + (length - size) / 2;

  let x: number;
  let y: number;
  const crossOffset = options.crossOffset ?? 0;
  if (vertical(side)) {
    y = side === "bottom" ? anchor.y + anchor.height + offset : anchor.y - offset - h;
    x = alignOn(anchor.x, anchor.width, w) + crossOffset;
  } else {
    x = side === "right" ? anchor.x + anchor.width + offset : anchor.x - offset - w;
    y = alignOn(anchor.y, anchor.height, h) + crossOffset;
  }
  x = clampRange(x, padding, viewport.width - padding - w);
  y = clampRange(y, padding, viewport.height - padding - h);

  return {
    x: Math.round(x),
    y: Math.round(y),
    side,
    align,
    placement: align === "center" ? side : `${side}-${align}`,
    maxWidth,
    maxHeight,
  };
}
