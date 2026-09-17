import { describe, expect, it } from "vitest";
import { compileExpression, expressionPorts, lenientPorts, validateExpression } from "./expression.ts";

/** Compile and run every statement, feeding named results forward like the patch does. */
function run(text: string, inputs: Record<string, number> = {}): number[] {
  const program = compileExpression(text);
  if (!program.ok) throw new Error(program.error.message);
  const env = new Array<number>(program.slotCount).fill(0);
  program.inputs.forEach((key, i) => {
    env[program.inputSlots[i]!] = inputs[key] ?? 0;
  });
  return program.statements.map((s) => {
    const v = s.evaluate(env);
    if (s.slot >= 0) env[s.slot] = v;
    return v;
  });
}

function errorOf(text: string) {
  const program = compileExpression(text);
  if (program.ok) throw new Error(`"${text}" should not parse`);
  return program.error;
}

describe("expression ports", () => {
  it("turns variables into inputs by first appearance and statements into outputs", () => {
    const program = compileExpression("width * height");
    expect(program.inputs).toEqual(["width", "height"]);
    expect(program.outputs).toEqual([{ key: "output", name: "Output", named: false }]);
    const named = compileExpression("area = w * h; perimeter = 2 * (w + h)");
    expect(named.inputs).toEqual(["w", "h"]);
    expect(named.outputs.map((o) => o.key)).toEqual(["area", "perimeter"]);
  });

  it("names unnamed results with the first free output key", () => {
    expect(compileExpression("output + 1; 3").outputs).toEqual([
      { key: "output2", name: "Output 2", named: false },
      { key: "output3", name: "Output 3", named: false },
    ]);
    expect(compileExpression("x + 1; output = 3").outputs.map((o) => o.key)).toEqual(["output2", "output"]);
  });

  it("treats a name followed by ( as a call and anywhere else as a variable", () => {
    expect(compileExpression("min(a, min)").inputs).toEqual(["a", "min"]);
    expect(compileExpression("a = x * 2; a + y").inputs).toEqual(["x", "y"]);
  });

  it("describes ports for the inspector and core", () => {
    expect(expressionPorts("r = s * 2; r + 1")).toEqual({
      inputs: [{ key: "s", name: "s", type: "number", default: 0, description: "Value of s in the formula." }],
      outputs: [
        { key: "r", name: "r", type: "number", description: "The value the formula gives r." },
        { key: "output", name: "Output", type: "number", description: "The value of statement 2 in the formula." },
      ],
    });
    expect(expressionPorts("   ")).toEqual({ inputs: [], outputs: [] });
  });

  it("caches compiled text", () => {
    expect(compileExpression("a + b + c")).toBe(compileExpression("a + b + c"));
  });
});

describe("expression evaluation", () => {
  it("follows JavaScript precedence and numeric semantics", () => {
    expect(run("1 + 2 * 3; (1 + 2) * 3; 2 ** 3 ** 2; -1 % 3; round(-2.5); 10 / 4 - 1")).toEqual([7, 9, 512, -1, -2, 1.5]);
    expect(run("2 > 1; 1 >= 2; 1 == 1; 1 === 1; 3 != 3; 3 !== 4; !0; !2")).toEqual([1, 0, 1, 1, 0, 1, 1, 0]);
    expect(run("0 && 5; 2 && 5; 0 || 7; 3 || 7")).toEqual([0, 5, 7, 3]);
    expect(run("x ? 10 : 20; x > 0 ? 1 : x < 0 ? -1 : 0", { x: -3 })).toEqual([10, -1]);
    expect(run("0xFF; .5 + 1.5e1; true + true; -(2 ** 2); (-2) ** 2")).toEqual([255, 15.5, 2, -4, 4]);
  });

  it("offers Math functions, constants, and Sonobe helpers", () => {
    expect(run("Math.PI; PI; Math.SQRT2; Math.max(1, 5, 3); hypot(3, 4); sqrt(16) + abs(-2); pow(2, 10); atan2(1, 1)")).toEqual([
      Math.PI,
      Math.PI,
      Math.SQRT2,
      5,
      5,
      6,
      1024,
      Math.PI / 4,
    ]);
    expect(run("radians(180); degrees(Math.PI); clamp(5, 10, 0); clamp(15, 10, 0); lerp(0, 10, 0.25); lerp(0, 10, 2)")).toEqual([Math.PI, 180, 5, 10, 2.5, 20]);
  });

  it("lets later statements read earlier results and skips empty statements", () => {
    expect(run("a = x * 2;; \n b = a + 1;", { x: 3 })).toEqual([6, 7]);
    expect(compileExpression("a = 1;;\n b = a + 1;").outputs.map((o) => o.key)).toEqual(["a", "b"]);
  });

  it("accepts empty text", () => {
    const program = compileExpression(" \n ");
    expect(program.ok).toBe(true);
    expect(program.outputs).toEqual([]);
    expect(validateExpression("")).toBeNull();
  });
});

describe("expression errors", () => {
  it("explains unknown functions and wrong argument counts", () => {
    expect(errorOf("sqr(x)")).toMatchObject({ message: "`sqr` isn't a function. Did you mean `sqrt`?", column: 1 });
    expect(errorOf("round(x, 2)").message).toBe("`round` takes 1 value. To round to 2 decimals, write `round(x * 100) / 100`.");
    expect(errorOf("pow(2)").message).toBe("`pow` takes 2 values.");
    expect(errorOf("max()").message).toBe("`max` takes at least 1 value.");
    expect(errorOf("clamp(1, 2)").message).toBe("`clamp` takes 3 values.");
    expect(errorOf("Math.clamp(1, 2, 3)").message).toContain("without `Math.`");
    expect(errorOf("Math.sqrt").message).toContain("needs values in parentheses");
  });

  it("points at unsupported syntax with a column", () => {
    expect(errorOf("x ^ 2")).toMatchObject({ message: "Use `**` for powers, like `x ** 2`.", column: 3 });
    expect(errorOf("a & b").message).toBe("`&` isn't supported in Math Expression.");
    expect(errorOf("a >>> 1").message).toBe("`>>>` isn't supported in Math Expression.");
    expect(errorOf("x++").message).toBe("`++` isn't supported in Math Expression.");
    expect(errorOf("a += 1").message).toBe("`+=` isn't supported in Math Expression.");
    expect(errorOf("'hi' + 1").message).toBe("`'hi'` isn't supported in Math Expression.");
    expect(errorOf("1 // note").message).toBe("`//` isn't supported in Math Expression.");
    expect(errorOf("[1, 2]").message).toBe("`[` isn't supported in Math Expression.");
    expect(errorOf("foo.bar").message).toBe("`foo.bar` isn't supported in Math Expression.");
    expect(errorOf("(x) => x").message).toBe("`=>` isn't supported in Math Expression.");
    expect(errorOf("2x").message).toContain("Put `*` between a number and a name");
  });

  it("explains randomness, memory, naming, and sign rules", () => {
    expect(errorOf("Math.random()").message).toContain("Random patch");
    expect(errorOf("x = x + 1").message).toContain("`x` is already an input");
    expect(errorOf("y = x; x = 1").message).toContain("`x` is already an input");
    expect(errorOf("a = 1; a = 2").message).toContain("names two results");
    expect(errorOf("a = b = 1").message).toContain("name only one result");
    expect(errorOf("x + 1 = 3").message).toContain("Only a name can go on the left");
    expect(errorOf("if = 3").message).toContain("reserved word");
    expect(errorOf("null + 1").message).toContain("reserved word");
    expect(errorOf("Math + 1").message).toContain("reserved word");
    expect(errorOf("-2 ** 2").message).toContain("(-2) ** 2");
  });

  it("reports incomplete formulas", () => {
    expect(errorOf("(1 + 2").message).toContain("needs a matching `)`");
    expect(errorOf("1 +").message).toBe("The formula ends before it's finished.");
    expect(errorOf("a b").message).toBe("Expected an operator or `;` before `b`.");
    expect(errorOf("1 + 2)").message).toBe("There's an extra `)`.");
    expect(errorOf("a ? 1").message).toContain("`?` needs a `:`");
    expect(errorOf("a = 1\nb = ^")).toMatchObject({ line: 2, column: 5 });
  });

  it("enforces the size limits", () => {
    expect(errorOf(Array.from({ length: 33 }, (_, i) => `v${i}`).join(" + ")).message).toContain("at most 32 inputs");
    expect(errorOf(Array.from({ length: 33 }, (_, i) => String(i)).join("; ")).message).toContain("at most 32 results");
    expect(compileExpression(`${"(".repeat(63)}1${")".repeat(63)}`).ok).toBe(true);
    expect(errorOf(`${"(".repeat(64)}1${")".repeat(64)}`).message).toContain("nests more than 64 levels");
    expect(errorOf(`${"- ".repeat(200)}1`).message).toContain("nests more than 64 levels");
    expect(errorOf(`x${" ".repeat(10_000)}`).message).toContain("longer than 10,000 characters");
  });

  it("keeps wires attached with lenient ports when text doesn't parse", () => {
    const program = compileExpression("a = b ^ 2; c + Math.sin(d)");
    expect(program.ok).toBe(false);
    expect(program.inputs).toEqual(["b", "c", "d"]);
    expect(program.outputs.map((o) => o.key)).toEqual(["a", "output"]);
    expect(lenientPorts("total = price * 1e3; 'label'").inputs).toEqual(["price"]);
  });
});
