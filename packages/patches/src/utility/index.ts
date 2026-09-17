import type { PatchDefinition } from "@sonobe/engine";
import { cornerRadii } from "./cornerRadii.ts";
import { cornerRadiiUnpack } from "./cornerRadiiUnpack.ts";
import { edges } from "./edges.ts";
import { edgesUnpack } from "./edgesUnpack.ts";
import { point } from "./point.ts";
import { point3d } from "./point3d.ts";
import { point3dUnpack } from "./point3dUnpack.ts";
import { point4d } from "./point4d.ts";
import { point4dUnpack } from "./point4dUnpack.ts";
import { pointUnpack } from "./pointUnpack.ts";
import { restartPrototype } from "./restartPrototype.ts";
import { size } from "./size.ts";
import { sizeUnpack } from "./sizeUnpack.ts";
import { splitter } from "./splitter.ts";
import { variableBroadcaster } from "./variableBroadcaster.ts";
import { variableReceiver } from "./variableReceiver.ts";
import { watch } from "./watch.ts";

/** Utility patches (plumbing, variables, pack and unpack, debugging, prototype control) in catalog order. */
export const definitions: PatchDefinition[] = [
  splitter,
  variableBroadcaster,
  variableReceiver,
  watch,
  point,
  pointUnpack,
  size,
  sizeUnpack,
  restartPrototype,
  point3d,
  point3dUnpack,
  point4d,
  point4dUnpack,
  edges,
  edgesUnpack,
  cornerRadii,
  cornerRadiiUnpack,
];
