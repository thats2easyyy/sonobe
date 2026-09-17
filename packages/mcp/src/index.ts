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
  ADDITIVE,
  authorFromClientName,
  createSonobeMcpServer,
  DESTRUCTIVE,
  PROMPT_NAMES,
  READ_ONLY,
  serverInstructions,
  SIMULATION,
  TOOL_NAMES,
  UI_ONLY,
  type SonobeMcpServerOptions,
  type ToolName,
} from "./server.ts";
export {
  createHttpHandler,
  serveStdioHost,
  type NodeMcpHandler,
  type StdioHandle,
  type StdioOptions,
  type TransportOptions,
} from "./transports.ts";
export { createTemplateDocument, TEMPLATES, templateOps, type TemplateInfo } from "./templates.ts";
export { explain, type Audience, type ExplainOptions } from "./explain.ts";
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
  describeLayerType,
  describePatchType,
  isImplemented,
  patchTypeData,
  searchPatchTypes,
  valueTypesText,
} from "./catalog.ts";
export { formatValue, roundForDisplay, sampleIndices, table, toJsonValue } from "./format.ts";
export { parseSimEvents, SimEventSchema, SimEventsSchema } from "./schemas.ts";
export { summaryText, traceTable } from "./tools/simulate.ts";
export { tidyOps, type TidyOptions } from "./tidy.ts";
