import type { PatchDefinition } from "@sonobe/engine";
import { circleShape } from "./circleShape.ts";
import { jsonToShape } from "./jsonToShape.ts";
import { lineShape } from "./lineShape.ts";
import { ovalShape } from "./ovalShape.ts";
import { roundedRectangleShape } from "./roundedRectangleShape.ts";
import { shapeUnion } from "./shapeUnion.ts";
import { svgPathShape } from "./svgPathShape.ts";
import { triangleShape } from "./triangleShape.ts";

export const definitions: PatchDefinition[] = [
  circleShape,
  ovalShape,
  roundedRectangleShape,
  triangleShape,
  lineShape,
  svgPathShape,
  shapeUnion,
  jsonToShape,
];
