/**
 * @sonobe/renderer — DOM renderer for SceneFrames, input capture, text measurement,
 * CSS device frames, and the browser's platform services for live prototypes. See ARCHITECTURE.md §8.
 */

export { createDomRenderer, lisIndices } from "./renderer.ts";
export type { DomRenderer, DomRendererOptions } from "./renderer.ts";
export type { MediaState, RendererStats, ShaderErrorInfo } from "./host.ts";

export { DomTextMeasurer, applyTextTransform, breakChunks, cssFont, fontStack, wrapParagraph } from "./textMeasurer.ts";
export type { DomTextMeasurerOptions, TextLayout, TextStyle } from "./textMeasurer.ts";

export { createDeviceFrame, getDeviceFrameLayout, orientSafeArea } from "./deviceFrame.ts";
export type { DeviceButton, DeviceCutout, DeviceFrame, DeviceFrameLayout, DeviceFrameOptions, Orientation, SafeArea } from "./deviceFrame.ts";

export { attachInputCapture, buttonsOf, clientToPrototype, effectiveScale, eventTime, pointerTypeOf } from "./input.ts";
export type { ClientRectLike, InputCaptureOptions, PointerState } from "./input.ts";

export { cursorAt, findNodesAt } from "./sceneQuery.ts";
export type { SceneHit } from "./sceneQuery.ts";

export { buildFragmentSource, parseShaderLog, readTextureSpec, ShaderHost } from "./shader.ts";
export type { FragmentSource, ShaderCompileError, ShaderInputs, TextureFilter, TextureSpec, TextureWrap } from "./shader.ts";

export { advancePlayhead, frameForTime, isLottieData, loadLottiePlayer, readLottieSource } from "./lottie.ts";
export type { LottieLoader, LottiePlayerLike, LottieSource } from "./lottie.ts";

export { createFontAssetRegistry, type FontAssetRegistry } from "./fonts.ts";
export { createBrowserPlatform, createMuteStore, detectMuted, getMuteStore, isMuted, liveKeyOf, OPENABLE_URL_SCHEMES, setMuted } from "./platform.ts";
export type { BrowserPlatform, BrowserPlatformOptions, MuteState, MuteStore, PlatformWindow } from "./platform.ts";
export { createLiveVideoOverlays, type LiveStreams, type LiveVideoOverlays } from "./liveMedia.ts";
export { cssGradient } from "./gradient.ts";
export { squirclePath } from "./squircle.ts";
export type { CornerRadii } from "./squircle.ts";
export { cssTransform, projectPoint, unprojectPoint } from "./matrix.ts";
export { cssColor, parseColor } from "./values.ts";
export { writtenStyle } from "./style.ts";
export { findSceneNode, renderSceneSvg, sceneNodeBounds, sceneToSvg, type SceneToSvgOptions, type SvgAsset, type SvgRender } from "./svg/index.ts";
