/**
 * Realistic placeholder content so the shell looks and behaves like a working session before the
 * document store, engine, and patch editor are wired in. Everything here is fictional.
 */

import type { LayerNode, PatchCategory, Severity, ValueType } from "@sonobe/core";

export const MOCK_DOCUMENT_TITLE = "Photo Zoom";

const layer = (id: string, type: string, name: string, extra: Partial<LayerNode> = {}): LayerNode => ({ id, type, name, props: {}, ...extra });

/** Layers in display order (front-most first), as a layers panel shows them. */
export const MOCK_LAYERS: LayerNode[] = [
  layer("status_bar", "group", "Status Bar", {
    locked: true,
    children: [layer("time", "text", "Time"), layer("battery", "shape", "Battery")],
  }),
  layer("header", "group", "Header", {
    children: [layer("title", "text", "Popular Events"), layer("subtitle", "text", "This Weekend"), layer("avatar", "image", "Avatar")],
  }),
  layer("card", "group", "Event Card", {
    children: [
      layer("like_button", "group", "Like Button", { children: [layer("heart", "shape", "Heart"), layer("like_hit", "hitArea", "Like Hit Area")] }),
      layer("event_title", "text", "Event Title"),
      layer("event_meta", "text", "Date & Place"),
      layer("scrim", "gradient", "Scrim"),
      layer("photo", "image", "Photo"),
    ],
  }),
  layer("card_2", "group", "Event Card 2", { props: { enabled: false }, children: [layer("photo_2", "image", "Photo 2")] }),
  layer("tab_bar", "componentInstance", "Tab Bar", { component: "tab_bar", children: [] }),
  layer("sheet_blur", "shader", "Sheet Blur"),
  layer("promo", "video", "Promo Clip"),
  layer("background", "colorFill", "Background"),
];

export type ConsoleLevel = "log" | "info" | "warn" | "error";

export interface ConsoleEntry {
  id: string;
  time: string;
  level: ConsoleLevel;
  source: string;
  message: string;
  count?: number;
}

export const MOCK_CONSOLE: ConsoleEntry[] = [
  { id: "c1", time: "14:02:11.204", level: "info", source: "prototype", message: "Prototype started · iPhone 17 Pro · 60 fps" },
  { id: "c2", time: "14:02:11.221", level: "log", source: "js_formatPrice", message: 'formatted 3 prices → ["$18", "$24", "Free"]' },
  { id: "c3", time: "14:02:13.870", level: "log", source: "tap_card", message: "tap on @card at (201, 244)" },
  { id: "c4", time: "14:02:13.871", level: "log", source: "toggle", message: "on: false → true", count: 3 },
  { id: "c5", time: "14:02:14.402", level: "warn", source: "pop", message: "Spring retargeted mid-flight; velocity kept (1.84 pt/s)" },
  { id: "c6", time: "14:02:16.019", level: "error", source: "js_fetchEvents", message: "TypeError: Cannot read properties of undefined (reading 'title') · line 12" },
  { id: "c7", time: "14:02:18.550", level: "info", source: "claude", message: "sim_trace pop.output for 1.2 s → settles in 0.41 s, overshoot 3.8%" },
];

export interface MockDiagnostic {
  id: string;
  severity: Severity;
  code: string;
  message: string;
  items: string[];
  fix?: string;
}

export const MOCK_DIAGNOSTICS: MockDiagnostic[] = [
  {
    id: "d1",
    severity: "warning",
    code: "pulse_into_state",
    message: "A pulse is wired into Enable on Hover, which expects a state that stays on.",
    items: ["hover_like"],
    fix: "Insert a Switch",
  },
  {
    id: "d2",
    severity: "warning",
    code: "untouchable_layer",
    message: "Like Hit Area can’t receive touches because its opacity is 0.",
    items: ["like_hit"],
    fix: "Turn on Receives Touches",
  },
  { id: "d3", severity: "info", code: "unused_patch", message: "Delay isn’t connected to anything yet.", items: ["delay_1"], fix: "Remove it" },
];

export interface AiActivityEntry {
  id: string;
  time: string;
  author: "Claude" | "You";
  label: string;
  ops: number;
  detail?: string;
}

export const MOCK_AI_ACTIVITY: AiActivityEntry[] = [
  {
    id: "a1",
    time: "2 min ago",
    author: "Claude",
    label: "Added a press animation to Event Card",
    ops: 12,
    detail: "interaction → switch → popAnimation → transition → @card.scale",
  },
  { id: "a2", time: "5 min ago", author: "Claude", label: "Tuned the spring to feel snappy", ops: 2, detail: "bounciness 5 → 3 · speed 10 → 14" },
  { id: "a3", time: "8 min ago", author: "You", label: "Renamed Rectangle 4 to Event Card", ops: 1 },
  { id: "a4", time: "11 min ago", author: "Claude", label: "Built the scrolling event list with loops", ops: 27, detail: "loop ×6 → @card.position" },
];

/** A minute of frame rates with one hitch, for the performance tab. */
export const MOCK_FPS: number[] = Array.from({ length: 90 }, (_, i) => {
  if (i >= 52 && i <= 55) return [51, 44, 49, 57][i - 52]!;
  return 59 + ((i * 7) % 3 === 0 ? 1 : 0) - ((i * 11) % 13 === 0 ? 1 : 0);
});

export interface MockPort {
  name: string;
  type: ValueType;
}

export interface MockPatchType {
  type: string;
  name: string;
  category: PatchCategory;
  summary: string;
  aliases?: string[];
  shortcut?: string;
  inputs: MockPort[];
  outputs: MockPort[];
  pairsWellWith?: string[];
}

const p = (name: string, type: ValueType): MockPort => ({ name, type });

export const MOCK_PATCH_TYPES: MockPatchType[] = [
  { type: "interaction", name: "Interaction", category: "interaction", shortcut: "I", aliases: ["tap", "touch", "press"], summary: "Tells you when a layer is pressed, tapped, and where the finger is.", inputs: [p("Layer", "layer"), p("Enable", "boolean")], outputs: [p("Down", "boolean"), p("Tap", "pulse"), p("Position", "point")], pairsWellWith: ["Switch", "Pop Animation"] },
  { type: "hover", name: "Hover", category: "interaction", aliases: ["mouse over"], summary: "On while the pointer is over a layer (desktop).", inputs: [p("Layer", "layer"), p("Enable", "boolean")], outputs: [p("Hovering", "boolean"), p("Position", "point")] },
  { type: "drag", name: "Drag", category: "interaction", aliases: ["pan", "move"], summary: "Moves a value with a finger, with optional momentum and bounds.", inputs: [p("Layer", "layer"), p("Min", "point"), p("Max", "point")], outputs: [p("Position", "point"), p("Velocity", "point"), p("Dragging", "boolean")] },
  { type: "scroll", name: "Scroll", category: "interaction", aliases: ["scroll view", "paging"], summary: "Makes content scroll with natural momentum and rubber-banding.", inputs: [p("Content", "layer"), p("Paging", "boolean")], outputs: [p("Position", "point"), p("Page", "index")] },
  { type: "longPress", name: "Long Press", category: "interaction", aliases: ["hold"], summary: "Fires when a layer is held still for a moment.", inputs: [p("Layer", "layer"), p("Duration", "number")], outputs: [p("Long Press", "pulse"), p("Down", "boolean")] },
  { type: "keyboard", name: "Keyboard", category: "device", shortcut: "K", aliases: ["key", "hotkey"], summary: "Tells you when a key is pressed.", inputs: [p("Key", "text")], outputs: [p("Down", "boolean"), p("Pressed", "pulse")] },
  { type: "switch", name: "Switch", category: "state", shortcut: "S", aliases: ["toggle", "flip flop", "on off"], summary: "Remembers on or off. Flip it with a tap.", inputs: [p("Flip", "pulse"), p("Turn On", "pulse"), p("Turn Off", "pulse")], outputs: [p("On", "boolean")], pairsWellWith: ["Interaction", "Pop Animation"] },
  { type: "counter", name: "Counter", category: "state", aliases: ["count", "increment"], summary: "Counts up or down each time it receives a pulse.", inputs: [p("Increase", "pulse"), p("Decrease", "pulse"), p("Jump", "pulse"), p("Max", "number")], outputs: [p("Count", "number")] },
  { type: "optionSwitch", name: "Option Switch", category: "state", shortcut: "⇧I", aliases: ["tabs", "state machine"], summary: "Remembers which of several options is selected.", inputs: [p("Set to 0", "pulse"), p("Set to 1", "pulse"), p("Set to 2", "pulse")], outputs: [p("Index", "index")] },
  { type: "pulse", name: "Pulse", category: "logic", shortcut: "U", aliases: ["trigger", "edge"], summary: "Sends a one-frame pulse when a state turns on or off.", inputs: [p("On", "boolean")], outputs: [p("Turned On", "pulse"), p("Turned Off", "pulse")] },
  { type: "delay", name: "Delay", category: "utility", shortcut: "D", aliases: ["wait", "timeout", "later"], summary: "Passes a value along after a set time.", inputs: [p("Value", "number"), p("Duration", "number")], outputs: [p("Value", "number")] },
  { type: "popAnimation", name: "Pop Animation", category: "animation", shortcut: "A", aliases: ["spring", "bouncy", "pop"], summary: "Animates toward a number with a spring set by bounciness and speed.", inputs: [p("Number", "number"), p("Bounciness", "number"), p("Speed", "number")], outputs: [p("Progress", "number")], pairsWellWith: ["Switch", "Transition"] },
  { type: "springAnimation", name: "Spring Animation", category: "animation", aliases: ["physics", "mass tension friction"], summary: "A physical spring with mass, tension, and friction.", inputs: [p("Number", "number"), p("Mass", "number"), p("Tension", "number"), p("Friction", "number")], outputs: [p("Progress", "number")] },
  { type: "classicAnimation", name: "Classic Animation", category: "animation", shortcut: "C", aliases: ["ease", "tween", "duration", "curve"], summary: "Animates over a fixed duration with an easing curve.", inputs: [p("Number", "number"), p("Duration", "number"), p("Curve", "enum")], outputs: [p("Progress", "number")] },
  { type: "transition", name: "Transition", category: "animation", shortcut: "T", aliases: ["map", "remap", "interpolate", "lerp"], summary: "Maps progress from 0–1 onto a start and end value.", inputs: [p("Progress", "number"), p("Start", "number"), p("End", "number")], outputs: [p("Output", "number")], pairsWellWith: ["Pop Animation", "Classic Animation"] },
  { type: "progress", name: "Progress", category: "math", shortcut: "⇧R", aliases: ["normalize", "percent"], summary: "Turns a value between start and end into 0–1.", inputs: [p("Value", "number"), p("Start", "number"), p("End", "number")], outputs: [p("Progress", "number")] },
  { type: "optionPicker", name: "Option Picker", category: "logic", shortcut: "O", aliases: ["mux", "select", "choose"], summary: "Outputs one of several values based on an index.", inputs: [p("Option", "index"), p("Value 1", "any"), p("Value 2", "any")], outputs: [p("Value", "any")] },
  { type: "add", name: "Add", category: "math", shortcut: "+", aliases: ["plus", "sum"], summary: "Adds numbers, points, or text together.", inputs: [p("Value 1", "number"), p("Value 2", "number")], outputs: [p("Result", "number")] },
  { type: "multiply", name: "Multiply", category: "math", shortcut: "*", aliases: ["times", "product"], summary: "Multiplies values.", inputs: [p("Value 1", "number"), p("Value 2", "number")], outputs: [p("Result", "number")] },
  { type: "and", name: "And", category: "logic", shortcut: "⇧A", aliases: ["all", "both"], summary: "On when every input is on.", inputs: [p("Value 1", "boolean"), p("Value 2", "boolean")], outputs: [p("Result", "boolean")] },
  { type: "equals", name: "Equals", category: "logic", shortcut: "E", aliases: ["compare", "same"], summary: "On when two values are the same.", inputs: [p("First", "number"), p("Second", "number")], outputs: [p("Equal", "boolean")] },
  { type: "loop", name: "Loop", category: "loops", aliases: ["repeat", "for", "range", "list"], summary: "Counts from 0 up to a number, once per item, to repeat layers.", inputs: [p("Count", "number")], outputs: [p("Index", "index")], pairsWellWith: ["Multiply", "Loop Builder"] },
  { type: "loopBuilder", name: "Loop Builder", category: "loops", aliases: ["array", "collection"], summary: "Collects several values into one loop.", inputs: [p("Value 1", "any"), p("Value 2", "any")], outputs: [p("Values", "any"), p("Index", "index")] },
  { type: "textFormatter", name: "Format Text", category: "text", aliases: ["template", "string", "interpolate"], summary: "Builds text from a template like “{count} likes”.", inputs: [p("Template", "text"), p("Value", "any")], outputs: [p("Text", "text")] },
  { type: "colorMix", name: "Color Mix", category: "color", aliases: ["blend", "interpolate color"], summary: "Blends between two colors.", inputs: [p("From", "color"), p("To", "color"), p("Amount", "number")], outputs: [p("Color", "color")] },
  { type: "pointPack", name: "Point Pack", category: "math", aliases: ["xy", "vector", "combine"], summary: "Combines X and Y numbers into a point.", inputs: [p("X", "number"), p("Y", "number")], outputs: [p("Point", "point")] },
  { type: "networkRequest", name: "Network Request", category: "data", aliases: ["fetch", "http", "api"], summary: "Loads JSON from a URL.", inputs: [p("URL", "text"), p("Request", "pulse")], outputs: [p("Result", "json"), p("Loading", "boolean")] },
  { type: "imageFromUrl", name: "Image from URL", category: "media", aliases: ["download", "remote image"], summary: "Loads an image from the web.", inputs: [p("URL", "text")], outputs: [p("Image", "image")] },
  { type: "roundedRectangle", name: "Rounded Rectangle", category: "shapes", aliases: ["path", "squircle"], summary: "Makes a rounded rectangle shape for a Shape layer.", inputs: [p("Size", "size"), p("Radius", "number")], outputs: [p("Shape", "shape")] },
  { type: "layerInfo", name: "Layer Info", category: "layers", aliases: ["frame", "bounds", "measure"], summary: "Reads a layer’s position and size.", inputs: [p("Layer", "layer")], outputs: [p("Position", "point"), p("Size", "size")] },
  { type: "whenPrototypeStarts", name: "When Prototype Starts", category: "utility", aliases: ["on load", "start", "init"], summary: "Sends a pulse when the prototype starts or restarts.", inputs: [], outputs: [p("Started", "pulse")] },
  { type: "javascript", name: "JavaScript", category: "scripting", aliases: ["code", "script", "js"], summary: "Write your own patch in JavaScript.", inputs: [p("Input", "any")], outputs: [p("Output", "any")] },
];

export interface MockNodePort {
  key: string;
  name: string;
  type: ValueType;
  value?: string;
  connected?: boolean;
  live?: boolean;
}

export interface MockNode {
  id: string;
  name: string;
  category: PatchCategory;
  x: number;
  y: number;
  width?: number;
  loop?: number;
  inputs: MockNodePort[];
  outputs: MockNodePort[];
}

export interface MockCable {
  from: [string, string];
  to: [string, string];
  pulse?: boolean;
}

export const MOCK_GRAPH: { nodes: MockNode[]; cables: MockCable[]; comments: { id: string; text: string; rect: [number, number, number, number] }[] } = {
  nodes: [
    {
      id: "tap_card",
      name: "Interaction",
      category: "interaction",
      x: 16,
      y: 56,
      inputs: [
        { key: "layer", name: "Layer", type: "layer", value: "Event Card" },
        { key: "enable", name: "Enable", type: "boolean", value: "✓" },
      ],
      outputs: [
        { key: "down", name: "Down", type: "boolean", connected: false },
        { key: "tap", name: "Tap", type: "pulse", connected: true, live: true },
        { key: "position", name: "Position", type: "point", connected: false },
      ],
    },
    {
      id: "toggle",
      name: "Switch",
      category: "state",
      x: 200,
      y: 72,
      inputs: [
        { key: "flip", name: "Flip", type: "pulse", connected: true },
        { key: "turnOn", name: "Turn On", type: "pulse" },
        { key: "turnOff", name: "Turn Off", type: "pulse" },
      ],
      outputs: [{ key: "on", name: "On", type: "boolean", connected: true, live: true }],
    },
    {
      id: "pop",
      name: "Pop Animation",
      category: "animation",
      x: 384,
      y: 56,
      inputs: [
        { key: "number", name: "Number", type: "number", connected: true },
        { key: "bounciness", name: "Bounciness", type: "number", value: "3" },
        { key: "speed", name: "Speed", type: "number", value: "14" },
      ],
      outputs: [{ key: "output", name: "Progress", type: "number", value: "0.62", connected: true }],
    },
    {
      id: "grow",
      name: "Transition",
      category: "animation",
      x: 568,
      y: 72,
      inputs: [
        { key: "progress", name: "Progress", type: "number", connected: true },
        { key: "start", name: "Start", type: "number", value: "1" },
        { key: "end", name: "End", type: "number", value: "1.08" },
      ],
      outputs: [{ key: "output", name: "Output", type: "number", value: "1.05", connected: true }],
    },
    {
      id: "card_scale",
      name: "Event Card",
      category: "layers",
      x: 752,
      y: 88,
      width: 136,
      inputs: [{ key: "scale", name: "Scale", type: "number", connected: true }],
      outputs: [],
    },
    {
      id: "rows",
      name: "Loop",
      category: "loops",
      x: 16,
      y: 240,
      loop: 6,
      inputs: [{ key: "count", name: "Count", type: "number", value: "6" }],
      outputs: [{ key: "index", name: "Index", type: "index", connected: true }],
    },
    {
      id: "row_y",
      name: "Multiply",
      category: "math",
      x: 200,
      y: 240,
      loop: 6,
      inputs: [
        { key: "value1", name: "Value 1", type: "index", connected: true },
        { key: "value2", name: "Value 2", type: "number", value: "236" },
      ],
      outputs: [{ key: "result", name: "Result", type: "number", connected: true }],
    },
    {
      id: "card_pos",
      name: "Point Pack",
      category: "math",
      x: 384,
      y: 240,
      loop: 6,
      inputs: [
        { key: "x", name: "X", type: "number", value: "16" },
        { key: "y", name: "Y", type: "number", connected: true },
      ],
      outputs: [{ key: "point", name: "Point", type: "point", connected: true }],
    },
    {
      id: "fetch",
      name: "Network Request",
      category: "data",
      x: 568,
      y: 240,
      inputs: [
        { key: "url", name: "URL", type: "text", value: "api/events" },
        { key: "request", name: "Request", type: "pulse" },
      ],
      outputs: [
        { key: "result", name: "Result", type: "json", connected: false },
        { key: "loading", name: "Loading", type: "boolean" },
      ],
    },
  ],
  cables: [
    { from: ["tap_card", "tap"], to: ["toggle", "flip"], pulse: true },
    { from: ["toggle", "on"], to: ["pop", "number"] },
    { from: ["pop", "output"], to: ["grow", "progress"] },
    { from: ["grow", "output"], to: ["card_scale", "scale"] },
    { from: ["rows", "index"], to: ["row_y", "value1"] },
    { from: ["row_y", "result"], to: ["card_pos", "y"] },
  ],
  comments: [
    { id: "isat", text: "Tap to zoom · Interaction → Switch → Animation → Transition", rect: [4, 16, 888, 176] },
    { id: "list", text: "Event list · one card per result", rect: [4, 216, 744, 124] },
  ],
};

export interface MockLesson {
  id: string;
  title: string;
  minutes: number;
  description: string;
  progress?: number;
}

export const MOCK_LESSONS: MockLesson[] = [
  { id: "isat", title: "Tap to zoom", minutes: 3, description: "Your first interaction: tap a card, switch a state, animate it with a spring.", progress: 0.66 },
  { id: "pulses", title: "States vs. pulses", minutes: 4, description: "Why a tap is a moment and a switch is a memory." },
  { id: "loops", title: "Lists with loops", minutes: 6, description: "Repeat one card for every item in your data." },
  { id: "springs", title: "Springs and feel", minutes: 5, description: "Smooth, snappy, bouncy, gentle: pick a feel, then fine-tune." },
];

export const MOCK_RECIPES: { id: string; title: string; patches: number }[] = [
  { id: "bottom_sheet", title: "Bottom sheet", patches: 9 },
  { id: "carousel", title: "Paging carousel", patches: 7 },
  { id: "pull_refresh", title: "Pull to refresh", patches: 11 },
  { id: "like", title: "Like button", patches: 5 },
  { id: "collapsing_header", title: "Collapsing header", patches: 8 },
  { id: "swipe_cards", title: "Swipe cards", patches: 12 },
];
