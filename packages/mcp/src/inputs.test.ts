/**
 * Tool inputs refuse fields they don't take (inputs.ts), for every tool in TOOL_NAMES, top level and
 * nested, with the tool, the field and the closest known field in the error. What clients add on
 * their own (_meta, the relay's headers) keeps working.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { unknownFields, unknownFieldsError } from "./inputs.ts";
import { NewLayerSchema, SimEventSchema } from "./schemas.ts";
import { TOOL_NAMES } from "./server.ts";
import { connectClient, modernMeta, rawSession, tempProject, type TempProject, type TestClient } from "./test-helpers.ts";

describe("unknownFields", () => {
  const schema = z.object({
    name: z.string(),
    nested: z.object({ size: z.number() }).optional(),
    open: z.looseObject({ a: z.number() }).optional(),
    values: z.record(z.string(), z.object({ x: z.number() })).optional(),
    list: z.array(z.union([z.string(), z.object({ key: z.string() })])).optional(),
    anything: z.unknown().optional(),
  });

  it("finds unknown fields in closed objects, at any depth, and leaves open ones alone", () => {
    expect(unknownFields(schema, { name: "a", nmae: "b" })).toEqual([
      { at: "", field: "nmae", known: ["name", "nested", "open", "values", "list", "anything"], records: ["values"] },
    ]);
    const deep = unknownFields(schema, {
      name: "a",
      nested: { size: 1, sise: 2 },
      open: { a: 1, extra: true },
      values: { first: { x: 1, y: 2 } },
      list: ["plain", { key: "k", kee: "k" }],
      anything: { whatever: 1 },
    });
    expect(deep.map((f) => `${f.at}:${f.field}`)).toEqual(["nested:sise", "values.first:y", "list[1]:kee"]);
  });

  it("tolerates _meta at the top level only", () => {
    expect(unknownFields(schema, { name: "a", _meta: { progressToken: 1 } })).toEqual([]);
    expect(unknownFields(schema, { name: "a", nested: { size: 1, _meta: {} } })).toHaveLength(1);
  });

  it("follows discriminated unions by their tag and recursive schemas by their getters", () => {
    expect(unknownFields(SimEventSchema, { kind: "drag", from: "@a", to: "@b", duration: 100 })).toMatchObject([
      { at: "", field: "duration" },
    ]);
    expect(unknownFields(SimEventSchema, { kind: "nope", whatever: 1 })).toEqual([]);
    expect(
      unknownFields(NewLayerSchema, { type: "group", children: [{ type: "text", position: [0, 0] }] }),
    ).toMatchObject([{ at: "children[0]", field: "position", records: ["props"] }]);
  });

  it("teaches with the tool, the field and the closest known field", () => {
    const one = unknownFieldsError("get_outline", unknownFields(z.object({ component: z.string().optional(), detail: z.string().optional() }), { componentID: "main" }));
    expect(one).toMatchObject({
      code: "unknown_field",
      message: 'get_outline has no field "componentID". Did you mean "component"?',
      hint: "get_outline takes: component, detail.",
      data: { unknownFields: [{ field: "componentID", didYouMean: "component" }] },
    });
    const nested = unknownFieldsError("add_layers", unknownFields(z.object({ layers: z.array(NewLayerSchema) }), { layers: [{ type: "text", position: [0, 0] }] }));
    expect(nested.message).toBe('add_layers has no field "position" in layers[0].');
    expect(nested.hint).toContain('Keys like "position" go inside "props".');
    const none = unknownFieldsError("list_value_types", unknownFields(z.object({}), { verbose: true }));
    expect(none.message).toBe('list_value_types takes no arguments, so "verbose" isn\'t one.');
    const several = unknownFieldsError("get_outline", unknownFields(z.object({ component: z.string().optional(), maxLines: z.number().optional() }), { componentID: "main", maxLine: 3 }));
    expect(several.message).toBe('get_outline has no fields "componentID" (did you mean "component"?) and "maxLine" (did you mean "maxLines"?).');
  });
});

describe("every tool refuses unknown fields", () => {
  let project: TempProject;
  let client: TestClient;

  beforeAll(async () => {
    project = await tempProject({ template: "photo-zoom" });
    client = await connectClient(project.host);
  });

  afterAll(async () => {
    await client.close();
    await project.cleanup();
  });

  it("names the tool and the field, and guesses the field it takes", async () => {
    const { tools } = await client.client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const name of TOOL_NAMES) {
      const bogus = await client.call(name, { zzBogusField: 1 });
      expect(bogus.isError, `${name}: ${bogus.text}`).toBe(true);
      expect(bogus.structured.error, name).toMatchObject({ code: "unknown_field" });
      expect(bogus.text, name).toContain(name);
      expect(bogus.text, name).toContain('"zzBogusField"');
      expect(bogus.text, name).toContain("Nothing changed.");
      const known = Object.keys((byName.get(name)!.inputSchema.properties ?? {}) as Record<string, unknown>);
      if (!known.length) {
        expect(bogus.text, name).toContain("takes no arguments");
        continue;
      }
      // Wrong case is the commonest slip ("docID", "simID"); the guess is the real field.
      const field = known[0]!;
      const typo = await client.call(name, { [field.toUpperCase()]: 1 });
      expect(typo.structured.error, name).toMatchObject({ code: "unknown_field" });
      expect(typo.text, name).toContain(`Did you mean "${field}"`);
      expect(typo.structured.unknownFields, name).toEqual([{ field: field.toUpperCase(), didYouMean: field }]);
    }
  });

  it("checks nested objects, and changes nothing", async () => {
    const before = (await client.call("get_document_info")).structured.revision;
    const layer = await client.call("add_layers", { layers: [{ type: "rectangle", name: "Card", position: [16, 120] }] });
    expect(layer.text).toContain('add_layers has no field "position" in layers[0].');
    expect(layer.text).toContain('Keys like "position" go inside "props".');
    const patch = await client.call("add_patches", { patches: [{ type: "switch", nmae: "Liked" }] });
    expect(patch.text).toContain('add_patches has no field "nmae" in patches[0]. Did you mean "name"?');
    const value = await client.call("set_values", { updates: [{ target: "zoom_spring.bounciness", vlaue: 3 }] });
    expect(value.text).toContain('Did you mean "value"?');
    const reset = await client.call("sim_reset");
    const event = await client.call("sim_dispatch", {
      simId: reset.structured.simId,
      events: [{ kind: "drag", from: "@photo", to: [200, 100], duration: 200 }],
    });
    expect(event.text).toContain('sim_dispatch has no field "duration" in events[0]. Did you mean "durationMs"?');
    expect((await client.call("get_document_info")).structured.revision).toBe(before);
  });

  it("keeps what clients add on their own working", async () => {
    // _meta inside arguments is reserved by MCP; some clients put request metadata there.
    const info = await client.call("get_document_info", { _meta: { progressToken: 7 } });
    expect(info.isError, info.text).toBe(false);
    // Request metadata where the protocol puts it: a progress token, and a 2026-07-28 envelope.
    const s = await rawSession(project.host);
    const call = await s.request("tools/call", {
      name: "get_outline",
      arguments: { detail: "compact" },
      _meta: { ...modernMeta(), progressToken: "p1" },
    });
    expect(JSON.stringify(call.result)).toContain("patch zoomed switch");
    await s.close();
  });
});
