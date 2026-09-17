/**
 * Sonobe design tokens as TypeScript constants. The same values are CSS custom properties in
 * tokens.css (tokens.test.ts keeps them in sync). Style with CSS variables (`var(--bg-panel)`);
 * reach for these constants where CSS can't: canvas drawing, SVG computed in JS, charts, exports.
 */

import type { PatchCategory, ValueType } from "@sonobe/core";

export type ThemeName = "dark" | "light";
export const THEMES: readonly ThemeName[] = ["dark", "light"];

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

const DARK = {
  "bg-window": "#111113",
  "bg-toolbar": "#18181B",
  "bg-panel": "#1B1B1E",
  "bg-sunken": "#141416",
  "bg-elevated": "#242428",
  "bg-overlay": "rgba(6, 6, 8, 0.56)",
  "bg-field": "rgba(255, 255, 255, 0.05)",
  "bg-field-hover": "rgba(255, 255, 255, 0.075)",
  "bg-hover": "rgba(255, 255, 255, 0.055)",
  "bg-pressed": "rgba(255, 255, 255, 0.09)",
  "bg-selected": "rgba(95, 116, 228, 0.24)",
  "bg-selected-hover": "rgba(95, 116, 228, 0.3)",
  "bg-selected-muted": "rgba(255, 255, 255, 0.08)",
  "bg-tooltip": "#303036",
  "text-primary": "#EDEDF0",
  "text-secondary": "#A8A8B0",
  "text-tertiary": "#7C7C85",
  "text-disabled": "#55555C",
  "text-on-accent": "#FFFFFF",
  "text-accent": "#A3B1FF",
  "text-tooltip": "#F4F4F6",
  "border-subtle": "rgba(255, 255, 255, 0.06)",
  "border-default": "rgba(255, 255, 255, 0.1)",
  "border-strong": "rgba(255, 255, 255, 0.16)",
  accent: "#5F74E4",
  "accent-hover": "#6E85F0",
  "accent-pressed": "#5367D4",
  "accent-soft": "rgba(95, 116, 228, 0.18)",
  "accent-soft-hover": "rgba(95, 116, 228, 0.26)",
  "focus-ring": "#7F92F7",
  danger: "#E24947",
  "danger-hover": "#EC5957",
  "danger-text": "#F58B84",
  "danger-soft": "rgba(226, 73, 71, 0.16)",
  warn: "#F2AF48",
  "warn-text": "#F5BD68",
  "warn-soft": "rgba(242, 175, 72, 0.14)",
  success: "#4EBE7D",
  "success-text": "#6FD39A",
  "success-soft": "rgba(78, 190, 125, 0.14)",
  info: "#57AFE0",
  "info-text": "#7CC2EA",
  "info-soft": "rgba(87, 175, 224, 0.14)",
  ai: "#EA8B60",
  "ai-text": "#F0A27F",
  "ai-soft": "rgba(234, 139, 96, 0.15)",
  "shadow-sm": "0 1px 2px rgba(0, 0, 0, 0.35)",
  "shadow-md": "0 2px 8px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.3)",
  "shadow-popover": "0 0 0 1px rgba(0, 0, 0, 0.45), 0 10px 28px -6px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.3)",
  "shadow-modal": "0 0 0 1px rgba(0, 0, 0, 0.5), 0 24px 64px -12px rgba(0, 0, 0, 0.65), 0 6px 16px rgba(0, 0, 0, 0.35)",
  "highlight-top": "inset 0 1px 0 rgba(255, 255, 255, 0.05)",
  "canvas-bg": "#131315",
  "canvas-grid": "rgba(255, 255, 255, 0.045)",
  "canvas-dot": "rgba(255, 255, 255, 0.1)",
  "patch-node-bg": "#222226",
  "patch-node-border": "rgba(255, 255, 255, 0.08)",
  selection: "#6E85F0",
  "scrollbar-thumb": "rgba(255, 255, 255, 0.14)",
  "scrollbar-thumb-hover": "rgba(255, 255, 255, 0.24)",
  "checker-a": "#2A2A2E",
  "checker-b": "#3A3A3F",
} as const;

export type ThemeTokenName = keyof typeof DARK;

const LIGHT: Record<ThemeTokenName, string> = {
  "bg-window": "#E9E9EC",
  "bg-toolbar": "#F6F6F8",
  "bg-panel": "#FFFFFF",
  "bg-sunken": "#F2F2F4",
  "bg-elevated": "#FFFFFF",
  "bg-overlay": "rgba(20, 20, 28, 0.28)",
  "bg-field": "rgba(0, 0, 0, 0.045)",
  "bg-field-hover": "rgba(0, 0, 0, 0.07)",
  "bg-hover": "rgba(0, 0, 0, 0.045)",
  "bg-pressed": "rgba(0, 0, 0, 0.08)",
  "bg-selected": "rgba(76, 94, 219, 0.13)",
  "bg-selected-hover": "rgba(76, 94, 219, 0.18)",
  "bg-selected-muted": "rgba(0, 0, 0, 0.06)",
  "bg-tooltip": "#1F1F24",
  "text-primary": "#1B1B1F",
  "text-secondary": "#56565E",
  "text-tertiary": "#75757D",
  "text-disabled": "#ADADB4",
  "text-on-accent": "#FFFFFF",
  "text-accent": "#4354C8",
  "text-tooltip": "#F4F4F6",
  "border-subtle": "rgba(0, 0, 0, 0.06)",
  "border-default": "rgba(0, 0, 0, 0.1)",
  "border-strong": "rgba(0, 0, 0, 0.18)",
  accent: "#4C5EDB",
  "accent-hover": "#3F4ECA",
  "accent-pressed": "#3645B6",
  "accent-soft": "rgba(76, 94, 219, 0.11)",
  "accent-soft-hover": "rgba(76, 94, 219, 0.17)",
  "focus-ring": "#5B6CE6",
  danger: "#CC272E",
  "danger-hover": "#B81F26",
  "danger-text": "#BE222A",
  "danger-soft": "rgba(204, 39, 46, 0.1)",
  warn: "#D98E1F",
  "warn-text": "#A46311",
  "warn-soft": "rgba(217, 142, 31, 0.14)",
  success: "#1E9E5A",
  "success-text": "#107D48",
  "success-soft": "rgba(30, 158, 90, 0.12)",
  info: "#1B86C4",
  "info-text": "#0573AA",
  "info-soft": "rgba(27, 134, 196, 0.11)",
  ai: "#D96A33",
  "ai-text": "#C5521C",
  "ai-soft": "rgba(217, 106, 51, 0.12)",
  "shadow-sm": "0 1px 2px rgba(0, 0, 0, 0.06)",
  "shadow-md": "0 2px 8px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.06)",
  "shadow-popover": "0 0 0 1px rgba(0, 0, 0, 0.08), 0 10px 28px -6px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.06)",
  "shadow-modal": "0 0 0 1px rgba(0, 0, 0, 0.08), 0 24px 64px -12px rgba(0, 0, 0, 0.28), 0 6px 16px rgba(0, 0, 0, 0.08)",
  "highlight-top": "inset 0 1px 0 rgba(255, 255, 255, 0.6)",
  "canvas-bg": "#EFEFF2",
  "canvas-grid": "rgba(0, 0, 0, 0.045)",
  "canvas-dot": "rgba(0, 0, 0, 0.13)",
  "patch-node-bg": "#FFFFFF",
  "patch-node-border": "rgba(0, 0, 0, 0.1)",
  selection: "#4C5EDB",
  "scrollbar-thumb": "rgba(0, 0, 0, 0.16)",
  "scrollbar-thumb-hover": "rgba(0, 0, 0, 0.28)",
  "checker-a": "#FFFFFF",
  "checker-b": "#E3E3E6",
};

/** Semantic theme tokens (surfaces, text, borders, accent, status, shadows, canvas). CSS: `--<name>`. */
export const THEME_TOKENS: Record<ThemeName, Record<ThemeTokenName, string>> = { dark: DARK, light: LIGHT };

/** `var(--name)` for a semantic token. */
export const tokenVar = (name: ThemeTokenName): string => `var(--${name})`;

// ---------------------------------------------------------------------------
// Port type palette
// ---------------------------------------------------------------------------

/**
 * Port colors group related value types. Hues were chosen in OKLCH for similar perceived weight and
 * checked for separation under protanopia, deuteranopia, and tritanopia. Pairs that still converge
 * are told apart by glyph shape (PORT_GROUP_GLYPH), so color is never the only signal.
 */
export type PortColorGroup =
  | "number"
  | "boolean"
  | "pulse"
  | "text"
  | "color"
  | "vector"
  | "index"
  | "json"
  | "layer"
  | "media"
  | "style"
  | "any";

export const PORT_COLOR_GROUPS: readonly PortColorGroup[] = [
  "number",
  "boolean",
  "pulse",
  "text",
  "color",
  "vector",
  "index",
  "json",
  "layer",
  "media",
  "style",
  "any",
];

export const PORT_TYPE_GROUP: Record<ValueType, PortColorGroup> = {
  number: "number",
  boolean: "boolean",
  pulse: "pulse",
  text: "text",
  color: "color",
  point: "vector",
  point3d: "vector",
  point4d: "vector",
  size: "vector",
  anchor: "vector",
  transform: "vector",
  index: "index",
  enum: "index",
  json: "json",
  layer: "layer",
  image: "media",
  video: "media",
  sound: "media",
  gradient: "style",
  shape: "style",
  textStyle: "style",
  layerEffect: "style",
  any: "any",
};

export const PORT_GROUP_COLORS: Record<ThemeName, Record<PortColorGroup, string>> = {
  dark: {
    number: "#65B2F1",
    boolean: "#FB89BE",
    pulse: "#FCD948",
    text: "#68CB6E",
    color: "#ED7940",
    vector: "#9575E2",
    index: "#76E2E2",
    json: "#F2CE9D",
    layer: "#96A6BB",
    media: "#D85164",
    style: "#45A68B",
    any: "#777A80",
  },
  light: {
    number: "#0278C7",
    boolean: "#D2458F",
    pulse: "#C48A0E",
    text: "#33903C",
    color: "#E06623",
    vector: "#6A44B4",
    index: "#239AA6",
    json: "#91683B",
    layer: "#3E4858",
    media: "#AF1B37",
    style: "#037A69",
    any: "#82868E",
  },
};

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

/** Color group for a port type; "variant" (unresolved typeParam) renders as any. */
export const portGroup = (type: ValueType | "variant"): PortColorGroup => (type === "variant" ? "any" : PORT_TYPE_GROUP[type]);

/** `var(--port-<group>)` for a port type. */
export const portColorVar = (type: ValueType | "variant"): string => `var(--port-${portGroup(type)})`;

/** Resolved hex for a port type in a theme (for canvas/SVG drawing outside CSS). */
export const portColor = (type: ValueType | "variant", theme: ThemeName): string => PORT_GROUP_COLORS[theme][portGroup(type)];

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

/**
 * Header accent per patch category. Interaction stays purple and loops green for continuity with
 * what Origami users already know; the rest are spread around the wheel.
 */
export const CATEGORY_COLORS: Record<ThemeName, Record<PatchCategory, string>> = {
  dark: {
    interaction: "#BD7FE8",
    animation: "#25AEA7",
    state: "#DF9B44",
    logic: "#DA6F54",
    math: "#3E8CC9",
    loops: "#61B565",
    text: "#AFB96D",
    color: "#DB6EA5",
    data: "#B9A272",
    device: "#7398AB",
    media: "#CE5057",
    shapes: "#50BDC9",
    layers: "#5F80E0",
    utility: "#7D8086",
    components: "#B969BE",
    scripting: "#E0CC55",
  },
  light: {
    interaction: "#9B54C8",
    animation: "#0A8681",
    state: "#C5770F",
    logic: "#C24D25",
    math: "#1666AA",
    loops: "#34893C",
    text: "#75832E",
    color: "#C13D82",
    data: "#907649",
    device: "#4B6E81",
    media: "#C12535",
    shapes: "#1790A3",
    layers: "#3255B6",
    utility: "#6E7278",
    components: "#973D9D",
    scripting: "#A69313",
  },
};

/** `var(--category-<name>)`. */
export const categoryColorVar = (category: PatchCategory): string => `var(--category-${category})`;
