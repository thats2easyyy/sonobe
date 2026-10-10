/**
 * Live values and pulse fires keyed by address, so each port row and cable subscribes only to what
 * it shows and re-renders only when that value changes.
 */

import { deepEqual } from "@sonobe/core/graph";

export interface LiveStore {
  get(address: string): unknown;
  subscribe(address: string, cb: () => void): () => void;
  /** Replace values; notifies addresses whose value changed. */
  setValues(values: Readonly<Record<string, unknown>>): void;
  /** Increments every time a pulse fires on `address`. */
  pulseCount(address: string): number;
  subscribePulse(address: string, cb: () => void): () => void;
  firePulses(addresses: readonly string[]): void;
  /** Forget everything (component switch, runtime not covering this component). */
  clear(): void;
}

function snapshot(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

export function createLiveStore(): LiveStore {
  const values = new Map<string, unknown>();
  const listeners = new Map<string, Set<() => void>>();
  const pulses = new Map<string, number>();
  const pulseListeners = new Map<string, Set<() => void>>();

  const on = (map: Map<string, Set<() => void>>, address: string, cb: () => void) => {
    let set = map.get(address);
    if (!set) map.set(address, (set = new Set()));
    set.add(cb);
    return () => {
      set!.delete(cb);
      if (set!.size === 0) map.delete(address);
    };
  };
  const notify = (map: Map<string, Set<() => void>>, address: string) => {
    const set = map.get(address);
    if (set) for (const cb of [...set]) cb();
  };

  return {
    get: (address) => values.get(address),
    subscribe: (address, cb) => on(listeners, address, cb),
    setValues(next) {
      for (const [address, value] of Object.entries(next)) {
        const prev = values.get(address);
        if (values.has(address) && (prev === value || deepEqual(prev, value))) continue;
        values.set(address, snapshot(value));
        notify(listeners, address);
      }
    },
    pulseCount: (address) => pulses.get(address) ?? 0,
    subscribePulse: (address, cb) => on(pulseListeners, address, cb),
    firePulses(addresses) {
      for (const address of addresses) {
        pulses.set(address, (pulses.get(address) ?? 0) + 1);
        notify(pulseListeners, address);
      }
    },
    clear() {
      const had = [...values.keys()];
      values.clear();
      for (const address of had) notify(listeners, address);
    },
  };
}

/**
 * A frame listener (RuntimeHost.subscribeFrame) that reads `sources`, each an address here and the
 * address the runtime knows it by, and stores what changed. The patch editor's subscription samples
 * values 20 times a second, so a boolean that is on for a single frame (Down under a quick tap)
 * falls between two samples most of the time, and its cable would send neither orb. The booleans
 * that cables carry are read on every frame the prototype steps instead; at rest there are none.
 */
export function followEveryFrame(live: LiveStore, sources: readonly (readonly [address: string, source: string])[], read: (source: string) => unknown): () => void {
  return () => {
    const values: Record<string, unknown> = {};
    for (const [address, source] of sources) values[address] = read(source);
    live.setValues(values);
  };
}
