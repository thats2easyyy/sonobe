import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { changeCase, changeCasePatch } from "./changeCase.ts";

describe("changeCase", () => {
  it("applies each case option", () => {
    expect(changeCase("Recently played", "uppercase")).toBe("RECENTLY PLAYED");
    expect(changeCase("Recently Played", "lowercase")).toBe("recently played");
    expect(changeCase("recently PLAYED", "capitalize")).toBe("Recently Played");
    expect(changeCase("RECENTLY PLAYED", "sentence")).toBe("Recently played");
  });

  it("uses root case mappings, which can change length", () => {
    expect(changeCase("straße", "uppercase")).toBe("STRASSE");
    expect(changeCase("istanbul", "uppercase")).toBe("ISTANBUL");
    expect(changeCase("123 🎉 ok!", "uppercase")).toBe("123 🎉 OK!");
  });

  it("capitalizes words after whitespace, skipping leading punctuation", () => {
    expect(changeCase("(hello world)", "capitalize")).toBe("(Hello World)");
    expect(changeCase("¿qué tal?", "capitalize")).toBe("¿Qué Tal?");
    expect(changeCase("1st place", "capitalize")).toBe("1st Place");
    expect(changeCase("don't stop", "capitalize")).toBe("Don't Stop");
    expect(changeCase("self-driving car", "capitalize")).toBe("Self-driving Car");
    expect(changeCase("iPhone", "capitalize")).toBe("Iphone");
    expect(changeCase("maya\tchen\nomar", "capitalize")).toBe("Maya\tChen\nOmar");
  });

  it("capitalizes the first letter of each sentence and lowercases the rest", () => {
    expect(changeCase("hello. how ARE you? i'm fine! yes I did", "sentence")).toBe("Hello. How are you? I'm fine! Yes i did");
    expect(changeCase("  \"quoted\" start", "sentence")).toBe("  \"Quoted\" start");
    expect(changeCase("v1.2 is out", "sentence")).toBe("V1.2 is out");
    expect(changeCase("wait...what", "sentence")).toBe("Wait...what");
  });

  it("treats unknown keys as uppercase and empty text as empty", () => {
    expect(changeCase("abc", "shout")).toBe("ABC");
    expect(changeCase("", "capitalize")).toBe("");
  });

  it("evaluates per loop index with the declared defaults", () => {
    expect(createPatchHarness(changeCasePatch, { inputs: { text: "hi" } }).step().outputs.output).toBe("HI");
    const h = createPatchHarness(changeCasePatch, { inputs: { text: loopOf(["maya chen", "omar haddad"]), case: "capitalize" } });
    expect(h.step().outputs.output).toEqual(loopOf(["Maya Chen", "Omar Haddad"]));
  });
});
