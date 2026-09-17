/**
 * Microphone: listens through the host's media service, outputs a live metering handle, and records
 * while Recording is on. One microphone per patch instance; async results apply on a later frame.
 */

import type { AssetRef } from "@sonobe/core";
import type { RuntimeServices } from "@sonobe/engine";
import { definePatch, logOnce, toBool, warnOnce } from "../infra/index.ts";
import { evaluateOncePerInstance, supersede, takeFinished, trackRequest } from "./capture.ts";
import type { MediaRequest } from "./capture.ts";
import { mediaPlatform } from "./platform.ts";
import type { MediaCaptureService } from "./platform.ts";
import { releaseRef, safely, withMutedBehavior } from "./shared.ts";

type Status = "off" | "starting" | "live" | "failed";

interface MicrophoneState {
  key: string;
  status: Status;
  handle: AssetRef | null;
  sound: AssetRef | null;
  recorderActive: boolean;
  requests: MediaRequest[];
}

function finishRecording(s: MicrophoneState, media: MediaCaptureService | undefined): void {
  if (!s.recorderActive) return;
  s.recorderActive = false;
  if (media) trackRequest(s.requests, "recording", () => media.stopRecording(s.key));
}

function closeSession(s: MicrophoneState, media: MediaCaptureService | undefined): void {
  if (s.status === "off") return;
  finishRecording(s, media);
  supersede(s.requests, "session");
  if (media) safely(() => media.close(s.key));
  s.status = "off";
  s.handle = null;
}

export const microphonePatch = withMutedBehavior(
  definePatch<MicrophoneState>("microphone", {
    state: () => ({ key: "", status: "off", handle: null, sound: null, recorderActive: false, requests: [] }),
    evaluate(ctx) {
      evaluateOncePerInstance(ctx, "microphone", (emit) => {
        const s = ctx.state;
        s.key = `${ctx.componentPath}/${ctx.id}`;
        const media = mediaPlatform(ctx.services).media;
        if (ctx.node.muted) {
          closeSession(s, media);
          emit.output("sound", null);
          emit.output("metering", null);
          emit.output("available", false);
          return;
        }
        const enabled = toBool(ctx.input("enabled"));
        const recording = toBool(ctx.input("recording"));
        let recorded = false;

        for (const r of takeFinished(s.requests)) {
          if (r.superseded) continue;
          if (r.kind === "session") {
            if (r.ok && r.value) {
              s.status = "live";
              s.handle = r.value;
            } else {
              s.status = "failed";
              s.handle = null;
              warnOnce(ctx, `session:${r.message}`, `microphone: ${r.ok ? "the microphone didn't return a live sound" : r.message}`);
            }
          } else if (r.kind === "recording" && r.ok && r.value !== null) {
            releaseRef(ctx.services, s.sound);
            s.sound = r.value;
            recorded = true;
          }
        }

        const canOpen = media !== undefined && typeof media.openMicrophone === "function";
        if (!canOpen) {
          if (enabled || recording) logOnce(ctx, "log", "noMicrophone", "microphone: no microphone in this host");
        } else if (!enabled) {
          closeSession(s, media);
        } else if (s.status === "off") {
          trackRequest(s.requests, "session", () => media.openMicrophone!(s.key));
          s.status = "starting";
        }

        if (canOpen) {
          const wantRecording = recording && s.status === "live";
          if (wantRecording && !s.recorderActive) {
            safely(() => media.startRecording(s.key, { audio: true }));
            s.recorderActive = true;
          }
          if (!wantRecording && s.recorderActive) finishRecording(s, media);
        }

        if (s.status === "starting" || s.requests.length > 0) ctx.requestNextFrame();
        emit.output("sound", s.sound);
        emit.output("metering", s.status === "live" ? s.handle : null);
        emit.output("available", s.status === "live");
        if (recorded) emit.pulse("recorded");
      });
    },
    dispose(state: MicrophoneState, services: RuntimeServices) {
      if (!state) return;
      const media = mediaPlatform(services).media;
      if (state.recorderActive && media) safely(() => void media.stopRecording(state.key));
      state.recorderActive = false;
      if (state.status !== "off" && media) safely(() => media.close(state.key));
      supersede(state.requests);
      state.requests = [];
      state.status = "off";
      state.handle = null;
      releaseRef(services, state.sound);
      state.sound = null;
    },
  }),
  "evaluate",
);
