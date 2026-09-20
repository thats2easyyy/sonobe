/**
 * Layer type declarations (contract). Property keys here are what documents store,
 * what the engine resolves, what the renderer draws, and what the MCP exposes.
 * See ARCHITECTURE.md §5.4 and §7.
 */

import type { EnumOption, LayerTypeSpec, PortSpec, PropCategory, PropSpec, Value, ValueSubtype, ValueType } from "./types.ts";

function prop(
  key: string,
  name: string,
  type: ValueType,
  def: Value,
  category: PropCategory,
  description: string,
  extra: Partial<PropSpec> = {},
): PropSpec {
  return { key, name, type, default: def, category, description, ...extra };
}

const opts = (...keys: [string, string][]): EnumOption[] => keys.map(([key, name]) => ({ key, name }));

const sub = (subtype: ValueSubtype) => ({ subtype });

export const BLEND_MODES = opts(
  ["normal", "Normal"], ["multiply", "Multiply"], ["screen", "Screen"], ["overlay", "Overlay"],
  ["darken", "Darken"], ["lighten", "Lighten"], ["colorDodge", "Color Dodge"], ["colorBurn", "Color Burn"],
  ["hardLight", "Hard Light"], ["softLight", "Soft Light"], ["difference", "Difference"],
  ["exclusion", "Exclusion"], ["hue", "Hue"], ["saturation", "Saturation"], ["color", "Color"],
  ["luminosity", "Luminosity"], ["plusDarker", "Plus Darker"], ["plusLighter", "Plus Lighter"],
);

export const SIZE_MODES = opts(["fixed", "Fixed"], ["auto", "Auto (hug contents)"], ["grow", "Grow (fill space)"], ["percent", "Percent of parent"]);

export const ALIGNMENTS = opts(
  ["topLeft", "Top Left"], ["top", "Top"], ["topRight", "Top Right"],
  ["left", "Left"], ["center", "Center"], ["right", "Right"],
  ["bottomLeft", "Bottom Left"], ["bottom", "Bottom"], ["bottomRight", "Bottom Right"],
);

export const FILL_MODES = opts(["fill", "Fill"], ["fit", "Fit"], ["stretch", "Stretch"], ["tile", "Tile"]);

/** Props every layer has. */
export const COMMON_PROPS: PropSpec[] = [
  prop("enabled", "Enabled", "boolean", true, "basics", "When off, the layer is hidden and ignores touches."),
  prop("position", "Position", "point", [0, 0], "basics", "Where the layer's anchor point sits, measured from the parent's top-left, in points.", sub("distance")),
  prop("size", "Size", "size", [100, 100], "basics", "Width and height in points (or percent when a size mode is Percent).", sub("distance")),
  prop("anchor", "Anchor", "anchor", [0, 0], "basics", "Which point of the layer Position refers to. [0,0] is top-left, [0.5,0.5] is center."),
  prop("opacity", "Opacity", "number", 1, "basics", "0 is fully transparent, 1 is fully opaque. Layers at 0 don't receive touches.", { ...sub("progress"), min: 0, max: 1, step: 0.01 }),
  prop("widthMode", "Width Mode", "enum", "fixed", "layout", "How width is determined inside a parent.", { enumOptions: SIZE_MODES }),
  prop("heightMode", "Height Mode", "enum", "fixed", "layout", "How height is determined inside a parent.", { enumOptions: SIZE_MODES }),
  prop("positioning", "Positioning", "enum", "relative", "layout", "Relative layers follow the parent's layout; absolute layers use Position even when the parent has layout.", { enumOptions: opts(["relative", "Relative"], ["absolute", "Absolute"]) }),
  prop("scale", "Scale", "number", 1, "transform", "Uniform scale about the pivot.", { step: 0.01 }),
  prop("scaleXYZ", "Scale XYZ", "point3d", [1, 1, 1], "transform", "Independent X/Y/Z scale, multiplied with Scale.", { advanced: true }),
  prop("rotation", "Rotation", "number", 0, "transform", "Rotation about the pivot in degrees (Z axis).", sub("angle")),
  prop("rotationX", "Rotation X", "number", 0, "transform", "3D rotation around the X axis in degrees.", { ...sub("angle"), advanced: true }),
  prop("rotationY", "Rotation Y", "number", 0, "transform", "3D rotation around the Y axis in degrees.", { ...sub("angle"), advanced: true }),
  prop("pivot", "Pivot", "anchor", [0.5, 0.5], "transform", "Point that scale and rotation happen around. [0.5,0.5] is center."),
  prop("zPosition", "Z Position", "number", 0, "transform", "Draw order among siblings: a higher Z Position draws in front and gets touches first; equal values keep layer-list order. It only reorders within the same parent.", { advanced: true }),
  prop("shadowColor", "Shadow Color", "color", "#000000FF", "shadow", "Drop shadow color."),
  prop("shadowOpacity", "Shadow Opacity", "number", 0, "shadow", "0 turns the shadow off.", { ...sub("progress"), min: 0, max: 1, step: 0.01 }),
  prop("shadowRadius", "Shadow Radius", "number", 0, "shadow", "Blur radius of the shadow in points.", { min: 0 }),
  prop("shadowOffset", "Shadow Offset", "point", [0, 0], "shadow", "Shadow offset in points."),
  prop("blur", "Blur", "number", 0, "filters", "Gaussian blur radius applied to the layer, in points.", { min: 0 }),
  prop("backgroundBlur", "Background Blur", "number", 0, "filters", "Blurs what's behind the layer (frosted glass).", { min: 0, advanced: true }),
  prop("blendMode", "Blend Mode", "enum", "normal", "filters", "How the layer's pixels combine with layers below.", { enumOptions: BLEND_MODES }),
  prop("effects", "Effects", "layerEffect", null, "filters", "Layer effects from effect patches (loop to stack several).", { wholeLoop: true, advanced: true }),
  prop("hitTest", "Receives Touches", "boolean", true, "interaction", "When off, touches pass through this layer to layers below."),
  prop("hitSlop", "Hit Slop", "number", 0, "interaction", "Extra touch area around the layer in points (makes small targets easier to tap).", { min: 0, advanced: true }),
  prop("cursor", "Cursor", "enum", "auto", "interaction", "Mouse cursor when hovering (desktop).", { enumOptions: opts(["auto", "Auto"], ["pointer", "Pointer"], ["grab", "Grab"], ["grabbing", "Grabbing"], ["text", "Text"], ["none", "None"]), advanced: true }),
];

const FILL_PROPS: PropSpec[] = [
  prop("color", "Color", "color", "#D9D9D9FF", "fill", "Fill color."),
  prop("gradient", "Gradient", "gradient", null, "fill", "Gradient fill; when set it replaces Color.", { advanced: true }),
];

const CORNER_PROPS: PropSpec[] = [
  prop("cornerRadius", "Corner Radius", "number", 0, "fill", "Rounds all corners, in points.", { min: 0 }),
  prop("cornerRadii", "Corner Radii", "point4d", null, "fill", "Independent corner radii [topLeft, topRight, bottomRight, bottomLeft]; overrides Corner Radius.", { advanced: true }),
  prop("cornerSmoothing", "Corner Smoothing", "number", 0, "fill", "0 = circular corners, 1 = fully smooth (squircle) corners.", { ...sub("progress"), min: 0, max: 1, step: 0.01 }),
];

const STROKE_PROPS: PropSpec[] = [
  prop("strokeColor", "Stroke Color", "color", "#000000FF", "stroke", "Border color."),
  prop("strokeWidth", "Stroke Width", "number", 0, "stroke", "Border width in points; 0 means no border.", { min: 0 }),
  prop("strokePosition", "Stroke Position", "enum", "inside", "stroke", "Where the border sits relative to the edge.", { enumOptions: opts(["inside", "Inside"], ["center", "Center"], ["outside", "Outside"]), advanced: true }),
];

const TEXT_STYLE_PROPS: PropSpec[] = [
  prop("fontFamily", "Font", "text", "Inter", "text", "Font family name."),
  prop("fontSize", "Font Size", "number", 17, "text", "Font size in points.", { min: 1 }),
  prop("fontWeight", "Weight", "number", 400, "text", "100 (thin) to 900 (black).", { min: 100, max: 900, step: 100 }),
  prop("italic", "Italic", "boolean", false, "text", "Italic style."),
  prop("textColor", "Text Color", "color", "#000000FF", "text", "Text color."),
  prop("textAlignment", "Alignment", "enum", "left", "text", "Horizontal text alignment.", { enumOptions: opts(["left", "Left"], ["center", "Center"], ["right", "Right"], ["justify", "Justify"]) }),
  prop("letterSpacing", "Letter Spacing", "number", 0, "text", "Extra space between characters in points."),
  prop("lineHeight", "Line Height", "number", 0, "text", "Line height in points; 0 uses the font's natural line height.", { min: 0 }),
];

const LAYOUT_CONTAINER_PROPS: PropSpec[] = [
  prop("layout", "Layout", "enum", "none", "layout", "Arrange children automatically: in a row, a column, or a wrapping grid.", { enumOptions: opts(["none", "None"], ["row", "Row"], ["column", "Column"], ["grid", "Grid"]) }),
  prop("spacingMode", "Spacing Mode", "enum", "fixed", "layout", "Fixed gap, space between children, or space evenly.", { enumOptions: opts(["fixed", "Fixed"], ["between", "Space Between"], ["evenly", "Space Evenly"]) }),
  prop("spacing", "Spacing", "number", 0, "layout", "Gap between children in points (Fixed mode). In Grid, used for both axes.", { min: 0 }),
  prop("padding", "Padding", "point4d", [0, 0, 0, 0], "layout", "Inner padding [top, right, bottom, left] in points."),
  prop("alignment", "Alignment", "enum", "topLeft", "layout", "Where children sit inside the container.", { enumOptions: ALIGNMENTS }),
  prop("clip", "Clip Contents", "boolean", false, "layout", "Hide children outside the container's bounds."),
];

const outputs = (...ports: PortSpec[]) => ports;

export const LAYER_TYPES: LayerTypeSpec[] = [
  {
    type: "group",
    name: "Group",
    category: "container",
    summary: "A container for other layers, with optional fill, border, clipping, and automatic layout.",
    canHaveChildren: true,
    props: [...COMMON_PROPS, prop("color", "Fill", "color", "#00000000", "fill", "Background color (transparent by default)."), ...CORNER_PROPS, ...STROKE_PROPS, ...LAYOUT_CONTAINER_PROPS],
    origami: { id: "builtin.layer.group", name: "Group" },
  },
  {
    type: "rectangle",
    name: "Rectangle",
    category: "shape",
    summary: "A rectangle with fill, rounded corners, and an optional border.",
    canHaveChildren: false,
    props: [...COMMON_PROPS, ...FILL_PROPS, ...CORNER_PROPS, ...STROKE_PROPS],
    origami: { name: "Rectangle" },
  },
  {
    type: "oval",
    name: "Oval",
    category: "shape",
    summary: "An ellipse that fills its size.",
    canHaveChildren: false,
    props: [...COMMON_PROPS, ...FILL_PROPS, ...STROKE_PROPS],
    origami: { name: "Oval" },
  },
  {
    type: "text",
    name: "Text",
    category: "basic",
    summary: "A block of text. Auto width/height hug the text by default.",
    canHaveChildren: false,
    props: [
      ...COMMON_PROPS.map((p) => (p.key === "widthMode" || p.key === "heightMode" ? { ...p, default: "auto" } : p)),
      prop("text", "Text", "text", "Text", "content", "The text to display.", sub("multiline")),
      ...TEXT_STYLE_PROPS,
      prop("verticalAlignment", "Vertical Alignment", "enum", "top", "text", "Vertical alignment within the layer's height.", { enumOptions: opts(["top", "Top"], ["center", "Center"], ["bottom", "Bottom"]) }),
      prop("textDecoration", "Decoration", "enum", "none", "text", "Underline or strikethrough.", { enumOptions: opts(["none", "None"], ["underline", "Underline"], ["strikethrough", "Strikethrough"]), advanced: true }),
      prop("textTransform", "Transform", "enum", "none", "text", "Change letter case.", { enumOptions: opts(["none", "None"], ["uppercase", "UPPERCASE"], ["lowercase", "lowercase"], ["capitalize", "Capitalize"]), advanced: true }),
      prop("maxLines", "Max Lines", "number", 0, "text", "Limit visible lines; 0 = unlimited.", { min: 0, step: 1, advanced: true }),
      prop("truncation", "Truncation", "enum", "end", "text", "How overflowing text is cut off when Max Lines is set.", { enumOptions: opts(["end", "End …"], ["middle", "Middle …"], ["clip", "Clip"]), advanced: true }),
    ],
    outputs: outputs({ key: "textSize", name: "Text Size", type: "size", description: "Measured size of the rendered text (next frame)." }),
    origami: { id: "builtin.layer.text", name: "Text Layer" },
  },
  {
    type: "image",
    name: "Image",
    category: "media",
    summary: "Displays an image asset or URL.",
    canHaveChildren: false,
    props: [
      ...COMMON_PROPS,
      prop("image", "Image", "image", null, "content", "Image asset (drop a file) or an image value from a patch."),
      prop("fillMode", "Fill Mode", "enum", "fill", "content", "How the image fits the layer bounds.", { enumOptions: FILL_MODES }),
      ...CORNER_PROPS,
      ...STROKE_PROPS,
    ],
    outputs: outputs({ key: "naturalSize", name: "Natural Size", type: "size", description: "The image's intrinsic size." }, { key: "loading", name: "Loading", type: "boolean", description: "True while the image is loading." }),
    origami: { name: "Image Layer" },
  },
  {
    type: "video",
    name: "Video",
    category: "media",
    summary: "Plays a video asset with play, loop, rate, and scrub controls.",
    canHaveChildren: false,
    props: [
      ...COMMON_PROPS,
      prop("video", "Video", "video", null, "content", "Video asset or URL."),
      prop("playing", "Play", "boolean", true, "content", "Plays while true."),
      prop("loop", "Loop", "boolean", true, "content", "Restart at the end."),
      prop("volume", "Volume", "number", 1, "content", "0 = muted, 1 = full volume.", { ...sub("progress"), min: 0, max: 1 }),
      prop("rate", "Rate", "number", 1, "content", "Playback speed multiplier."),
      prop("scrub", "Scrub", "boolean", false, "content", "When on, Scrub Time controls the frame shown."),
      prop("scrubTime", "Scrub Time", "number", 0, "content", "Time in seconds shown while Scrub is on.", sub("duration")),
      prop("fillMode", "Fill Mode", "enum", "fill", "content", "How the video fits the layer bounds.", { enumOptions: FILL_MODES }),
      ...CORNER_PROPS,
    ],
    outputs: outputs(
      { key: "currentTime", name: "Current Time", type: "number", subtype: "duration", description: "Playback position in seconds." },
      { key: "duration", name: "Duration", type: "number", subtype: "duration", description: "Video length in seconds." },
      { key: "naturalSize", name: "Natural Size", type: "size", description: "The video's intrinsic size." },
    ),
    origami: { name: "Video Layer" },
  },
  {
    type: "shape",
    name: "Shape",
    category: "shape",
    summary: "A vector path (from shape patches or drawn) with fill, stroke, and stroke trimming.",
    canHaveChildren: false,
    props: [
      ...COMMON_PROPS,
      prop("shape", "Shape", "shape", null, "content", "Path data in layer-local points."),
      ...FILL_PROPS.map((p) => (p.key === "color" ? { ...p, default: "#000000FF" } : p)),
      ...STROKE_PROPS.filter((p) => p.key !== "strokePosition"),
      prop("strokeStart", "Stroke Start", "number", 0, "stroke", "Trim the start of the stroke (0..1).", { ...sub("progress"), min: 0, max: 1 }),
      prop("strokeEnd", "Stroke End", "number", 1, "stroke", "Trim the end of the stroke (0..1).", { ...sub("progress"), min: 0, max: 1 }),
      prop("lineCap", "Line Cap", "enum", "round", "stroke", "Stroke end style.", { enumOptions: opts(["butt", "Butt"], ["round", "Round"], ["square", "Square"]), advanced: true }),
      prop("lineJoin", "Line Join", "enum", "round", "stroke", "Stroke corner style.", { enumOptions: opts(["miter", "Miter"], ["round", "Round"], ["bevel", "Bevel"]), advanced: true }),
    ],
    origami: { name: "Shape" },
  },
  {
    type: "colorFill",
    name: "Color Fill",
    category: "basic",
    summary: "Fills its parent's bounds with a color (handy for backgrounds and tints).",
    canHaveChildren: false,
    props: [prop("enabled", "Enabled", "boolean", true, "basics", "When off, the fill is hidden."), prop("color", "Color", "color", "#FFFFFFFF", "fill", "Fill color."), prop("opacity", "Opacity", "number", 1, "basics", "Fill opacity.", { ...sub("progress"), min: 0, max: 1 }), prop("blendMode", "Blend Mode", "enum", "normal", "filters", "Blend mode.", { enumOptions: BLEND_MODES })],
    origami: { name: "Color Fill" },
  },
  {
    type: "gradient",
    name: "Gradient",
    category: "basic",
    summary: "A layer filled with a linear, radial, or angular gradient.",
    canHaveChildren: false,
    props: [...COMMON_PROPS, prop("gradient", "Gradient", "gradient", { kind: "linear", stops: [{ offset: 0, color: { r: 1, g: 1, b: 1, a: 1 } }, { offset: 1, color: { r: 0, g: 0, b: 0, a: 1 } }], start: [0.5, 0], end: [0.5, 1] }, "fill", "Gradient stops and direction."), ...CORNER_PROPS],
    origami: { name: "Gradient Fill" },
  },
  {
    type: "hitArea",
    name: "Hit Area",
    category: "basic",
    summary: "An invisible touch target. Use it to make a tap region bigger or independent of visuals.",
    canHaveChildren: false,
    props: [...COMMON_PROPS.filter((p) => ["enabled", "position", "size", "anchor", "positioning", "widthMode", "heightMode", "hitSlop", "cursor"].includes(p.key)), prop("showInEditor", "Show in Editor", "boolean", true, "basics", "Draw a translucent overlay while editing so you can see the target.")],
    origami: { id: "origami.hitarea", name: "Hit Area" },
  },
  {
    type: "textField",
    name: "Text Field",
    category: "advanced",
    summary: "An editable text input. Read what people type from its outputs.",
    canHaveChildren: false,
    props: [
      ...COMMON_PROPS,
      prop("text", "Text", "text", "", "content", "Current text (set it to change the field's contents)."),
      prop("placeholder", "Placeholder", "text", "Placeholder", "content", "Shown when empty."),
      ...TEXT_STYLE_PROPS,
      prop("placeholderColor", "Placeholder Color", "color", "#00000066", "text", "Placeholder text color."),
      prop("multiline", "Multiline", "boolean", false, "content", "Allow multiple lines."),
      prop("secure", "Secure", "boolean", false, "content", "Hide characters (passwords)."),
      prop("keyboardType", "Keyboard", "enum", "default", "content", "Keyboard hint on mobile.", { enumOptions: opts(["default", "Default"], ["number", "Number"], ["email", "Email"], ["url", "URL"], ["phone", "Phone"]) }),
      prop("focused", "Focused", "boolean", false, "content", "Set true to focus the field."),
    ],
    outputs: outputs(
      { key: "value", name: "Text", type: "text", description: "What's currently typed." },
      { key: "isFocused", name: "Is Focused", type: "boolean", description: "True while editing." },
      { key: "submitted", name: "Submitted", type: "pulse", description: "Pulses when Return is pressed." },
    ),
    origami: { id: "builtin.layer.textInput", name: "Text Input" },
  },
  {
    type: "lottie",
    name: "Lottie",
    category: "media",
    summary: "Plays a Lottie animation (JSON or dotLottie).",
    canHaveChildren: false,
    props: [
      ...COMMON_PROPS,
      prop("animation", "Animation", "json", null, "content", "Lottie JSON asset, URL, or inline Bodymovin JSON."),
      prop("playing", "Play", "boolean", true, "content", "Plays while true."),
      prop("loop", "Loop", "boolean", true, "content", "Restart at the end."),
      prop("rate", "Rate", "number", 1, "content", "Speed; negative plays backwards."),
      prop("scrub", "Scrub", "boolean", false, "content", "When on, Scrub Time controls the frame shown."),
      prop("scrubTime", "Scrub Time", "number", 0, "content", "Time in seconds while scrubbing.", sub("duration")),
      prop("fillMode", "Fill Mode", "enum", "fit", "content", "How the animation fits the bounds.", { enumOptions: FILL_MODES.filter((o) => o.key !== "tile") }),
    ],
    outputs: outputs({ key: "currentTime", name: "Current Time", type: "number", subtype: "duration", description: "Playback time." }, { key: "duration", name: "Duration", type: "number", subtype: "duration", description: "Animation length." }),
    origami: { name: "Lottie Animation" },
  },
  {
    type: "shader",
    name: "Shader",
    category: "advanced",
    summary: "A GPU fragment shader (GLSL ES 3.0, ShaderToy-style) that fills the layer. Sample images through iChannel0–iChannel3.",
    canHaveChildren: true,
    props: [
      ...COMMON_PROPS,
      prop("code", "Shader Code", "text", "void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n  vec2 uv = fragCoord / iResolution.xy;\n  fragColor = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0);\n}\n", "content", "GLSL fragment code defining mainImage(out vec4, in vec2). Uniforms: iResolution, iTime, iTimeDelta, iFrame, iMouse, iChannel0–iChannel3 and iChannelResolution (images set in Uniforms).", sub("code")),
      prop("uniforms", "Uniforms", "json", null, "content", "Extra uniform values by name ({\"uStrength\": 0.5}). Texture uniforms take an image: {\"iChannel0\": {\"asset\": \"photo\", \"wrap\": \"clamp\"}}.", { advanced: true }),
      ...CORNER_PROPS,
    ],
    origami: { id: "builtin.layer.shader", name: "Shader" },
  },
  {
    type: "clone",
    name: "Clone",
    category: "advanced",
    summary: "A live copy of another layer with its own position, scale, rotation, and opacity.",
    canHaveChildren: false,
    props: [...COMMON_PROPS, prop("source", "Source Layer", "layer", null, "content", "The layer to copy.")],
    origami: { id: "builtin.layer.clone", name: "Clone Layer" },
  },
  {
    type: "componentInstance",
    name: "Component",
    category: "component",
    summary: "An instance of a layer component. Its extra properties come from the component's published inputs.",
    canHaveChildren: true,
    props: [...COMMON_PROPS],
  },
];

export const LAYER_TYPE_MAP: ReadonlyMap<string, LayerTypeSpec> = new Map(LAYER_TYPES.map((t) => [t.type, t]));
