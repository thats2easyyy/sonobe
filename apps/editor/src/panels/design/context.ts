/**
 * What the Design with Claude box tells the Assistant about the canvas: the component, its screens,
 * the layer the person picked to redesign, and the style digest of what's there.
 */

import type { EditorSession } from "../../state/session.ts";
import type { AssistantCanvasContext } from "../assistant/types.ts";
import type { DesignData } from "./designStore.ts";

export interface DesignTarget { id: string; name: string; type: string; isResult: boolean }

/** One selected layer (unless newScreen), else null. isResult: it's the screen Claude just made. */
export function designTarget(_session: EditorSession, _design: Pick<DesignData, "newScreen" | "result">): DesignTarget | null {
  throw new Error("not implemented");
}

export function canvasContext(_session: EditorSession, _target: DesignTarget | null, _bounds: (id: string) => { x: number; y: number; width: number; height: number } | null): AssistantCanvasContext {
  throw new Error("not implemented");
}
