/**
 * Learn drawer: guides bundled from docs/guides (with the README's level map), a safe Markdown
 * renderer, the patch reference from registry specs, and "Try it" for bundled examples.
 *
 * Mount inside <EditorProvider> (for the registry and opening examples), e.g. in DrawerHost:
 *
 *   <DrawerHost learn={
 *     <LearnDrawer
 *       onClose={() => layoutStore.getState().setDrawer(null)}
 *       onConnectClaude={() => connectClaudeStore.getState().show()}   // from panels/connect
 *       onInsertPatch={(type) => insertPatch(type)}                    // optional
 *       view={learnView}                                              // optional: open a guide or patch
 *     />
 *   } />
 *
 * Props (all optional): onClose, view / defaultView / onViewChange (LearnView: { kind: "home" } |
 * { kind: "guide", slug, anchor? } | { kind: "patches", type? }), onConnectClaude, onInsertPatch,
 * className. The drawer fills its container. Last view and opened guides persist per viewer.
 */

export { LearnDrawer, type LearnDrawerProps } from "./LearnDrawer.tsx";
export { Markdown, type MarkdownProps } from "./Markdown.tsx";
export { GuideReader, GUIDE_ID_PREFIX, type GuideReaderProps } from "./GuideReader.tsx";
export { GuideHome, type GuideHomeProps } from "./GuideHome.tsx";
export { PatchReference, type PatchReferenceProps } from "./PatchReference.tsx";
export type { LearnView } from "./learnStorage.ts";
export { collectLinks, inlineText, parseInline, parseMarkdown, sanitizeHref, slugify, type HeadingLevel, type MdAlign, type MdBlock, type MdInline } from "./markdown.ts";
export {
  CLAUDE_GUIDE_SLUG,
  createGuideCatalog,
  getGuideCatalog,
  guideSlug,
  parseGuide,
  parseLevelMap,
  README_SLUG,
  resolveGuideHref,
  searchGuides,
  type Guide,
  type GuideCatalog,
  type GuideHeading,
  type GuideLink,
  type GuideSearchResult,
  type LevelRow,
} from "./guides.ts";
export { examplesForGuide, examplesUsingPatch, getExamples, groupExampleFiles, loadExampleDocument, openExample, type ExampleProject, type OpenExampleResult, type OpenExampleTarget } from "./examples.ts";
export { formatPortDefault, listPatchReference, patchAvailability, patchPortRows, searchPatchReference, type PatchReferenceItem, type PortRow } from "./patchReference.ts";
export * from "./lessons/index.ts";
