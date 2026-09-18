import type { AssetRecord } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { createFontAssetRegistry } from "./fonts.ts";

class FakeFontFace {
  readonly family: string;
  readonly source: string;
  readonly descriptors: FontFaceDescriptors;
  constructor(family: string, source: string, descriptors: FontFaceDescriptors) {
    this.family = family;
    this.source = source;
    this.descriptors = descriptors;
  }
  load() {
    return Promise.resolve(this);
  }
}

function fakeDocument() {
  const added = new Set<FakeFontFace>();
  const doc = { fonts: { add: (f: FakeFontFace) => added.add(f), delete: (f: FakeFontFace) => added.delete(f) }, defaultView: { FontFace: FakeFontFace } } as unknown as Document;
  return { doc, added };
}

const inter: AssetRecord = { id: "inter", kind: "font", name: "Inter Variable", file: "abc.woff2", font: { family: "Inter Variable", weight: "100 900", unicodeRange: "U+0-FF" } };

describe("createFontAssetRegistry", () => {
  it("registers font assets that name a face, once, and removes them when they go", () => {
    const { doc, added } = fakeDocument();
    const registry = createFontAssetRegistry((id) => `blob:${id}`, doc);
    registry.sync({ inter, photo: { id: "photo", kind: "image", name: "Photo", file: "p.png" }, plain: { id: "plain", kind: "font", name: "Plain", file: "x.ttf" } });
    registry.sync({ inter });
    expect([...added].map((f) => [f.family, f.source, f.descriptors])).toEqual([["Inter Variable", 'url("blob:inter")', { weight: "100 900", unicodeRange: "U+0-FF" }]]);
    registry.sync({});
    expect(added.size).toBe(0);
    registry.sync({ inter });
    registry.dispose();
    expect(added.size).toBe(0);
  });
});
