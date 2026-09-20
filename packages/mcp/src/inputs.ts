/**
 * Tool inputs that refuse fields they don't take. zod strips unknown keys, so a misspelled or guessed
 * field ("componentID", a layer's "position" outside "props") would vanish and the call would quietly
 * do something else. Every tool registers its input through toolInputSchema, which walks the
 * arguments against the schema first and turns unknown fields in closed objects into one teaching
 * error that names the tool, the field and the closest field it takes. Open objects (looseObject,
 * records) and values typed unknown are left alone; op shapes are checked by core's applyOps.
 * Browser-safe.
 */

import { didYouMean, didYouMeanText } from "@sonobe/core";
import type { z } from "zod";
import { joinList } from "./format.ts";
import type { TeachingError } from "./results.ts";

/** A field the schema doesn't take, in one object of the arguments. */
export interface UnknownField {
  /** Where the object is in the arguments ("layers[0]", "updates[2].props"), or "" at the top level. */
  at: string;
  field: string;
  /** The fields that object takes. */
  known: string[];
  /** Its fields that hold values by key (records), where an unknown key may belong. */
  records: string[];
}

/**
 * Arguments that failed the unknown-field check. The input schema hands this to the tool wrapper in
 * place of the parsed arguments, so the error goes out as a teaching result, not a protocol error.
 */
export class RejectedArguments {
  readonly tool: string;
  readonly fields: readonly UnknownField[];
  constructor(tool: string, fields: readonly UnknownField[]) {
    this.tool = tool;
    this.fields = fields;
  }
}

/** Fields every tool tolerates at the top level: MCP reserves `_meta` for metadata. */
const RESERVED = new Set(["_meta"]);

interface Def {
  type: string;
  shape?: Record<string, z.ZodType>;
  catchall?: z.ZodType;
  innerType?: z.ZodType;
  in?: z.ZodType;
  element?: z.ZodType;
  items?: z.ZodType[];
  rest?: z.ZodType | null;
  valueType?: z.ZodType;
  options?: z.ZodType[];
  discriminator?: string;
  getter?: () => z.ZodType;
}

const defOf = (schema: z.ZodType): Def => (schema as unknown as { _zod: { def: Def } })._zod.def;

const WRAPPERS = new Set(["optional", "nullable", "default", "prefault", "catch", "readonly", "nonoptional"]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const keyPath = (at: string, key: string) =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? (at ? `${at}.${key}` : key) : `${at}[${JSON.stringify(key)}]`;

/** The option of a discriminated union that `value` names, if any. */
function discriminatedOption(def: Def, value: Record<string, unknown>): z.ZodType | undefined {
  const tag = value[def.discriminator!];
  return def.options?.find((option) => {
    const values = (option as unknown as { _zod: { propValues?: Record<string, Set<unknown>> } })._zod.propValues?.[def.discriminator!];
    return values?.has(tag) ?? false;
  });
}

/**
 * Fields in `value` that closed objects of `schema` don't take, depth first. Objects are closed
 * unless they're loose (a catchall) or records. For a plain union the check follows the options the
 * value parses as, and reports the one with the fewest unknown fields.
 */
export function unknownFields(schema: z.ZodType, value: unknown, at = ""): UnknownField[] {
  const def = defOf(schema);
  if (WRAPPERS.has(def.type)) return value === undefined || value === null ? [] : unknownFields(def.innerType!, value, at);
  switch (def.type) {
    case "pipe":
      return unknownFields(def.in!, value, at);
    case "lazy":
      return unknownFields(def.getter!(), value, at);
    case "object": {
      if (!isPlainObject(value)) return [];
      const shape = def.shape ?? {};
      const open = def.catchall !== undefined && defOf(def.catchall).type !== "never";
      const known = Object.keys(shape);
      const out: UnknownField[] = [];
      for (const [key, v] of Object.entries(value)) {
        const field = shape[key];
        if (field) out.push(...unknownFields(field, v, keyPath(at, key)));
        else if (!open && !(at === "" && RESERVED.has(key))) {
          const records = known.filter((k) => recordLike(shape[k]!));
          out.push({ at, field: key, known, records });
        }
      }
      return out;
    }
    case "array":
      return Array.isArray(value) ? value.flatMap((item, i) => unknownFields(def.element!, item, `${at}[${i}]`)) : [];
    case "tuple":
      if (!Array.isArray(value)) return [];
      return value.flatMap((item, i) => {
        const itemSchema = def.items?.[i] ?? def.rest ?? undefined;
        return itemSchema ? unknownFields(itemSchema, item, `${at}[${i}]`) : [];
      });
    case "record":
      if (!isPlainObject(value)) return [];
      return Object.entries(value).flatMap(([key, v]) => unknownFields(def.valueType!, v, keyPath(at, key)));
    case "union": {
      if (def.discriminator !== undefined) {
        if (!isPlainObject(value)) return [];
        const option = discriminatedOption(def, value);
        return option ? unknownFields(option, value, at) : [];
      }
      let best: UnknownField[] | undefined;
      for (const option of def.options ?? []) {
        if (!option.safeParse(value).success) continue;
        const found = unknownFields(option, value, at);
        if (!best || found.length < best.length) best = found;
        if (!found.length) break;
      }
      return best ?? [];
    }
    default:
      return [];
  }
}

/** A field that holds values by key (a record). */
function recordLike(schema: z.ZodType): boolean {
  const def = defOf(schema);
  if (WRAPPERS.has(def.type)) return recordLike(def.innerType!);
  return def.type === "record";
}

/** One unknown field in a list: `"position" in layers[0]`, with its best guess. */
function fieldClause(f: UnknownField, guesses: readonly string[]): string {
  const where = f.at ? ` in ${f.at}` : "";
  return `"${f.field}"${where}${guesses.length ? ` (did you mean "${guesses[0]}"?)` : ""}`;
}

/** The teaching error for arguments with fields the tool doesn't take. */
export function unknownFieldsError(tool: string, fields: readonly UnknownField[]): TeachingError {
  const guesses = fields.map((f) => didYouMean(f.field, f.known));
  const first = fields[0]!;
  let message: string;
  if (fields.length === 1 && !first.known.length && !first.at) message = `${tool} takes no arguments, so "${first.field}" isn't one.`;
  else if (fields.length === 1)
    message = `${tool} has no field "${first.field}"${first.at ? ` in ${first.at}` : ""}.${didYouMeanText(guesses[0]!)}`;
  else message = `${tool} has no fields ${joinList(fields.map((f, i) => fieldClause(f, guesses[i]!)))}.`;
  const hints: string[] = [];
  const seen = new Set<string>();
  fields.forEach((f, i) => {
    const where = f.at || tool;
    if (!seen.has(where)) {
      seen.add(where);
      if (f.known.length) hints.push(`${where} takes: ${f.known.join(", ")}.`);
    }
    if (!guesses[i]!.length && f.records.length)
      hints.push(`Keys like "${f.field}" go inside ${joinList(f.records.map((r) => `"${r}"`), "or")}.`);
  });
  return {
    code: "unknown_field",
    message,
    ...(hints.length ? { hint: hints.join(" ") } : {}),
    data: {
      unknownFields: fields.map((f, i) => ({
        ...(f.at ? { at: f.at } : {}),
        field: f.field,
        ...(guesses[i]!.length ? { didYouMean: guesses[i]![0] } : {}),
      })),
    },
  };
}

type JsonSchemaOptions = { target: string; libraryOptions?: Record<string, unknown> };
type JsonSchemaConverter = {
  input(options: JsonSchemaOptions): Record<string, unknown>;
  output(options: JsonSchemaOptions): Record<string, unknown>;
};

/** A Standard Schema a tool registers as its inputSchema: the zod object, plus the unknown-field check. */
export interface ToolInputSchema {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    validate(value: unknown): ReturnType<z.ZodType["~standard"]["validate"]> | { value: RejectedArguments };
    readonly jsonSchema: JsonSchemaConverter;
  };
}

/**
 * The input schema a tool registers. It publishes the zod object's JSON Schema as it is, and
 * validates in two steps: unknown fields first (they often explain a missing required field, as
 * "componentID" does for "component"), handed on as RejectedArguments; then zod itself.
 */
export function toolInputSchema(tool: string, input: z.ZodObject): ToolInputSchema {
  const standard = input["~standard"] as z.ZodType["~standard"] & { jsonSchema: JsonSchemaConverter };
  return {
    "~standard": {
      version: 1,
      vendor: "sonobe",
      validate: (value) => {
        const fields = unknownFields(input, value);
        if (fields.length) return { value: new RejectedArguments(tool, fields) };
        return standard.validate(value);
      },
      jsonSchema: standard.jsonSchema,
    },
  };
}
