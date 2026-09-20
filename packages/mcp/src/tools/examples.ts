/** Example tools: list_examples and get_example, the verified examples as a patterns catalog (examples.ts). */

import { didYouMeanText } from "@sonobe/core";
import { z } from "zod";
import { exampleOutline, readmeSections, type BuiltExample, type ExampleEntry } from "../examples.ts";
import { plural } from "../format.ts";
import { failure, success } from "../results.ts";
import { READ_ONLY, type ToolContext } from "../server.ts";

/** README sections get_example shows, by detail. */
const SUMMARY_SECTIONS = ["What you'll learn", "The patch chain", "Common mistakes"];
const FULL_SECTIONS = ["What you'll learn", "Build it step by step", "The patch chain", "Variations", "Common mistakes"];

/** Most checks listed per scenario. */
const MAX_CHECKS = 4;

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** "10-swipe-cards · Swipe Cards: Per-copy state with loops, throws, deck depth. Key patches: loop, swipe, …" */
function listLine(entry: ExampleEntry, built: BuiltExample | undefined): string {
  const keys = built?.keyPatches.length ? ` Key patches: ${built.keyPatches.join(", ")}.` : entry.keyPatchNames.length ? ` Key patches: ${entry.keyPatchNames.join(", ")}.` : "";
  return `${entry.id} · ${entry.name}: ${entry.teaches.replace(/\.$/, "")}.${keys}`;
}

function scenarioLines(entry: ExampleEntry): string[] {
  if (!entry.scenarios?.length) return [];
  return [
    `## Scenarios it passes (examples/${entry.id}/test.json)`,
    ...entry.scenarios.map((s) => {
      const checks = s.checks.slice(0, MAX_CHECKS).join("; ");
      return `- ${s.name}${checks ? `: ${checks}${s.checks.length > MAX_CHECKS ? "; …" : ""}` : ""}`;
    }),
  ];
}

export function registerExampleTools(tc: ToolContext): void {
  const { host } = tc;

  /** The example built with the host's patches, or why it can't be. */
  const build = (entry: ExampleEntry): BuiltExample | { error: string } => {
    try {
      return tc.examples().build(entry, host.registry);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };

  const unknownExample = (id: string) => {
    const catalog = tc.examples();
    return failure({
      code: "unknown_example",
      message: `There's no example "${id}".${didYouMeanText(catalog.suggest(id))}`,
      hint: `Examples: ${catalog.list().map((e) => e.id).join(", ")}. list_examples says what each teaches.`,
    });
  };

  tc.tool(
    "list_examples",
    {
      title: "List examples",
      description:
        "The verified example prototypes as a catalog of patterns: what each teaches and its key patches (tap to grow, like toggle, scrolling list, carousel, tab bar, collapsing header, pull to refresh, bottom sheet, drag and snap, swipe cards, long press, timed sequence, stories, onboarding, loops...). Each one builds with no errors and passes scripted scenarios. Before building an interaction one of them covers, read it with get_example. query filters by words in the name, what it teaches or its patch types.",
      input: z.object({
        query: z
          .string()
          .max(200)
          .optional()
          .describe('Words to match, e.g. "swipe", "loop", "springAnimation" (all must match).'),
      }),
      annotations: READ_ONLY,
    },
    async ({ query }) => {
      const catalog = tc.examples();
      const rows = catalog.list().map((entry) => {
        const built = build(entry);
        return { entry, built: "error" in built ? undefined : built };
      });
      const wanted = words(query ?? "");
      const matches = rows.filter(({ entry, built }) => {
        if (!wanted.length) return true;
        const hay = new Set(
          words([entry.id, entry.name, entry.description, entry.teaches, ...entry.keyPatchNames, ...(built?.patchTypes ?? [])].join(" ")),
        );
        const text = [...hay].join(" ");
        return wanted.every((w) => hay.has(w) || text.includes(w));
      });
      if (!matches.length)
        return success(
          `No example matches "${query}". Examples: ${rows.map((r) => r.entry.id).join(", ")}. Try one word, or a patch type key such as "swipe".`,
          { total: rows.length, examples: [] },
        );
      const lines = [
        `${plural(matches.length, "example")}${wanted.length ? ` matching "${query}"` : ""}. Each builds with no errors and passes its scripted scenarios. get_example({ "id": "${matches[0]!.entry.id}" }) shows how one works, and detail "ops" gives its recipe as apply_ops batches.`,
        "",
        ...matches.map(({ entry, built }) => listLine(entry, built)),
      ];
      return success(lines.join("\n"), {
        total: rows.length,
        examples: matches.map(({ entry, built }) => ({
          id: entry.id,
          name: entry.name,
          teaches: entry.teaches,
          keyPatches: built?.keyPatches ?? [],
        })),
      });
    },
  );

  tc.tool(
    "get_example",
    {
      title: "Get example",
      description:
        'One verified example as a pattern to follow. detail "summary" (default): what it teaches, its key patches, the patch chain (a diagram and what each patch does), common mistakes and the scenarios it passes. "full" adds the build steps, variations and the whole outline. "ops": the recipe as apply_ops batches that build it on a blank document (create_document first), with the example\'s ids, values and layout; batch picks one when there are several. Adapt the pattern to the person\'s design rather than pasting it over their work.',
      input: z.object({
        id: z
          .string()
          .describe('Example id from list_examples ("10-swipe-cards"), its number ("10") or its name.'),
        detail: z.enum(["summary", "full", "ops"]).optional().describe("Default summary."),
        batch: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('With detail "ops": which batch, from 1 (default 1).'),
      }),
      annotations: READ_ONLY,
    },
    async ({ id, detail, batch }) => {
      const entry = tc.examples().get(id);
      if (!entry) return unknownExample(id);
      const built = build(entry);
      if ("error" in built)
        return failure({
          code: "example_unavailable",
          message: `The ${entry.name} example couldn't be built with this Sonobe's patches: ${built.error}`,
          hint: "This is a bug in Sonobe; pick another example meanwhile.",
        });
      const d = detail ?? "summary";
      const { intro, sections } = entry.readme ? readmeSections(entry.readme) : { intro: "", sections: new Map<string, string>() };
      const scenarioCount = entry.scenarios?.length ?? 0;
      const head = [
        `# ${entry.number.toString().padStart(2, "0")} ${entry.name} (${entry.id})`,
        intro || entry.description,
        `Teaches: ${entry.teaches.replace(/\.$/, "")}.`,
        `Key patches: ${built.keyPatches.join(", ")}. All ${plural(built.patchTypes.length, "patch type")}: ${built.patchTypes.join(", ")}.`,
        `Verified: builds with no errors${scenarioCount ? ` and passes ${plural(scenarioCount, "scripted scenario")}` : ""} (examples/run.test.ts).`,
      ];
      const data = {
        id: entry.id,
        name: entry.name,
        teaches: entry.teaches,
        keyPatches: built.keyPatches,
        patchTypes: built.patchTypes,
        scenarios: (entry.scenarios ?? []).map((s) => s.name),
        batches: built.batches.length,
        ops: built.batches.reduce((n, b) => n + b.length, 0),
      };

      if (d === "ops") {
        const count = built.batches.length;
        const index = (batch ?? 1) - 1;
        if (index >= count)
          return failure({
            code: "invalid_batch",
            message: `${entry.name}'s recipe has ${plural(count, "batch", "batches")}, so there's no batch ${batch}.`,
            hint: `Pass batch 1${count > 1 ? `…${count}` : ""}.`,
          });
        const ops = built.batches[index]!;
        const lines = [
          `# ${entry.name} (${entry.id}): the recipe${count > 1 ? `, batch ${index + 1} of ${count}` : ""}`,
          `${plural(data.ops, "op")} build the example on a blank document, with its ids, values and layout. Make one with create_document (or use an empty document), then call apply_ops with ${count > 1 ? "each batch in order" : "these ops"}: { "ops": [...] }. Then check it: get_diagnostics, and sim_reset, sim_dispatch and sim_get_values against the scenarios get_example lists.`,
          "",
          "```json",
          `[\n${ops.map((op) => `  ${JSON.stringify(op)}`).join(",\n")}\n]`,
          "```",
        ];
        if (index + 1 < count)
          lines.push(`Next: get_example({ "id": "${entry.id}", "detail": "ops", "batch": ${index + 2} }).`);
        return success(lines.join("\n"), { ...data, batch: index + 1 });
      }

      const shown = (d === "full" ? FULL_SECTIONS : SUMMARY_SECTIONS).flatMap((heading) => {
        const body = sections.get(heading);
        return body ? [`## ${heading}`, body, ""] : [];
      });
      const lines = [...head, "", ...shown, ...scenarioLines(entry)];
      if (!entry.readme) lines.push(`How it works: ${entry.recipe.notes}`);
      if (d === "full") lines.push("", "## Outline", exampleOutline(built, host.registry));
      lines.push(
        "",
        `Next: get_example({ "id": "${entry.id}", "detail": "ops" }) gives the recipe as apply_ops batches${d === "full" ? "" : '; detail "full" adds the build steps, variations and the whole outline'}.`,
      );
      return success(lines.join("\n").replace(/\n{3,}/g, "\n\n"), { ...data, detail: d });
    },
  );
}
