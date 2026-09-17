import { describe, expect, it } from "vitest";
import { newComponent } from "./document.ts";
import { migrateFile, ProjectFormatError } from "./migrations.ts";
import { parseComponentFile, parseProjectFile } from "./schema.ts";
import {
  createMemoryFs,
  loadProject,
  parseComponent,
  parseDocumentFiles,
  saveProject,
  serializeAssets,
  serializeComponent,
  serializeDocument,
  stringifyCanonical,
} from "./serialize.ts";
import { buildSampleDocument, mustApply } from "./testing/fixtures.ts";
import type { Component } from "./types.ts";

describe("canonical serialization", () => {
  it("writes schema key order, sorted maps, inline leaves and rounded numbers", () => {
    const c: Component = newComponent({ id: "main", name: "Main", kind: "prototype", size: [390, 844] });
    c.layers = [{ id: "card", type: "rectangle", name: "Card", props: { size: [358, 220], position: [16, 120], scale: { link: "grow.output" }, opacity: -0 } }];
    c.patches = {
      pop: { type: "popAnimation", inputs: {}, ui: { y: 60, x: 400 } },
      grow: { ui: { x: 580, y: 60 }, type: "transition", typeParam: "number", inputs: { progress: { link: "pop.output" }, start: 1, end: 1.0800000001 } },
    };
    expect(serializeComponent(c)).toBe(
      [
        "{",
        '  "formatVersion": 1,',
        '  "id": "main",',
        '  "name": "Main",',
        '  "kind": "prototype",',
        '  "size": [390, 844],',
        '  "interface": { "inputs": {}, "outputs": {} },',
        '  "layers": [',
        "    {",
        '      "id": "card",',
        '      "type": "rectangle",',
        '      "name": "Card",',
        '      "props": {',
        '        "opacity": 0,',
        '        "position": [16, 120],',
        '        "scale": { "link": "grow.output" },',
        '        "size": [358, 220]',
        "      }",
        "    }",
        "  ],",
        '  "patches": {',
        '    "grow": {',
        '      "type": "transition",',
        '      "typeParam": "number",',
        '      "inputs": {',
        '        "end": 1.08,',
        '        "progress": { "link": "pop.output" },',
        '        "start": 1',
        "      },",
        '      "ui": { "x": 580, "y": 60 }',
        "    },",
        '    "pop": {',
        '      "type": "popAnimation",',
        '      "inputs": {},',
        '      "ui": { "x": 400, "y": 60 }',
        "    }",
        "  },",
        '  "comments": []',
        "}",
        "",
      ].join("\n"),
    );
  });

  it("keeps single-key wrappers and short number lists on one line", () => {
    const text = stringifyCanonical({ b: { loop: [1, 2, 3] }, a: { layer: { layer: "card" } }, stops: [[0, "#FFFFFFFF"], [1, "#000000FF"]] });
    expect(text).toBe('{\n  "a": { "layer": { "layer": "card" } },\n  "b": { "loop": [1, 2, 3] },\n  "stops": [[0, "#FFFFFFFF"], [1, "#000000FF"]]\n}\n');
  });

  it("breaks long leaves across lines", () => {
    const text = stringifyCanonical({ text: { value: "x".repeat(120) } });
    expect(text).toBe(`{\n  "text": {\n    "value": "${"x".repeat(120)}"\n  }\n}\n`);
  });

  it("preserves json literal key order but sorts meta", () => {
    const c = newComponent({ id: "main", name: "Main", kind: "prototype" });
    c.meta = { zeta: 1, alpha: { y: 2, x: 1 } };
    c.patches = { data: { type: "javascript", inputs: { config: { json: { zeta: 1, alpha: 2 } } }, ui: { x: 0, y: 0 } } };
    const text = serializeComponent(c);
    expect(text.indexOf('"zeta": 1, "alpha": 2')).toBeGreaterThan(0);
    expect(text).toContain('"meta": {\n    "alpha": { "x": 1, "y": 2 },\n    "zeta": 1\n  }');
  });

  it("is stable: serialize(parse(serialize(doc))) is byte-identical", () => {
    const doc = mustApply(buildSampleDocument(), [
      { op: "setInput", target: "grow.end", value: 1.0000004999 },
      { op: "updatePatch", id: "pop", settings: { preset: "snappy", curve: [0.1, 0.2] }, muted: true },
      { op: "addAsset", asset: { id: "photo", kind: "image", name: "Photo", file: "abc.png", width: 10, height: 10 } },
      { op: "addLayer", layer: { type: "image", name: "Hero", props: { image: { asset: "photo" }, cornerRadius: 4.0000001, strokeColor: "#FF0000" } } },
      { op: "setScript", file: "js_1.js", source: "export default function(){}\n" },
    ]).doc;
    const files = serializeDocument(doc);
    const again = serializeDocument(parseDocumentFiles(files));
    expect(again).toEqual(files);
    for (const text of Object.values(files)) {
      expect(text.endsWith("\n")).toBe(true);
      expect(text).not.toContain("\r");
    }
    expect(parseDocumentFiles(files)).toStrictEqual(parseDocumentFiles(again));
  });

  it("serializes the asset registry sorted by id", () => {
    const text = serializeAssets({
      b: { id: "b", kind: "sound", name: "B", file: "b.mp3" },
      a: { file: "a.png", name: "A", kind: "image", id: "a", width: 1.23456789 },
    });
    expect(text).toBe('{\n  "a": { "id": "a", "kind": "image", "name": "A", "file": "a.png", "width": 1.234568 },\n  "b": { "id": "b", "kind": "sound", "name": "B", "file": "b.mp3" }\n}\n');
  });
});

describe("schema", () => {
  it("normalizes empty children, false flags and comment order", () => {
    const r = parseComponentFile({
      formatVersion: 1,
      id: "main",
      name: "Main",
      kind: "prototype",
      interface: { inputs: {}, outputs: {} },
      layers: [{ id: "card", type: "rectangle", name: "Card", props: {}, children: [], locked: false }],
      patches: { p: { type: "switch", inputs: {}, muted: false, ui: { x: 0, y: 0, collapsed: false } } },
      comments: [
        { id: "z", text: "", rect: [0, 0, 1, 1] },
        { id: "a", text: "", rect: [0, 0, 1, 1] },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.layers[0]).toStrictEqual({ id: "card", type: "rectangle", name: "Card", props: {} });
    expect(r.value.patches.p).toStrictEqual({ type: "switch", inputs: {}, ui: { x: 0, y: 0 } });
    expect(r.value.comments.map((c) => c.id)).toEqual(["a", "z"]);
  });

  it("reports readable error paths", () => {
    const r = parseComponentFile(
      {
        formatVersion: 1,
        id: "main",
        name: "Main",
        kind: "prototype",
        interface: { inputs: { label: { key: "other", name: "Label", type: "text" } }, outputs: {} },
        layers: [{ id: "card", type: "rectangle", name: "Card", props: { scale: { lnk: "grow.output" } }, prop: 1 }],
        patches: { "2bad": { type: "switch", inputs: {}, ui: { x: 0, y: 0 } }, ok: { type: "switch", inputs: { flip: { link: "nope" } }, ui: { x: 0, y: 0 } } },
        comments: [],
      },
      "components/main.json",
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const paths = r.issues.map((i) => i.path);
    expect(paths).toContain("layers[0].props.scale");
    expect(paths).toContain("layers[0]");
    expect(paths).toContain("interface.inputs.label.key");
    expect(r.issues.find((i) => i.path === "layers[0]")?.message).toContain('unknown field "prop"');
    expect(r.message).toContain("components/main.json: layers[0].props.scale:");
    expect(r.issues.some((i) => i.path.startsWith("patches") && i.message.includes("id"))).toBe(true);
    expect(r.issues.some((i) => i.message.includes('link must be an address'))).toBe(true);
  });

  it("validates project manifests", () => {
    const r = parseProjectFile('{"formatVersion":1,"name":"X","root":"main","device":{"preset":""},"fps":30}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.path).sort()).toEqual(["device.preset", "fps"]);
    const bad = parseProjectFile("{nope");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain("isn't valid JSON");
  });

  it("round-trips parsed documents without adding undefined fields", () => {
    const doc = buildSampleDocument();
    const r = parseComponentFile(JSON.parse(JSON.stringify(doc.components.main)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toStrictEqual(doc.components.main);
  });
});

describe("migrations", () => {
  it("rejects files from newer versions", () => {
    try {
      migrateFile("component", { formatVersion: 3 }, { file: "components/main.json" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectFormatError);
      expect((err as ProjectFormatError).code).toBe("tooNew");
      expect((err as Error).message).toContain("Update Sonobe");
    }
  });

  it("reads newer projects that declare a compatible minReaderVersion", () => {
    expect(migrateFile("project", { formatVersion: 2, minReaderVersion: 1 })).toEqual({ formatVersion: 2, minReaderVersion: 1 });
  });

  it("flags invalid formats and failed migrations", () => {
    expect(() => migrateFile("project", { name: "x" })).toThrow(expect.objectContaining({ code: "invalidFormat" }));
    expect(() => migrateFile("project", [1, 2])).toThrow(expect.objectContaining({ code: "invalidFormat" }));
    expect(() => migrateFile("component", { formatVersion: 1 }, { currentVersion: 2, migrations: [] })).toThrow(expect.objectContaining({ code: "migrationFailed" }));
    const throwing = [{ kind: "component" as const, from: 1, description: "rename fields", migrate: () => { throw new Error("boom"); } }];
    expect(() => migrateFile("component", { formatVersion: 1 }, { currentVersion: 2, migrations: throwing })).toThrow(/boom/);
  });

  it("runs migrations step by step", () => {
    const migrations = [
      { kind: "component" as const, from: 1, description: "add notes", migrate: (j: Record<string, unknown>) => ({ ...j, notes: "v2" }) },
      { kind: "component" as const, from: 2, description: "uppercase notes", migrate: (j: Record<string, unknown>) => ({ ...j, notes: String(j.notes).toUpperCase() }) },
    ];
    expect(migrateFile("component", { formatVersion: 1 }, { currentVersion: 3, migrations })).toEqual({ formatVersion: 3, notes: "V2" });
  });

  it("reports corrupt JSON and id/file mismatches", () => {
    expect(() => parseComponent("{", "components/main.json")).toThrow(expect.objectContaining({ code: "corrupt" }));
    const files = serializeDocument(buildSampleDocument());
    files["components/other.json"] = files["components/main.json"]!;
    expect(() => parseDocumentFiles(files)).toThrow(expect.objectContaining({ code: "invalidFormat", message: expect.stringContaining("other.json") }));
  });
});

describe("project IO", () => {
  it("saves and loads through an FsAdapter", async () => {
    const fs = createMemoryFs();
    const doc = mustApply(buildSampleDocument(), [
      { op: "addComponent", component: { name: "Primary Button", kind: "layerComponent" } },
      { op: "setScript", file: "js_1.js", source: "// hi\n" },
    ]).doc;
    const first = await saveProject(fs, "/work/Demo.sonobe", doc);
    expect(first.written.sort()).toEqual(["assets/assets.json", "components/main.json", "components/primary_button.json", "project.json", "scripts/js_1.js"]);
    const loaded = await loadProject(fs, "/work/Demo.sonobe");
    expect(loaded).toStrictEqual(doc);

    const second = await saveProject(fs, "/work/Demo.sonobe", loaded);
    expect(second.written).toEqual([]);
    expect(second.unchanged).toHaveLength(5);

    const removed = mustApply(loaded, [
      { op: "removeComponent", id: "primary_button" },
      { op: "setScript", file: "js_1.js", source: null },
    ]).doc;
    await fs.writeText("/work/Demo.sonobe/components/README.txt", "not a component");
    const third = await saveProject(fs, "/work/Demo.sonobe", removed);
    expect(third.removed.sort()).toEqual(["components/primary_button.json", "scripts/js_1.js"]);
    expect(await fs.exists("/work/Demo.sonobe/components/README.txt")).toBe(true);
    expect(await loadProject(fs, "/work/Demo.sonobe")).toStrictEqual(removed);
  });

  it("explains missing projects and roots", async () => {
    const fs = createMemoryFs();
    await expect(loadProject(fs, "/nowhere")).rejects.toMatchObject({ code: "invalidFormat", message: expect.stringContaining("project.json is missing") });
    const files = serializeDocument(buildSampleDocument());
    delete files["components/main.json"];
    expect(() => parseDocumentFiles(files)).toThrow(/root component is "main"/);
  });
});
