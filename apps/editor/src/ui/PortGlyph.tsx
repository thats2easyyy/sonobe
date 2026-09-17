import type { ValueType } from "@sonobe/core";
import type { CSSProperties } from "react";
import { PORT_GROUP_GLYPH, portColorVar, portGroup } from "../theme/tokens.ts";
import { cx } from "./lib/cx.ts";
import "./PortGlyph.css";

/** Plain-language names for value types (UI copy). */
export const VALUE_TYPE_LABELS: Record<ValueType, string> = {
  number: "Number",
  boolean: "On/Off",
  pulse: "Pulse",
  text: "Text",
  color: "Color",
  point: "Point",
  point3d: "Point 3D",
  point4d: "Point 4D",
  size: "Size",
  anchor: "Anchor",
  index: "Index",
  enum: "Option",
  json: "JSON",
  layer: "Layer",
  image: "Image",
  video: "Video",
  sound: "Sound",
  gradient: "Gradient",
  shape: "Shape",
  textStyle: "Text Style",
  layerEffect: "Effect",
  transform: "Transform",
  any: "Any",
};

export interface PortGlyphProps {
  type: ValueType | "variant";
  /** Connected ports are solid; unconnected ports are dimmed. */
  connected?: boolean;
  /** A true boolean or a firing pulse glows. */
  live?: boolean;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/** Port marker: color by value type, shape by structure (circle, pill, diamond, square, ring). */
export function PortGlyph({ type, connected = true, live = false, size = 9, className, style }: PortGlyphProps) {
  const group = portGroup(type);
  return (
    <span
      className={cx("sb-portglyph", className)}
      data-glyph={PORT_GROUP_GLYPH[group]}
      data-connected={connected || undefined}
      data-live={live || undefined}
      aria-hidden
      style={{ "--sb-port-color": portColorVar(type), "--sb-port-size": `${size}px`, ...style } as CSSProperties}
    />
  );
}
