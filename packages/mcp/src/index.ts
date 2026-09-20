/**
 * @sonobe/mcp: Sonobe's MCP surface (ARCHITECTURE §10). Tools, resources and prompts over a
 * SonobeHost; HeadlessHost for project folders on disk; Streamable HTTP and stdio transports.
 */

export * from "./host.ts";
export { createHeadlessHost, type HeadlessHost, type HeadlessHostOptions } from "./headless.ts";
export {
  createDocumentSession,
  describeOps,
  diagnosticKey,
  diagnosticTotals,
  diffDiagnostics,
  historyItem,
  type DocumentSession,
  type DocumentSessionOptions,
} from "./session.ts";
export {
  createSimulationManager,
  type SimulationManager,
  type SimulationManagerOptions,
} from "./sim.ts";
export {
  applyOverrides,
  overrideEntries,
  OVERRIDE_OPS,
  type AppliedOverrides,
  type OverrideEntry,
} from "./overrides.ts";
export { isolateSceneLayer, sceneNodesFor } from "./isolate.ts";
export {
  cachedGraphEstimate,
  elkGroupLayout,
  estimateGraphGeometry,
  resolveGraphGeometry,
  type GraphGeometry,
} from "./geometry.ts";
export {
  canvasNotes,
  designScene,
  drawComponentGraph,
  graphNotes,
  type GraphDrawing,
} from "./componentViews.ts";
export {
  ADDITIVE,
  authorFromClientName,
  conformErrorResult,
  createSonobeMcpServer,
  DESTRUCTIVE,
  PROMPT_NAMES,
  READ_ONLY,
  serverInstructions,
  SIMULATION,
  subscribedResources,
  TOOL_NAMES,
  UI_ONLY,
  type SonobeMcpServerOptions,
  type SonobeServerContext,
  type ToolName,
} from "./server.ts";
export {
  callSignal,
  toolWork,
  ToolCancelledError,
  type CallScope,
  type StepOptions,
  type ToolWork,
  type ToolWorkOptions,
} from "./progress.ts";
export {
  ANONYMOUS_CLIENT,
  CLIENT_HEADER,
  clientLabel,
  createClientRegistry,
  isClientId,
  parseHello,
  type ClientRegistry,
  type ClientRegistryOptions,
  type McpClientHello,
  type McpClientState,
  type McpClientStatus,
  type McpClientVia,
} from "./clients.ts";
export {
  createHttpHandler,
  documentResourceUris,
  publishDocumentChange,
  serveStdioHost,
  type NodeMcpHandler,
  type ResourceNotifier,
  type StdioHandle,
  type StdioOptions,
  type TransportOptions,
} from "./transports.ts";
export {
  instanceIds,
  instancePathTo,
  resolveInstancePath,
  splitInstanceAddress,
  type InstanceResolution,
  type InstanceStep,
} from "./instances.ts";
export { createTemplateDocument, TEMPLATES, templateOps, type TemplateInfo } from "./templates.ts";
export {
  checkProjectTarget,
  expandHome,
  isPlaceholderName,
  resolveProjectTarget,
  type ProjectTargetOptions,
  type ProjectTargetProblem,
} from "./projectTarget.ts";
export { explain, type Audience, type ExplainOptions } from "./explain.ts";
export { describeRemovals, hasDestructiveOps, isDestructiveOp, removedItems, type RemovalSummary } from "./removals.ts";
export {
  defaultGuides,
  defaultGuidesDir,
  GUIDE_TOPICS,
  loadGuides,
  parseGuide,
  type Guide,
  type GuideStore,
  type GuideTopic,
} from "./guides.ts";
export {
  copyExampleTexts,
  defaultExamples,
  defaultExamplesDir,
  loadExamples,
  type ExampleCatalog,
  type ExampleEntry,
} from "./examples.ts";
export {
  describeLayerType,
  describePatchType,
  isImplemented,
  patchTypeData,
  searchPatchTypes,
  valueTypesText,
} from "./catalog.ts";
export { formatValue, roundForDisplay, sampleIndices, table, toJsonValue } from "./format.ts";
export {
  parseSimEvents,
  SimEventSchema,
  SimEventsSchema,
  ToolErrorOutputSchema,
  toolOutputSchema,
  type ToolOutputSchema,
} from "./schemas.ts";
export { IMPORT_META_KEY, type ImportResultMeta } from "./tools/import.ts";
export { summaryText, traceTable } from "./tools/simulate.ts";
