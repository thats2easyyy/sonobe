/**
 * Every guide example is real: "json tool:<name>" blocks run through the MCP tools against a
 * HeadlessHost (in order, on a fresh document per guide), "json tool-error:<name>" blocks must
 * fail, "text outline" lines must appear in get_outline, and "json events" blocks must parse.
 */

import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultGuidesDir, GUIDE_TOPICS, loadGuides } from "./guides.ts";
import { SimEventsSchema } from "./schemas.ts";
import { connectClient, tempProject } from "./test-helpers.ts";

interface Block {
  info: string;
  body: string;
  line: number;
}

function codeBlocks(markdown: string): Block[] {
  const out: Block[] = [];
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = /^```(.*)$/.exec(lines[i]!);
    if (!open) continue;
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length && !/^```\s*$/.test(lines[j]!); j++) body.push(lines[j]!);
    out.push({ info: open[1]!.trim(), body: body.join("\n"), line: i + 1 });
    i = j;
  }
  return out;
}

const guides = loadGuides();

describe("guides", () => {
  it("ship every topic, with a title and valid related topics", () => {
    const files = readdirSync(defaultGuidesDir())
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));
    expect(files.sort()).toEqual([...GUIDE_TOPICS].sort());
    for (const guide of guides.list()) {
      expect(guide.title, guide.topic).not.toBe(guide.topic);
      expect(guide.related.length, guide.topic).toBeGreaterThan(0);
      for (const r of guide.related)
        expect(GUIDE_TOPICS as readonly string[], `${guide.topic} → ${r}`).toContain(r);
      expect(guide.markdown.split("\n").length, guide.topic).toBeLessThan(220);
    }
  });

  for (const topic of GUIDE_TOPICS) {
    it(`${topic}: examples run against HeadlessHost`, async () => {
      const guide = guides.get(topic)!;
      const project = await tempProject({ name: topic });
      const client = await connectClient(project.host);
      let simId: string | undefined;
      let checked = 0;
      try {
        for (const block of codeBlocks(guide.markdown)) {
          const where = `${topic}.md:${block.line} (${block.info})`;
          const tool = /^json tool(-error)?:([a-z_]+)$/.exec(block.info);
          if (tool) {
            const args = JSON.parse(block.body) as Record<string, unknown>;
            if (typeof args.simId === "string" && simId) args.simId = simId;
            const r = await client.call(tool[2]!, args);
            if (tool[1]) expect(r.isError, `${where} should fail:\n${r.text}`).toBe(true);
            else expect(r.isError, `${where} failed:\n${r.text}`).toBe(false);
            if (tool[2] === "sim_reset") simId = r.structured.simId as string;
            if (
              !tool[1] &&
              [
                "add_layers",
                "add_patches",
                "apply_ops",
                "connect",
                "set_values",
                "create_component",
              ].includes(tool[2]!)
            ) {
              const totals = (
                r.structured.diagnostics as { totals: { errors: number } } | undefined
              )?.totals;
              expect(totals?.errors ?? 0, `${where} introduced errors:\n${r.text}`).toBe(0);
            }
            checked++;
          } else if (block.info === "text outline") {
            const outline = (await client.call("get_outline", {})).text.split("\n");
            for (const line of block.body.split("\n").filter((l) => l.trim()))
              expect(
                outline,
                `${where}: "${line}" isn't in the real outline:\n${outline.join("\n")}`,
              ).toContain(line);
            checked++;
          } else if (block.info === "json events") {
            const parsed = SimEventsSchema.safeParse(JSON.parse(block.body));
            expect(parsed.success, `${where}: ${parsed.success ? "" : parsed.error.message}`).toBe(
              true,
            );
            checked++;
          } else if (block.info.startsWith("json")) {
            throw new Error(
              `${where}: json blocks must be "json tool:<name>", "json tool-error:<name>" or "json events".`,
            );
          }
        }
        if (topic !== "troubleshooting")
          expect(checked, `${topic} has no validated examples`).toBeGreaterThan(0);
        const diagnostics = await client.call("get_diagnostics", { severity: "error" });
        expect(diagnostics.text, `${topic} leaves errors`).toContain("No error-level diagnostics");
      } finally {
        await client.close();
        await project.cleanup();
      }
    });
  }

  it("mention only real patch and tool names in backticks", async () => {
    const project = await tempProject();
    const toolNames = new Set(
      (await (await connectClient(project.host)).client.listTools()).tools.map((t) => t.name),
    );
    const patchTypes = new Set(project.host.registry.patches.keys());
    const layerTypes = new Set(project.host.registry.layers.keys());
    for (const guide of guides.list()) {
      const tokens = [...guide.markdown.matchAll(/`([a-z][A-Za-z0-9_]*)`/g)].map((m) => m[1]!);
      for (const token of tokens) {
        if (
          /^(get|list|describe|sim|add|set|update|delete|create|open|save|apply|begin|finish|tidy)_[a-z_]+$/.test(
            token,
          )
        )
          expect(toolNames, `${guide.topic}: tool \`${token}\``).toContain(token);
        if (
          /^(loop[A-Z]\w*|pop\w+|spring\w+|classicAnimation|tapToggle|longPress|gridLayout|layerInfo|delay1|variable\w+|reverseProgress)$/.test(
            token,
          )
        )
          expect(patchTypes, `${guide.topic}: patch \`${token}\``).toContain(token);
        if (/^(hitArea|componentInstance|textField|colorFill)$/.test(token))
          expect(layerTypes, `${guide.topic}: layer \`${token}\``).toContain(token);
      }
    }
    await project.cleanup();
  });
});
