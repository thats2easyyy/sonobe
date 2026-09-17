/** 02 Like Toggle: tap the heart, or double-tap the photo, to like a post. A bouncy heart, a color change, and a live count. */

import { addLayer, addPatch, connect, gradient, gradientLayer, group, homeIndicator, layerRef, link, oval, palette, rect, SCREEN, shadow, shape, statusBar, text, type } from "../lib/kit.ts";
import type { Recipe } from "../lib/recipe.ts";

/** A heart in a 24 × 24 box. */
export const HEART_PATH = "M12 21C12 21 3 15.2 3 8.9C3 5.8 5.4 3.5 8.2 3.5C9.9 3.5 11.2 4.4 12 5.7C12.8 4.4 14.1 3.5 15.8 3.5C18.6 3.5 21 5.8 21 8.9C21 15.2 12 21 12 21Z";

const PHOTO: [number, number] = [338, 380];

export const likeToggle: Recipe = {
  folder: "02-like-toggle",
  name: "Like Toggle",
  description: "Tap the heart or double-tap the photo to like a post. The heart pops, turns pink, and the count goes up by one.",
  guides: ["02-isat", "03-states-and-pulses"],
  background: palette.canvas,
  notes:
    "Tap the heart to like or unlike. Double-tap the photo to like (it never unlikes) and flash a big heart. Liked is the one piece of memory; everything you see is drawn from it.",
  ops: () => [
    addLayer(statusBar("app", "dark")),
    addLayer(text("screen_title", "Screen Title", "Moments", type.title2, palette.ink, { position: [24, 72] })),
    addLayer(
      group("post", "Post", { position: [16, 118], size: [370, 612], cornerRadius: 28, color: palette.surface, ...shadow("soft") }, [
        oval("author_avatar", "Author Avatar", { position: [16, 16], size: [40, 40], gradient: gradient([[0, "#FF9A62FF"], [1, "#FF3D71FF"]], [0, 0], [1, 1]) }),
        text("author_name", "Author Name", "Noa Park", type.headline, palette.ink, { position: [68, 17] }),
        text("author_meta", "Author Details", "Lake Tahoe · 2h", type.footnote, palette.ink2, { position: [68, 39] }),
        group("post_photo", "Photo", { position: [16, 72], size: PHOTO, cornerRadius: 20, clip: true, color: palette.night }, [
          gradientLayer("photo_sky", "Sky", gradient([[0, "#0F1A3AFF"], [0.62, "#3B2B7AFF"], [1, "#F97366FF"]]), { size: PHOTO }),
          oval("photo_moon", "Moon", { position: [232, 46], size: [64, 64], color: "#FFF3D6FF", ...shadow("glow", palette.amber) }),
          oval("photo_lantern_1", "Lantern 1", { position: [78, 196], size: [10, 14], color: palette.amber, ...shadow("glow", palette.amber) }),
          oval("photo_lantern_2", "Lantern 2", { position: [142, 150], size: [8, 11], color: "#FFD27AFF", ...shadow("glow", palette.amber) }),
          oval("photo_lantern_3", "Lantern 3", { position: [196, 218], size: [12, 16], color: palette.amber, ...shadow("glow", palette.amber) }),
          oval("photo_far_ridge", "Far Ridge", { position: [-120, 262], size: [420, 260], color: "#221A4FFF" }),
          oval("photo_near_ridge", "Near Ridge", { position: [130, 292], size: [400, 240], color: "#120E2EFF" }),
          shape("burst", "Big Heart", { position: [PHOTO[0] / 2, PHOTO[1] / 2], anchor: [0.5, 0.5], size: [96, 96], color: palette.white, opacity: 0, hitTest: false, ...shadow("glow", palette.pink) }),
        ]),
        group("heart_button", "Heart Button", { position: [12, 458], size: [48, 48] }, [
          shape("heart_icon", "Heart", { position: [12, 12], size: [24, 24], strokeWidth: 2, hitTest: false }),
        ]),
        oval("comment_icon", "Comment", { position: [70, 470], size: [24, 24], color: palette.clear, strokeColor: palette.ink, strokeWidth: 2, hitTest: false }),
        rect("save_icon", "Save", { position: [330, 470], size: [18, 24], cornerRadius: 3, color: palette.clear, strokeColor: palette.ink, strokeWidth: 2, hitTest: false }),
        text("likes", "Like Count", "128 likes", type.headline, palette.ink, { position: [20, 516] }),
        text("caption", "Caption", "Floating lanterns over the lake after midnight.", type.callout, palette.ink2, { position: [20, 544] }),
        text("comments_link", "Comments Link", "View all 24 comments", type.footnote, palette.ink3, { position: [20, 574] }),
      ]),
    ),
    addLayer(text("hint", "Hint", "Tap the heart or double-tap the photo", type.footnote, palette.ink2, { position: [SCREEN.width / 2, 770], anchor: [0.5, 0], textAlignment: "center" })),
    addLayer(homeIndicator("app", "dark")),

    // Shapes for the two hearts
    addPatch("heart_shape", "svgPathShape", "Heart Shape", { pathData: HEART_PATH, viewBox: [0, 0, 24, 24], size: [24, 24] }),
    addPatch("burst_shape", "svgPathShape", "Big Heart Shape", { pathData: HEART_PATH, viewBox: [0, 0, 24, 24], size: [96, 96] }),
    connect("heart_shape.shape", "@heart_icon.shape"),
    connect("burst_shape.shape", "@burst.shape"),

    // ISAT: two ways in, one memory
    addPatch("tap_heart", "interaction", "Tap Heart", { layer: layerRef("heart_button") }),
    addPatch("double_tap_photo", "doubleTap", "Double-Tap Photo", { layer: layerRef("post_photo") }),
    addPatch("liked", "switch", "Liked", { flip: link("tap_heart.tap"), turnOn: link("double_tap_photo.doubleTap") }),
    addPatch("like_spring", "popAnimation", "Like Spring", { number: link("liked.on"), bounciness: 12, speed: 14 }),
    addPatch("heart_scale", "transition", "Heart Scale", { progress: link("like_spring.output"), start: 0.9, end: 1 }, { typeParam: "number" }),
    addPatch("heart_fill", "transition", "Heart Fill", { progress: link("like_spring.output"), start: "#FF3D7100", end: palette.pink }, { typeParam: "color" }),
    addPatch("heart_outline", "transition", "Heart Outline", { progress: link("like_spring.output"), start: palette.ink, end: palette.pink }, { typeParam: "color" }),
    connect("heart_scale.output", "@heart_icon.scale"),
    connect("heart_fill.output", "@heart_icon.color"),
    connect("heart_outline.output", "@heart_icon.strokeColor"),

    // The count reads the same memory: 128 + (0 or 1)
    addPatch("like_count", "add", "Like Count", { value1: 128, value2: link("liked.on") }, { typeParam: "number", inputCount: 2 }),
    addPatch("like_label", "formatNumber", "Like Label", { value: link("like_count.output"), suffix: " likes" }),
    connect("like_label.text", "@likes.text"),

    // The big heart: on for a moment after a double tap
    addPatch("burst_timer", "wait", "Big Heart Timer", { start: link("double_tap_photo.doubleTap"), duration: 0.55 }),
    addPatch("burst_visible", "switch", "Big Heart Visible", { turnOn: link("double_tap_photo.doubleTap"), turnOff: link("burst_timer.finished") }),
    addPatch("burst_spring", "popAnimation", "Big Heart Spring", { number: link("burst_visible.on"), bounciness: 10, speed: 16 }),
    addPatch("burst_scale", "transition", "Big Heart Scale", { progress: link("burst_spring.output"), start: 0.3, end: 1 }, { typeParam: "number" }),
    addPatch("burst_opacity", "progress", "Big Heart Opacity", { value: link("burst_spring.output"), start: 0, end: 0.5, clampToRange: true }),
    connect("burst_scale.output", "@burst.scale"),
    connect("burst_opacity.progress", "@burst.opacity"),
  ],
};
