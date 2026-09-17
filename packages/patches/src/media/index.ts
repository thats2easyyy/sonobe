import type { PatchDefinition } from "@sonobe/engine";
import { audioMeteringPatch } from "./audioMetering.ts";
import { cameraPatch } from "./camera.ts";
import { faceDetectionPatch } from "./faceDetection.ts";
import { handDetectionPatch } from "./handDetection.ts";
import { imageAssetPatch } from "./imageAsset.ts";
import { imageInfoPatch } from "./imageInfo.ts";
import { microphonePatch } from "./microphone.ts";
import { objectDetectionPatch } from "./objectDetection.ts";
import { photoPickerPatch } from "./photoPicker.ts";
import { qrCodeDetectionPatch } from "./qrCodeDetection.ts";
import { snapshotPatch } from "./snapshot.ts";
import { soundPlayerPatch } from "./soundPlayer.ts";
import { videoAssetPatch } from "./videoAsset.ts";
import { videoInfoPatch } from "./videoInfo.ts";

export {
  audioMeteringPatch,
  cameraPatch,
  faceDetectionPatch,
  handDetectionPatch,
  imageAssetPatch,
  imageInfoPatch,
  microphonePatch,
  objectDetectionPatch,
  photoPickerPatch,
  qrCodeDetectionPatch,
  snapshotPatch,
  soundPlayerPatch,
  videoAssetPatch,
  videoInfoPatch,
};

/** Every media-category definition, in catalog order. */
export const definitions: PatchDefinition[] = [
  soundPlayerPatch,
  imageAssetPatch,
  videoAssetPatch,
  imageInfoPatch,
  videoInfoPatch,
  photoPickerPatch,
  cameraPatch,
  microphonePatch,
  audioMeteringPatch,
  snapshotPatch,
  faceDetectionPatch,
  handDetectionPatch,
  objectDetectionPatch,
  qrCodeDetectionPatch,
];
