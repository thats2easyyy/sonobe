/** Inline text editing on the canvas: a textarea laid over the text layer with matching type. */

import type { SceneNode } from "@sonobe/engine";
import { cssColor, fontStack, parseColor } from "@sonobe/renderer";
import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent } from "react";
import type { Viewport } from "./viewport.ts";

export interface InlineTextEditorProps {
  node: SceneNode;
  viewport: Viewport;
  initialText: string;
  /** Select everything on open (a freshly inserted text layer). */
  selectAll?: boolean;
  /** Called once with the final text (blur, Escape, or ⌘Return). */
  onCommit: (text: string) => void;
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export function InlineTextEditor({ node, viewport, initialText, selectAll = false, onCommit }: InlineTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (selectAll) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
  }, [selectAll]);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    onCommit(ref.current?.value ?? initialText);
  };

  const p = node.props;
  const m = node.worldTransform;
  const z = viewport.zoom;
  const fontSize = num(p.fontSize, 17);
  const lineHeight = num(p.lineHeight, 0);
  const autoWidth = p.widthMode === "auto";
  const align = p.textAlignment;
  const transform = p.textTransform;
  const style: CSSProperties = {
    transform: `matrix(${m[0]! * z}, ${m[1]! * z}, ${m[4]! * z}, ${m[5]! * z}, ${m[12]! * z + viewport.x}, ${m[13]! * z + viewport.y})`,
    width: autoWidth ? undefined : node.width,
    minWidth: autoWidth ? Math.max(node.width, 8) : undefined,
    minHeight: node.height,
    fontFamily: fontStack(typeof p.fontFamily === "string" ? p.fontFamily : "Inter"),
    fontSize,
    fontWeight: num(p.fontWeight, 400),
    fontStyle: p.italic === true ? "italic" : undefined,
    letterSpacing: num(p.letterSpacing, 0),
    lineHeight: lineHeight > 0 ? `${lineHeight}px` : `${Math.round(fontSize * 1.2 * 100) / 100}px`,
    color: cssColor(parseColor(p.textColor) ?? { r: 0, g: 0, b: 0, a: 1 }),
    textAlign: align === "center" || align === "right" || align === "justify" ? align : "left",
    textTransform: transform === "uppercase" || transform === "lowercase" || transform === "capitalize" ? transform : undefined,
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) {
      event.preventDefault();
      finish();
    }
  };

  return (
    <textarea
      ref={ref}
      className="sb-cv__text-editor"
      data-auto-width={autoWidth || undefined}
      aria-label="Edit text. Press Escape to finish."
      defaultValue={initialText}
      spellCheck={false}
      style={style}
      onBlur={finish}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );
}
