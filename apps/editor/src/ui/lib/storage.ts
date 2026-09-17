/**
 * localStorage access that never throws. Storage can be unavailable (private windows, blocked
 * site data, tests); callers always get a fallback and state simply stays in memory.
 */

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

export function readString(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    // Quota exceeded or storage blocked: keep the in-memory value.
  }
}

export function removeKey(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Storage blocked: nothing to remove.
  }
}

/** Read and validate JSON. Returns undefined when missing, unparsable, or invalid. */
export function readJSON<T>(key: string, validate: (value: unknown) => value is T): T | undefined {
  const text = readString(key);
  if (text === null) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return validate(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function writeJSON(key: string, value: unknown): void {
  try {
    writeString(key, JSON.stringify(value));
  } catch {
    // Unserializable value: skip persisting.
  }
}
