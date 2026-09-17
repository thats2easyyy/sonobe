/** JSON File: loads a project JSON asset through the platform and parses it. */

import { definePatch, logOnce, toText } from "../infra/index.ts";
import { errorText, stripBom } from "./shared.ts";

type Pending = { ok: true; text: string } | { ok: false; message: string };

export interface JsonFileState {
  url: string | undefined;
  /** Increments per read; results from older reads are ignored. */
  token: number;
  pending: Pending | null;
  json: unknown;
  loading: boolean;
  error: boolean;
  message: string;
}

function set(s: JsonFileState, json: unknown, loading: boolean, error: boolean, message: string): void {
  s.json = json;
  s.loading = loading;
  s.error = error;
  s.message = message;
}

export const jsonFile = definePatch<JsonFileState>("jsonFile", {
  state: () => ({ url: undefined, token: 0, pending: null, json: null, loading: false, error: false, message: "" }),
  evaluate(ctx) {
    const s = ctx.state;
    const assetId = toText(ctx.node.settings?.asset ?? "");
    const url = assetId === "" ? undefined : ctx.services.resolveAssetUrl(assetId);
    if (s.token === 0 || url !== s.url) {
      s.url = url;
      const token = ++s.token;
      s.pending = null;
      const fetch = ctx.services.platform.fetch;
      if (assetId === "") set(s, null, false, false, "");
      else if (url === undefined) set(s, null, false, true, `No asset named "${assetId}" in this project`);
      else if (!fetch) set(s, null, false, true, "This host can't read project files");
      else {
        s.loading = true;
        const settle = (pending: Pending) => {
          if (token === s.token) s.pending = pending;
        };
        try {
          fetch(url)
            .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`the file couldn't be read (status ${r.status})`))))
            .then(
              (text) => settle({ ok: true, text }),
              (e: unknown) => settle({ ok: false, message: errorText(e) }),
            );
        } catch (e) {
          settle({ ok: false, message: errorText(e) });
        }
      }
    }
    if (s.pending) {
      const p = s.pending;
      s.pending = null;
      s.loading = false;
      if (!p.ok) set(s, null, false, true, `Couldn't load ${assetId}: ${p.message}`);
      else {
        try {
          set(s, JSON.parse(stripBom(p.text)), false, false, "");
        } catch (e) {
          set(s, null, false, true, `${assetId} isn't valid JSON: ${errorText(e)}`);
        }
      }
    }
    if (s.error) logOnce(ctx, "warn", `error:${s.message}`, s.message);
    if (s.loading) ctx.requestNextFrame();
    ctx.output("json", s.json as never);
    ctx.output("loading", s.loading);
    ctx.output("error", s.error);
    ctx.output("errorMessage", s.message);
  },
  dispose(state) {
    state.token++;
    state.pending = null;
  },
});
