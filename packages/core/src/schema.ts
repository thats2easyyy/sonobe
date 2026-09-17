/**
 * zod schemas for on-disk files (project.json, components/*.json, assets/assets.json)
 * with readable error paths, plus normalization into the canonical in-memory form.
 */

import { z } from "zod";
import { parseAddress } from "./address.ts";
import { ID_PATTERN, isValidId } from "./ids.ts";
import type { AssetRecord, Component, Id, InputValue, LayerNode, PatchNode, ProjectManifest } from "./types.ts";
import { isLiteral, parseColor, VALUE_TYPES } from "./values.ts";

export interface FormatIssue {
  /** Dotted path inside the file, e.g. "layers[0].props.color". */
  path: string;
  message: string;
  /** File the issue belongs to (project-level loads). */
  file?: string;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: FormatIssue[]; message: string };

const ID_MESSAGE = "must be an id (letters, digits and underscores; not starting with a digit)";

export const IdSchema = z.string().regex(ID_PATTERN, ID_MESSAGE);
const ValueTypeSchema = z.enum(VALUE_TYPES as unknown as [string, ...string[]]);
const Vec2Schema = z.tuple([z.number(), z.number()]);
const MetaSchema = z.record(z.string(), z.unknown());

const WRAPPERS = 'a number, true/false, text, a list of numbers, null, or one of { "link" }, { "layer" }, { "asset" }, { "loop" }, { "json" }, { "gradient" }';

function gradientProblem(g: unknown): string | undefined {
  if (!g || typeof g !== "object" || Array.isArray(g)) return "gradient must be an object with kind, stops, start and end";
  const v = g as Record<string, unknown>;
  const extra = Object.keys(v).filter((k) => !["kind", "stops", "start", "end", "ratio"].includes(k));
  if (v.ratio !== undefined && !(typeof v.ratio === "number" && Number.isFinite(v.ratio) && v.ratio > 0)) return "gradient ratio must be a number above 0";
  if (extra.length) return `gradient has unknown field ${extra.map((k) => `"${k}"`).join(", ")}`;
  if (v.kind !== "linear" && v.kind !== "radial" && v.kind !== "angular") return 'gradient kind must be "linear", "radial" or "angular"';
  if (!Array.isArray(v.stops) || !v.stops.every((s) => Array.isArray(s) && s.length === 2 && typeof s[0] === "number" && typeof s[1] === "string" && !!parseColor(s[1]))) {
    return 'gradient stops must be [offset, "#RRGGBBAA"] pairs';
  }
  const vec = (x: unknown) => Array.isArray(x) && x.length === 2 && x.every((n) => typeof n === "number" && Number.isFinite(n));
  if (!vec(v.start) || !vec(v.end)) return "gradient start and end must be [x, y]";
  return undefined;
}

/** Why a value can't sit on an input port or layer prop, or undefined when it can. */
export function describeInputValueProblem(v: unknown): string | undefined {
  if (v === null || typeof v === "boolean" || typeof v === "string") return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? undefined : "numbers must be finite";
  if (Array.isArray(v)) {
    return v.every((n) => typeof n === "number" && Number.isFinite(n)) ? undefined : 'lists may only contain numbers; wrap other lists as { "loop": [...] } or { "json": [...] }';
  }
  if (typeof v !== "object") return `expected ${WRAPPERS}`;
  const keys = Object.keys(v);
  if (keys.length !== 1) return `expected ${WRAPPERS}, but got an object with ${keys.length ? keys.map((k) => `"${k}"`).join(", ") : "no fields"}`;
  const key = keys[0]!;
  const inner = (v as Record<string, unknown>)[key];
  switch (key) {
    case "link": {
      const a = typeof inner === "string" ? parseAddress(inner) : undefined;
      if (!a || a.index !== undefined) return 'link must be an address like "patch.port", "@layer.prop" or "$in.key"';
      if (a.kind === "componentOutput") return "a link can't read from $out";
      if ((a.kind === "patch" || a.kind === "layer") && a.id.startsWith("$")) return `link "${inner as string}" uses a batch ref; files need real ids`;
      return undefined;
    }
    case "layer":
    case "asset":
      return isValidId(inner) ? undefined : `${key} ${ID_MESSAGE}`;
    case "loop":
      return Array.isArray(inner) && inner.every(isLiteral) ? undefined : "loop items must be numbers, true/false, text, number lists or null";
    case "json":
      return undefined;
    case "gradient":
      return gradientProblem(inner);
    default:
      return `unknown value wrapper "${key}"; expected link, layer, asset, loop, json or gradient`;
  }
}

export const InputValueSchema = z.unknown().superRefine((v, ctx) => {
  const problem = describeInputValueProblem(v);
  if (problem) ctx.addIssue({ code: "custom", message: problem });
}) as unknown as z.ZodType<InputValue>;

const InputMapSchema = z.record(z.string(), InputValueSchema);

export const PatchNodeSchema = z.strictObject({
  type: z.string().min(1, "patch type can't be empty"),
  name: z.string().optional(),
  component: IdSchema.optional(),
  typeParam: z.string().optional(),
  inputCount: z.number().int().min(0).optional(),
  muted: z.boolean().optional(),
  inputs: InputMapSchema,
  settings: MetaSchema.optional(),
  ui: z.strictObject({ x: z.number(), y: z.number(), collapsed: z.boolean().optional(), color: z.string().optional() }),
}) as unknown as z.ZodType<PatchNode>;

export const LayerNodeSchema: z.ZodType<LayerNode> = z.lazy(() =>
  z.strictObject({
    id: IdSchema,
    type: z.string().min(1, "layer type can't be empty"),
    name: z.string(),
    component: IdSchema.optional(),
    locked: z.boolean().optional(),
    collapsed: z.boolean().optional(),
    props: InputMapSchema,
    children: z.array(LayerNodeSchema).optional(),
  }),
) as unknown as z.ZodType<LayerNode>;

export const CommentNodeSchema = z.strictObject({
  id: IdSchema,
  text: z.string(),
  rect: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  color: z.string().optional(),
});

export const InterfacePortSchema = z.strictObject({
  key: IdSchema,
  name: z.string(),
  type: ValueTypeSchema,
  default: InputValueSchema.optional(),
  category: z.string().optional(),
  enumOptions: z.array(z.string()).optional(),
  loopBehavior: z.enum(["loop", "pass"]).optional(),
  link: z.string().optional(),
});

const InterfaceSchema = z
  .strictObject({ inputs: z.record(IdSchema, InterfacePortSchema), outputs: z.record(IdSchema, InterfacePortSchema) })
  .superRefine((iface, ctx) => {
    for (const direction of ["inputs", "outputs"] as const) {
      for (const [key, port] of Object.entries(iface[direction])) {
        if (port.key !== key) ctx.addIssue({ code: "custom", path: [direction, key, "key"], message: `must match its map key "${key}"` });
        if (direction === "inputs" && port.link !== undefined) ctx.addIssue({ code: "custom", path: [direction, key, "link"], message: "published inputs can't have a link" });
        if (direction === "outputs" && port.link !== undefined) {
          const a = parseAddress(port.link);
          if (!a || a.kind === "componentOutput" || a.index !== undefined) ctx.addIssue({ code: "custom", path: [direction, key, "link"], message: 'link must be an address like "patch.port"' });
        }
      }
    }
  });

export const ComponentSchema = z.strictObject({
  formatVersion: z.number().int().min(1),
  id: IdSchema,
  name: z.string(),
  kind: z.enum(["prototype", "layerComponent", "patchComponent"]),
  notes: z.string().optional(),
  size: Vec2Schema.optional(),
  interface: InterfaceSchema,
  layers: z.array(LayerNodeSchema),
  patches: z.record(IdSchema, PatchNodeSchema),
  comments: z.array(CommentNodeSchema),
  meta: MetaSchema.optional(),
}) as unknown as z.ZodType<Component>;

export const ProjectManifestSchema = z.strictObject({
  formatVersion: z.number().int().min(1),
  minReaderVersion: z.number().int().min(1).optional(),
  name: z.string(),
  generator: z.string().optional(),
  root: IdSchema,
  device: z.strictObject({ preset: z.string().min(1), size: Vec2Schema.optional(), orientation: z.enum(["portrait", "landscape"]).optional() }),
  fps: z.union([z.literal(60), z.literal(120)]).optional(),
  background: z.string().refine((s) => !!parseColor(s), "must be a color like #RRGGBBAA").optional(),
  meta: MetaSchema.optional(),
}) as unknown as z.ZodType<ProjectManifest>;

export const AssetRecordSchema = z.strictObject({
  id: IdSchema,
  kind: z.enum(["image", "video", "sound", "font", "lottie", "json"]),
  name: z.string(),
  file: z.string().min(1).refine((f) => !f.startsWith("/") && !f.split(/[\\/]/).includes(".."), "must be a path inside assets/"),
  mime: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  duration: z.number().optional(),
  sha256: z.string().optional(),
}) as unknown as z.ZodType<AssetRecord>;

export const AssetRegistrySchema = z.record(IdSchema, AssetRecordSchema).superRefine((assets, ctx) => {
  for (const [key, record] of Object.entries(assets)) {
    if (record.id !== key) ctx.addIssue({ code: "custom", path: [key, "id"], message: `must match its map key "${key}"` });
  }
});

/** "layers[0].props.color" */
export function formatIssuePath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else {
      const s = String(seg);
      out += /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s) ? (out ? `.${s}` : s) : `[${JSON.stringify(s)}]`;
    }
  }
  return out;
}

/** Readable issues from a zod error. */
export function zodIssues(error: z.ZodError, file?: string): FormatIssue[] {
  return error.issues.map((issue) => {
    let message = issue.message.replace(/^Invalid input: /, "");
    if (issue.code === "unrecognized_keys") message = `unknown field ${issue.keys.map((k) => `"${k}"`).join(", ")}`;
    const out: FormatIssue = { path: formatIssuePath(issue.path), message };
    if (file !== undefined) out.file = file;
    return out;
  });
}

/** "components/main.json: layers[0].props.color: expected …; …" */
export function formatIssues(issues: readonly FormatIssue[], max = 5): string {
  const lines = issues.slice(0, max).map((i) => `${i.file ? `${i.file}: ` : ""}${i.path ? `${i.path}: ` : ""}${i.message}`);
  if (issues.length > max) lines.push(`…and ${issues.length - max} more`);
  return lines.join("\n");
}

function parseWith<T>(schema: z.ZodType<T>, input: unknown, file: string): ParseResult<T> {
  let json = input;
  if (typeof input === "string") {
    try {
      json = JSON.parse(input);
    } catch (err) {
      const issues = [{ path: "", message: `isn't valid JSON (${err instanceof Error ? err.message : String(err)})`, file }];
      return { ok: false, issues, message: formatIssues(issues) };
    }
  }
  const r = schema.safeParse(json);
  if (r.success) return { ok: true, value: r.data };
  const issues = zodIssues(r.error, file);
  return { ok: false, issues, message: formatIssues(issues) };
}

function normalizeLayer(layer: LayerNode): LayerNode {
  const out: LayerNode = { ...layer };
  if (!out.locked) delete out.locked;
  if (!out.collapsed) delete out.collapsed;
  if (out.children?.length) out.children = out.children.map(normalizeLayer);
  else delete out.children;
  return out;
}

function normalizePatch(node: PatchNode): PatchNode {
  const out: PatchNode = { ...node, ui: { ...node.ui } };
  if (!out.muted) delete out.muted;
  if (!out.ui.collapsed) delete out.ui.collapsed;
  if (out.ui.color === "") delete out.ui.color;
  if (out.name === "") delete out.name;
  if (out.settings && !Object.keys(out.settings).length) delete out.settings;
  return out;
}

/**
 * Canonical in-memory form: no empty `children`, no `false` editor flags, no empty
 * names/notes/settings, no null top-level `meta` values (updateComponent treats null as
 * "remove the key"), comments sorted by id. Ops keep documents in this form so inverse ops
 * restore deep-equal documents.
 */
export function normalizeComponent(component: Component): Component {
  const out: Component = {
    ...component,
    interface: { inputs: { ...component.interface.inputs }, outputs: { ...component.interface.outputs } },
    layers: component.layers.map(normalizeLayer),
    patches: Object.fromEntries(Object.entries(component.patches).map(([id, p]) => [id, normalizePatch(p)])),
    comments: [...component.comments].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
  if (out.notes === "") delete out.notes;
  if (out.meta) out.meta = Object.fromEntries(Object.entries(out.meta).filter(([, v]) => v !== null && v !== undefined));
  return out;
}

/** Validate a component file (text or parsed JSON) and normalize it. */
export function parseComponentFile(input: unknown, file = "component"): ParseResult<Component> {
  const r = parseWith(ComponentSchema, input, file);
  return r.ok ? { ok: true, value: normalizeComponent(r.value) } : r;
}

/** Validate a project.json manifest (text or parsed JSON). */
export function parseProjectFile(input: unknown, file = "project.json"): ParseResult<ProjectManifest> {
  return parseWith(ProjectManifestSchema, input, file);
}

/** Validate assets/assets.json (text or parsed JSON). */
export function parseAssetsFile(input: unknown, file = "assets/assets.json"): ParseResult<Record<Id, AssetRecord>> {
  return parseWith(AssetRegistrySchema as unknown as z.ZodType<Record<Id, AssetRecord>>, input, file);
}
