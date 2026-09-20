import { describe, expect, it } from "vitest";
import { ANONYMOUS_CLIENT, clientLabel, createClientRegistry, parseHello, type ClientRegistryOptions } from "./clients.ts";

const A = "11111111-aaaa-4bbb-8ccc-000000000001";
const B = "22222222-aaaa-4bbb-8ccc-000000000002";

function registry(options: Omit<ClientRegistryOptions, "now"> = {}) {
  let t = 1_000_000;
  const clients = createClientRegistry({ now: () => t, ...options });
  let changes = 0;
  clients.subscribe(() => changes++);
  return {
    clients,
    advance: (ms: number) => (t += ms),
    changes: () => changes,
  };
}

describe("client registry", () => {
  it("lists a relay session from its hello, then drops it after it stops heartbeating", () => {
    const r = registry();
    r.clients.hello({ id: A, name: "claude-code", title: "Claude Code", version: "2.1.278", folder: "/Users/me/placemark", relay: { version: "0.1.0" } });
    expect(r.clients.list()).toMatchObject([{ id: A, label: "Claude Code", version: "2.1.278", folder: "/Users/me/placemark", via: "relay", state: "connected", toolCalls: 0, lastActivityAt: null, relayVersion: "0.1.0" }]);
    expect(r.changes()).toBe(1);

    // A heartbeat keeps it connected without telling anyone: nothing it shows changed.
    r.advance(30_000);
    r.clients.hello({ id: A });
    expect(r.changes()).toBe(1);
    expect(r.clients.get(A)).toMatchObject({ state: "connected", folder: "/Users/me/placemark" });

    r.advance(75_001);
    expect(r.clients.get(A)?.state).toBe("gone");
    r.advance(600_000);
    expect(r.clients.list()).toEqual([]);
  });

  it("marks a session gone on goodbye, and connected again if it comes back", () => {
    const r = registry();
    r.clients.hello({ id: A, name: "claude-code" });
    r.advance(5_000);
    r.clients.bye(A);
    expect(r.clients.get(A)?.state).toBe("gone");
    r.clients.bye(A);
    expect(r.changes()).toBe(2);
    r.advance(1_000);
    r.clients.hello({ id: A });
    expect(r.clients.get(A)).toMatchObject({ state: "connected", connectedAt: 1_006_000 });
  });

  it("counts tool calls per session and keeps the relay's name over per-call client info", () => {
    const r = registry();
    r.clients.hello({ id: A, name: "cursor-agent" });
    r.clients.hello({ id: B, name: "claude-code" });
    r.advance(2_000);
    r.clients.toolCall(A, "get_outline", { name: "something-else" });
    r.advance(1_000);
    r.clients.toolCall(A, "add_layers");
    expect(r.clients.get(A)).toMatchObject({ label: "Cursor Agent", toolCalls: 2, lastTool: "add_layers", lastActivityAt: 1_003_000 });
    expect(r.clients.get(B)).toMatchObject({ toolCalls: 0, lastTool: null });
    // Most recently active first.
    expect(r.clients.list().map((c) => c.id)).toEqual([A, B]);
  });

  it("puts clients without the relay in one row that goes idle, then away", () => {
    const r = registry();
    r.clients.toolCall(null, "list_documents");
    expect(r.clients.list()).toMatchObject([{ id: ANONYMOUS_CLIENT, via: "http", label: "Unidentified MCP client", state: "connected", toolCalls: 1 }]);
    // A header that isn't a relay id counts as none.
    r.clients.toolCall("../../etc", "get_outline", { name: "my-script" });
    expect(r.clients.list()).toMatchObject([{ id: ANONYMOUS_CLIENT, label: "My Script", toolCalls: 2 }]);
    r.advance(120_001);
    expect(r.clients.get(ANONYMOUS_CLIENT)?.state).toBe("idle");
    r.advance(600_000);
    expect(r.clients.list()).toEqual([]);
  });

  it("keeps at most maxClients rows, dropping gone and quiet ones first", () => {
    const r = registry({ maxClients: 2 });
    r.clients.hello({ id: A });
    r.advance(1_000);
    r.clients.hello({ id: B });
    r.clients.bye(B);
    r.advance(1_000);
    r.clients.hello({ id: "33333333-aaaa-4bbb-8ccc-000000000003" });
    expect(r.clients.list().map((c) => c.id).sort()).toEqual([A, "33333333-aaaa-4bbb-8ccc-000000000003"]);
  });

  it("labels known clients by their product name", () => {
    expect(clientLabel({ name: "claude-code", title: "Claude Code" })).toBe("Claude Code");
    expect(clientLabel({ name: "claude-ai", title: "Claude" })).toBe("Claude Desktop");
    expect(clientLabel({ name: "cursor-agent" })).toBe("Cursor Agent");
    expect(clientLabel({ name: "x", title: "My Tool" })).toBe("My Tool");
    expect(clientLabel({})).toBe("MCP client");
  });
});

describe("parseHello", () => {
  it("accepts what the relay sends", () => {
    expect(parseHello({ id: A, name: "claude-code", title: "Claude Code", version: "2.1.278", folder: "/Users/me/placemark", relay: { version: "0.1.0" }, extra: true })).toEqual({
      id: A,
      name: "claude-code",
      title: "Claude Code",
      version: "2.1.278",
      folder: "/Users/me/placemark",
      relay: { version: "0.1.0" },
    });
    expect(parseHello({ id: A, folder: "C:\\dev\\app" })).toEqual({ id: A, folder: "C:\\dev\\app" });
    expect(parseHello({ id: A, name: "claude\u0007-code" })).toEqual({ id: A, name: "claude-code" });
    expect((parseHello({ id: A, name: "x".repeat(500) }) as { name: string }).name).toHaveLength(120);
    // clientInfo's version is a required string that some clients leave blank; the rest still counts.
    expect(parseHello({ id: A, name: "my-agent", version: "" })).toEqual({ id: A, name: "my-agent" });
    expect(parseHello({ id: A, name: "my-agent", title: "  ", version: "\u0007" })).toEqual({ id: A, name: "my-agent" });
  });

  it("explains what's wrong with a bad hello", () => {
    expect(parseHello(null)).toContain("Send a JSON object");
    expect(parseHello([])).toContain("Send a JSON object");
    expect(parseHello({ id: "short" })).toContain('"id" must be 8 to 64');
    expect(parseHello({ id: "../../../etc/passwd" })).toContain('"id" must be 8 to 64');
    expect(parseHello({ id: A, folder: "relative/path" })).toContain('"folder" must be an absolute path');
    expect(parseHello({ id: A, folder: "/a\nb" })).toContain('"folder" must be an absolute path');
    expect(parseHello({ id: A, folder: `/${"a".repeat(1100)}` })).toContain("at most 1024");
    expect(parseHello({ id: A, name: 3 })).toContain('"name" must be a string');
    expect(parseHello({ id: A, relay: "0.1.0" })).toContain('"relay" must be an object');
  });
});
