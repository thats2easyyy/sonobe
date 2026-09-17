/** Resources: guides, patch reference per type, document outline and diagnostics. */

import { getOutline } from "@sonobe/core";
import { BEHAVIORS, renderPatchReference } from "@sonobe/patches";
import { ResourceTemplate } from "@modelcontextprotocol/server";
import { HostError } from "./host.ts";
import type { ToolContext } from "./server.ts";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function registerResources(tc: ToolContext): void {
  const { host, server } = tc;

  server.registerResource(
    "guide",
    new ResourceTemplate("sonobe://guides/{topic}", {
      list: async () => ({
        resources: tc
          .guides()
          .list()
          .map((g) => ({
            uri: `sonobe://guides/${g.topic}`,
            name: `guide-${g.topic}`,
            title: g.title,
            mimeType: "text/markdown",
          })),
      }),
    }),
    {
      title: "Sonobe guide",
      description: "Workflow guides for building prototypes with Sonobe tools.",
      mimeType: "text/markdown",
    },
    async (uri, vars) => {
      const topic = one(vars.topic);
      const guide = tc.guides().get(topic);
      if (!guide) throw new HostError("not_found", `There's no guide "${topic}".`);
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: guide.markdown }] };
    },
  );

  server.registerResource(
    "patch-reference",
    new ResourceTemplate("sonobe://patches/{type}", {
      list: async () => ({
        resources: [...host.registry.patches.values()].map((s) => ({
          uri: `sonobe://patches/${s.type}`,
          name: `patch-${s.type}`,
          title: s.name,
          description: s.summary,
          mimeType: "text/markdown",
        })),
      }),
    }),
    {
      title: "Patch reference",
      description: "Reference page for one patch type: ports, defaults, behavior, examples.",
      mimeType: "text/markdown",
    },
    async (uri, vars) => {
      const type = one(vars.type);
      const spec = host.registry.patches.get(type);
      if (!spec) throw new HostError("not_found", `There's no patch type "${type}".`);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: renderPatchReference(spec, {
              ...(BEHAVIORS[type] ? { behavior: BEHAVIORS[type] } : {}),
            }),
          },
        ],
      };
    },
  );

  server.registerResource(
    "document-outline",
    new ResourceTemplate("sonobe://documents/{docId}/outline", {
      list: async () => ({
        resources: (await host.listDocuments()).map((d) => ({
          uri: `sonobe://documents/${d.docId}/outline`,
          name: `outline-${d.docId}`,
          title: `${d.name} outline`,
          mimeType: "text/plain",
        })),
      }),
    }),
    {
      title: "Document outline",
      description: "Compact text projection of every component in a document.",
      mimeType: "text/plain",
    },
    async (uri, vars) => {
      const snap = await host.getDocument(one(vars.docId));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: `revision ${snap.revision}\n${getOutline(snap.doc, undefined, { registry: host.registry })}`,
          },
        ],
      };
    },
  );

  server.registerResource(
    "document-diagnostics",
    new ResourceTemplate("sonobe://documents/{docId}/diagnostics", {
      list: async () => ({
        resources: (await host.listDocuments()).map((d) => ({
          uri: `sonobe://documents/${d.docId}/diagnostics`,
          name: `diagnostics-${d.docId}`,
          title: `${d.name} diagnostics`,
          mimeType: "application/json",
        })),
      }),
    }),
    {
      title: "Document diagnostics",
      description: "Diagnostics for a document as JSON, with suggestions.",
      mimeType: "application/json",
    },
    async (uri, vars) => {
      const r = await host.diagnostics(one(vars.docId));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              { docId: r.docId, revision: r.revision, diagnostics: r.diagnostics },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
