import { createRuntime } from "@sonobe/engine";
import { buildDoc, createMockRegistry, defineMock, port } from "@sonobe/engine/testing";
import { describe, expect, it, vi } from "vitest";
import { createLocalTrustPersistence, createMemoryTrustPersistence, createScriptTrustStore, scriptPatchCount, withScriptTrust } from "./scriptTrust.ts";

const js = defineMock({ type: "javascript", name: "JavaScript", inputs: [], outputs: [port("output", "number")], evaluate: (ctx) => ctx.output("output", 42) });
const registry = createMockRegistry([js]);
const scripted = () => buildDoc({ patches: { js_1: { type: "javascript" } } }, registry);
const plain = () => buildDoc({ patches: { toggle: { type: "switch" } } }, registry);

describe("script trust", () => {
  it("asks before running scripts of projects opened from disk, and remembers the answer per path", () => {
    const persistence = createMemoryTrustPersistence();
    const trust = createScriptTrustStore({ persistence });
    expect(scriptPatchCount(scripted())).toBe(1);

    trust.evaluate(scripted(), null);
    expect(trust.getState()).toMatchObject({ required: false, trusted: true, scriptCount: 1 });
    trust.evaluate(plain(), "/p/Plain.sonobe");
    expect(trust.allowed()).toBe(true);

    trust.evaluate(scripted(), "/p/Scripts.sonobe");
    expect(trust.getState()).toMatchObject({ required: true, trusted: false, projectPath: "/p/Scripts.sonobe" });
    expect(trust.allowed()).toBe(false);
    const allowedChanges = vi.fn();
    trust.subscribeAllowed(allowedChanges);
    trust.noteDocument(plain());
    expect(trust.getState()).toMatchObject({ required: true, scriptCount: 0 });
    trust.trust();
    expect(trust.allowed()).toBe(true);
    expect(allowedChanges).toHaveBeenCalledWith(true);
    expect(persistence.list()).toEqual(["/p/Scripts.sonobe"]);

    const reopened = createScriptTrustStore({ persistence });
    reopened.evaluate(scripted(), "/p/Scripts.sonobe");
    expect(reopened.allowed()).toBe(true);
    reopened.revoke();
    expect(reopened.getState()).toMatchObject({ required: true, trusted: false });
    expect(persistence.isTrusted("/p/Scripts.sonobe")).toBe(false);

    const sessionOnly = createScriptTrustStore({ persistence });
    sessionOnly.evaluate(scripted(), "/p/Other.sonobe");
    sessionOnly.trust({ remember: false });
    sessionOnly.evaluate(scripted(), "/p/Other.sonobe");
    expect(sessionOnly.allowed()).toBe(true);
    expect(persistence.isTrusted("/p/Other.sonobe")).toBe(false);
    sessionOnly.rememberPath("/p/Saved.sonobe");
    expect(persistence.isTrusted("/p/Saved.sonobe")).toBe(true);
  });

  it("asks once even when requested twice", async () => {
    let answer!: (ok: boolean) => void;
    const confirm = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const trust = createScriptTrustStore({ persistence: createMemoryTrustPersistence(), confirm });
    trust.evaluate(scripted(), "/p/S.sonobe");
    const first = trust.request();
    const second = trust.request();
    expect(second).toBe(first);
    expect(trust.getState().requesting).toBe(true);
    expect(confirm).toHaveBeenCalledWith({ projectPath: "/p/S.sonobe", scriptCount: 1, name: "Test" });
    answer(true);
    await expect(first).resolves.toBe(true);
    expect(trust.getState()).toMatchObject({ trusted: true, requesting: false });

    const declined = createScriptTrustStore({ persistence: createMemoryTrustPersistence(), confirm: async () => false });
    declined.evaluate(scripted(), "/p/S.sonobe");
    await expect(declined.request()).resolves.toBe(false);
    await expect(createScriptTrustStore({ persistence: createMemoryTrustPersistence() }).request()).resolves.toBe(true);
    const noPrompt = createScriptTrustStore({ persistence: createMemoryTrustPersistence() });
    noPrompt.evaluate(scripted(), "/p/S.sonobe");
    await expect(noPrompt.request()).resolves.toBe(false);
  });

  it("keeps trusted paths in storage", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    createLocalTrustPersistence({ storage }).trust("/p/A.sonobe");
    expect(createLocalTrustPersistence({ storage }).isTrusted("/p/A.sonobe")).toBe(true);
    expect(createLocalTrustPersistence({ storage: null }).isTrusted("/p/A.sonobe")).toBe(false);
    data.set("sonobe.trustedProjects", "{nope");
    expect(createLocalTrustPersistence({ storage }).list()).toEqual([]);
  });

  it("gates the JavaScript patch until scripts are allowed", () => {
    let allowed = false;
    const gated = withScriptTrust(registry, () => allowed);
    expect(gated.definitions.get("switch")).toBe(registry.definitions.get("switch"));
    expect(registry.definitions.get("javascript")).toBe(js);
    const noScripts = createMockRegistry();
    expect(withScriptTrust(noScripts, () => false)).toBe(noScripts);

    const runtime = createRuntime(scripted(), { registry: gated, deterministic: true });
    runtime.step();
    expect(runtime.getValue("js_1.output")).not.toBe(42);
    expect(runtime.issues()).toEqual([expect.objectContaining({ code: "script_untrusted", severity: "warning", patchId: "js_1" })]);
    allowed = true;
    runtime.step();
    expect(runtime.getValue("js_1.output")).toBe(42);
    runtime.dispose();
  });
});
