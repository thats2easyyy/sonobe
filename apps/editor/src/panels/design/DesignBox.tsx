/**
 * The Design with Claude box: floats at the bottom of the canvas, follows the selection (a new screen,
 * or a redesign of the selected layer), sends to the in-app Assistant with the canvas's context, and
 * shows what Claude is doing and what it made. Without the Assistant, it copies a prompt instead.
 */

import type { JSX } from "react";
import type { EditorSession } from "../../state/session.ts";
import type { Rect } from "../canvas/geometry.ts";

/** Renders when designStore.open. */
export function DesignBox(_props: { session: EditorSession; bounds(id: string): Rect | null }): JSX.Element | null {
  throw new Error("not implemented");
}
