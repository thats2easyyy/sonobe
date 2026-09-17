/**
 * @sonobe/renderer — DOM renderer for SceneFrames, input capture, text measurement,
 * and CSS device frames. See ARCHITECTURE.md §8.
 */

export { createDomRenderer, lisIndices } from "./renderer.ts";
export type { DomRenderer, DomRendererOptions } from "./renderer.ts";
export type { MediaState, RendererStats, ShaderErrorInfo } from "./host.ts";

export { DomTextMeasurer, applyTextTransform, breakChunks, cssFont, fontStack, wrapParagraph } from "./textMeasurer.ts";
export type { DomTextMeasurerOptions, TextLayout, TextStyle } from "./textMeasurer.ts";

export { createDeviceFrame, getDeviceFrameLayout, orientSafeArea } from "./deviceFrame.ts";
export type { DeviceButton, DeviceCutout, DeviceFrame, DeviceFrameLayout, DeviceFrameOptions, Orientation, SafeArea } from "./deviceFrame.ts";

export { attachInputCapture, clientToPrototype, effectiveScale } from "./input.ts";
export type { ClientRectLike, InputCaptureOptions, PointerState } from "./input.ts";

export { cursorAt, findNodesAt } from "./sceneQuery.ts";
export type { SceneHit } from "./sceneQuery.ts";

export { buildFragmentSource, parseShaderLog, ShaderHost } from "./shader.ts";
export type { FragmentSource, ShaderCompileError, ShaderInputs } from "./shader.ts";

export { cssGradient } from "./gradient.ts";
export { squirclePath } from "./squircle.ts";
export type { CornerRadii } from "./squircle.ts";
export { cssTransform, projectPoint, unprojectPoint } from "./matrix.ts";
export { cssColor, parseColor } from "./values.ts";
export { writtenStyle } from "./style.ts";
