/** Discovery tools: get_guide, list_patch_types, describe_patch_types, describe_layer_types, list_value_types. */

import { didYouMean, didYouMeanText, type PatchCategory } from "@sonobe/core";
import { CATEGORY_ORDER } from "@sonobe/patches";
import { z } from "zod";
import {
  describeLayerType,
  describePatchType,
  groupByCategory,
  isImplemented,
  patchTypeData,
  searchPatchTypes,
  valueTypesText,
} from "../catalog.ts";
import { pageNote, paginate } from "../format.ts";
import { GUIDE_TOPICS } from "../guides.ts";
import { failure, success } from "../results.ts";
import { READ_ONLY, type ToolContext } from "../server.ts";

export function registerDiscoveryTools(tc: ToolContext): void {
  const { host } = tc;

  tc.tool(
    "get_guide",
    {
      title: "Get guide",
      description: `Short workflow guides for building prototypes with Sonobe tools. Read "start-here" once per conversation before editing. Topics: ${GUIDE_TOPICS.join(", ")}.`,
      input: z.object({ topic: z.string().describe(`One of: ${GUIDE_TOPICS.join(", ")}.`) }),
      annotations: READ_ONLY,
    },
    async ({ topic }) => {
      const guide = tc.guides().get(topic);
      if (!guide) {
        const topics = tc
          .guides()
          .list()
          .map((g) => g.topic);
        return failure({
          code: "unknown_topic",
          message: `There's no guide "${topic}".${didYouMeanText(didYouMean(topic, topics))}`,
          hint: `Topics: ${topics.join(", ")}.`,
        });
      }
      const related = guide.related.length ? `\n\nRelated topics: ${guide.related.join(", ")}` : "";
      return success(`${guide.markdown.trim()}${related}`, {
        topic: guide.topic,
        title: guide.title,
        relatedTopics: guide.related,
      });
    },
  );

  tc.tool(
    "list_patch_types",
    {
      title: "List patch types",
      description:
        'Search the patch library by what you want to do ("spring", "drag", "tabs"), by category, or list everything. Returns type keys with a one-line summary and port keys. Use describe_patch_types for defaults and behavior.',
      input: z.object({
        query: z
          .string()
          .optional()
          .describe("Words to match against names, aliases, summaries and port keys."),
        category: z.enum(CATEGORY_ORDER as [PatchCategory, ...PatchCategory[]]).optional(),
        detail: z
          .enum(["names", "summary"])
          .optional()
          .describe("names: type keys only; summary (default): plus summary and ports."),
        implementedOnly: z
          .boolean()
          .optional()
          .describe("Only types whose evaluators are implemented."),
        limit: z.number().int().min(1).max(200).optional().describe("Default 40."),
        cursor: z.string().optional(),
      }),
      annotations: READ_ONLY,
    },
    async ({ query, category, detail, implementedOnly, limit, cursor }) => {
      const specs = searchPatchTypes(host.registry, {
        ...(query ? { query } : {}),
        ...(category ? { category } : {}),
        ...(implementedOnly ? { implementedOnly } : {}),
      });
      if (!specs.length) {
        return success(
          `No patch types match${query ? ` "${query}"` : ""}${category ? ` in ${category}` : ""}. Try broader words, or list a category (${CATEGORY_ORDER.join(", ")}).`,
          { total: 0, types: [] },
        );
      }
      const page = paginate(specs, cursor, limit ?? 40);
      const head = `${specs.length} patch type${specs.length === 1 ? "" : "s"}${query ? ` matching "${query}"` : ""}${category ? ` in ${category}` : ""}${query ? " (best matches first)" : ""}:`;
      const body = query
        ? page.items
            .map(
              (s) =>
                `- ${
                  detail === "names"
                    ? `${s.type} (${s.name})`
                    : groupByCategory(host.registry, [s], detail ?? "summary")
                        .split("\n")
                        .slice(1)
                        .join("\n")
                }`,
            )
            .join("\n")
        : groupByCategory(host.registry, page.items, detail ?? "summary");
      const note = pageNote(page, "types");
      return success([head, body, note].filter(Boolean).join("\n"), {
        total: page.total,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        types: page.items.map((s) => ({
          type: s.type,
          name: s.name,
          category: s.category,
          summary: s.summary,
          implemented: isImplemented(host.registry, s.type),
        })),
      });
    },
  );

  tc.tool(
    "describe_patch_types",
    {
      title: "Describe patch types",
      description:
        "Full declarations for patch types: every input and output with type, default, range and options; typeParam variants and variadic counts; pairings, common mistakes and an example outline. Call before wiring a patch you haven't used in this conversation.",
      input: z.object({
        types: z
          .array(z.string())
          .min(1)
          .max(12)
          .describe('Patch type keys, e.g. ["interaction", "popAnimation"].'),
        detail: z
          .enum(["standard", "full"])
          .optional()
          .describe("full adds advanced ports, all examples, docs and evaluation behavior."),
        includeExamples: z.boolean().optional().describe("Default true."),
      }),
      annotations: READ_ONLY,
    },
    async ({ types, detail, includeExamples }) => {
      const blocks: string[] = [];
      const data: Record<string, unknown>[] = [];
      const unknown: string[] = [];
      const candidates = [...host.registry.patches.values()].map((s) => ({
        value: s.type,
        aliases: [s.name, ...(s.aliases ?? [])],
      }));
      for (const type of types) {
        const spec = host.registry.patches.get(type);
        if (!spec) {
          unknown.push(type);
          blocks.push(
            `## ${type}\nThere's no patch type "${type}".${didYouMeanText(didYouMean(type, candidates))}`,
          );
          continue;
        }
        blocks.push(
          describePatchType(host.registry, spec, {
            detail: detail ?? "standard",
            includeExamples: includeExamples !== false,
          }),
        );
        data.push(patchTypeData(host.registry, spec));
      }
      if (unknown.length === types.length) {
        return failure({
          code: "unknown_patch_type",
          message: blocks.map((b) => b.split("\n").slice(1).join(" ")).join(" "),
          hint: "list_patch_types searches by what you want to do.",
        });
      }
      return success(blocks.join("\n\n"), { types: data, unknown });
    },
  );

  tc.tool(
    "describe_layer_types",
    {
      title: "Describe layer types",
      description:
        "Layer types and their properties (key, type, default, options), read-only outputs, and whether they can hold children. Omit types for a one-line list of every layer type.",
      input: z.object({
        types: z
          .array(z.string())
          .max(12)
          .optional()
          .describe('Layer type keys, e.g. ["rectangle", "text"].'),
        detail: z
          .enum(["summary", "standard", "full"])
          .optional()
          .describe("full adds advanced props."),
      }),
      annotations: READ_ONLY,
    },
    async ({ types, detail }) => {
      const all = [...host.registry.layers.values()];
      if (!types?.length)
        return success(
          [
            "Layer types (use describe_layer_types with types for props):",
            ...all.map((s) => `- ${describeLayerType(s, "summary")}`),
          ].join("\n"),
          {
            types: all.map((s) => ({
              type: s.type,
              name: s.name,
              canHaveChildren: s.canHaveChildren,
            })),
          },
        );
      const blocks: string[] = [];
      const unknown: string[] = [];
      for (const type of types) {
        const spec = host.registry.layers.get(type);
        if (!spec) {
          unknown.push(type);
          blocks.push(
            `## ${type}\nThere's no layer type "${type}".${didYouMeanText(
              didYouMean(
                type,
                all.map((s) => ({ value: s.type, aliases: [s.name] })),
              ),
            )}`,
          );
          continue;
        }
        blocks.push(describeLayerType(spec, detail ?? "standard"));
      }
      if (unknown.length === types.length)
        return failure({
          code: "unknown_layer_type",
          message: blocks.map((b) => b.split("\n").slice(1).join(" ")).join(" "),
          hint: `Layer types: ${all.map((s) => s.type).join(", ")}.`,
        });
      return success(blocks.join("\n\n"), {
        types: types
          .filter((t) => !unknown.includes(t))
          .map((t) => {
            const s = host.registry.layers.get(t)!;
            return {
              type: s.type,
              name: s.name,
              canHaveChildren: s.canHaveChildren,
              props: s.props.map((p) => ({
                key: p.key,
                type: p.type,
                default: p.default,
                category: p.category,
              })),
              outputs: (s.outputs ?? []).map((p) => ({ key: p.key, type: p.type })),
            };
          }),
        unknown,
      });
    },
  );

  tc.tool(
    "list_value_types",
    {
      title: "List value types",
      description:
        "The value types ports carry, how to write each as a literal in ops, which connections convert automatically, and which converter patches fix a mismatch.",
      input: z.object({}),
      annotations: READ_ONLY,
    },
    async () => success(valueTypesText()),
  );
}
