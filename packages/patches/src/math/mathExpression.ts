/**
 * Math Expression: evaluates a typed formula. Each variable becomes a number input and each
 * `;`-separated statement a number output; ports are derived from `settings.expression`.
 */

import type { PatchNode } from "@sonobe/core";
import { definePatch, logOnce, toNumber } from "../infra/index.ts";
import { compileExpression, expressionPorts } from "./expression.ts";

export interface MathExpressionState {
  warned: boolean;
}

/** The formula text in a node's settings ("" when missing or not text). */
export function expressionText(settings: PatchNode["settings"] | undefined): string {
  const text = settings?.expression;
  return typeof text === "string" ? text : "";
}

export const mathExpression = definePatch<MathExpressionState>("mathExpression", {
  state: () => ({ warned: false }),
  dynamicPorts: (node) => expressionPorts(expressionText(node.settings)),
  evaluate(ctx) {
    const program = compileExpression(expressionText(ctx.node.settings));
    if (!program.ok) {
      const { message, line, column } = program.error;
      logOnce(ctx, "error", "invalid_expression", `${ctx.id}: ${message} (${line > 1 ? `line ${line}, ` : ""}column ${column})`);
      for (const output of program.outputs) ctx.output(output.key, 0);
      return;
    }
    const env = new Array<number>(program.slotCount).fill(0);
    for (let i = 0; i < program.inputs.length; i++) env[program.inputSlots[i]!] = toNumber(ctx.input(program.inputs[i]!));
    for (const statement of program.statements) {
      let v = statement.evaluate(env);
      if (!Number.isFinite(v)) {
        v = 0;
        if (!ctx.state.warned) {
          ctx.state.warned = true;
          ctx.services.log("warn", `${ctx.id}.${statement.key} isn't a finite number, so it outputs 0`);
        }
      }
      if (v === 0) v = 0;
      if (statement.slot >= 0) env[statement.slot] = v;
      ctx.output(statement.key, v);
    }
  },
});
