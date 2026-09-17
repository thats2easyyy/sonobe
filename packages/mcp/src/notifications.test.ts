/**
 * Resource notifications on new revisions: 2025-era connections get resources/updated for URIs
 * they subscribed to and list_changed when documents open; 2026-07-28 clients get the same
 * events on subscriptions/listen streams, over stdio and Streamable HTTP.
 */

import { createServer, type Server } from "node:http";
import path from "node:path";
import { Client as ClientV2, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Client as ClientV1 } from "@modelcontextprotocol/sdk/client/index.js";
import {
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import type { DocumentChange } from "./host.ts";
import { tempProject, type TempProject } from "./test-helpers.ts";
import {
  createHttpHandler,
  documentResourceUris,
  publishDocumentChange,
  serveStdioHost,
} from "./transports.ts";

let project: TempProject | undefined;
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  await project?.cleanup();
  project = undefined;
});

async function waitFor(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const OUTLINE = "sonobe://documents/test/outline";
const DIAGNOSTICS = "sonobe://documents/test/diagnostics";

describe("publishDocumentChange", () => {
  it("maps revisions to resource updates and open/close to list changes", () => {
    const calls: string[] = [];
    const notifier = {
      resourcesChanged: () => calls.push("list"),
      resourceUpdated: (uri: string) => calls.push(uri),
    };
    publishDocumentChange(notifier, { kind: "revision", docId: "test", revision: 3 });
    publishDocumentChange(notifier, { kind: "opened", docId: "other" });
    publishDocumentChange(notifier, { kind: "closed", docId: "other" });
    expect(calls).toEqual([OUTLINE, DIAGNOSTICS, "list", "list"]);
    expect(documentResourceUris("test")).toEqual([OUTLINE, DIAGNOSTICS]);
  });

  it("HeadlessHost reports revisions, undo and opened documents", async () => {
    project = await tempProject();
    const changes: DocumentChange[] = [];
    const off = project.host.onDocumentChange((c) => changes.push(c));
    await project.host.apply([{ op: "addLayer", layer: { type: "oval", name: "Dot" } }], {
      label: "dot",
      author: { kind: "agent", name: "Claude" },
    });
    await project.host.apply([{ op: "addLayer", layer: { type: "oval", name: "Dot" } }], {
      label: "dry",
      author: { kind: "agent", name: "Claude" },
      dryRun: true,
    });
    await project.host.history.undo({ author: { kind: "agent", name: "Claude" } });
    await project.host.createDocument({ path: path.join(project.dir, "B.sonobe"), open: false });
    off();
    await project.host.apply([{ op: "addLayer", layer: { type: "oval", name: "Late" } }], {
      label: "late",
      author: { kind: "agent", name: "Claude" },
    });
    expect(changes).toEqual([
      { kind: "revision", docId: "test", revision: 1 },
      { kind: "revision", docId: "test", revision: 2 },
      { kind: "opened", docId: "b" },
    ]);
  });
});

describe("stdio", () => {
  it("2025-era: resources/updated for subscribed URIs, list_changed on open", async () => {
    project = await tempProject({ template: "photo-zoom" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const handle = serveStdioHost(project.host, { version: "0.1.0-test", transport: serverSide });
    const client = new ClientV1({ name: "claude-code", version: "2.1.273" });
    const updated: string[] = [];
    let listChanged = 0;
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
      updated.push(n.params.uri);
    });
    client.setNotificationHandler(ResourceListChangedNotificationSchema, () => {
      listChanged++;
    });
    await client.connect(clientSide as never);
    cleanups.push(async () => {
      await client.close();
      await handle.close();
    });
    expect(client.getServerCapabilities()?.resources).toMatchObject({
      subscribe: true,
      listChanged: true,
    });
    await client.subscribeResource({ uri: OUTLINE });
    await client.callTool({
      name: "add_layers",
      arguments: { layers: [{ type: "oval", name: "Dot" }] },
    });
    await waitFor(() => updated.length > 0, "resources/updated");
    expect(updated).toEqual([OUTLINE]);
    const read = await client.readResource({ uri: OUTLINE });
    expect(JSON.stringify(read.contents)).toContain("layer dot oval");

    await client.callTool({
      name: "create_document",
      arguments: { path: path.join(project.dir, "Other.sonobe"), open: false },
    });
    await waitFor(() => listChanged > 0, "resources/list_changed");

    await client.unsubscribeResource({ uri: OUTLINE });
    await client.callTool({
      name: "add_layers",
      arguments: { layers: [{ type: "oval", name: "Dot Two" }] },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(updated).toEqual([OUTLINE]);
  });

  it("2026-07-28: events arrive on subscriptions/listen streams", async () => {
    project = await tempProject({ template: "photo-zoom" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const handle = serveStdioHost(project.host, { version: "0.1.0-test", transport: serverSide });
    const client = new ClientV2(
      { name: "claude-code", version: "2.1.273" },
      { versionNegotiation: { mode: "auto" } },
    );
    const updated: string[] = [];
    let listChanged = 0;
    client.setNotificationHandler("notifications/resources/updated", (n) => {
      updated.push(n.params.uri);
    });
    client.setNotificationHandler("notifications/resources/list_changed", () => {
      listChanged++;
    });
    await client.connect(clientSide);
    const subscription = await client.listen({
      resourceSubscriptions: [DIAGNOSTICS],
      resourcesListChanged: true,
    });
    cleanups.push(async () => {
      await subscription.close();
      await client.close();
      await handle.close();
    });
    await client.callTool({
      name: "add_layers",
      arguments: { layers: [{ type: "oval", name: "Dot" }] },
    });
    await waitFor(() => updated.includes(DIAGNOSTICS), "resources/updated on the listen stream");
    expect(updated).not.toContain(OUTLINE);
    await client.callTool({
      name: "create_document",
      arguments: { path: path.join(project.dir, "Other.sonobe"), open: false },
    });
    await waitFor(() => listChanged > 0, "list_changed on the listen stream");
  });
});

describe("Streamable HTTP", () => {
  it("publishes host changes to listen streams, and unsubscribes on close", async () => {
    project = await tempProject({ template: "photo-zoom" });
    const host = project.host;
    let listeners = 0;
    const counted = {
      ...host,
      onDocumentChange(listener: (change: DocumentChange) => void) {
        listeners++;
        const off = host.onDocumentChange(listener);
        return () => {
          listeners--;
          off();
        };
      },
    };
    const handler = createHttpHandler(counted, { version: "0.1.0-test" });
    expect(listeners).toBe(1);
    const server: Server = createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
    const client = new ClientV2(
      { name: "claude-code", version: "2.1.273" },
      { versionNegotiation: { mode: "auto" } },
    );
    const updated: string[] = [];
    client.setNotificationHandler("notifications/resources/updated", (n) => {
      updated.push(n.params.uri);
    });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    const subscription = await client.listen({ resourceSubscriptions: [OUTLINE] });
    cleanups.push(async () => {
      await subscription.close();
      await client.close();
      await handler.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      expect(listeners).toBe(0);
    });
    await client.callTool({
      name: "add_layers",
      arguments: { layers: [{ type: "oval", name: "Dot" }] },
    });
    await waitFor(() => updated.includes(OUTLINE), "resources/updated over HTTP");
    // The hook app hosts call when they know a revision changed.
    const before = updated.length;
    handler.documentChanged({ kind: "revision", docId: "test", revision: 99 });
    await waitFor(() => updated.length > before, "documentChanged hook");
  });
});
