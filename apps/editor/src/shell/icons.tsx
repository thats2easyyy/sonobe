import type { PatchCategory } from "@sonobe/core";
import {
  Blend,
  Boxes,
  Braces,
  Circle,
  Code,
  Component,
  Cpu,
  Film,
  GitBranch,
  Group,
  Image,
  Layers,
  Palette,
  PaintBucket,
  Pointer,
  Repeat,
  Shapes,
  Smartphone,
  Spline,
  Square,
  SquareDashed,
  SquareFunction,
  TextCursorInput,
  ToggleLeft,
  Type,
  Video,
  Waypoints,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/** Icon box sizes (px) and stroke: 16 toolbar, 14 headers, rails and rows, 12 inside chips. */
export const ICON_SIZE = { sm: 12, md: 14, lg: 16 } as const;
export const ICON_STROKE = 1.75;

/** One glyph per layer type, shared by the Layers panel and the patch editor. */
export const LAYER_TYPE_ICONS: Record<string, LucideIcon> = {
  group: Group,
  rectangle: Square,
  oval: Circle,
  text: Type,
  image: Image,
  video: Video,
  shape: Spline,
  colorFill: PaintBucket,
  gradient: Blend,
  hitArea: SquareDashed,
  textField: TextCursorInput,
  lottie: Film,
  shader: Cpu,
  clone: Boxes,
  componentInstance: Component,
};

export function LayerTypeIcon({ type, size = ICON_SIZE.md }: { type: string; size?: number }) {
  const Icon = LAYER_TYPE_ICONS[type] ?? Square;
  return <Icon size={size} strokeWidth={ICON_STROKE} />;
}

export const CATEGORY_ICONS: Record<PatchCategory, LucideIcon> = {
  interaction: Pointer,
  animation: Waypoints,
  state: ToggleLeft,
  logic: GitBranch,
  math: SquareFunction,
  loops: Repeat,
  text: Type,
  color: Palette,
  data: Braces,
  device: Smartphone,
  media: Image,
  shapes: Shapes,
  layers: Layers,
  utility: Wrench,
  components: Component,
  scripting: Code,
};

/** The Sonobe mark: a folded modular unit (two overlapping parallelograms). */
export function SonobeMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="sb-mark">
      <path d="M4 7.5 12 3l8 4.5-8 4.5z" fill="var(--accent)" />
      <path d="M4 7.5v9l8 4.5v-9z" fill="color-mix(in srgb, var(--accent) 62%, var(--bg-toolbar))" />
      <path d="M20 7.5v9l-8 4.5v-9z" fill="color-mix(in srgb, var(--ai) 85%, var(--bg-toolbar))" />
    </svg>
  );
}
