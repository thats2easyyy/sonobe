/**
 * Sample content for the widget gallery (#gallery) only. The editor never reads this; everything
 * here is fictional.
 */

import type { LayerNode, PatchCategory, ValueType } from "@sonobe/core";

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
