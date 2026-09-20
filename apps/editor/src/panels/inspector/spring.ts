/**
 * Spring patches in the inspector: the physical spring a Pop, Spring, Fluid Spring, or Spring Preset
 * patch describes, perceptual preset values per patch type, the live curve geometry, and handoff
 * code for SwiftUI, Android, CSS, and motion.
 */

import {
  SPRING_PRESETS,
  fromMassStiffnessDamping,
  sampleSpringCurve,
  springToAndroid,
  springToCSSLinear,
  springToMotion,
  springToSwiftUI,
  type SpringConfig,
  type SpringPresetKey,
} from "@sonobe/engine";
import { fluidSpringConfig, popSpringConfig, springPresetValues } from "@sonobe/patches/infra";
import { isLinkInput, type Id, type Op, type PatchNode, type PatchSpec } from "@sonobe/core";

export const SPRING_PATCH_TYPES: ReadonlySet<string> = new Set(["popAnimation", "springAnimation", "springPreset", "fluidSpringAnimation"]);

export const isSpringPatch = (type: string): boolean => SPRING_PATCH_TYPES.has(type);

export { SPRING_PRESETS };

export interface SpringReading {
  config: SpringConfig;
  /** Spring inputs driven by links; the preview uses their defaults. */
  linked: string[];
}

/** The inputs that define the spring for each patch type. */
export const SPRING_INPUTS: Readonly<Record<string, readonly string[]>> = {
  popAnimation: ["bounciness", "speed"],
  springAnimation: ["mass", "tension", "friction"],
  fluidSpringAnimation: ["response", "dampingFraction"],
  springPreset: ["preset", "duration", "bounce"],
};

/** The value a link reads when it's known without running the prototype (a knob's running value), else undefined. */
export type LinkReader = (link: string) => unknown;

function reader(node: PatchNode, spec: PatchSpec, linked: string[], readLink?: LinkReader) {
  const raw = (key: string): unknown => {
    const stored = node.inputs[key];
    if (isLinkInput(stored)) {
      const known = readLink?.(stored.link);
      if (known !== undefined) return known;
      linked.push(key);
      return spec.inputs.find((p) => p.key === key)?.default;
    }
    return stored ?? spec.inputs.find((p) => p.key === key)?.default;
  };
  return {
    number: (key: string, fallback: number) => {
      const value = raw(key);
      return typeof value === "number" && Number.isFinite(value) ? value : fallback;
    },
    text: (key: string, fallback: string) => {
      const value = raw(key);
      return typeof value === "string" ? value : fallback;
    },
  };
}

/**
 * The spring a patch node describes (exactly as its evaluator computes it); undefined for other types.
 * `readLink` supplies what linked inputs read when that's known (knobs); other linked inputs use their defaults.
 */
export function springConfigForNode(node: PatchNode, spec: PatchSpec, readLink?: LinkReader): SpringReading | undefined {
  const linked: string[] = [];
  const read = reader(node, spec, linked, readLink);
  let config: SpringConfig;
  switch (node.type) {
    case "popAnimation":
      config = popSpringConfig(read.number("bounciness", 5), read.number("speed", 10));
      break;
    case "springAnimation":
      config = fromMassStiffnessDamping(Math.max(0.01, read.number("mass", 1)), read.number("tension", 130.51), read.number("friction", 18.85));
      break;
    case "fluidSpringAnimation":
      config = fluidSpringConfig(read.number("response", 0.55), read.number("dampingFraction", 0.825));
      break;
    case "springPreset": {
      const values = springPresetValues(read.text("preset", "smooth"), read.number("duration", 0.5), read.number("bounce", 0));
      config = fromMassStiffnessDamping(values.mass, values.tension, values.friction);
      break;
    }
    default:
      return undefined;
  }
  return { config, linked };
}

const round = (n: number, decimals = 4) => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

/** Input values that give a patch type the preset's feel. */
export function presetInputs(type: string, key: SpringPresetKey): Record<string, number | string> | undefined {
  const values = springPresetValues(key);
  switch (type) {
    case "popAnimation":
      return { bounciness: round(values.bounciness), speed: round(values.speed) };
    case "springAnimation":
      return { mass: 1, tension: round(values.tension), friction: round(values.friction) };
    case "fluidSpringAnimation":
      return { response: round(values.response), dampingFraction: round(values.dampingFraction) };
    case "springPreset":
      return { preset: key };
    default:
      return undefined;
  }
}

/** setInput ops applying a preset to a spring patch. */
export function planPreset(componentId: Id, patchId: Id, type: string, key: SpringPresetKey, knobOf?: (port: string) => Id | undefined): Op[] {
  const inputs = presetInputs(type, key) ?? {};
  return Object.entries(inputs).map(([port, value]): Op => {
    // An input a knob drives keeps its knob: the preset tunes the knob instead.
    const knob = knobOf?.(port);
    return knob !== undefined ? { op: "setKnobValue", id: knob, value } : { op: "setInput", component: componentId, target: `${patchId}.${port}`, value };
  });
}

/** The preset the node's inputs currently match (literals, and links `readLink` knows), if any. */
export function activePreset(node: PatchNode, spec: PatchSpec, readLink?: LinkReader): SpringPresetKey | null {
  const valueOf = (key: string): unknown => {
    const stored = node.inputs[key];
    if (isLinkInput(stored)) return readLink?.(stored.link);
    return stored === undefined ? spec.inputs.find((p) => p.key === key)?.default : stored;
  };
  for (const preset of SPRING_PRESETS) {
    const expected = presetInputs(node.type, preset.key);
    if (!expected) return null;
    const matches = Object.entries(expected).every(([key, want]) => {
      const have = valueOf(key);
      if (typeof want === "string") return have === want;
      return typeof have === "number" && Math.abs(have - want) <= 1e-3 * Math.max(1, Math.abs(want));
    });
    if (matches) return preset.key;
  }
  return null;
}

export interface SpringCurveGeometry {
  /** SVG path in a `width` × `height` box. */
  path: string;
  /** y of the start (0) and target (1) lines. */
  startY: number;
  targetY: number;
  /** Sampled values at 60 fps (0 → 1). */
  values: number[];
  /** Seconds sampled. */
  duration: number;
  settleTime: number | null;
  /** Largest excursion past the target as a fraction of the distance. */
  overshoot: number;
  x: (t: number) => number;
  y: (v: number) => number;
}

/** Step response 0 → 1 until the spring settles, fitted into a box. */
export function springCurveGeometry(config: SpringConfig, width: number, height: number, padding = 6): SpringCurveGeometry {
  const curve = sampleSpringCurve(config, 0, 60);
  let min = 0;
  let max = 1;
  for (const v of curve.values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;
  const duration = curve.times.at(-1) || 1 / 60;
  const x = (t: number) => padding + (t / duration) * (width - 2 * padding);
  const y = (v: number) => padding + (1 - (v - min) / span) * (height - 2 * padding);
  const path = curve.values.map((v, i) => `${i === 0 ? "M" : "L"}${x(curve.times[i]!).toFixed(2)} ${y(v).toFixed(2)}`).join(" ");
  return { path, startY: y(0), targetY: y(1), values: curve.values, duration, settleTime: curve.settleTime, overshoot: curve.overshoot, x, y };
}

export type HandoffTarget = "swiftui" | "android" | "css" | "motion";

export interface HandoffSnippet {
  id: HandoffTarget;
  label: string;
  code: string;
}

/** Copyable code for engineers, from the engine's spring converters. */
export function handoffSnippets(config: SpringConfig): HandoffSnippet[] {
  const android = springToAndroid(config);
  const css = springToCSSLinear(config);
  const motion = springToMotion(config);
  return [
    {
      id: "swiftui",
      label: "SwiftUI",
      code: `withAnimation(${springToSwiftUI(config)}) {\n  isOn.toggle()\n}\n\n// Same spring, other forms:\n// ${springToSwiftUI(config, "responseDampingFraction")}\n// ${springToSwiftUI(config, "interpolating")}`,
    },
    {
      id: "android",
      label: "Android",
      code: `// Jetpack Compose\nval scale by animateFloatAsState(\n  targetValue = if (isOn) 1.1f else 1f,\n  animationSpec = ${android.compose},\n)\n\n// AndroidX SpringForce\n${android.code}`,
    },
    { id: "css", label: "CSS", code: `.card {\n  transition: transform ${css.css};\n}` },
    { id: "motion", label: "motion", code: `<motion.div\n  animate={{ scale: isOn ? 1.1 : 1 }}\n  transition={${motion.code}}\n/>` },
  ];
}
