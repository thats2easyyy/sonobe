/** Open URL: opens a link through the host on a pulse, refusing dangerous schemes. */

import type { RuntimePatchDefinition, RuntimeServices } from "@sonobe/engine";
import { definePatch, toText } from "../infra/index.ts";
import { isPromiseLike, withMutedBehavior } from "./shared.ts";

/** Schemes a prototype may never open. */
export const REFUSED_URL_SCHEMES: readonly string[] = ["javascript", "data", "file", "blob", "vbscript", "about"];

const BLOCKED_MESSAGE = "The link couldn't be opened. The browser may have blocked it, or no app handles it.";

/** Frame each patch instance last opened a link on, per runtime. */
const lastOpened = new WeakMap<RuntimeServices, Map<string, number>>();

export interface OpenUrlState {
  errorMessage: string;
  generation: number;
  pending: boolean;
  settled: { ok: boolean; message: string } | null;
  key: string;
}

/** A readable problem with `url` (already trimmed), or undefined when it may be opened. */
export function validateOpenUrl(url: string): string | undefined {
  if (url === "") return "Add a URL to open.";
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(url);
  if (!match) return "Start the URL with https:// or an app scheme like myapp://.";
  const scheme = match[1]!.toLowerCase();
  if (REFUSED_URL_SCHEMES.includes(scheme)) return `Links using ${scheme}: can't be opened from a prototype.`;
  return undefined;
}

export const openUrl: RuntimePatchDefinition<OpenUrlState> = withMutedBehavior(
  definePatch<OpenUrlState>("openUrl", {
    state: () => ({ errorMessage: "", generation: 0, pending: false, settled: null, key: "" }),
    evaluate(ctx) {
      const s = ctx.state;
      s.key = `${ctx.componentPath}/${ctx.id}`;
      let opened = false;
      let failed = false;
      if (s.settled) {
        if (s.settled.ok) {
          opened = true;
          s.errorMessage = "";
        } else {
          failed = true;
          s.errorMessage = s.settled.message;
        }
        s.settled = null;
      }
      if (ctx.pulsed("open")) {
        const url = toText(ctx.input("url")).trim();
        const problem = validateOpenUrl(url);
        let frames = lastOpened.get(ctx.services);
        if (!frames) lastOpened.set(ctx.services, (frames = new Map()));
        const host = ctx.services.platform.openUrl as ((url: string) => unknown) | undefined;
        const fail = (message: string) => {
          opened = false;
          failed = true;
          s.errorMessage = message;
        };
        if (problem) fail(problem);
        else if (frames.get(s.key) === ctx.frame) fail("Only one link can open per frame.");
        else if (!host) fail("This viewer can't open links.");
        else {
          frames.set(s.key, ctx.frame);
          const generation = ++s.generation;
          s.pending = false;
          try {
            const r = host(url);
            if (isPromiseLike(r)) {
              s.pending = true;
              r.then(
                (ok) => {
                  if (generation !== s.generation) return;
                  s.pending = false;
                  s.settled = ok === false ? { ok: false, message: BLOCKED_MESSAGE } : { ok: true, message: "" };
                },
                (e: unknown) => {
                  if (generation !== s.generation) return;
                  s.pending = false;
                  s.settled = { ok: false, message: `The link couldn't be opened: ${String(e)}` };
                },
              );
            } else if (r === false) fail(BLOCKED_MESSAGE);
            else {
              failed = false;
              opened = true;
              s.errorMessage = "";
            }
          } catch (e) {
            fail(`The link couldn't be opened: ${String(e)}`);
          }
        }
      }
      if (s.pending) ctx.requestNextFrame();
      ctx.output("errorMessage", s.errorMessage);
      if (opened) ctx.pulse("opened");
      else if (failed) ctx.pulse("failed");
    },
    dispose(state, services) {
      state.generation++;
      state.pending = false;
      state.settled = null;
      if (state.key) lastOpened.get(services)?.delete(state.key);
    },
  }),
  "zero",
);
