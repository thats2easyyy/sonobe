/**
 * zod input and output schemas shared by tools, the CLI and tests. Value and op shapes stay loose
 * on purpose: core applyOps validates them and returns teaching errors with did-you-mean and
 * ready-to-apply fixes, which beats a generic schema rejection. Browser-safe.
 */

import { OP_KINDS } from "@sonobe/core";
import { z } from "zod";
import type { SimEvent } from "./host.ts";

export const DocIdSchema = z
  .string()
  .describe("Target document id (default: the active document).");
export const ComponentIdSchema = z
  .string()
  .describe('Component id (default: the root prototype, usually "main").');
export const LabelSchema = z
  .string()
  .max(120)
  .describe('History label shown to the person, e.g. "added press animation".');
export const ExpectedRevisionSchema = z
  .number()
  .int()
  .nonnegative()
  .describe(
    "Fail instead of applying when the document is no longer at this revision (optimistic concurrency).",
  );

export const InputValueSchema = z
  .unknown()
  .describe(
    'A literal (1, true, "text", "#FF3B30FF", [x, y]) or a wrapper: { "link": "patchId.port" | "@layerId.prop" | "$ref.port" }, { "layer": "layerId" | "$ref" }, { "loop": [..] }, { "json": .. }, { "asset": "assetId" }, { "gradient": .. }. null resets to the default.',
  );

export const OP_HELP = `One op. Kinds: ${OP_KINDS.join(", ")}. Shapes: addLayer { parent?, index?, layer: { ref?, id?, type, name?, props?, children? } } · updateLayer { id, props?, name?, locked?, collapsed? } · moveLayer { id, parent?, index? } · removeLayer { id } · addPatch { patch: { ref?, id?, type, name?, typeParam?, inputCount?, inputs?, settings?, component?, ui? } } · updatePatch { id, name?, typeParam?, inputCount?, muted?, settings?, ui? } · removePatch { id } · setInput { target, value } · connect { from, to } · disconnect { to } · rename { id, name } · addComment { comment: { text, rect, color? } } · createComponent { name, layerIds?, patchIds? } · updateInterface { component, inputs?, outputs? } · updateComponent { id, name?, notes?, size? } · setProject { changes }. Every op may name "component". Later ops can use "$ref" for items earlier ops created with "ref".`;

export const OpSchema = z
  .looseObject({ op: z.string().describe(`Op kind: ${OP_KINDS.join(" | ")}.`) })
  .describe(OP_HELP);

export interface NewLayerInput {
  ref?: string;
  id?: string;
  type: string;
  name?: string;
  props?: Record<string, unknown>;
  children?: NewLayerInput[];
  component?: string;
}

export const NewLayerSchema: z.ZodType<NewLayerInput> = z.looseObject({
  ref: z.string().optional().describe('Temp name for later references in this batch ("$ref").'),
  id: z.string().optional().describe("Explicit id (default: derived from the name)."),
  type: z
    .string()
    .describe(
      "Layer type: group, rectangle, oval, text, image, video, shape, colorFill, gradient, hitArea, textField, lottie, shader, clone, componentInstance.",
    ),
  name: z.string().optional(),
  props: z
    .record(z.string(), InputValueSchema)
    .optional()
    .describe(
      'Property values by key, e.g. { "position": [16, 120], "size": [358, 220], "color": "#FFFFFFFF" }.',
    ),
  get children() {
    return z
      .array(NewLayerSchema)
      .optional()
      .describe("Child layers (containers only), back to front.");
  },
  component: z.string().optional().describe("For componentInstance: the layer component to show."),
});

export const NewPatchSchema = z.looseObject({
  ref: z
    .string()
    .optional()
    .describe('Temp name for later references in this batch ("$ref.port").'),
  id: z.string().optional().describe("Explicit id (default: derived from the name or type)."),
  type: z
    .string()
    .describe(
      "Patch type key from list_patch_types, e.g. interaction, switch, popAnimation, transition.",
    ),
  name: z.string().optional().describe('Display name describing its effect, e.g. "Card Pressed".'),
  typeParam: z
    .string()
    .optional()
    .describe("Variant for type-variant patches (number, point, color...)."),
  inputCount: z
    .number()
    .int()
    .optional()
    .describe("Count for variadic patches (Add, Or, Option Picker...)."),
  inputs: z
    .record(z.string(), InputValueSchema)
    .optional()
    .describe(
      'Input values by port key; links as { "link": "$tap.tap" }, layers as { "layer": "card" }.',
    ),
  settings: z.record(z.string(), z.unknown()).optional(),
  component: z.string().optional().describe('For type "component": the patch component to run.'),
  ui: z
    .object({ x: z.number(), y: z.number() })
    .optional()
    .describe("Patch editor position (default: placed automatically)."),
});

export const ConnectionSchema = z.object({
  from: z
    .string()
    .describe(
      'Output address: "patchId.port", "@layerId.outputOrProp", "$in.key", or "$ref.port".',
    ),
  to: z.string().describe('Input address: "patchId.port", "@layerId.prop", or "$out.key".'),
});

const TargetSchema = z
  .union([z.string(), z.tuple([z.number(), z.number()])])
  .describe(
    '"@layerId" (center of the layer, "@row#2" for a loop copy) or [x, y] in prototype points.',
  );
const AtMs = z
  .number()
  .nonnegative()
  .optional()
  .describe("Milliseconds after the start of this dispatch or trace (default 0).");

export const SimEventSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("tap"),
      target: TargetSchema,
      holdMs: z.number().nonnegative().optional().describe("Default 50."),
      atMs: AtMs,
    }),
    z.object({
      kind: z.literal("longPress"),
      target: TargetSchema,
      durationMs: z.number().nonnegative().optional().describe("Default 600."),
      atMs: AtMs,
    }),
    z.object({
      kind: z.literal("drag"),
      from: TargetSchema,
      to: TargetSchema,
      durationMs: z.number().nonnegative().optional().describe("Default 300."),
      release: z.boolean().optional().describe("Lift the finger at the end (default true)."),
      atMs: AtMs,
    }),
    z.object({ kind: z.literal("hover"), target: TargetSchema, atMs: AtMs }),
    z.object({ kind: z.literal("leave"), atMs: AtMs }),
    z.object({
      kind: z.literal("scroll"),
      target: TargetSchema,
      dx: z.number().optional(),
      dy: z.number().optional(),
      atMs: AtMs,
    }),
    z.object({
      kind: z.literal("key"),
      key: z.string().describe('Key value, e.g. "Space", "a", "ArrowUp".'),
      phase: z.enum(["press", "down", "up"]).optional(),
      shift: z.boolean().optional(),
      alt: z.boolean().optional(),
      meta: z.boolean().optional(),
      ctrl: z.boolean().optional(),
      atMs: AtMs,
    }),
    z.object({
      kind: z.literal("text"),
      layer: z.string().describe("Text Field layer id."),
      value: z.string(),
      atMs: AtMs,
    }),
    z.object({ kind: z.literal("focus"), layer: z.string(), focused: z.boolean(), atMs: AtMs }),
    z.object({ kind: z.literal("submit"), layer: z.string(), atMs: AtMs }),
    z.object({
      kind: z.literal("pointer"),
      phase: z.enum(["down", "move", "up", "cancel", "leave"]),
      x: z.number(),
      y: z.number(),
      pointerId: z.number().int().optional(),
      pointerType: z.enum(["mouse", "touch", "pen"]).optional(),
      atMs: AtMs,
    }),
    z.object({
      kind: z.literal("orientation"),
      orientation: z.enum(["portrait", "landscape"]),
      atMs: AtMs,
    }),
    z.object({
      kind: z.literal("deviceMotion"),
      acceleration: z.tuple([z.number(), z.number(), z.number()]),
      rotationRate: z.tuple([z.number(), z.number(), z.number()]),
      atMs: AtMs,
    }),
  ])
  .describe("A simulated input.");

export const SimEventsSchema = z.array(SimEventSchema);

/** Parse events from JSON (CLI event files): an array, or { "events": [...] }. */
export function parseSimEvents(
  json: unknown,
): { ok: true; events: SimEvent[] } | { ok: false; message: string } {
  const list = Array.isArray(json)
    ? json
    : json && typeof json === "object" && Array.isArray((json as { events?: unknown }).events)
      ? (json as { events: unknown[] }).events
      : undefined;
  if (!list)
    return {
      ok: false,
      message:
        'Events must be a JSON array like [{ "kind": "tap", "target": "@card" }] or { "events": [...] }.',
    };
  const r = SimEventsSchema.safeParse(list);
  if (!r.success)
    return {
      ok: false,
      message: r.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; "),
    };
  return { ok: true, events: r.data as SimEvent[] };
}

const DiagnosticsDeltaOutput = z.looseObject({
  added: z.array(z.unknown()),
  resolved: z.array(z.unknown()),
  totals: z.object({ errors: z.number(), warnings: z.number(), info: z.number() }),
});

/** Every structuredContent leads with the complete teaching text (results.ts withCompleteText). */
const TextField = z
  .string()
  .describe("The complete result as text, the same text the content block carries.");

export const WriteOutputSchema = z.looseObject({
  text: TextField,
  ok: z.boolean(),
  changed: z.enum(["none", "partial", "all"]),
  docId: z.string(),
  revision: z.number(),
  dryRun: z.boolean().optional(),
  txnId: z.string().optional(),
  created: z.array(z.string()).optional(),
  idMap: z.record(z.string(), z.string()).optional(),
  affected: z
    .looseObject({
      components: z.array(z.string()),
      layers: z.array(z.string()),
      patches: z.array(z.string()),
    })
    .optional(),
  diagnostics: DiagnosticsDeltaOutput.optional(),
  saved: z.boolean().optional(),
});

export const SimStateOutputSchema = z.looseObject({
  text: TextField,
  simId: z.string(),
  docId: z.string(),
  frame: z.number(),
  timeMs: z.number(),
  fps: z.number(),
  issues: z.array(z.unknown()),
});

export const DocumentInfoOutputSchema = z.looseObject({
  text: TextField,
  docId: z.string(),
  name: z.string(),
  revision: z.number(),
  dirty: z.boolean(),
  components: z.array(z.looseObject({ id: z.string(), name: z.string(), kind: z.string() })),
  diagnostics: z.object({ errors: z.number(), warnings: z.number(), info: z.number() }),
});

/** The structuredContent of a teaching error (results.ts failure()). */
export const ToolErrorOutputSchema = z.looseObject({
  text: TextField.optional(),
  ok: z.literal(false),
  changed: z.enum(["none", "partial", "all"]),
  error: z.looseObject({
    code: z.string(),
    message: z.string(),
    hint: z.string().optional(),
    address: z.string().optional(),
    opIndex: z.number().optional(),
    suggestions: z.array(z.unknown()),
  }),
});

type JsonSchemaOptions = { target: string; libraryOptions?: Record<string, unknown> };
type JsonSchemaConverter = {
  input(options: JsonSchemaOptions): Record<string, unknown>;
  output(options: JsonSchemaOptions): Record<string, unknown>;
};

/** A Standard Schema (validation plus JSON Schema) that tools register as their outputSchema. */
export interface ToolOutputSchema {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    validate(value: unknown): ReturnType<z.ZodType["~standard"]["validate"]>;
    readonly jsonSchema: JsonSchemaConverter;
  };
  /** The success shape alone. */
  readonly success: z.ZodObject;
  /** Synchronous check against success ∪ teaching error. */
  accepts(value: unknown): boolean;
}

function jsonBranch(schema: z.ZodType, options: JsonSchemaOptions): Record<string, unknown> {
  const converter = (schema["~standard"] as { jsonSchema?: JsonSchemaConverter }).jsonSchema;
  const json = converter
    ? converter.output(options)
    : (z.toJSONSchema(schema, { io: "output" }) as Record<string, unknown>);
  const { $schema: _schema, ...rest } = json;
  return rest;
}

/**
 * An outputSchema that also accepts teaching errors. SDK clients validate structuredContent
 * against a tool's outputSchema (the v1 SDK even on isError results), so an error result that
 * doesn't fit the success shape would surface as -32602 instead of the teaching error. The JSON
 * Schema keeps an object root (required by 2025-era clients) with anyOf success | error.
 */
export function toolOutputSchema(success: z.ZodObject): ToolOutputSchema {
  const union = z.union([success, ToolErrorOutputSchema]);
  const json = (options: JsonSchemaOptions) => {
    const branches = [jsonBranch(success, options), jsonBranch(ToolErrorOutputSchema, options)];
    return { type: "object", anyOf: branches };
  };
  return {
    "~standard": {
      version: 1,
      vendor: "sonobe",
      validate: (value) => union["~standard"].validate(value),
      jsonSchema: { input: json, output: json },
    },
    success,
    accepts: (value) => union.safeParse(value).success,
  };
}
