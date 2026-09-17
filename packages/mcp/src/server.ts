/**
 * createSonobeMcpServer: the MCP surface of ARCHITECTURE §10 (tools, resources, prompts) over a
 * SonobeHost. One factory serves every transport and protocol era; handlers are stateless apart
 * from what the host keeps (documents, history, simulations).
 */

import type { Author } from "@sonobe/core";
import {
  McpServer,
  type CallToolResult,
  type ServerContext,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";
import type { z } from "zod";
import { defaultGuides, type GuideStore } from "./guides.ts";
import type { SonobeHost } from "./host.ts";
import { registerPrompts } from "./prompts.ts";
import { registerResources } from "./resources.ts";
import { guarded } from "./results.ts";
import { registerDiscoveryTools } from "./tools/discovery.ts";
import { registerDocumentTools } from "./tools/documents.ts";
import { registerPresenceTools } from "./tools/presence.ts";
import { registerReadTools } from "./tools/read.ts";
import { registerSimulationTools } from "./tools/simulate.ts";
import { registerWriteTools } from "./tools/write.ts";

export interface SonobeMcpServerOptions {
  /** Server version reported to clients. */
  version: string;
  /** Server name (default "sonobe"). */
  name?: string;
  /** Guide store (default: packages/mcp/guides). */
  guides?: GuideStore;
  /** Replace the default instructions. */
  instructions?: string;
}

/** Every tool, in registration order (ARCHITECTURE §10). */
export const TOOL_NAMES = [
  "get_guide",
  "list_patch_types",
  "describe_patch_types",
  "describe_layer_types",
  "list_value_types",
  "list_documents",
  "open_document",
  "create_document",
  "get_document_info",
  "save_document",
  "get_outline",
  "get_layers",
  "get_patches",
  "get_items",
  "find",
  "get_selection",
  "get_diagnostics",
  "explain",
  "apply_ops",
  "add_layers",
  "add_patches",
  "connect",
  "set_values",
  "update_layers",
  "delete_items",
  "rename",
  "create_component",
  "tidy_graph",
  "sim_reset",
  "sim_dispatch",
  "sim_step",
  "sim_trace",
  "sim_get_values",
  "get_screenshot",
  "begin_work",
  "finish_work",
  "reveal",
  "list_history",
  "undo",
] as const;

export const PROMPT_NAMES = [
  "prototype_interaction",
  "debug_interaction",
  "explain_prototype",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
export const ADDITIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
export const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};
/** Changes presence or layout state people see, not document semantics. */
export const UI_ONLY: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
/** Simulations never change the document. */
export const SIMULATION: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

export interface ToolContext {
  host: SonobeHost;
  server: McpServer;
  options: SonobeMcpServerOptions;
  guides(): GuideStore;
  /** The agent attributed in history ("Claude", or the client's name). */
  author(ctx: ServerContext): Author;
  /** Register a tool with teaching-error handling. */
  tool<S extends z.ZodObject>(
    name: ToolName,
    config: {
      title: string;
      description: string;
      input: S;
      output?: z.ZodObject;
      annotations: ToolAnnotations;
    },
    handler: (args: z.infer<S>, ctx: ServerContext) => Promise<CallToolResult>,
  ): void;
}

function clientName(server: McpServer, ctx: ServerContext): string | undefined {
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
  const info = (envelope?.["io.modelcontextprotocol/clientInfo"] ??
    server.server.getClientVersion()) as { name?: unknown; title?: unknown } | undefined;
  const name =
    typeof info?.title === "string"
      ? info.title
      : typeof info?.name === "string"
        ? info.name
        : undefined;
  return name?.trim() || undefined;
}

/** "Claude" for Claude clients (claude-code, claude-ai...), otherwise the client's own name. */
export function authorFromClientName(name: string | undefined): Author {
  if (!name || /claude/i.test(name)) return { kind: "agent", name: "Claude" };
  const pretty = name.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { kind: "agent", name: pretty.slice(0, 40) };
}

/** The instructions sent at initialize/discover. */
export function serverInstructions(host: SonobeHost): string {
  const lines = [
    "Sonobe is an interaction prototyping tool: layers (what people see) plus a patch graph (the logic) with a live viewer. These tools edit the person's Sonobe document through the same ops, validation and undo history as their own clicks.",
    "",
    "Workflow:",
    '1. Call get_guide("start-here") once per conversation (again after your context is compacted).',
    "2. Call get_document_info, then get_outline, before changing anything. Use ids exactly as the outline shows them; never guess.",
    "3. Before wiring patches, look them up with list_patch_types and describe_patch_types so port keys, types and defaults are real.",
    "4. Call begin_work with a short intent before editing, and finish_work when you're done.",
    '5. Build in small batches (one feature at a time) with add_layers, add_patches (with connections), connect, set_values or apply_ops. Give new items a "ref" and wire them with "$ref.port" in the same batch. Every write returns ids, the new revision and diagnostics added/resolved; pass expectedRevision so you never overwrite edits the person made meanwhile.',
    "6. Verify before claiming it works: get_diagnostics, then sim_reset → sim_dispatch (tap, drag...) → sim_step or sim_trace on the layer properties that should change.",
    "7. When talking to the person, name layers and patches by their display names (the Card's scale), not raw ids, addresses or JSON.",
  ];
  if (host.kind === "headless") {
    lines.push(
      "",
      `This server is running headless over a project folder: no screenshots or editor selection. ${host.capabilities.autosave ? "Changes are saved to disk automatically." : "Call save_document to write changes to disk."}`,
    );
  }
  return lines.join("\n");
}

/** Build an MCP server over a host. Create one per HTTP request or stdio connection. */
export function createSonobeMcpServer(
  host: SonobeHost,
  options: SonobeMcpServerOptions,
): McpServer {
  const server = new McpServer(
    { name: options.name ?? "sonobe", title: "Sonobe", version: options.version },
    {
      instructions: options.instructions ?? serverInstructions(host),
      capabilities: { tools: {}, resources: {}, prompts: {} },
    },
  );
  const tc: ToolContext = {
    host,
    server,
    options,
    guides: () => options.guides ?? defaultGuides(),
    author: (ctx) => authorFromClientName(clientName(server, ctx)),
    tool(name, config, handler) {
      const run = guarded(
        handler as (args: unknown, ctx: ServerContext) => Promise<CallToolResult>,
      );
      const registration: Record<string, unknown> = {
        title: config.title,
        description: config.description,
        inputSchema: config.input,
        annotations: { title: config.title, ...config.annotations },
      };
      if (config.output) registration.outputSchema = config.output;
      server.registerTool(
        name,
        registration as never,
        ((args: unknown, ctx: ServerContext) => run(args, ctx)) as never,
      );
    },
  };
  registerDiscoveryTools(tc);
  registerDocumentTools(tc);
  registerReadTools(tc);
  registerWriteTools(tc);
  registerSimulationTools(tc);
  registerPresenceTools(tc);
  registerResources(tc);
  registerPrompts(tc);
  return server;
}
