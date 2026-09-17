/**
 * JavaScript: runs a script from the project's scripts folder. Ports come from the script's static
 * header (dynamicPorts), and each loop index runs its own sandboxed instance (one instance for
 * whole-loop scripts). See script/instance.ts for the per-frame flow and sandbox/ for the realm.
 */

import type { PatchNode, ValueType } from "@sonobe/core";
import { DETERMINISTIC_EPOCH_MS } from "@sonobe/engine";
import { definePatch, warnOnce } from "../infra/index.ts";
import { activeVariant, headerPortSpecs, readScriptHeader, type ScriptHeader } from "./script/header.ts";
import { ScriptInstance, type ScriptInstanceOptions } from "./script/instance.ts";

interface ScriptEntry {
  file: string;
  source: string;
  header: ScriptHeader;
}

/**
 * The script source and header each node compiled with. `PatchContext` can't read `doc.scripts`
 * (contract gap), so `dynamicPorts`, which the engine calls whenever it compiles a document,
 * records them here for `evaluate`.
 */
const scriptEntries = new WeakMap<PatchNode, ScriptEntry>();

/** Above this many per-item instances, suggest whole-loop mode. */
export const MANY_INSTANCES = 1000;

export interface JavascriptState {
  instance: ScriptInstance | null;
}

/** True when services report the deterministic simulation clock. */
function isDeterministic(now: number, time: number): boolean {
  return Math.abs(now - (DETERMINISTIC_EPOCH_MS + time * 1000)) < 0.5;
}

export const javascript = definePatch<JavascriptState>("javascript", {
  state: () => ({ instance: null }),

  dynamicPorts(node, doc) {
    const setting = node.settings?.script;
    const file = typeof setting === "string" ? setting.trim() : "";
    if (!file) {
      scriptEntries.delete(node);
      return { inputs: [], outputs: [] };
    }
    const source = doc.scripts?.[file];
    if (source === undefined) {
      scriptEntries.delete(node);
      throw new Error(`scripts/${file} doesn't exist. Create it with setScript or choose another file.`);
    }
    try {
      const header = readScriptHeader(source, file);
      scriptEntries.set(node, { file, source, header });
      return headerPortSpecs(header, node.typeParam);
    } catch (err) {
      scriptEntries.delete(node);
      throw err;
    }
  },

  evaluate(ctx) {
    const entry = scriptEntries.get(ctx.node);
    if (!entry) return;
    const variant: ValueType | null = activeVariant(entry.header, ctx.node.typeParam);
    let instance = ctx.state.instance;
    if (!instance || instance.source !== entry.source || instance.file !== entry.file || instance.variant !== variant || instance.header !== entry.header) {
      const outputs = instance?.carryOutputs(entry.header, variant);
      instance?.dispose();
      const options: ScriptInstanceOptions = {
        file: entry.file,
        source: entry.source,
        header: entry.header,
        variant,
        patchId: ctx.id,
        loopIndex: entry.header.wholeLoop ? 0 : ctx.loopIndex,
        deterministic: isDeterministic(ctx.services.now(), ctx.time),
      };
      if (outputs) options.outputs = outputs;
      instance = new ScriptInstance(options);
      ctx.state.instance = instance;
    }
    if (!entry.header.wholeLoop && ctx.loopIndex === 0 && ctx.loopCount > MANY_INSTANCES) {
      warnOnce(ctx, "many_instances", `${ctx.id} runs its script ${ctx.loopCount} times, once per loop item. Mark a port wholeLoop: true to run it once with the whole loop.`);
    }
    instance.frame(ctx);
  },

  dispose(state) {
    state?.instance?.dispose();
  },
});
