/** 12 Timed Sequence: a payment confirmation that plays in stages when the prototype starts. Waits for timing, Classic Animation for fades, springs for pops. */

import { addLayer, addPatch, connect, gradient, gradientLayer, group, homeIndicator, layerRef, link, oval, palette, SCREEN, shadow, shape, statusBar, text, type } from "../lib/kit.ts";
import type { Recipe } from "../lib/recipe.ts";

/** When each stage starts, in seconds after the prototype starts. */
export const STAGES = { circle: 0.1, check: 0.45, title: 0.8, details: 1.15, button: 1.5 } as const;
const CHECK_CENTER: [number, number] = [SCREEN.width / 2, 290];
export const DETAILS_Y = 548;

function detailRow(n: number, label: string, value: string): ReturnType<typeof group> {
  return group(`detail_${n}`, label, { position: [20, 16 + (n - 1) * 40], size: [314, 32] }, [
    text(`detail_${n}_label`, "Label", label, type.callout, palette.ink2, { position: [0, 6] }),
    text(`detail_${n}_value`, "Value", value, type.subhead, palette.ink, { position: [314, 6], anchor: [1, 0], textAlignment: "right" }),
  ]);
}

export const timedSequence: Recipe = {
  folder: "12-timed-sequence",
  name: "Timed Sequence",
  description: "A payment confirmation that plays in stages: the circle pops, the check draws, the amount fades up, the receipt slides in, and Replay runs it again.",
  guides: ["02-isat", "05-springs-and-feel"],
  background: "#ECFDF3FF",
  notes:
    "Watch it play, then tap Replay. When Prototype Starts pulses once; five Waits started by that one pulse finish at 0.1, 0.45, 0.8, 1.15 and 1.5 seconds, and each Done drives its own animation. Replay restarts the prototype, so everything plays from the top.",
  ops: () => [
    addLayer(gradientLayer("backdrop", "Backdrop", gradient([[0, "#D1FAE5FF"], [0.6, "#F8FAFCFF"]]), { size: [SCREEN.width, SCREEN.height], hitTest: false })),
    addLayer(statusBar("app", "dark")),
    addLayer(oval("check_ring", "Ring", { position: CHECK_CENTER, anchor: [0.5, 0.5], size: [168, 168], color: "#22C55E29", scale: 0, hitTest: false })),
    addLayer(oval("check_circle", "Circle", { position: CHECK_CENTER, anchor: [0.5, 0.5], size: [120, 120], color: palette.green, scale: 0, hitTest: false, ...shadow("glow", palette.green) })),
    addLayer(shape("checkmark", "Checkmark", { position: CHECK_CENTER, anchor: [0.5, 0.5], size: [120, 120], color: palette.clear, strokeColor: palette.white, strokeWidth: 8, lineCap: "round", lineJoin: "round", strokeEnd: 0, hitTest: false })),
    addLayer(text("title", "Title", "Payment sent", type.title2, palette.ink, { position: [SCREEN.width / 2, 406], anchor: [0.5, 0], textAlignment: "center", opacity: 0 })),
    addLayer(text("amount", "Amount", "$248.00", { fontSize: 48, fontWeight: 700, letterSpacing: -1 }, palette.ink, { position: [SCREEN.width / 2, 446], anchor: [0.5, 0], textAlignment: "center", opacity: 0 })),
    addLayer(
      group("details", "Receipt", { position: [24, 900], size: [354, 136], cornerRadius: 20, color: palette.surface, hitTest: false, ...shadow("soft") }, [
        detailRow(1, "To", "Juniper & Oak Catering"),
        detailRow(2, "When", "Today, 9:41"),
        detailRow(3, "Reference", "A7-2291"),
      ]),
    ),
    addLayer(
      group("replay_button", "Replay Button", { position: [24, 740], size: [354, 56], cornerRadius: 28, color: palette.ink, opacity: 0 }, [
        text("replay_label", "Replay Label", "Replay", type.headline, palette.white, { position: [177, 28], anchor: [0.5, 0.5], textAlignment: "center" }),
      ]),
    ),
    addLayer(homeIndicator("app", "dark")),

    addPatch("check_shape", "svgPathShape", "Checkmark Shape", { pathData: "M34 62L52 80L88 42", viewBox: [0, 0, 120, 120], size: [120, 120] }),
    connect("check_shape.shape", "@checkmark.shape"),

    // One start pulse, five timers
    addPatch("started", "whenPrototypeStarts", "Prototype Starts"),
    addPatch("circle_wait", "wait", "After 0.1 s", { start: link("started.started"), duration: STAGES.circle }),
    addPatch("check_wait", "wait", "After 0.45 s", { start: link("started.started"), duration: STAGES.check }),
    addPatch("title_wait", "wait", "After 0.8 s", { start: link("started.started"), duration: STAGES.title }),
    addPatch("details_wait", "wait", "After 1.15 s", { start: link("started.started"), duration: STAGES.details }),
    addPatch("button_wait", "wait", "After 1.5 s", { start: link("started.started"), duration: STAGES.button }),

    // Stage 1: the circle pops in
    addPatch("circle_spring", "popAnimation", "Circle Spring", { number: link("circle_wait.done"), bounciness: 8, speed: 12 }),
    addPatch("circle_scale", "transition", "Circle Scale", { progress: link("circle_spring.output"), start: 0, end: 1 }, { typeParam: "number" }),
    addPatch("ring_scale", "transition", "Ring Scale", { progress: link("circle_spring.output"), start: 0.5, end: 1 }, { typeParam: "number" }),
    connect("circle_scale.output", "@check_circle.scale"),
    connect("ring_scale.output", "@check_ring.scale"),

    // Stage 2: the check draws itself
    addPatch("check_draw", "classicAnimation", "Draw Check", { number: link("check_wait.done"), duration: 0.45, curve: "cubicOut" }, { typeParam: "number" }),
    connect("check_draw.output", "@checkmark.strokeEnd"),

    // Stage 3: the text fades up
    addPatch("title_fade", "classicAnimation", "Text Fade", { number: link("title_wait.done"), duration: 0.4, curve: "cubicOut" }, { typeParam: "number" }),
    addPatch("title_rise", "transition", "Title Rise", { progress: link("title_fade.output"), start: [SCREEN.width / 2, 422], end: [SCREEN.width / 2, 406] }, { typeParam: "point" }),
    addPatch("amount_rise", "transition", "Amount Rise", { progress: link("title_fade.output"), start: [SCREEN.width / 2, 462], end: [SCREEN.width / 2, 446] }, { typeParam: "point" }),
    connect("title_fade.output", "@title.opacity"),
    connect("title_fade.output", "@amount.opacity"),
    connect("title_rise.output", "@title.position"),
    connect("amount_rise.output", "@amount.position"),

    // Stage 4: the receipt slides in
    addPatch("details_spring", "popAnimation", "Receipt Spring", { number: link("details_wait.done"), bounciness: 3, speed: 12 }),
    addPatch("details_position", "transition", "Receipt Position", { progress: link("details_spring.output"), start: [24, 900], end: [24, DETAILS_Y] }, { typeParam: "point" }),
    connect("details_position.output", "@details.position"),

    // Stage 5: the button fades in, and Replay starts over
    addPatch("button_fade", "classicAnimation", "Button Fade", { number: link("button_wait.done"), duration: 0.3, curve: "cubicOut" }, { typeParam: "number" }),
    connect("button_fade.output", "@replay_button.opacity"),
    addPatch("tap_replay", "interaction", "Tap Replay", { layer: layerRef("replay_button") }),
    addPatch("replay", "restartPrototype", "Replay", { restart: link("tap_replay.tap") }),
  ],
};
