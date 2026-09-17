/**
 * @sonobe/engine/testing: document builders, deterministic test runtimes, frame runners, input
 * generators, the isolated patch harness, and mock definitions. Free of test-framework imports.
 */

export { buildDoc, type ComponentInput, type DocInput, type GraphInput, type PatchInput } from "./buildDoc.ts";
export { drag, idle, keyPress, pointerEvent, sequence, tap, type FrameEvents, type PointerOptions } from "./events.ts";
export {
  createTestRuntime,
  runFrames,
  runPatch,
  type EventsByFrame,
  type RunPatchFrame,
  type RunPatchOptions,
  type RunPatchResult,
} from "./harness.ts";
export {
  createMockRegistry,
  defineMock,
  MOCK_DEFINITIONS,
  mockAdd,
  mockCounter,
  mockInteraction,
  mockLayerInfo,
  mockLogger,
  mockLoop,
  mockLoopSum,
  mockMultiply,
  mockPopAnimation,
  mockPulseOnChange,
  mockRandom,
  mockRestartPrototype,
  mockSplitter,
  mockSwitch,
  mockTime,
  mockTransition,
  mockVelocity,
  mockWhenPrototypeStarts,
  port,
  probeDefinition,
  sequenceDefinition,
} from "./mockDefinitions.ts";
