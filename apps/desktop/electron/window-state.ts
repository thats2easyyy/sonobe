import { atomicWriteFileSync, readJsonFile } from "./fs-utils.ts";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  /** x/y are omitted when the saved position isn't on any current display (center instead). */
  bounds: { x?: number; y?: number; width: number; height: number };
  maximized: boolean;
  fullScreen: boolean;
  /** Interface zoom factor (View › Interface Size). */
  zoomFactor: number;
}

export interface WindowStateDefaults {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

export const ZOOM_MIN = 0.67;
export const ZOOM_MAX = 2;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function intersection(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)),
  };
}

/**
 * Validate saved window state against the current displays. The window keeps its saved
 * position only when enough of its title bar (120×24 pt) is on some display's work area.
 */
export function resolveWindowState(saved: unknown, workAreas: readonly Rect[], defaults: WindowStateDefaults): WindowState {
  const s = saved && typeof saved === "object" ? (saved as Record<string, unknown>) : {};
  const b = s.bounds && typeof s.bounds === "object" ? (s.bounds as Record<string, unknown>) : {};

  const maxWidth = Math.max(defaults.minWidth, ...workAreas.map((a) => a.width));
  const maxHeight = Math.max(defaults.minHeight, ...workAreas.map((a) => a.height));
  const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)));

  const width = clamp(finite(b.width) ? b.width : Math.min(defaults.width, maxWidth), defaults.minWidth, maxWidth);
  const height = clamp(finite(b.height) ? b.height : Math.min(defaults.height, maxHeight), defaults.minHeight, maxHeight);
  const bounds: WindowState["bounds"] = { width, height };

  if (finite(b.x) && finite(b.y)) {
    const titleBar: Rect = { x: Math.round(b.x), y: Math.round(b.y), width, height: 24 };
    const visible = workAreas.some((area) => {
      const i = intersection(titleBar, area);
      return i.width >= Math.min(120, width) && i.height >= 24;
    });
    if (visible) {
      bounds.x = titleBar.x;
      bounds.y = titleBar.y;
    }
  }

  const zoom = finite(s.zoomFactor) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s.zoomFactor)) : 1;
  return { bounds, maximized: s.maximized === true, fullScreen: s.fullScreen === true, zoomFactor: zoom };
}

export async function loadWindowState(file: string, workAreas: readonly Rect[], defaults: WindowStateDefaults): Promise<WindowState> {
  return resolveWindowState(await readJsonFile(file), workAreas, defaults);
}

/** Synchronous so it can run from a window's close handler during quit. */
export function saveWindowStateSync(file: string, state: WindowState): void {
  atomicWriteFileSync(file, `${JSON.stringify({ version: 1, ...state }, null, 2)}\n`);
}
