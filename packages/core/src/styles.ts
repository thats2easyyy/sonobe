/**
 * Style digest: the colors, fonts, font sizes, corner radii and shadows a component's layers use
 * most, counted from their explicit literal props. Pure and deterministic, so the canvas's Design
 * with Claude box, get_outline({ detail: "styles" }) and copied prompts all ground a new design
 * the same way.
 */

import type { Id, SonobeDocument } from "./types.ts";

export interface StyleDigest {
  component: Id;
  layers: number;
  /** At most 12, as "#RRGGBBAA". */
  colors: { value: string; uses: number; roles: ("fill" | "text" | "stroke" | "shadow" | "gradient")[] }[];
  /** At most 4. */
  fonts: { family: string; weights: number[]; uses: number }[];
  /** At most 8. */
  fontSizes: { size: number; uses: number }[];
  /** At most 6. */
  radii: { radius: number; uses: number }[];
  /** At most 3. */
  shadows: { color: string; radius: number; offset: [number, number]; opacity: number; uses: number }[];
}

/** The digest of `componentId` (default: the project's root component). */
export function styleDigest(_doc: SonobeDocument, _componentId?: Id): StyleDigest {
  throw new Error("not implemented");
}

/** The digest as a few lines of text ("styles main (64 layers)", then colors, fonts, sizes, radii, shadows). */
export function formatStyleDigest(_digest: StyleDigest): string {
  throw new Error("not implemented");
}
