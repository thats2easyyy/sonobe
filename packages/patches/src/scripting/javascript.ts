/**
 * JavaScript: runs a script from the project's scripts folder. Ports come from the script's static
 * header (dynamicPorts), and each loop index runs its own sandboxed instance (one instance for
 * whole-loop scripts). See script/instance.ts for the per-frame flow and sandbox/ for the realm.
 */

import type { ValueType } from "@sonobe/core";
import { definePatch, warnOnce } from "../infra/index.ts";
import { activeVariant, headerPortSpecs, readScriptHeader, type ScriptHeader } from "./script/header.ts";
import { ScriptInstance, type ScriptInstanceOptions } from "./script/instance.ts";

interface ScriptEntry {
  file: string;
  source: string;
  /** Null when the header can't be read (dynamicPorts already reported why). */
  header: ScriptHeader | null;
}

/** Above this many per-item instances, suggest whole-loop mode. */
export const MANY_INSTANCES = 1000;

export interface JavascriptState {
  instance: ScriptInstance | null;
  /** The file, source, and header this index last read through `services.readScript`. */
  entry: ScriptEntry | null;
}

/** The node's script file setting, trimmed ("" when unset). */
function scriptFile(settings: Record<string, unknown> | undefined): string {
  const setting = settings?.script;
  return typeof setting === "string" ? setting.trim() : "";
}

/** The header for `source`, reusing the previous entry while the file and source are unchanged. */
function readEntry(previous: ScriptEntry | null, file: string, source: string): ScriptEntry {
  if (previous && previous.file === file && previous.source === source) return previous;
  let header: ScriptHeader | null;
  try {
    header = readScriptHeader(source, file);
  } catch {
    header = null;
  }
  return { file, source, header };
}

export const javascript = definePatch<JavascriptState>("javascript", {
  state: () => ({ instance: null, entry: null }),

  dynamicPorts(node, doc) {
    const file = scriptFile(node.settings);
    if (!file) return { inputs: [], outputs: [] };
    const source = doc.scripts?.[file];
    if (source === undefined) throw new Error(`scripts/${file} doesn't exist. Create it with setScript or choose another file.`);
    const header = readScriptHeader(source, file);
    const ports = headerPortSpecs(header, node.typeParam);
    // Scripts that declare `export const variants` let the node switch type like a built-in patch.
    return header.variants?.length ? { ...ports, variants: [...header.variants] } : ports;
  },

  evaluate(ctx) {
    const file = scriptFile(ctx.node.settings);
    const source = file ? ctx.services.readScript(file) : undefined;
    if (source === undefined) {
      ctx.state.entry = null;
      return;
    }
    const entry = readEntry(ctx.state.entry, file, source);
    ctx.state.entry = entry;
    const header = entry.header;
    if (!header) return;
    const variant: ValueType | null = activeVariant(header, ctx.node.typeParam);
    let instance = ctx.state.instance;
    if (!instance || instance.source !== entry.source || instance.file !== entry.file || instance.variant !== variant || instance.header !== header) {
      const outputs = instance?.carryOutputs(header, variant);
      instance?.dispose();
      const options: ScriptInstanceOptions = {
        file: entry.file,
        source: entry.source,
        header,
        variant,
        patchId: ctx.id,
        loopIndex: header.wholeLoop ? 0 : ctx.loopIndex,
        deterministic: ctx.services.deterministic === true,
      };
      if (outputs) options.outputs = outputs;
      instance = new ScriptInstance(options);
      ctx.state.instance = instance;
    }
    if (!header.wholeLoop && ctx.loopIndex === 0 && ctx.loopCount > MANY_INSTANCES) {
      warnOnce(ctx, "many_instances", `${ctx.id} runs its script ${ctx.loopCount} times, once per loop item. Mark a port wholeLoop: true to run it once with the whole loop.`);
    }
    instance.frame(ctx);
  },

  dispose(state) {
    state?.instance?.dispose();
  },
});
