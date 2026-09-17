/** Splicing a patch into a cable: which drags count (⌘-drag on macOS, Ctrl-drag on Windows and Linux). */

export interface SpliceModifiers {
  metaKey: boolean;
  ctrlKey: boolean;
}

/**
 * True when a drag may splice: ⌘ or Ctrl is held and exactly one patch is being dragged. A plain drag
 * only moves the patch, as in Origami since v91.
 */
export function isSpliceDrag(event: SpliceModifiers, dragged: readonly { type?: string }[]): boolean {
  return (event.metaKey || event.ctrlKey) && dragged.length === 1 && dragged[0]!.type === "patch";
}
