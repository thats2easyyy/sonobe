/**
 * Markdown reference generated from patch specs: one page per patch and an index grouped by
 * category. docs/patches is written from here, and the same text can serve hover docs and MCP
 * resources (ARCHITECTURE.md §11).
 */

import { isLoopLiteral } from "@sonobe/core";
import type { EnumOption, PatchCategory, PatchSpec, PortSpec, SettingSpec, VariadicSpec } from "@sonobe/core";
import { BEHAVIORS, SPECS } from "../specs.ts";
import type { PatchBehavior } from "../specs.ts";

type Status = NonNullable<PatchSpec["status"]>;

/** Picker order (CONVENTIONS.md §12). */
export const CATEGORY_ORDER: readonly PatchCategory[] = [
  "interaction", "animation", "state", "logic", "math", "loops", "text", "color",
  "data", "device", "media", "shapes", "layers", "utility", "components", "scripting",
];

/** Patch picker labels. */
export const CATEGORY_LABELS: Readonly<Record<PatchCategory, string>> = {
  interaction: "Interaction",
  animation: "Animation",
  state: "State & Time",
  logic: "Logic",
  math: "Math",
  loops: "Loops",
  text: "Text",
  color: "Color",
  data: "Data & Network",
  device: "Device",
  media: "Media",
  shapes: "Shapes",
  layers: "Layers & Effects",
  utility: "Utility",
  components: "Components",
  scripting: "Scripting",
};

export const CATEGORY_DESCRIPTIONS: Readonly<Record<PatchCategory, string>> = {
  interaction: "Pointer, touch, keyboard, and gesture input on layers or the screen, plus scroll and drag physics.",
  animation: "Values moving over time and reshaped progress: springs, tweens, curves, transitions, smoothing, velocity, and spring converters.",
  state: "Memory and timing: switches, counters, options, pulses, delays, timers, and clocks.",
  logic: "Boolean logic, comparisons, and choosing between values.",
  math: "Arithmetic, rounding, ranges, snapping, trigonometry, expressions, and randomness.",
  loops: "Creating, reading, reshaping, and combining loops.",
  text: "Measuring, searching, and editing text, and formatting numbers and dates.",
  color: "Building and converting colors and gradients.",
  data: "JSON objects and arrays, data files, HTTP, WebSockets, and encoding.",
  device: "Device information, sensors, haptics, speech, and hardware.",
  media: "Image, video, and sound assets and playback; camera and microphone; detection on images.",
  shapes: "Vector shapes for Shape layers.",
  layers: "Reading layer geometry, converting coordinates, and producing layer effects.",
  utility: "Plumbing: pass-through, variables, pack and unpack, debugging, and prototype control.",
  components: "Patch component instances.",
  scripting: "Code patches.",
};

export const STATUS_LABELS: Readonly<Record<Status, string>> = {
  supported: "Supported",
  "web-limited": "Web-limited",
  "unsupported-web": "Not on the web yet",
};

const STATUS_MEANINGS: Readonly<Record<Status, string>> = {
  supported: "Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.",
  "web-limited": "Works only on some platforms or browsers, or needs a permission, a tap first, a secure page, or special hardware.",
  "unsupported-web": "Loads from files and outputs idle values, but can't run on the web yet.",
};

export const TIER_LABELS: Readonly<Record<1 | 2 | 3, string>> = {
  1: "Everyday essentials",
  2: "Breadth",
  3: "Hardware and platform-specific",
};

const PLATFORM_LABELS: Readonly<Record<string, string>> = {
  desktop: "the desktop app",
  web: "the web player in desktop browsers",
  mobile: "the web player on phones and tablets",
};

/** First line of every generated file. */
export const REFERENCE_BANNER =
  "<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->";

export interface ReferenceOptions {
  /** Catalog-only text for Origami import aliases and port labels (default: the catalog's). */
  behavior?: PatchBehavior;
  /** Specs used to name linked patches (default: the catalog). */
  specs?: Readonly<Record<string, PatchSpec>>;
}

const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\r?\n+/g, "<br>");
const tick = (text: string): string => (text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``);

/** GitHub heading anchor for `heading`. */
export function headingAnchor(heading: string): string {
  return heading.toLowerCase().replace(/[^a-z0-9 _-]/g, "").replace(/ /g, "-");
}

/** A declared default for display: `0`, `"On"`, `#FFFFFFFF`, `[0, 0]`, "empty loop", "none", or "—" for none declared. */
export function formatDefault(value: unknown, type: string): string {
  if (value === undefined) return "—";
  if (value === null) return "none";
  if (isLoopLiteral(value)) return value.loop.length ? `loop ${tick(JSON.stringify(value.loop))}` : "empty loop";
  if (typeof value === "string") return type === "enum" || /^#[0-9A-Fa-f]{8}$/.test(value) ? tick(value) : tick(JSON.stringify(value));
  if (Array.isArray(value) && value.every((v) => typeof v === "number")) return tick(`[${value.join(", ")}]`);
  return tick(JSON.stringify(value));
}

function portType(port: Pick<PortSpec, "type" | "subtype" | "wholeLoop" | "advanced">): string {
  const parts = [tick(port.type) + (port.subtype ? ` (${port.subtype})` : "")];
  if (port.wholeLoop) parts.push("whole loop");
  if (port.advanced) parts.push("advanced");
  return parts.join(" · ");
}

function rangeText(port: Pick<PortSpec, "min" | "max" | "step">): string {
  const parts: string[] = [];
  if (port.min !== undefined && port.max !== undefined) parts.push(`Range ${port.min} to ${port.max}`);
  else if (port.min !== undefined) parts.push(`At least ${port.min}`);
  else if (port.max !== undefined) parts.push(`At most ${port.max}`);
  if (port.step !== undefined) parts.push(`step ${port.step}`);
  return parts.length ? `${parts.join(", ")}.` : "";
}

const optionList = (options: readonly EnumOption[]): string => options.map((o) => `${o.name} (${tick(o.key)})`).join(", ");

/** "a", "a and b", "a, b, and c". */
function joinWithAnd(items: readonly string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}
const hasOptionDescriptions = (options: readonly EnumOption[] | undefined): boolean => !!options?.some((o) => o.description);

function portDescription(port: PortSpec): string {
  const parts = [port.description];
  const range = rangeText(port);
  if (range) parts.push(range);
  if (port.enumOptions?.length && !hasOptionDescriptions(port.enumOptions)) parts.push(`Options: ${optionList(port.enumOptions)}.`);
  return cell(parts.join(" "));
}

function optionSections(ports: readonly (PortSpec | SettingSpec)[]): string[] {
  const blocks: string[] = [];
  for (const port of ports) {
    if (!port.enumOptions?.length || !hasOptionDescriptions(port.enumOptions)) continue;
    const items = port.enumOptions.map((o) => `- **${o.name}** (${tick(o.key)})${o.description ? `: ${o.description}` : ""}`);
    blocks.push(`**${port.name} options**\n\n${items.join("\n")}`);
  }
  return blocks;
}

function inputsTable(ports: readonly PortSpec[]): string {
  const rows = ports.map((p) => `| **${cell(p.name)}**<br>${tick(p.key)} | ${portType(p)} | ${formatDefault(p.default, p.type)} | ${portDescription(p)} |`);
  return ["| Input | Type | Default | Description |", "|---|---|---|---|", ...rows].join("\n");
}

function outputsTable(ports: readonly PortSpec[]): string {
  const rows = ports.map((p) => `| **${cell(p.name)}**<br>${tick(p.key)} | ${portType(p)} | ${portDescription(p)} |`);
  return ["| Output | Type | Description |", "|---|---|---|", ...rows].join("\n");
}

function variadicBlock(v: VariadicSpec): string {
  const start = v.startIndex ?? 1;
  const outputs = v.direction === "outputs";
  const heading = outputs ? "### Repeating outputs" : "### Repeating inputs";
  const def = !outputs && v.default !== undefined ? ` · default ${formatDefault(v.default, v.type)}` : "";
  return [
    heading,
    `**${v.name} ${start}, ${v.name} ${start + 1}, …** (${tick(`${v.key}${start}`)}, ${tick(`${v.key}${start + 1}`)}, …) · ${tick(v.type)}${def}`,
    v.description,
    `A patch can have ${v.min} to ${v.max} of these, and a new patch starts with ${v.defaultCount}.`,
  ].join("\n\n");
}

/** A repeated group of ports whose count the node sets (PatchSpec.inputCountRange), for patches without a VariadicSpec. */
function inputCountBlock(range: NonNullable<PatchSpec["inputCountRange"]>): string {
  return [
    "### Repeating inputs",
    `The inputs this patch adds come in repeating groups. A patch can have ${range.min} to ${range.max} groups, and a new patch starts with ${range.defaultCount}.`,
  ].join("\n\n");
}

function shortcutText(shortcut: string): string {
  const keys = shortcut === "+" ? ["+"] : shortcut.split("+");
  return keys.map((k) => `<kbd>${k}</kbd>`).join("+");
}

/** Markdown page for one patch: summary, docs, ports, types, examples, mistakes, pairings, availability, and Origami mapping. */
export function renderPatchReference(spec: PatchSpec, options: ReferenceOptions = {}): string {
  const behavior = options.behavior ?? (Object.hasOwn(BEHAVIORS, spec.type) ? BEHAVIORS[spec.type] : undefined);
  const specs = options.specs ?? SPECS;
  const blocks: string[] = [REFERENCE_BANNER, `# ${spec.name}`, spec.summary];

  const label = CATEGORY_LABELS[spec.category] ?? spec.category;
  const facts = ["| | |", "|---|---|", `| Type key | ${tick(spec.type)} |`, `| Category | [${label}](README.md#${headingAnchor(label)}) |`];
  if (spec.tier) facts.push(`| Tier | ${spec.tier} (${TIER_LABELS[spec.tier].toLowerCase()}) |`);
  if (spec.status) facts.push(`| Status | ${STATUS_LABELS[spec.status]} |`);
  if (spec.shortcut) facts.push(`| Shortcut | ${shortcutText(spec.shortcut)} |`);
  if (spec.aliases?.length) facts.push(`| Search terms | ${cell(spec.aliases.join(", "))} |`);
  blocks.push(facts.join("\n"));

  if (spec.docs?.trim()) blocks.push(spec.docs.trim());

  blocks.push("## Inputs");
  if (behavior?.dynamicPortsRule) blocks.push("This patch adds ports based on how it's set up, so these tables list only the ports it always has.");
  blocks.push(spec.inputs.length ? inputsTable(spec.inputs) : "This patch has no fixed inputs.");
  if (spec.variadic && (spec.variadic.direction ?? "inputs") === "inputs") blocks.push(variadicBlock(spec.variadic));
  else if (!spec.variadic && spec.inputCountRange) blocks.push(inputCountBlock(spec.inputCountRange));
  blocks.push(...optionSections(spec.inputs));

  blocks.push("## Outputs");
  blocks.push(spec.outputs.length ? outputsTable(spec.outputs) : "This patch has no fixed outputs.");
  if (spec.variadic?.direction === "outputs") blocks.push(variadicBlock(spec.variadic));

  if (spec.settings?.length) {
    const rows = spec.settings.map((s) => `| **${cell(s.name)}**<br>${tick(s.key)} | ${tick(s.type)} | ${formatDefault(s.default, s.type)} | ${cell(s.description + (s.enumOptions?.length && !hasOptionDescriptions(s.enumOptions) ? ` Options: ${optionList(s.enumOptions)}.` : ""))} |`);
    blocks.push("## Settings", "Settings configure the patch itself instead of flowing through cables.", ["| Setting | Type | Default | Description |", "|---|---|---|---|", ...rows].join("\n"));
    blocks.push(...optionSections(spec.settings));
  }

  if (spec.variants?.length) {
    const [first, ...rest] = spec.variants;
    const list = [`${tick(first!)} (default)`, ...rest.map((v) => tick(v))].join(", ");
    blocks.push("## Types", `Pick the patch's type to change what flows through ports marked ${tick("variant")}: ${list}.`);
    const overrides = Object.entries(spec.variantDefaults ?? {}).flatMap(([variant, ports]) =>
      Object.entries(ports ?? {}).map(([key, value]) => `| ${tick(variant)} | ${tick(key)} | ${formatDefault(value, variant)} |`),
    );
    if (overrides.length) {
      blocks.push("For other types, a port starts at its zero value unless listed here:", ["| Type | Port | Default |", "|---|---|---|", ...overrides].join("\n"));
    }
  }

  if (spec.examples?.length) {
    blocks.push("## Examples");
    for (const example of spec.examples) {
      blocks.push(`### ${example.title}`);
      if (example.description) blocks.push(example.description);
      blocks.push("```text\n" + example.outline + "\n```");
    }
  }

  if (spec.commonMistakes?.length) blocks.push("## Common mistakes", spec.commonMistakes.map((m) => `- ${m}`).join("\n"));

  if (spec.pairsWellWith?.length) {
    const items = spec.pairsWellWith.map((type) => {
      const other = Object.hasOwn(specs, type) ? specs[type] : undefined;
      return other ? `- [${other.name}](${type}.md): ${other.summary}` : `- ${tick(type)}`;
    });
    blocks.push("## Pairs well with", items.join("\n"));
  }

  const status: Status = spec.status ?? "supported";
  const availability = [`**${STATUS_LABELS[status]}.** ${status === "supported" ? STATUS_MEANINGS.supported : (spec.statusReason ?? STATUS_MEANINGS[status])}`];
  if (status !== "supported") {
    availability.push(spec.platforms?.length ? `Works in ${joinWithAnd(spec.platforms.map((p) => PLATFORM_LABELS[p] ?? p))}.` : STATUS_MEANINGS[status]);
  }
  if (spec.tier) availability.push(`Tier ${spec.tier}: ${TIER_LABELS[spec.tier].toLowerCase()}.`);
  blocks.push("## Availability", availability.join("\n\n"));

  blocks.push("## Origami mapping");
  if (spec.origami) {
    const mapping = [`- **Origami patch:** ${spec.origami.name}${spec.origami.id ? ` (${tick(spec.origami.id)})` : ""}`];
    if (behavior?.importAliases?.length) mapping.push(`- **Also imports:** ${behavior.importAliases.map(tick).join(", ")}`);
    blocks.push(mapping.join("\n"));
    const ports = Object.entries(behavior?.origamiPorts ?? {});
    if (ports.length) blocks.push(["| Sonobe port | Origami label |", "|---|---|", ...ports.map(([key, labelText]) => `| ${tick(key)} | ${cell(labelText)} |`)].join("\n"));
  } else {
    blocks.push("Sonobe-native: Origami has no matching patch.");
  }

  return blocks.join("\n\n") + "\n";
}

/** Markdown index of patches grouped by category, with counts by tier and status. */
export function renderReferenceIndex(specs: Iterable<PatchSpec> = Object.values(SPECS)): string {
  const list = [...specs];
  const byCategory = new Map<string, PatchSpec[]>();
  for (const spec of list) {
    const group = byCategory.get(spec.category);
    if (group) group.push(spec);
    else byCategory.set(spec.category, [spec]);
  }
  const categories = [...CATEGORY_ORDER.filter((c) => byCategory.has(c)), ...[...byCategory.keys()].filter((c) => !(CATEGORY_ORDER as readonly string[]).includes(c))];
  const label = (c: string) => CATEGORY_LABELS[c as PatchCategory] ?? c;
  const tierCount = (tier: number) => list.filter((s) => s.tier === tier).length;
  const statusOf = (s: PatchSpec): Status => s.status ?? "supported";

  const blocks: string[] = [
    REFERENCE_BANNER,
    "# Patch reference",
    "Every built-in Sonobe patch, grouped the way the patch picker groups them. Each page covers what the patch does, its ports and defaults, examples, common mistakes, what it pairs well with, where it runs, and how it maps to Origami.",
    `**${list.length} patches** in ${categories.length} categories: ${tierCount(1)} everyday essentials (tier 1), ${tierCount(2)} for breadth (tier 2), and ${tierCount(3)} hardware and platform-specific patches (tier 3).`,
    [
      "| Status | Meaning | Patches |",
      "|---|---|---:|",
      ...(Object.keys(STATUS_LABELS) as Status[]).map((s) => `| ${STATUS_LABELS[s]} | ${STATUS_MEANINGS[s]} | ${list.filter((p) => statusOf(p) === s).length} |`),
    ].join("\n"),
    "## Categories",
    [
      "| Category | What belongs | Patches |",
      "|---|---|---:|",
      ...categories.map((c) => `| [${label(c)}](#${headingAnchor(label(c))}) | ${CATEGORY_DESCRIPTIONS[c as PatchCategory] ?? ""} | ${byCategory.get(c)!.length} |`),
    ].join("\n"),
  ];

  for (const c of categories) {
    const rows = byCategory.get(c)!.map((s) => `| [${cell(s.name)}](${s.type}.md) | ${tick(s.type)} | ${cell(s.summary)} | ${s.tier ?? ""} | ${STATUS_LABELS[statusOf(s)]} |`);
    blocks.push(`## ${label(c)}`);
    if (CATEGORY_DESCRIPTIONS[c as PatchCategory]) blocks.push(CATEGORY_DESCRIPTIONS[c as PatchCategory]);
    blocks.push(["| Patch | Key | What it does | Tier | Status |", "|---|---|---|---:|---|", ...rows].join("\n"));
  }
  return blocks.join("\n\n") + "\n";
}

/** Every generated reference file by name: `README.md` plus `<type>.md` per spec. */
export function renderReferenceFiles(
  specs: Readonly<Record<string, PatchSpec>> = SPECS,
  behaviors: Readonly<Record<string, PatchBehavior>> = BEHAVIORS,
): Record<string, string> {
  const files: Record<string, string> = { "README.md": renderReferenceIndex(Object.values(specs)) };
  for (const spec of Object.values(specs)) {
    const behavior = Object.hasOwn(behaviors, spec.type) ? behaviors[spec.type] : undefined;
    files[`${spec.type}.md`] = renderPatchReference(spec, behavior ? { specs, behavior } : { specs });
  }
  return files;
}
