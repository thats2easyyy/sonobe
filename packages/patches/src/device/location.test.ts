import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import type { GeoFix } from "@sonobe/engine";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { PLACES, formatCoordinates, locationPatch } from "./location.ts";

function fakeGeo() {
  const watches: { onFix: (fix: GeoFix) => void; onError: (message: string) => void; stopped: boolean }[] = [];
  const geolocation = {
    watch(onFix: (fix: GeoFix) => void, onError: (message: string) => void) {
      const w = { onFix, onError, stopped: false };
      watches.push(w);
      return {
        stop() {
          w.stopped = true;
        },
      };
    },
  };
  return { watches, geolocation };
}

describe("formatCoordinates", () => {
  it("uses 4 decimals and hemisphere letters", () => {
    expect(formatCoordinates(37.7749, -122.4194)).toBe("37.7749° N, 122.4194° W");
    expect(formatCoordinates(-33.8688, 151.2093)).toBe("33.8688° S, 151.2093° E");
    expect(formatCoordinates(0, 0)).toBe("0.0000° N, 0.0000° E");
  });
});

describe("location", () => {
  it("outputs an override city immediately", () => {
    const h = createPatchHarness(locationPatch, { inputs: { override: "tokyo" } });
    expect(h.step().outputs).toEqual({ latitude: 35.6762, longitude: 139.6503, name: "Tokyo", available: true, accuracy: 0, loading: false, errorMessage: "" });
    expect(Object.keys(PLACES)).toHaveLength(13);
  });

  it("explains that the real location isn't available in simulation or without a service", () => {
    const sim = createPatchHarness(locationPatch);
    expect(sim.step().outputs).toMatchObject({ available: false, loading: false, errorMessage: "Location isn't available in simulation." });
    const live = createPatchHarness(locationPatch, { services: { deterministic: false } });
    expect(live.step().outputs.errorMessage).toBe("Location isn't available here. Choose an override city.");
  });

  it("watches the real location: Loading until the first fix, then updates between readings", async () => {
    const { watches, geolocation } = fakeGeo();
    const h = createPatchHarness(locationPatch, { services: { platform: { geolocation } as never } });
    const f0 = h.step();
    expect(f0.outputs).toMatchObject({ loading: true, available: false, latitude: 0 });
    expect(f0.requestedNextFrame).toBe(true);
    h.step();
    expect(watches).toHaveLength(1);
    watches[0]!.onFix({ latitude: 51.5, longitude: -0.12, accuracy: 25 });
    expect(h.step().outputs).toEqual({ latitude: 51.5, longitude: -0.12, name: "51.5000° N, 0.1200° W", available: true, accuracy: 25, loading: false, errorMessage: "" });
    watches[0]!.onFix({ latitude: Number.NaN, longitude: 3, accuracy: 1 });
    expect(h.step().outputs.latitude).toBe(51.5);
    watches[0]!.onError("Location permission was denied.");
    expect(h.step().outputs).toMatchObject({ available: true, latitude: 51.5, errorMessage: "Location permission was denied.", loading: false });
  });

  it("switching to a city stops the watch; switching back keeps the city until a fix arrives", () => {
    const { watches, geolocation } = fakeGeo();
    const h = createPatchHarness(locationPatch, { services: { platform: { geolocation } as never } });
    h.step();
    expect(h.step({ inputs: { override: "paris" } }).outputs.name).toBe("Paris");
    expect(watches[0]!.stopped).toBe(true);
    watches[0]!.onFix({ latitude: 1, longitude: 1, accuracy: 1 });
    const back = h.step({ inputs: { override: "current" } });
    expect(back.outputs).toMatchObject({ name: "Paris", loading: false, available: true });
    expect(watches).toHaveLength(2);
    watches[1]!.onFix({ latitude: 2, longitude: 3, accuracy: 4 });
    expect(h.step().outputs.latitude).toBe(2);
  });

  it("disabling stops the watch, turns Available and Loading off, and holds the values", () => {
    const { watches, geolocation } = fakeGeo();
    const h = createPatchHarness(locationPatch, { services: { platform: { geolocation } as never } });
    h.step();
    watches[0]!.onFix({ latitude: 10, longitude: 20, accuracy: 5 });
    h.step();
    const off = h.step({ inputs: { enabled: false } });
    expect(off.outputs).toMatchObject({ available: false, loading: false, latitude: 10, longitude: 20 });
    expect(watches[0]!.stopped).toBe(true);
  });

  it("uses San Francisco for an unknown override with one warning, per loop index", () => {
    const h = createPatchHarness(locationPatch, { inputs: { override: loopOf(["atlantis", "lagos"]) } });
    const f = h.run(2);
    expect(f.outputs.name).toEqual(loopOf(["San Francisco", "Lagos"]));
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("stops the watch on dispose and outputs zeros while muted", () => {
    const { watches, geolocation } = fakeGeo();
    const h = createPatchHarness(locationPatch, { services: { platform: { geolocation } as never } });
    h.step();
    h.dispose();
    expect(watches[0]!.stopped).toBe(true);
    const muted = runPatch(locationPatch, [{ override: "london" }], { muted: true });
    expect(muted.frames[0]!.outputs).toMatchObject({ available: false, latitude: 0, name: "" });
  });
});
