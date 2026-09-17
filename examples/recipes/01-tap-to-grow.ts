/** 01 Tap to Grow: the ISAT pattern. Interaction → Switch → Pop Animation → Transition. */

import { addLayer, addPatch, connect, gradient, gradientLayer, group, homeIndicator, layerRef, link, oval, palette, SCREEN, shadow, statusBar, text, type } from "../lib/kit.ts";
import type { Recipe } from "../lib/recipe.ts";

const CARD: [number, number] = [338, 440];

export const tapToGrow: Recipe = {
  folder: "01-tap-to-grow",
  name: "Tap to Grow",
  description: "Tap a photo card and it springs bigger; tap again and it springs back. The four-patch ISAT chain behind most interactions.",
  guides: ["01-first-prototype", "02-isat"],
  background: palette.canvas,
  notes:
    "Tap the card. Tap Card pulses, Card Zoomed remembers the new state, Zoom Spring moves from 0 to 1 with a bounce, and three Transitions turn that into scale and shadow.",
  ops: () => [
    addLayer(statusBar("app", "dark")),
    addLayer(text("date", "Date", "SATURDAY, JUNE 14", type.caption, palette.ink3, { position: [24, 78] })),
    addLayer(text("title", "Title", "Discover", type.largeTitle, palette.ink, { position: [24, 96] })),
    addLayer(
      oval("avatar", "Avatar", {
        position: [338, 98],
        size: [40, 40],
        color: palette.indigo,
        gradient: gradient([[0, "#8B5CF6FF"], [1, "#FF3D71FF"]], [0, 0], [1, 1]),
        hitTest: false,
      }),
    ),
    addLayer(
      group("card", "Card", {
        position: [SCREEN.width / 2, 470],
        anchor: [0.5, 0.5],
        size: CARD,
        cornerRadius: 32,
        clip: true,
        color: palette.night,
        ...shadow("soft"),
      }, [
        gradientLayer("card_photo", "Photo", gradient([[0, "#FFB37BFF"], [0.45, "#FF5E7EFF"], [1, "#4B3FD8FF"]], [0, 0], [1, 1]), { size: CARD }),
        oval("card_sun", "Sun", { position: [92, 110], size: [150, 150], color: "#FFE9B8FF", ...shadow("glow", palette.amber) }),
        oval("card_far_hill", "Far Hill", { position: [-90, 262], size: [380, 260], color: "#46329ACC" }),
        oval("card_near_hill", "Near Hill", { position: [110, 300], size: [420, 280], color: "#2A1F6BFF" }),
        gradientLayer("card_shade", "Shade", gradient([[0, "#00000000"], [1, "#00000080"]]), { position: [0, 240], size: [CARD[0], 200] }),
        group("card_chip", "Photo Count", { position: [20, 20], size: [92, 30], cornerRadius: 15, color: "#FFFFFF33", backgroundBlur: 12, hitTest: false }, [
          text("card_chip_label", "Photo Count Label", "6 photos", type.caption, palette.white, { position: [46, 15], anchor: [0.5, 0.5], textAlignment: "center" }),
        ]),
        text("card_title", "Card Title", "Golden hour", type.title, palette.white, { position: [24, 346] }),
        text("card_subtitle", "Card Subtitle", "Ocean Beach · San Francisco", type.callout, palette.white70, { position: [24, 386] }),
      ]),
    ),
    addLayer(text("hint", "Hint", "Tap the card to zoom", type.footnote, palette.ink2, { position: [SCREEN.width / 2, 770], anchor: [0.5, 0], textAlignment: "center" })),
    addLayer(homeIndicator("app", "dark")),

    addPatch("tap_card", "interaction", "Tap Card", { layer: layerRef("card") }),
    addPatch("card_zoomed", "switch", "Card Zoomed", { flip: link("tap_card.tap") }),
    addPatch("zoom_spring", "popAnimation", "Zoom Spring", { number: link("card_zoomed.on"), bounciness: 6, speed: 12 }),
    addPatch("card_scale", "transition", "Card Scale", { progress: link("zoom_spring.output"), start: 1, end: 1.12 }, { typeParam: "number" }),
    addPatch("card_shadow_radius", "transition", "Shadow Radius", { progress: link("zoom_spring.output"), start: 18, end: 44 }, { typeParam: "number" }),
    addPatch("card_shadow_opacity", "transition", "Shadow Opacity", { progress: link("zoom_spring.output"), start: 0.08, end: 0.26 }, { typeParam: "number" }),
    connect("card_scale.output", "@card.scale"),
    connect("card_shadow_radius.output", "@card.shadowRadius"),
    connect("card_shadow_opacity.output", "@card.shadowOpacity"),
  ],
};
