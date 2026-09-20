/**
 * @sonobe/renderer/svg: static SVG drawings of SceneFrames and patch graphs for headless screenshots. DOM-free.
 */

export { findSceneNode, renderSceneSvg, sceneNodeBounds, sceneToSvg, walkSceneNodes } from "./sceneToSvg.ts";
export type { SceneToSvgOptions, SvgAsset, SvgRect, SvgRender } from "./sceneToSvg.ts";
export { graphToSvg } from "./graphToSvg.ts";
export type { GraphSvg, GraphSvgOptions } from "./graphToSvg.ts";
export { pathDataLength } from "./pathLength.ts";
export { approximateTextWidth, textLineHeight, truncateLines, wrapText } from "./text.ts";
export type { SvgTextStyle, TextWidth } from "./text.ts";
