/**
 * Sonobe's MCP tools, in process: createSonobeMcpServer over the app's SonobeHost, connected to an
 * MCP client named "Assistant" over an in-memory transport. The server attributes every edit to the
 * client's name, so the Assistant's changes show up as "Assistant" in history and AI Activity and go
 * through the same validation, delete confirmation, and "Read only" guard as Claude Desktop and
 * Claude Code. Also converts tools and results to the Messages API shapes.
 */

import type { BetaImageBlockParam, BetaTextBlockParam, BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createSonobeMcpServer, type GuideStore, type SonobeHost } from "@sonobe/mcp";

/** The client name the MCP server turns into the history author. */
export const ASSISTANT_AUTHOR_NAME = "Assistant";

/** Tool results longer than this are cut, with a note telling Claude to ask for less. */
export const MAX_TOOL_RESULT_CHARS = 150_000;

/**
 * MCP tools the Assistant isn't given. The canvas already draws its import_design html while Claude
 * writes it (design_draft events), so preview_design would only draw the page twice. The server
 * instructions' lines that name them are left out too.
 */
export const ASSISTANT_HIDDEN_TOOLS: ReadonlySet<string> = new Set(["preview_design"]);

export interface ToolContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface ToolCallResult {
  content: ToolContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  /** The MCP result's _meta (import_design's "dev.sonobe/import"). */
  meta?: Record<string, unknown>;
}

export interface AssistantToolInfo {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** The tool never changes the document. */
  readOnly: boolean;
}

export interface LocalToolScope { conversationId: string; runId: string; projectPath: string | null; signal: AbortSignal }
/** Tools of the Assistant's own that run in the main process (the code folder tools). Not MCP tools. */
export interface LocalTools {
  /** Listed after the MCP tools in a fixed order, always, so the cached prefix never changes. */
  readonly infos: readonly AssistantToolInfo[];
  call(name: string, input: Record<string, unknown>, scope: LocalToolScope): Promise<ToolCallResult>;
  /** A chat was reset or its window closed. */
  forget(conversationId: string): void;
}

export interface ToolCallOptions {
  /** Aborting cancels the call (the server gets notifications/cancelled, and a cancelled call never changes the document). */
  signal?: AbortSignal;
  /** Where a long call is ("Downloading images: 7 of 28"), from the tool's progress notifications. */
  onProgress?(message: string): void;
}

export interface ToolBridge {
  /** Every tool but ASSISTANT_HIDDEN_TOOLS, in the server's registration order (stable, so prompt caching holds). */
  tools(): Promise<readonly AssistantToolInfo[]>;
  /** The MCP server's instructions. */
  instructions(): Promise<string>;
  call(name: string, args: Record<string, unknown>, options?: ToolCallOptions): Promise<ToolCallResult>;
  close(): Promise<void>;
}

export interface McpToolBridgeOptions {
  host: SonobeHost;
  version: string;
  guides?: GuideStore;
}

interface Connection {
  client: Client;
  tools: AssistantToolInfo[];
  instructions: string;
  close(): Promise<void>;
}

/** The server instructions without the lines that teach a tool the Assistant isn't given. */
function withoutHiddenTools(instructions: string): string {
  return instructions
    .split("\n")
    .filter((line) => ![...ASSISTANT_HIDDEN_TOOLS].some((name) => new RegExp(`\\b${name}\\b`).test(line)))
    .join("\n");
}

export function createMcpToolBridge(options: McpToolBridgeOptions): ToolBridge {
  let connecting: Promise<Connection> | null = null;

  const connect = (): Promise<Connection> =>
    (connecting ??= (async () => {
      const server = createSonobeMcpServer(options.host, { version: options.version, ...(options.guides ? { guides: options.guides } : {}) });
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await server.connect(serverSide);
      const client = new Client({ name: ASSISTANT_AUTHOR_NAME, version: options.version });
      await client.connect(clientSide);
      const listed = await client.listTools();
      const tools: AssistantToolInfo[] = listed.tools.filter((tool) => !ASSISTANT_HIDDEN_TOOLS.has(tool.name)).map((tool) => {
        const annotations = (tool.annotations ?? {}) as { title?: unknown; readOnlyHint?: unknown };
        const title = typeof tool.title === "string" ? tool.title : typeof annotations.title === "string" ? annotations.title : tool.name;
        return { name: tool.name, title, description: tool.description ?? "", inputSchema: tool.inputSchema as Record<string, unknown>, readOnly: annotations.readOnlyHint === true };
      });
      return {
        client,
        tools,
        instructions: withoutHiddenTools(client.getInstructions() ?? ""),
        async close() {
          await client.close().catch(() => undefined);
          await server.close().catch(() => undefined);
        },
      };
    })().catch((err: unknown) => {
      connecting = null;
      throw err;
    }));

  return {
    tools: async () => (await connect()).tools,
    instructions: async () => (await connect()).instructions,
    async call(name, args, callOptions = {}) {
      const { client } = await connect();
      // Asking for progress sends a progressToken, so long calls (import_design) report steps and
      // heartbeats, and each one restarts the SDK's 60 s request timeout.
      const result = (await client.callTool(
        { name, arguments: args },
        {
          ...(callOptions.signal ? { signal: callOptions.signal } : {}),
          onprogress: (progress) => {
            if (progress.message) callOptions.onProgress?.(progress.message);
          },
          resetTimeoutOnProgress: true,
        },
      )) as unknown as ToolCallResult & { _meta?: Record<string, unknown> };
      return {
        content: Array.isArray(result.content) ? result.content : [],
        ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
        ...(result.isError ? { isError: true } : {}),
        ...(result._meta ? { meta: result._meta } : {}),
      };
    },
    async close() {
      const pending = connecting;
      connecting = null;
      if (pending) await (await pending.catch(() => null))?.close();
    },
  };
}

/** Messages API tool definitions (eager input streaming; the MCP server validates every input). */
export function toAnthropicTools(tools: readonly AssistantToolInfo[]): BetaTool[] {
  return tools.map((tool) => {
    const { $schema: _schema, ...schema } = tool.inputSchema;
    const description = tool.title && tool.title !== tool.name ? `${tool.title}. ${tool.description}` : tool.description;
    return {
      name: tool.name,
      description,
      input_schema: { ...schema, type: "object" } as BetaTool.InputSchema,
      eager_input_streaming: true,
    };
  });
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** A tool result as tool_result content: text blocks and screenshots. */
export function toolResultContent(result: ToolCallResult, maxChars = MAX_TOOL_RESULT_CHARS): Array<BetaTextBlockParam | BetaImageBlockParam> {
  const blocks: Array<BetaTextBlockParam | BetaImageBlockParam> = [];
  let budget = maxChars;
  for (const item of result.content) {
    if (item.type === "text" && typeof item.text === "string") {
      if (budget <= 0) continue;
      const text = item.text.length > budget ? `${item.text.slice(0, budget)}\n… (cut off after ${maxChars.toLocaleString("en-US")} characters; ask for fewer items or a narrower query)` : item.text;
      budget -= item.text.length;
      if (text) blocks.push({ type: "text", text });
    } else if (item.type === "image" && typeof item.data === "string" && item.mimeType && IMAGE_TYPES.has(item.mimeType)) {
      blocks.push({ type: "image", source: { type: "base64", media_type: item.mimeType as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data: item.data } });
    }
  }
  if (blocks.length === 0 && result.structuredContent) blocks.push({ type: "text", text: JSON.stringify(result.structuredContent).slice(0, maxChars) });
  if (blocks.length === 0) blocks.push({ type: "text", text: result.isError ? "The tool failed without a message." : "Done." });
  return blocks;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const namesOf = (items: unknown[]): string[] =>
  items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { name, type } = item as { name?: unknown; type?: unknown };
    return typeof name === "string" ? [name] : typeof type === "string" ? [type] : [];
  });

/** A short, human description of what a tool call is about (for activity chips). */
export function describeToolInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  for (const key of ["intent", "label", "topic", "query", "name", "path"]) {
    if (typeof o[key] === "string" && o[key]) return clip(key === "query" ? `“${o[key] as string}”` : (o[key] as string), 80);
  }
  for (const key of ["layers", "patches", "updates"]) {
    const list = o[key];
    if (Array.isArray(list) && list.length) {
      const names = namesOf(list);
      return clip(names.length ? names.join(", ") : `${list.length} ${key}`, 80);
    }
  }
  if (Array.isArray(o.ops)) return `${o.ops.length} op${o.ops.length === 1 ? "" : "s"}`;
  if (Array.isArray(o.connections)) return `${o.connections.length} connection${o.connections.length === 1 ? "" : "s"}`;
  if (Array.isArray(o.ids)) return `${o.ids.length} item${o.ids.length === 1 ? "" : "s"}`;
  if (Array.isArray(o.types)) return clip((o.types as unknown[]).filter((t) => typeof t === "string").join(", "), 80);
  return "";
}

/** The first line of a result, for activity chips. */
export function describeToolResult(result: ToolCallResult): string {
  for (const item of result.content) {
    if (item.type === "text" && typeof item.text === "string") {
      const line = item.text.split("\n").find((l) => l.trim());
      if (line) return clip(line.trim(), 140);
    }
    if (item.type === "image") return "Screenshot";
  }
  return result.isError ? "Failed" : "Done";
}
