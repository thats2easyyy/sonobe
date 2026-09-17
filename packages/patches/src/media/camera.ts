/**
 * Camera: runs a camera through the host's media service, outputs the live feed, captures photos on
 * a pulse, and records while Recording is on. One camera per patch instance; async results apply
 * on a later frame and superseded sessions are dropped.
 */

import type { AssetRef } from "@sonobe/core";
import type { RuntimeServices } from "@sonobe/engine";
import { definePatch, logOnce, toBool, warnOnce } from "../infra/index.ts";
import { evaluateOncePerInstance, supersede, takeFinished, trackRequest } from "./capture.ts";
import type { MediaRequest } from "./capture.ts";
import { mediaPlatform } from "./platform.ts";
import type { MediaCaptureService } from "./platform.ts";
import { enumOr, releaseRef, safely, withMutedBehavior } from "./shared.ts";

type Status = "off" | "starting" | "live" | "failed";

interface CameraState {
  key: string;
  status: Status;
  facing: "front" | "back" | null;
  quality: "low" | "medium" | "high" | null;
  stream: AssetRef | null;
  image: AssetRef | null;
  video: AssetRef | null;
  recorderActive: boolean;
  requests: MediaRequest[];
}

function finishRecording(s: CameraState, media: MediaCaptureService | undefined): void {
  if (!s.recorderActive) return;
  s.recorderActive = false;
  if (media) trackRequest(s.requests, "recording", () => media.stopRecording(s.key));
}

function closeSession(s: CameraState, media: MediaCaptureService | undefined): void {
  if (s.status === "off") return;
  finishRecording(s, media);
  supersede(s.requests, "session");
  if (media) safely(() => media.close(s.key));
  s.status = "off";
  s.stream = null;
  s.facing = null;
  s.quality = null;
}

export const cameraPatch = withMutedBehavior(
  definePatch<CameraState>("camera", {
    state: () => ({ key: "", status: "off", facing: null, quality: null, stream: null, image: null, video: null, recorderActive: false, requests: [] }),
    evaluate(ctx) {
      evaluateOncePerInstance(ctx, "camera", (emit) => {
        const s = ctx.state;
        s.key = `${ctx.componentPath}/${ctx.id}`;
        const media = mediaPlatform(ctx.services).media;
        if (ctx.node.muted) {
          closeSession(s, media);
          for (const key of ["stream", "image", "video"]) emit.output(key, null);
          emit.output("available", false);
          return;
        }
        const enabled = toBool(ctx.input("enabled"));
        const facing = enumOr(ctx.input("camera"), ["front", "back"] as const, "back");
        const quality = enumOr(ctx.input("quality"), ["low", "medium", "high"] as const, "medium");
        const recording = toBool(ctx.input("recording"));
        const capture = ctx.pulsed("capture");
        let captured = false;
        let recorded = false;

        // 1. Apply finished async work, dropping superseded sessions.
        for (const r of takeFinished(s.requests)) {
          if (r.superseded) continue;
          if (r.kind === "session") {
            if (r.ok && r.value) {
              s.status = "live";
              s.stream = r.value;
            } else {
              s.status = "failed";
              s.stream = null;
              warnOnce(ctx, `session:${r.message}`, `camera: ${r.ok ? "the camera didn't return a feed" : r.message}`);
            }
          } else if (r.kind === "capture") {
            if (r.ok && r.value) {
              releaseRef(ctx.services, s.image);
              s.image = r.value;
              captured = true;
            } else if (!r.ok) {
              warnOnce(ctx, `capture:${r.message}`, `camera: couldn't take a photo (${r.message})`);
            }
          } else if (r.ok && r.value !== null) {
            releaseRef(ctx.services, s.video);
            s.video = r.value;
            recorded = true;
          }
        }

        // 2. Session.
        const canOpen = media !== undefined && typeof media.openCamera === "function";
        if (!canOpen) {
          if (enabled || capture || recording) logOnce(ctx, "log", "noCamera", "camera: no camera in this host");
        } else if (!enabled) {
          closeSession(s, media);
        } else if (s.status === "off" || facing !== s.facing || quality !== s.quality) {
          finishRecording(s, media);
          supersede(s.requests, "session");
          trackRequest(s.requests, "session", () => media.openCamera!(s.key, { facing, quality }));
          Object.assign(s, { status: "starting", facing, quality });
        }

        // 3. Capture and record.
        if (capture) {
          if (canOpen && s.status === "live" && typeof media.captureFrame === "function") trackRequest(s.requests, "capture", () => media.captureFrame!(s.key));
          else if (canOpen) warnOnce(ctx, "captureNotLive", "camera: Capture needs a running camera");
        }
        if (canOpen) {
          const wantRecording = recording && s.status === "live";
          if (wantRecording && !s.recorderActive) {
            const audio = toBool(ctx.input("recordAudio"));
            safely(() => media.startRecording(s.key, { audio }));
            s.recorderActive = true;
          }
          if (!wantRecording && s.recorderActive) finishRecording(s, media);
        }

        if (s.status === "starting" || s.requests.length > 0) ctx.requestNextFrame();
        emit.output("stream", s.status === "live" || s.status === "starting" ? s.stream : null);
        emit.output("image", s.image);
        emit.output("video", s.video);
        emit.output("available", s.status === "live");
        if (captured) emit.pulse("captured");
        if (recorded) emit.pulse("recorded");
      });
    },
    dispose(state: CameraState, services: RuntimeServices) {
      if (!state) return;
      const media = mediaPlatform(services).media;
      if (state.recorderActive && media) safely(() => void media.stopRecording(state.key));
      state.recorderActive = false;
      if (state.status !== "off" && media) safely(() => media.close(state.key));
      supersede(state.requests);
      state.requests = [];
      state.status = "off";
      state.stream = null;
      releaseRef(services, state.image);
      releaseRef(services, state.video);
      state.image = null;
      state.video = null;
    },
  }),
  "evaluate",
);
