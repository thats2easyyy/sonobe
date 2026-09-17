/**
 * What document the patch graph shows while someone scrubs a value or drags on the canvas. A gesture
 * commits a revision per pointer move, and every graph re-render costs React Flow a pass over every
 * node and cable. The pointer, the inspector and the viewer must never wait for that:
 *
 * - no gesture open: the current document.
 * - a graph of up to LARGE_GRAPH_NODES flow nodes: the current document at low priority
 *   (useDeferredValue), so it catches up between moves.
 * - a larger graph: the document as it was when the gesture began, then the current one as soon as
 *   the gesture ends. At a thousand patches one React Flow pass takes longer than a frame, so even a
 *   few passes a second make a scrub stutter.
 */

import { useDeferredValue, useRef } from "react";

/** Graphs with more flow nodes than this hold still during gestures. */
export const LARGE_GRAPH_NODES = 600;

/** Chooses the document the graph renders (see the module comment). */
export function gestureDocument<T>(live: T, deferred: T, settled: T, gestureOpen: boolean, largeGraph: boolean): T {
  if (!gestureOpen) return live;
  return largeGraph ? settled : deferred;
}

/** The document the graph should render during gestures (see the module comment). */
export function useGestureDocument<T>(live: T, gestureOpen: boolean, largeGraph: boolean): T {
  const deferred = useDeferredValue(live);
  /** The last document rendered with no gesture open: the one the gesture began from. */
  const settled = useRef(live);
  if (!gestureOpen) settled.current = live;
  return gestureDocument(live, deferred, settled.current, gestureOpen, largeGraph);
}
