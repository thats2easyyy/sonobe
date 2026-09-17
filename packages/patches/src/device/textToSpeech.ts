/**
 * Text to Speech: says Text on a Speak pulse through the host's speech service, reports Speaking,
 * and pulses Finished when the voice reaches the end. Hosts that return a promise report the real
 * end; otherwise the end is estimated from the text length (15 characters per second at rate 1).
 * One speech queue per runtime: a new utterance interrupts the previous one.
 */

import type { RuntimeServices } from "@sonobe/engine";
import { clamp, definePatch, finiteOr, toText, warnOnce } from "../infra/index.ts";
import { devicePlatform, isThenable } from "./platform.ts";
import type { SpeechOptions } from "./platform.ts";
import { describeError, withMutedBehavior } from "./shared.ts";

interface SpeechState {
  /** Utterance counter; results for older ids are ignored. */
  id: number;
  /** Identity of this state's current utterance in the shared speech queue. */
  token: object | null;
  speaking: boolean;
  ended: "ended" | "interrupted" | null;
  endAt: number;
}

/** The utterance currently owning each runtime's speech queue. */
const queues = new WeakMap<RuntimeServices, { owner: object | null }>();

function speechQueue(services: RuntimeServices): { owner: object | null } {
  let queue = queues.get(services);
  if (!queue) queues.set(services, (queue = { owner: null }));
  return queue;
}

/** Estimated speaking time in seconds: 15 characters per second at rate 1, at least 0.5 s. */
export function estimateSpeechSeconds(text: string, rate: number): number {
  return Math.max(0.5, text.length / (15 * rate));
}

function stopUtterance(state: SpeechState, services: RuntimeServices): void {
  if (!state.speaking) return;
  state.id++;
  state.speaking = false;
  state.ended = null;
  const queue = speechQueue(services);
  if (queue.owner === state.token) {
    queue.owner = null;
    devicePlatform(services).stopSpeaking?.();
  }
}

export const textToSpeechPatch = withMutedBehavior(
  definePatch<SpeechState>("textToSpeech", {
    state: () => ({ id: 0, token: null, speaking: false, ended: null, endAt: 0 }),
    evaluate(ctx) {
      const s = ctx.state;
      if (ctx.node.muted) {
        stopUtterance(s, ctx.services);
        ctx.output("speaking", false);
        return;
      }
      const platform = devicePlatform(ctx.services);
      const queue = speechQueue(ctx.services);
      if (ctx.pulsed("stop")) {
        stopUtterance(s, ctx.services);
      } else if (ctx.pulsed("speak")) {
        const text = toText(ctx.input("text")).trim();
        if (text !== "") {
          const id = ++s.id;
          const token = {};
          s.token = token;
          queue.owner = token;
          const rate = clamp(finiteOr(ctx.input("rate"), 1), 0.1, 10);
          const options: SpeechOptions = {
            rate,
            pitch: clamp(finiteOr(ctx.input("pitch"), 1), 0, 2),
            volume: clamp(finiteOr(ctx.input("volume"), 1), 0, 1),
          };
          const voice = toText(ctx.input("voice")).trim();
          if (voice !== "") options.voice = voice;
          s.speaking = true;
          s.ended = null;
          let result: unknown;
          if (platform.speak) {
            try {
              result = platform.speak(text, options);
            } catch (error) {
              warnOnce(ctx, "speakFailed", `Text to Speech: the voice couldn't start (${describeError(error)}).`);
            }
          } else {
            ctx.services.log("log", `Text to Speech: ${JSON.stringify(text)}`);
          }
          if (isThenable<string>(result)) {
            s.endAt = Number.POSITIVE_INFINITY;
            result.then(
              (how) => {
                if (s.id === id) s.ended = how === "interrupted" ? "interrupted" : "ended";
              },
              () => {
                if (s.id === id) s.ended = "interrupted";
              },
            );
          } else {
            s.endAt = ctx.time + estimateSpeechSeconds(text, rate);
          }
        }
      }
      // Another utterance took over the queue: this one was cut off.
      if (s.speaking && s.ended === null && queue.owner !== s.token) s.ended = "interrupted";
      if (s.speaking && (s.ended !== null || ctx.time >= s.endAt)) {
        if (s.ended !== "interrupted") ctx.pulse("finished");
        s.speaking = false;
        s.ended = null;
        if (queue.owner === s.token) queue.owner = null;
      }
      if (s.speaking) ctx.requestNextFrame();
      ctx.output("speaking", s.speaking);
    },
    dispose(state, services) {
      if (state) stopUtterance(state, services);
    },
  }),
  "evaluate",
);
