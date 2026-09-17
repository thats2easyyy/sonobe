/**
 * @sonobe/renderer/svg: static SVG drawings of SceneFrames for headless screenshots. DOM-free.
 */

export { findSceneNode, renderSceneSvg, sceneNodeBounds, sceneToSvg, walkSceneNodes } from "./sceneToSvg.ts";
export type { SceneToSvgOptions, SvgAsset, SvgRect, SvgRender } from "./sceneToSvg.ts";
export { pathDataLength } from "./pathLength.ts";
export { approximateTextWidth, textLineHeight, truncateLines, wrapText } from "./text.ts";
export type { SvgTextStyle, TextWidth } from "./text.ts";
