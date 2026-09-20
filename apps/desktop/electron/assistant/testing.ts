/** Test helpers for the Assistant: a scripted fake Anthropic client, a fake tool bridge and a stand-in for draft streams. Not imported by app code. */

import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, BetaMessageStreamParams, BetaRawMessageStreamEvent } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { AgentDraftStreams, AnthropicClientLike, MessageStreamLike } from "./agent.ts";
import type { AssistantEvent } from "./protocol.ts";
import type { AssistantToolInfo, ToolBridge, ToolCallOptions, ToolCallResult } from "./toolBridge.ts";

export type FakeBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature?: string }
  /** Its input streams as input_json_delta pieces: `jsonChunks`, else JSON.stringify(input) in 16-character pieces. */
  | { type: "tool_use"; id: string; name: string; input: unknown; jsonChunks?: string[] }
  | { type: "fallback"; from: { model: string }; to: { model: string } };

export interface FakeTurn {
  content?: FakeBlock[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  /** Thrown from the stream (an SDK error, or a plain Error for unparseable tool JSON). */
  error?: unknown;
  /** Streams the text, then waits until the request is aborted. */
  hang?: boolean;
}

export interface ScriptedClient {
  client: AnthropicClientLike;
  /** Snapshots of every request body. */
  requests: BetaMessageStreamParams[];
  keys: string[];
  listCalls: number;
  listError: unknown;
}

function message(turn: FakeTurn): BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content: (turn.content ?? []).map((b) =>
      b.type === "text" ? { type: "text", text: b.text, citations: null } : b.type === "thinking" ? { type: "thinking", thinking: b.thinking, signature: b.signature ?? "sig" } : b.type === "tool_use" ? { type: "tool_use", id: b.id, name: b.name, input: b.input } : b,
    ),
    stop_reason: turn.stop_reason ?? ((turn.content ?? []).some((b) => b.type === "tool_use") ? "tool_use" : "end_turn"),
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...turn.usage },
  } as unknown as BetaMessage;
}

function fakeStream(turn: FakeTurn | undefined, signal: AbortSignal | undefined): MessageStreamLike {
  const t = turn ?? { content: [{ type: "text", text: "(no more scripted turns)" }] };
  const aborted = () => new Anthropic.APIUserAbortError();
  let done: Promise<BetaMessage> | null = null;
  const events: BetaRawMessageStreamEvent[] = [];
  (t.content ?? []).forEach((b, index) => {
    if (b.type === "text") {
      for (const piece of b.text.match(/.{1,8}/gs) ?? []) events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: piece } } as BetaRawMessageStreamEvent);
    } else if (b.type === "thinking") {
      events.push({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: b.thinking } } as BetaRawMessageStreamEvent);
    } else if (b.type === "tool_use") {
      events.push({ type: "content_block_start", index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } } as BetaRawMessageStreamEvent);
      for (const piece of b.jsonChunks ?? (JSON.stringify(b.input) ?? "").match(/.{1,16}/gsu) ?? []) {
        events.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: piece } } as BetaRawMessageStreamEvent);
      }
      events.push({ type: "content_block_stop", index } as BetaRawMessageStreamEvent);
    }
  });
  const run = async function* (): AsyncGenerator<BetaRawMessageStreamEvent> {
    for (const event of events) {
      if (signal?.aborted) throw aborted();
      await Promise.resolve();
      yield event;
    }
    if (t.hang) {
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve();
        else signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      throw aborted();
    }
    if (t.error) throw t.error;
  };
  let iterated = false;
  return {
    [Symbol.asyncIterator]() {
      iterated = true;
      const it = run();
      done = (async () => message(t))();
      return it;
    },
    finalMessage() {
      if (!iterated) done = (async () => message(t))();
      if (signal?.aborted) return Promise.reject(aborted());
      if (t.error) return Promise.reject(t.error);
      return done!;
    },
    abort() {
      /* the signal aborts the request */
    },
  };
}

export function scriptedClient(turns: FakeTurn[]): ScriptedClient {
  const state: ScriptedClient = {
    requests: [],
    keys: [],
    listCalls: 0,
    listError: null,
    client: {
      beta: {
        messages: {
          stream(body, options) {
            state.requests.push(structuredClone(body));
            return fakeStream(turns.shift(), options?.signal);
          },
        },
      },
      models: {
        async list() {
          state.listCalls++;
          if (state.listError) throw state.listError;
          return { data: [] };
        },
      },
    },
  };
  return state;
}

export interface FakeBridge extends ToolBridge {
  calls: { name: string; args: Record<string, unknown> }[];
}

export const FAKE_TOOLS: AssistantToolInfo[] = [
  { name: "get_outline", title: "Get outline", description: "Outline of the document.", inputSchema: { $schema: "http://json-schema.org/draft-07/schema#", type: "object", properties: {} }, readOnly: true },
  { name: "add_layers", title: "Add layers", description: "Add layers.", inputSchema: { type: "object", properties: { layers: { type: "array" } }, required: ["layers"] }, readOnly: false },
  { name: "delete_items", title: "Delete items", description: "Delete items.", inputSchema: { type: "object", properties: { ids: { type: "array" }, confirmToken: { type: "string" } } }, readOnly: false },
  { name: "apply_ops", title: "Apply ops", description: "Apply ops.", inputSchema: { type: "object", properties: { ops: { type: "array" } } }, readOnly: false },
  {
    name: "import_design",
    title: "Import design",
    description: "Import a design.",
    inputSchema: {
      type: "object",
      properties: { docId: { type: "string" }, component: { type: "string" }, name: { type: "string" }, replace: { type: "string" }, width: { type: "number" }, height: { type: "number" }, dryRun: { type: "boolean" }, screenshot: { type: "boolean" }, html: { type: "string" } },
    },
    readOnly: false,
  },
];

export function fakeBridge(handler: (name: string, args: Record<string, unknown>, callIndex: number, options: ToolCallOptions) => ToolCallResult | Promise<ToolCallResult>): FakeBridge {
  const bridge: FakeBridge = {
    calls: [],
    tools: async () => FAKE_TOOLS,
    instructions: async () => "Call get_outline before editing.",
    async call(name, args, options = {}) {
      bridge.calls.push({ name, args });
      return handler(name, args, bridge.calls.length - 1, options);
    },
    close: async () => undefined,
  };
  return bridge;
}

export const text = (value: string): ToolCallResult => ({ content: [{ type: "text", text: value }] });

export interface FakeDraftStreams {
  factory: AgentDraftStreams;
  /** Every DraftStreams the agent made (one per turn that wrote import_design, a retried turn included). */
  created: { runId: string; turn: number }[];
}

/**
 * A stand-in for draftStream.ts's createDraftStreams that doesn't decode: one design_draft per
 * input_json_delta of an import_design block, whose append is the raw chunk (so the appends
 * concatenate to the tool input's JSON), then done with the parsed html at content_block_stop, or
 * from finish for a block that never got there.
 */
export function fakeDraftStreams(): FakeDraftStreams {
  const created: FakeDraftStreams["created"] = [];
  const factory: AgentDraftStreams = ({ runId, turn, emit }) => {
    created.push({ runId, turn });
    const blocks = new Map<number, { toolUseId: string; json: string; done: boolean }>();
    const done = (block: { toolUseId: string; json: string; done: boolean }, html: unknown) => {
      block.done = true;
      const event: AssistantEvent = { type: "design_draft", runId, turn, toolUseId: block.toolUseId, offset: block.json.length, append: "", done: true, ...(typeof html === "string" ? { html } : {}) };
      emit(event);
    };
    return {
      onEvent(event) {
        if (event.type === "content_block_start") {
          if (event.content_block.type === "tool_use" && event.content_block.name === "import_design") blocks.set(event.index, { toolUseId: event.content_block.id, json: "", done: false });
          return;
        }
        const block = event.type === "content_block_delta" || event.type === "content_block_stop" ? blocks.get(event.index) : undefined;
        if (!block || block.done) return;
        if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
          emit({ type: "design_draft", runId, turn, toolUseId: block.toolUseId, offset: block.json.length, append: event.delta.partial_json, done: false });
          block.json += event.delta.partial_json;
        } else if (event.type === "content_block_stop" && block.json) {
          done(block, (JSON.parse(block.json) as { html?: unknown }).html);
        }
      },
      finish(message) {
        message.content.forEach((b, index) => {
          if (b.type !== "tool_use" || b.name !== "import_design" || blocks.get(index)?.done) return;
          done(blocks.get(index) ?? { toolUseId: b.id, json: "", done: false }, (b.input as { html?: unknown }).html);
        });
      },
    };
  };
  return { factory, created };
}

/** Flush pending microtasks and timers so streamed events settle. */
export const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
