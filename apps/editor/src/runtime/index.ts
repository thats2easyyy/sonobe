/** Editor runtime host: the live prototype runtime, viewers, platform services, script trust, and deterministic simulations. */

export {
  createRuntimeHost,
  issuesToDiagnostics,
  type AttachRendererOptions,
  type LayerBounds,
  type LiveValues,
  type PulseFire,
  type RectLike,
  type RuntimeHost,
  type RuntimeHostOptions,
  type RuntimeHostState,
  type ValueScope,
  type ValueSubscriptionOptions,
  type ViewerBounds,
  type ViewerHandle,
} from "./runtimeHost.ts";
export { createSimulation, MAX_SIM_STEP_FRAMES, type Simulation, type SimulationLog, type SimulationOptions, type SimulationSnapshot, type SimulationStepOptions } from "./simulation.ts";
export { createAnimationFrameScheduler, createManualScheduler, type FrameScheduler, type ManualScheduler } from "./scheduler.ts";
export { createFpsMeter, type FpsMeter } from "./fpsMeter.ts";
export { createBrowserPlatform, detectMuted, getMuteStore, isMuted, liveKeyOf, OPENABLE_URL_SCHEMES, setMuted, type BrowserPlatform, type BrowserPlatformOptions, type MuteState, type PlatformWindow } from "./platform.ts";
export { createMediaInfoCache, findSceneNode, mediaRefOf, type MediaInfoCache, type MediaInfoCacheOptions, type MediaKind } from "./mediaInfo.ts";
export {
  createLocalTrustPersistence,
  createMemoryTrustPersistence,
  createScriptTrustStore,
  SCRIPT_PATCH_TYPE,
  scriptPatchCount,
  withScriptTrust,
  type ScriptTrustOptions,
  type ScriptTrustState,
  type ScriptTrustStore,
  type TrustPersistence,
  type TrustPromptInfo,
} from "./scriptTrust.ts";
export { componentIdForInstancePath, instanceIdsIn, instancePathFor, qualifyAddress } from "./instances.ts";
