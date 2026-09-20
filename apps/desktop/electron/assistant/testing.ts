/** Test helpers for the Assistant: a scripted fake Anthropic client and a fake tool bridge. Not imported by app code. */

import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, BetaMessageStreamParams, BetaRawMessageStreamEvent } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { AnthropicClientLike, MessageStreamLike } from "./agent.ts";
import type { AssistantToolInfo, ToolBridge, ToolCallOptions, ToolCallResult } from "./toolBridge.ts";

export type FakeBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
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
    content: (turn.content ?? []).map((b) => (b.type === "text" ? { type: "text", text: b.text, citations: null } : b.type === "thinking" ? { type: "thinking", thinking: b.thinking, signature: b.signature ?? "sig" } : b)),
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

/** Flush pending microtasks and timers so streamed events settle. */
export const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
