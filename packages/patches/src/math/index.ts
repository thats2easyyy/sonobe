import type { PatchDefinition } from "@sonobe/engine";
import { absoluteValue } from "./absoluteValue.ts";
import { add } from "./add.ts";
import { arctangent } from "./arctangent.ts";
import { clamp } from "./clamp.ts";
import { cosine } from "./cosine.ts";
import { divide } from "./divide.ts";
import { length } from "./length.ts";
import { mathExpression } from "./mathExpression.ts";
import { max } from "./max.ts";
import { min } from "./min.ts";
import { modulo } from "./modulo.ts";
import { multiply } from "./multiply.ts";
import { power } from "./power.ts";
import { random } from "./random.ts";
import { remap } from "./remap.ts";
import { round } from "./round.ts";
import { sine } from "./sine.ts";
import { snap } from "./snap.ts";
import { squareRoot } from "./squareRoot.ts";
import { subtract } from "./subtract.ts";

/** Math patches in catalog order. */
export const definitions: PatchDefinition[] = [
  add,
  subtract,
  multiply,
  divide,
  modulo,
  power,
  squareRoot,
  absoluteValue,
  round,
  min,
  max,
  clamp,
  remap,
  snap,
  mathExpression,
  random,
  sine,
  cosine,
  arctangent,
  length,
];
