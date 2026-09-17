/**
 * Platform services the device patches read. The contract's `PlatformServices` has vibrate, speak,
 * and deviceMotion; the rest are the members the catalog proposes (CONVENTIONS.md §19.7). Patches
 * duck-type them, so a host that adds one lights the patch up without a patch change, and a host
 * without one gets idle outputs and one log.
 */

import type { DeviceInfo, RuntimeServices } from "@sonobe/engine";

export interface SpeechOptions {
  rate: number;
  pitch: number;
  volume: number;
  voice?: string;
}

/** How an utterance ended, as reported by a host that tracks completion. */
export type SpeechOutcome = "ended" | "interrupted";

/** Native haptics (proposed `PlatformServices.haptic`). */
export interface HapticService {
  supports(type: string): boolean;
  play(type: string, pattern?: unknown): void;
}

export interface GeoFix {
  latitude: number;
  longitude: number;
  accuracy: number;
}

/** Geolocation (proposed `PlatformServices.geolocation`). */
export interface GeolocationService {
  watch(onFix: (fix: GeoFix) => void, onError: (message: string) => void): { stop(): void };
}

export interface GamepadButtonSnapshot {
  pressed: boolean;
  value: number;
}

export interface GamepadSnapshot {
  connected: boolean;
  mapping: string;
  buttons: readonly (GamepadButtonSnapshot | undefined)[];
  axes: readonly number[];
  motion?: { acceleration?: readonly number[]; rotationRate?: readonly number[] };
}

export interface SoftKeyboardSnapshot {
  visible: boolean;
  height: number;
  keyboardType?: string;
}

/** A connected Bluetooth LE characteristic (proposed). */
export interface BleLink {
  name: string;
  canRead: boolean;
  canNotify: boolean;
  read(): Promise<Uint8Array>;
  write(bytes: Uint8Array): Promise<void>;
  setNotifications(on: boolean): Promise<void>;
  onValue(callback: (bytes: Uint8Array) => void): void;
  onDisconnect(callback: () => void): void;
  disconnect(): void;
}

/** Bluetooth LE (proposed `PlatformServices.bluetooth`). */
export interface BleService {
  available: boolean;
  connect(options: { service: string; characteristic: string; namePrefix?: string }): Promise<BleLink>;
}

export interface MotionSample {
  acceleration: readonly number[];
  rotationRate: readonly number[];
  attitude?: readonly number[];
}

/** The platform members device patches use: contract members plus proposed ones. */
export interface DevicePlatform {
  vibrate?: (pattern: number | number[]) => void;
  deviceMotion?: () => MotionSample | undefined;
  /** Contract: returns void. Proposed: a promise that resolves with how the utterance ended. */
  speak?: (text: string, options: SpeechOptions) => void | PromiseLike<SpeechOutcome | string>;
  stopSpeaking?: () => void;
  haptic?: HapticService;
  geolocation?: GeolocationService;
  gamepads?: () => readonly (GamepadSnapshot | null | undefined)[];
  softKeyboard?: () => SoftKeyboardSnapshot | undefined;
  bluetooth?: BleService;
}

/** The runtime's platform services, typed with the proposed members. */
export function devicePlatform(services: RuntimeServices): DevicePlatform {
  return (services.platform ?? {}) as unknown as DevicePlatform;
}

/** Proposed `DeviceInfo.orientationAngle` (degrees counterclockwise), when the host provides it. */
export function orientationAngleOf(device: DeviceInfo): number | undefined {
  const angle = (device as DeviceInfo & { orientationAngle?: unknown }).orientationAngle;
  return typeof angle === "number" && Number.isFinite(angle) ? angle : undefined;
}

/** True for promises and other thenables. */
export function isThenable<T = unknown>(value: unknown): value is PromiseLike<T> {
  return (typeof value === "object" || typeof value === "function") && value !== null && typeof (value as { then?: unknown }).then === "function";
}
