import { describe, expect, it } from "vitest";
import type { PatchDefinition, SpeechOptions } from "@sonobe/engine";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { estimateSpeechSeconds, textToSpeechPatch } from "./textToSpeech.ts";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The definition with a switch for `ctx.muted`, so a test can mute a running patch. */
function muteSwitch<S>(definition: PatchDefinition<S>) {
  let muted = false;
  const switched: PatchDefinition<S> = { ...definition, evaluate: (ctx) => definition.evaluate(Object.create(ctx, { muted: { get: () => muted } })) };
  return { definition: switched, mute: (on: boolean) => void (muted = on) };
}

describe("textToSpeech", () => {
  it("estimates 15 characters per second at rate 1, at least 0.5 s", () => {
    expect(estimateSpeechSeconds("Hello", 1)).toBe(0.5);
    expect(estimateSpeechSeconds("x".repeat(30), 1)).toBe(2);
    expect(estimateSpeechSeconds("x".repeat(30), 2)).toBe(1);
  });

  it("logs the text without a speech service and pulses Finished after the estimate", () => {
    const h = createPatchHarness(textToSpeechPatch);
    expect(h.step().outputs.speaking).toBe(false);
    const start = h.step({ pulses: ["speak"], dt: 0.1 });
    expect(start.outputs.speaking).toBe(true);
    expect(start.requestedNextFrame).toBe(true);
    expect(h.logs.map((l) => l.message)).toEqual(['Text to Speech: "Hello"']);
    let finishedAt = -1;
    for (let i = 0; i < 10; i++) {
      const f = h.step({ dt: 0.1 });
      if (f.pulses.has("finished")) {
        finishedAt = f.time;
        expect(f.outputs.speaking).toBe(false);
        break;
      }
      expect(f.outputs.speaking).toBe(true);
    }
    expect(finishedAt - start.time).toBeGreaterThanOrEqual(0.5 - 1e-9);
    expect(finishedAt - start.time).toBeLessThan(0.6 + 1e-9);
  });

  it("passes clamped options and the voice to the host", () => {
    const calls: [string, SpeechOptions][] = [];
    const h = createPatchHarness(textToSpeechPatch, { services: { platform: { speak: (text, opts) => void calls.push([text, opts as SpeechOptions]) } } });
    h.step({ pulses: ["speak"], inputs: { text: "  Good morning  ", rate: 50, pitch: -1, volume: Number.NaN, voice: "en-GB" } });
    expect(calls).toEqual([["Good morning", { rate: 10, pitch: 0, volume: 1, voice: "en-GB" }]]);
  });

  it("Stop wins over Speak, cuts off speech without Finished, and calls stopSpeaking only while speaking", () => {
    let stops = 0;
    const h = createPatchHarness(textToSpeechPatch, { services: { platform: { speak: () => {}, stopSpeaking: () => stops++ } as never } });
    h.step({ pulses: ["speak", "stop"] });
    expect(h.output("speaking")).toBe(false);
    expect(stops).toBe(0);
    h.step({ pulses: ["speak"] });
    const stopped = h.step({ pulses: ["stop"] });
    expect(stopped.outputs.speaking).toBe(false);
    expect(stops).toBe(1);
    const later = h.run(120);
    expect(later.pulses.has("finished")).toBe(false);
  });

  it("ignores empty text", () => {
    const h = createPatchHarness(textToSpeechPatch);
    const f = h.step({ pulses: ["speak"], inputs: { text: "   " } });
    expect(f.outputs.speaking).toBe(false);
    expect(h.logs).toEqual([]);
  });

  it("uses a host promise: ended pulses Finished, interrupted doesn't, and replaced results are ignored", async () => {
    const resolvers: ((how: string) => void)[] = [];
    const speak = () => new Promise<string>((resolve) => resolvers.push(resolve));
    const h = createPatchHarness(textToSpeechPatch, { services: { platform: { speak } as never } });
    h.step({ pulses: ["speak"] });
    h.run(200);
    expect(h.output("speaking")).toBe(true);
    resolvers[0]!("ended");
    await flush();
    const done = h.step();
    expect(done.pulses.has("finished")).toBe(true);
    expect(done.outputs.speaking).toBe(false);

    h.step({ pulses: ["speak"] });
    h.step({ pulses: ["speak"] });
    resolvers[1]!("ended");
    await flush();
    expect(h.step().outputs.speaking).toBe(true);
    resolvers[2]!("interrupted");
    await flush();
    const cut = h.step();
    expect(cut.pulses.has("finished")).toBe(false);
    expect(cut.outputs.speaking).toBe(false);
  });

  it("a later loop index interrupts an earlier one: the queue has one voice", () => {
    const h = createPatchHarness(textToSpeechPatch, { inputs: { speak: loopOf([true, true]), text: "A long sentence to say out loud" } });
    expect(h.step().outputs.speaking).toEqual(loopOf([true, true]));
    const f = h.step();
    expect(f.outputs.speaking).toEqual(loopOf([false, true]));
    expect(f.pulseItems.finished).toBeUndefined();
  });

  it("stops speaking while muted and on dispose", () => {
    let stops = 0;
    const { definition, mute } = muteSwitch(textToSpeechPatch);
    const h = createPatchHarness(definition, { services: { platform: { speak: () => {}, stopSpeaking: () => void stops++ } } });
    h.step({ pulses: ["speak"] });
    mute(true);
    expect(h.step({ pulses: ["speak"] }).outputs.speaking).toBe(false);
    expect(stops).toBe(1);
    mute(false);
    h.step({ pulses: ["speak"] });
    h.dispose();
    expect(stops).toBe(2);
  });
});
