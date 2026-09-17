import type { PatchCategory } from "@sonobe/core";
import {
  Blend,
  Braces,
  Circle,
  Code,
  Component,
  Copy,
  Film,
  GitBranch,
  Group,
  Image,
  Layers,
  Palette,
  PaintBucket,
  Pointer,
  Repeat,
  Scan,
  Shapes,
  Smartphone,
  Sparkle,
  Spline,
  Square,
  SquareFunction,
  TextCursorInput,
  ToggleLeft,
  Type,
  Video,
  Waypoints,
  Wrench,
  type LucideIcon,
} from "lucide-react";

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
  hitArea: Scan,
  textField: TextCursorInput,
  lottie: Film,
  shader: Sparkle,
  clone: Copy,
  componentInstance: Component,
};

export function LayerTypeIcon({ type, size = 14 }: { type: string; size?: number }) {
  const Icon = LAYER_TYPE_ICONS[type] ?? Square;
  return <Icon size={size} strokeWidth={1.75} />;
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
