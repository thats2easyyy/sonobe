import { describe, expect, it } from "vitest";
import { newComponent } from "./document.ts";
import { migrateFile, ProjectFormatError } from "./migrations.ts";
import { parseComponentFile, parseProjectFile } from "./schema.ts";
import {
  createMemoryFs,
  loadProject,
  loadProjectFiles,
  parseComponent,
  parseDocumentFiles,
  saveProject,
  serializeAssets,
  serializeComponent,
  serializeDocument,
  staleProjectFiles,
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

  it("never loads or deletes folders and files in scripts/ it doesn't own", async () => {
    const dir = "/work/Kept.sonobe";
    const doc = mustApply(buildSampleDocument(), [
      { op: "setScript", file: "js_1.js", source: "// one\n" },
      { op: "setScript", file: "helpers.js", source: "// helpers\n" },
    ]).doc;
    const fs = createMemoryFs();
    await saveProject(fs, dir, doc);
    await fs.writeText(`${dir}/scripts/lib/math.js`, "export const x = 1;\n");
    await fs.writeText(`${dir}/scripts/.eslintrc.json`, "{}\n");
    await fs.writeText(`${dir}/scripts/my helper.js`, "// spaces\n");
    await fs.writeText(`${dir}/components/sub/nested.json`, "{}\n");
    await fs.mkdirp(`${dir}/components/old.json`);

    const loaded = await loadProject(fs, dir);
    expect(Object.keys(loaded.scripts).sort()).toEqual(["helpers.js", "js_1.js"]);

    const removed = mustApply(loaded, [{ op: "setScript", file: "js_1.js", source: null }]).doc;
    const result = await saveProject(fs, dir, removed);
    expect(result.removed).toEqual(["scripts/js_1.js"]);
    for (const kept of ["scripts/lib/math.js", "scripts/.eslintrc.json", "scripts/my helper.js", "scripts/helpers.js", "components/sub/nested.json"]) {
      expect(await fs.exists(`${dir}/${kept}`)).toBe(true);
    }
    expect(await loadProject(fs, dir)).toStrictEqual(removed);
  });

  it("removes only stale files the caller says it owns", async () => {
    const dir = "/work/Shared.sonobe";
    const fs = createMemoryFs();
    const { doc, files } = await (async () => {
      await saveProject(fs, dir, mustApply(buildSampleDocument(), [{ op: "setScript", file: "mine.js", source: "// mine\n" }]).doc);
      return loadProjectFiles(fs, dir);
    })();
    expect(Object.keys(files).sort()).toEqual(["assets/assets.json", "components/main.json", "project.json", "scripts/mine.js"]);
    // Someone else adds a component and a script while this document is open.
    await fs.writeText(`${dir}/components/button.json`, serializeComponent(newComponent({ id: "button", name: "Button", kind: "layerComponent" })));
    await fs.writeText(`${dir}/scripts/theirs.js`, "// theirs\n");

    const next = mustApply(doc, [{ op: "setScript", file: "mine.js", source: null }]).doc;
    expect(await staleProjectFiles(fs, dir, serializeDocument(next))).toEqual(["components/button.json", "scripts/mine.js", "scripts/theirs.js"]);
    const result = await saveProject(fs, dir, next, { removable: new Set(Object.keys(files)) });
    expect(result.removed).toEqual(["scripts/mine.js"]);
    expect(await fs.exists(`${dir}/components/button.json`)).toBe(true);
    expect(await fs.exists(`${dir}/scripts/theirs.js`)).toBe(true);
    expect(result.files).toEqual(serializeDocument(next));
  });

  it("refuses to save files whose names differ only by case, before writing anything", async () => {
    const doc = mustApply(
      buildSampleDocument(),
      [
        { op: "addComponent", component: { id: "card", name: "Card", kind: "layerComponent" } },
        { op: "addComponent", component: { id: "Card", name: "Card 2", kind: "layerComponent" } },
      ],
      { lenient: true },
    ).doc;
    const fs = createMemoryFs();
    await expect(saveProject(fs, "/work/Clash.sonobe", doc)).rejects.toMatchObject({
      code: "invalidFormat",
      message: expect.stringContaining("components/Card.json and components/card.json would overwrite each other"),
    });
    expect(fs.files.size).toBe(0);

    const scripts = mustApply(buildSampleDocument(), [
      { op: "setScript", file: "js_1.js", source: "// lower\n" },
      { op: "setScript", file: "JS_1.js", source: "// upper\n" },
    ], { lenient: true }).doc;
    await expect(saveProject(fs, "/work/Clash.sonobe", scripts)).rejects.toMatchObject({ message: expect.stringContaining("scripts/JS_1.js and scripts/js_1.js") });
  });

  it("explains a component file whose id differs from its name only by case", () => {
    const files = serializeDocument(mustApply(buildSampleDocument(), [{ op: "addComponent", component: { id: "card", name: "Card", kind: "layerComponent" } }]).doc);
    files["components/Card.json"] = files["components/card.json"]!;
    delete files["components/card.json"];
    expect(() => parseDocumentFiles(files)).toThrow(/differ only by capitalization/);
  });
});

describe("hostile files", () => {
  const componentText = (patches: string) =>
    `{"formatVersion":1,"id":"main","name":"Main","kind":"prototype","interface":{"inputs":{},"outputs":{}},"layers":[],"patches":${patches},"comments":[]}`;

  it("reports a __proto__ patch id instead of silently dropping the patch", () => {
    const r = parseComponentFile(componentText('{"__proto__":{"type":"switch","inputs":{},"ui":{"x":0,"y":0}},"other":{"type":"switch","inputs":{},"ui":{"x":0,"y":0}}}'), "components/main.json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("__proto__");
  });

  it("turns layers nested thousands deep into a format error with a short path", () => {
    let layer: Record<string, unknown> = { id: "l2000", type: "group", name: "L", props: {} };
    for (let i = 1999; i >= 1; i--) layer = { id: `l${i}`, type: "group", name: "L", props: {}, children: [layer] };
    const text = `{"formatVersion":1,"id":"main","name":"Main","kind":"prototype","interface":{"inputs":{},"outputs":{}},"layers":[${JSON.stringify(layer)}],"patches":{},"comments":[]}`;
    try {
      parseComponent(text, "components/main.json");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectFormatError);
      expect((err as ProjectFormatError).code).toBe("invalidFormat");
      const issue = (err as ProjectFormatError).issues[0]!;
      expect(issue.message).toContain("nested more than 256 levels");
      expect(issue.path.length).toBeLessThan(80);
    }
  });

  it("keeps large coordinates stable across load and save", () => {
    const doc = mustApply(buildSampleDocument(), [{ op: "updatePatch", id: "pop", ui: { x: -4345500469.207764, y: 4294967296.1234567 } }]).doc;
    const files = serializeDocument(doc);
    expect(serializeDocument(parseDocumentFiles(files))).toEqual(files);
  });
});
