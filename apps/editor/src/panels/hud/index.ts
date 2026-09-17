/**
 * Bottom HUD: Console, Diagnostics, AI Activity, and Performance.
 *
 * Mount inside <EditorProvider> (and <CommandProvider> so tooltips show shortcuts). <Hud> fills its
 * container (height: 100%). Every prop is optional:
 *
 *   <Hud
 *     tab={layout.hudTab}                                   // "console" | "diagnostics" | "ai" | "performance"
 *     onTabChange={(tab) => layoutStore.getState().setHudTab(tab)}
 *     collapsed={layout.collapsed.hud}
 *     onToggleCollapse={() => layoutStore.getState().toggleCollapsed("hud")}
 *     onConnectClaude={() => connectClaudeStore.getState().show()}   // from panels/connect
 *   />
 *
 * The individual views also work as BottomHud slots (each fills a sized container). Revealing an
 * item selects it (entering its component) and publishes `selection.requestReveal`, which the layer
 * list, canvas, and patch editor should scroll to.
 */

export { Hud, type HudProps, type HudTabId } from "./Hud.tsx";
export { ConsoleView } from "./ConsoleView.tsx";
export { DiagnosticsView } from "./DiagnosticsView.tsx";
export { AiActivityView, type AiActivityViewProps } from "./AiActivityView.tsx";
export { PerformanceView } from "./PerformanceView.tsx";
export { SampleChart, type SampleChartProps } from "./SampleChart.tsx";
export { useActivityFeed, useHudCounts, useHudDiagnostics, useNow, usePerfSamples, type HudCounts, type PerfSamplesOptions } from "./hooks.ts";
export { revealItems, type RevealTarget } from "./reveal.ts";
export {
  ALL_CONSOLE_LEVELS,
  CONSOLE_LEVELS,
  componentForPath,
  consoleEntryTarget,
  filterConsoleEntries,
  formatConsoleTime,
  scriptLocation,
  type ConsoleFilter,
  type ConsoleLevelFilter,
  type ConsoleSourceTarget,
  type ScriptLocation,
} from "./consoleModel.ts";
export {
  adviceSuggestions,
  ALL_SEVERITIES,
  applyDiagnosticFix,
  countBySeverity,
  diagnosticKey,
  filterDiagnostics,
  fixableSuggestions,
  fixLabel,
  mergeDiagnostics,
  SEVERITIES,
  type DiagnosticSource,
  type FixOutcome,
  type FixSuggestion,
  type HudDiagnostic,
  type SeverityFilter,
} from "./diagnosticsModel.ts";
export { deriveActivityFeed, formatRelativeTime, undoActionLabel, type ActivityInput, type ActivityItem, type ActivityStatus, type ChangeActivity, type NoteActivity, type WorkingActivity } from "./activityModel.ts";
export { documentStats, formatMs, frameBudgetShare, patchTimingsOf, pushSample, sceneStats, smoothness, summarizeSamples, type DocumentStats, type PatchTiming, type PerfSample, type PerfSummary, type ReplicatedLayer, type SceneStats, type SmoothnessTone } from "./perfModel.ts";
export { isFiltered, toggleFilter } from "./filters.ts";
export { itemDisplayName, summarizeNames } from "./itemNames.ts";
