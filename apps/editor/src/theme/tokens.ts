/**
 * Sonobe design tokens as TypeScript constants. The same values are CSS custom properties in
 * tokens.css (tokens.test.ts keeps them in sync). Style with CSS variables (`var(--bg-panel)`);
 * reach for these constants where CSS can't: canvas drawing, SVG computed in JS, charts, exports.
 */

import type { PatchCategory, ValueType } from "@sonobe/core";
import { portGroup, type PortColorGroup, type ThemeTokenName } from "@sonobe/renderer/theme";

// The color palettes live in @sonobe/renderer/theme, shared with graphToSvg (patch graphs drawn without the editor).
export {
  CATEGORY_COLORS,
  COMMENT_COLORS,
  PORT_COLOR_GROUPS,
  PORT_GROUP_COLORS,
  PORT_TYPE_GROUP,
  THEME_TOKENS,
  THEMES,
  portColor,
  portGroup,
  type PortColorGroup,
  type ThemeName,
  type ThemeTokenName,
} from "@sonobe/renderer/theme";

export const FONT_FAMILY = {
  sans: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Segoe UI", system-ui, sans-serif',
  mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
} as const;

/** px. CSS: `--font-size-<key>`. */
export const FONT_SIZE = { "2xs": 10, xs: 11, sm: 12, md: 13, lg: 15, xl: 20, "2xl": 28 } as const;
export const FONT_WEIGHT = { regular: 400, medium: 500, semibold: 600, bold: 700 } as const;

/** Spacing scale in px. CSS: `--space-<index>`. */
export const SPACING = [0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48] as const;

/** px. CSS: `--radius-<key>`. */
export const RADIUS = { xs: 3, sm: 4, md: 6, lg: 8, xl: 12, "2xl": 16, full: 999 } as const;

/** px. CSS: `--control-h-<key>`. */
export const CONTROL_HEIGHT = { xs: 18, sm: 22, md: 26, lg: 32 } as const;

/** px. CSS: `--toolbar-h`, `--panel-header-h`, `--tabbar-h`, `--row-h`, `--rail-w`. */
export const LAYOUT = { toolbarHeight: 44, panelHeaderHeight: 34, tabBarHeight: 30, rowHeight: 26, railWidth: 36 } as const;

/** Fixed stacking scale. CSS: `--z-<key>`. */
export const Z_INDEX = {
  base: 0,
  raised: 1,
  panel: 10,
  sticky: 20,
  drawer: 30,
  overlay: 100,
  dropdown: 200,
  popover: 300,
  modal: 400,
  palette: 500,
  toast: 600,
  tooltip: 700,
} as const;

/** ms. CSS: `--duration-<key>`; all become 0ms under reduced motion. */
export const DURATION = { instant: 60, fast: 120, base: 180, slow: 240, slower: 320 } as const;

/** CSS: `--ease-out`, `--ease-in-out`, `--ease-standard`, `--ease-in`, `--ease-spring`. */
export const EASING = {
  out: "cubic-bezier(0.23, 1, 0.32, 1)",
  inOut: "cubic-bezier(0.77, 0, 0.175, 1)",
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  in: "cubic-bezier(0.55, 0.055, 0.675, 0.19)",
  spring: "cubic-bezier(0.34, 1.36, 0.64, 1)",
} as const;

/** `var(--name)` for a semantic token. */
export const tokenVar = (name: ThemeTokenName): string => `var(--${name})`;

// ---------------------------------------------------------------------------
// Port type palette
// ---------------------------------------------------------------------------

/**
 * Port glyph by structure: circle = single value, pill = vector, diamond = pulse (an event, not a
 * state), square = reference or resource, ring = accepts anything.
 */
export type PortGlyph = "circle" | "pill" | "diamond" | "square" | "ring";

export const PORT_GROUP_GLYPH: Record<PortColorGroup, PortGlyph> = {
  number: "circle",
  boolean: "circle",
  pulse: "diamond",
  text: "circle",
  color: "circle",
  vector: "pill",
  index: "circle",
  json: "circle",
  layer: "square",
  media: "square",
  style: "square",
  any: "ring",
};

export const PORT_GROUP_LABELS: Record<PortColorGroup, string> = {
  number: "Number",
  boolean: "Boolean",
  pulse: "Pulse",
  text: "Text",
  color: "Color",
  vector: "Point · Size · Anchor",
  index: "Index · Enum",
  json: "JSON",
  layer: "Layer",
  media: "Image · Video · Sound",
  style: "Gradient · Shape · Style · Effect",
  any: "Any",
};

/** `var(--port-<group>)` for a port type. */
export const portColorVar = (type: ValueType | "variant"): string => `var(--port-${portGroup(type)})`;

// ---------------------------------------------------------------------------
// Patch category header colors
// ---------------------------------------------------------------------------

export const PATCH_CATEGORIES: readonly PatchCategory[] = [
  "interaction",
  "animation",
  "state",
  "logic",
  "math",
  "loops",
  "text",
  "color",
  "data",
  "device",
  "media",
  "shapes",
  "layers",
  "utility",
  "components",
  "scripting",
];

export const CATEGORY_LABELS: Record<PatchCategory, string> = {
  interaction: "Interaction",
  animation: "Animation",
  state: "State",
  logic: "Logic",
  math: "Math",
  loops: "Loops",
  text: "Text",
  color: "Color",
  data: "Data",
  device: "Device",
  media: "Media",
  shapes: "Shapes",
  layers: "Layers",
  utility: "Utility",
  components: "Components",
  scripting: "Scripting",
};

/** `var(--category-<name>)`. */
export const categoryColorVar = (category: PatchCategory): string => `var(--category-${category})`;
