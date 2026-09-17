import type { PatchDefinition } from "@sonobe/engine";
import { arrayAppend } from "./arrayAppend.ts";
import { arrayCount } from "./arrayCount.ts";
import { arrayIndexOf } from "./arrayIndexOf.ts";
import { arrayJoin } from "./arrayJoin.ts";
import { arrayReverse } from "./arrayReverse.ts";
import { arraySort } from "./arraySort.ts";
import { base64Decode } from "./base64Decode.ts";
import { base64Encode } from "./base64Encode.ts";
import { getKeys } from "./getKeys.ts";
import { jsonArray } from "./jsonArray.ts";
import { jsonFile } from "./jsonFile.ts";
import { jsonObject } from "./jsonObject.ts";
import { jsonToText } from "./jsonToText.ts";
import { networkRequest } from "./networkRequest.ts";
import { objectJoin } from "./objectJoin.ts";
import { openUrl } from "./openUrl.ts";
import { setValueForKey } from "./setValueForKey.ts";
import { subarray } from "./subarray.ts";
import { textToJson } from "./textToJson.ts";
import { valueAtIndex } from "./valueAtIndex.ts";
import { valueAtPath } from "./valueAtPath.ts";
import { valueForKey } from "./valueForKey.ts";
import { webSocketConnection } from "./webSocketConnection.ts";
import { webSocketReceive } from "./webSocketReceive.ts";
import { webSocketSend } from "./webSocketSend.ts";

/** Data & Network patches, in catalog order. */
export const definitions: PatchDefinition[] = [
  jsonArray,
  jsonObject,
  valueAtIndex,
  valueForKey,
  valueAtPath,
  setValueForKey,
  getKeys,
  objectJoin,
  arrayAppend,
  arrayCount,
  arrayJoin,
  arrayReverse,
  arraySort,
  arrayIndexOf,
  subarray,
  jsonToText,
  textToJson,
  jsonFile,
  networkRequest,
  openUrl,
  webSocketConnection,
  webSocketSend,
  webSocketReceive,
  base64Encode,
  base64Decode,
];
