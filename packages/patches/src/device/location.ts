/**
 * Location: the device's position from the host's geolocation watch, or a fixed city center from
 * Override. Callbacks only store fixes; the next evaluate applies them.
 */

import type { GeoFix } from "@sonobe/engine";
import { definePatch, toBool, toText, warnOnce } from "../infra/index.ts";
import { describeError } from "./shared.ts";

export interface Place {
  name: string;
  latitude: number;
  longitude: number;
}

/** Override cities: decimal degrees of each city center. */
export const PLACES: Readonly<Record<string, Place>> = {
  sanFrancisco: { name: "San Francisco", latitude: 37.7749, longitude: -122.4194 },
  newYork: { name: "New York", latitude: 40.7128, longitude: -74.006 },
  mexicoCity: { name: "Mexico City", latitude: 19.4326, longitude: -99.1332 },
  saoPaulo: { name: "São Paulo", latitude: -23.5505, longitude: -46.6333 },
  london: { name: "London", latitude: 51.5074, longitude: -0.1278 },
  paris: { name: "Paris", latitude: 48.8566, longitude: 2.3522 },
  lagos: { name: "Lagos", latitude: 6.5244, longitude: 3.3792 },
  capeTown: { name: "Cape Town", latitude: -33.9249, longitude: 18.4241 },
  dubai: { name: "Dubai", latitude: 25.2048, longitude: 55.2708 },
  mumbai: { name: "Mumbai", latitude: 19.076, longitude: 72.8777 },
  singapore: { name: "Singapore", latitude: 1.3521, longitude: 103.8198 },
  tokyo: { name: "Tokyo", latitude: 35.6762, longitude: 139.6503 },
  sydney: { name: "Sydney", latitude: -33.8688, longitude: 151.2093 },
};

/** "37.7749° N, 122.4194° W": 4 decimals with hemisphere letters. */
export function formatCoordinates(latitude: number, longitude: number): string {
  return `${Math.abs(latitude).toFixed(4)}° ${latitude >= 0 ? "N" : "S"}, ${Math.abs(longitude).toFixed(4)}° ${longitude >= 0 ? "E" : "W"}`;
}

interface LocationState {
  latitude: number;
  longitude: number;
  name: string;
  accuracy: number;
  available: boolean;
  loading: boolean;
  errorMessage: string;
  watch: { stop(): void } | null;
  /** Watch generation; callbacks from stopped watches are ignored. */
  gen: number;
  fix: GeoFix | null;
  fixError: string | null;
}

function stopWatch(s: LocationState): void {
  s.gen++;
  const watch = s.watch;
  s.watch = null;
  s.fix = null;
  s.fixError = null;
  try {
    watch?.stop();
  } catch {
    // The host already dropped the watch.
  }
}

export const locationPatch = definePatch<LocationState>("location", {
  mutedBehavior: "zero",
  state: () => ({ latitude: 0, longitude: 0, name: "", accuracy: 0, available: false, loading: false, errorMessage: "", watch: null, gen: 0, fix: null, fixError: null }),
  evaluate(ctx) {
    const s = ctx.state;
    const override = toText(ctx.input("override"));
    if (!toBool(ctx.input("enabled"))) {
      stopWatch(s);
      s.available = false;
      s.loading = false;
    } else if (override !== "current") {
      stopWatch(s);
      let place = Object.hasOwn(PLACES, override) ? PLACES[override] : undefined;
      if (!place) {
        warnOnce(ctx, "unknownOverride", `Location: "${override}" isn't an override city, so it uses San Francisco.`);
        place = PLACES.sanFrancisco!;
      }
      Object.assign(s, { latitude: place.latitude, longitude: place.longitude, name: place.name, accuracy: 0, available: true, loading: false, errorMessage: "" });
    } else {
      const geo = ctx.services.platform.geolocation;
      if (!geo) {
        const message = ctx.services.deterministic ? "Location isn't available in simulation." : "Location isn't available here. Choose an override city.";
        Object.assign(s, { available: false, loading: false, errorMessage: message });
      } else {
        if (!s.watch) {
          s.loading = !s.available;
          const gen = ++s.gen;
          try {
            s.watch = geo.watch(
              (fix) => {
                if (s.gen === gen) s.fix = fix;
              },
              (message) => {
                if (s.gen === gen) s.fixError = typeof message === "string" ? message : describeError(message);
              },
            );
          } catch (error) {
            s.watch = null;
            s.fixError = describeError(error);
          }
        }
        const fix = s.fix;
        if (fix) {
          s.fix = null;
          const { latitude, longitude, accuracy } = fix;
          if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
            Object.assign(s, {
              latitude,
              longitude,
              accuracy: Number.isFinite(accuracy) && accuracy > 0 ? accuracy : 0,
              name: formatCoordinates(latitude, longitude),
              available: true,
              loading: false,
              errorMessage: "",
            });
          }
        }
        if (s.fixError !== null) {
          s.loading = false;
          s.errorMessage = s.fixError;
          s.fixError = null;
        }
        if (s.loading) ctx.requestNextFrame();
      }
    }
    ctx.output("latitude", s.latitude);
    ctx.output("longitude", s.longitude);
    ctx.output("name", s.name);
    ctx.output("available", s.available);
    ctx.output("accuracy", s.accuracy);
    ctx.output("loading", s.loading);
    ctx.output("errorMessage", s.errorMessage);
  },
  dispose(state) {
    if (state) stopWatch(state);
  },
});
