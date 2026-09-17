/**
 * 10 Swipe Cards: a deck of three cards you throw left or right. One Group repeated by a loop; every
 * patch runs once per card, so each card has its own switch, spring, and badges.
 */

import { addLayer, addPatch, connect, group, homeIndicator, layerRef, link, oval, palette, SCREEN, shadow, statusBar, text, type } from "../lib/kit.ts";
import type { Recipe } from "../lib/recipe.ts";

const CARD: [number, number] = [330, 440];
export const DECK_CENTER: [number, number] = [SCREEN.width / 2, 440];
export const FLY_OUT = 600;

/** Bottom of the deck first: copy 2 is drawn last, so it's on top. */
const DISHES: [string, string, string, string][] = [
  ["Lemon ricotta pasta", "25 min · vegetarian", "#F59E0BFF", "#FDE68AFF"],
  ["Charred corn tacos", "30 min · a little spicy", "#EF4444FF", "#FECACAFF"],
  ["Miso ramen", "40 min · cozy", "#5B5CF6FF", "#C7D2FEFF"],
];

export const swipeCards: Recipe = {
  folder: "10-swipe-cards",
  name: "Swipe Cards",
  description: "Throw dinner ideas left to skip or right to save. Each card follows your finger, tilts, shows a badge, and flies off or springs back; the deck moves up behind it.",
  guides: ["06-gestures", "07-loops"],
  background: palette.canvas,
  notes:
    "Drag the top card and let go. Cards is a loop of three, so every patch below it runs once per card. Swipe Card decides whether a release counts as a throw, Card Gone remembers it, and Card Spring either returns the card or throws it with the finger's speed.",
  ops: () => [
    addLayer(statusBar("app", "dark")),
    addLayer(text("title", "Title", "Tonight's dinner", type.title2, palette.ink, { position: [24, 72] })),
    addLayer(text("subtitle", "Subtitle", "Swipe right to save, left to skip", type.footnote, palette.ink2, { position: [24, 104] })),
    addLayer(
      group("empty_state", "Empty State", { position: [51, 300], size: [300, 240], hitTest: false }, [
        text("empty_title", "Empty Title", "That's everything", type.title2, palette.ink, { position: [150, 40], anchor: [0.5, 0], textAlignment: "center" }),
        text("empty_body", "Empty Body", "Saved dishes are in your list.", type.callout, palette.ink2, { position: [150, 78], anchor: [0.5, 0], textAlignment: "center" }),
      ]),
    ),
    addLayer(
      group("start_over", "Start Over", { position: [121, 430], size: [160, 48], cornerRadius: 24, color: palette.ink }, [
        text("start_over_label", "Start Over Label", "Start over", type.subhead, palette.white, { position: [80, 24], anchor: [0.5, 0.5], textAlignment: "center" }),
      ]),
    ),
    addLayer(
      group("card", "Card", { position: DECK_CENTER, anchor: [0.5, 0.5], size: CARD, cornerRadius: 32, clip: true, color: DISHES[2]![2], ...shadow("soft") }, [
        oval("card_plate", "Plate", { position: [65, 50], size: [200, 200], color: "#FFFFFF33" }),
        oval("card_food", "Food", { position: [95, 80], size: [140, 140], color: DISHES[2]![3] }),
        text("card_title", "Dish", DISHES[2]![0], type.title, palette.white, { position: [24, 318] }),
        text("card_meta", "Details", DISHES[2]![1], type.callout, palette.white70, { position: [24, 360] }),
        group("card_like", "Save Badge", { position: [24, 24], size: [96, 40], cornerRadius: 12, color: palette.white, opacity: 0, hitTest: false }, [
          text("card_like_label", "Save Label", "SAVE", type.headline, palette.green, { position: [48, 20], anchor: [0.5, 0.5], textAlignment: "center" }),
        ]),
        group("card_nope", "Skip Badge", { position: [210, 24], size: [96, 40], cornerRadius: 12, color: palette.white, opacity: 0, hitTest: false }, [
          text("card_nope_label", "Skip Label", "SKIP", type.headline, palette.red, { position: [48, 20], anchor: [0.5, 0.5], textAlignment: "center" }),
        ]),
      ]),
    ),
    addLayer(homeIndicator("app", "dark")),

    // One card per loop index
    addPatch("cards", "loop", "Cards", { count: DISHES.length }),
    addPatch("card_titles", "loopBuilder", "Dish Names", Object.fromEntries(DISHES.map((d, i) => [`item${i}`, d[0]])), { typeParam: "text", inputCount: DISHES.length }),
    addPatch("card_metas", "loopBuilder", "Dish Details", Object.fromEntries(DISHES.map((d, i) => [`item${i}`, d[1]])), { typeParam: "text", inputCount: DISHES.length }),
    addPatch("card_colors", "loopBuilder", "Card Colors", Object.fromEntries(DISHES.map((d, i) => [`item${i}`, d[2]])), { typeParam: "color", inputCount: DISHES.length }),
    addPatch("card_accents", "loopBuilder", "Food Colors", Object.fromEntries(DISHES.map((d, i) => [`item${i}`, d[3]])), { typeParam: "color", inputCount: DISHES.length }),
    connect("card_titles.loop", "@card_title.text"),
    connect("card_metas.loop", "@card_meta.text"),
    connect("card_colors.loop", "@card.color"),
    connect("card_accents.loop", "@card_food.color"),

    // Which card is on top: the highest index that isn't gone
    addPatch("card_swipe", "swipe", "Swipe Card", { layer: layerRef("card"), axis: "horizontal", minDistance: 120, minVelocity: 800 }),
    addPatch("tap_start_over", "interaction", "Tap Start Over", { layer: layerRef("start_over") }),
    addPatch("card_gone", "switch", "Card Gone", { turnOn: link("card_swipe.swiped"), turnOff: link("tap_start_over.tap") }),
    addPatch("cards_gone", "loopSum", "Cards Gone", { loop: link("card_gone.on") }, { typeParam: "number" }),
    addPatch("top_index", "subtract", "Top Card", { value1: DISHES.length - 1, value2: link("cards_gone.sum") }, { typeParam: "number", inputCount: 2 }),
    addPatch("is_top", "equals", "Is Top Card", { value1: link("cards.index"), value2: link("top_index.output") }, { typeParam: "number" }),
    connect("is_top.output", "@card.hitTest"),

    // Where each card rests: centered, or thrown off to the side it was swiped
    addPatch("card_side", "optionSwitch", "Swiped Which Way", { setTo0: link("card_swipe.swipedLeft"), setTo1: link("card_swipe.swipedRight") }, { inputCount: 2 }),
    addPatch("fly_out_x", "optionPicker", "Fly-Out X", { option: link("card_side.option"), option0: -FLY_OUT, option1: FLY_OUT }, { typeParam: "number", inputCount: 2 }),
    addPatch("resting_x", "ifElse", "Resting X", { condition: link("card_gone.on"), ifTrue: link("fly_out_x.output"), ifFalse: 0 }, { typeParam: "number" }),

    // Follow the finger, then spring with its speed
    addPatch("card_gesture", "gesture", "Drag Card", { layer: layerRef("card") }),
    addPatch("finger_offset", "pointUnpack", "Finger Offset", { value: link("card_gesture.translation") }),
    addPatch("finger_speed", "pointUnpack", "Finger Speed", { value: link("card_gesture.velocity") }),
    addPatch("card_target", "ifElse", "Finger or Resting X", { condition: link("card_gesture.down"), ifTrue: link("finger_offset.x"), ifFalse: link("resting_x.output") }, { typeParam: "number" }),
    addPatch("card_spring", "springAnimation", "Card Spring", { number: link("card_target.output"), tension: 180, friction: 20, gestureActive: link("card_gesture.down"), gestureVelocity: link("finger_speed.x") }, { typeParam: "number" }),

    // Cards behind the top one sit a little lower and smaller, and move up as the deck shrinks
    addPatch("card_depth", "subtract", "Cards Above", { value1: link("top_index.output"), value2: link("cards.index") }, { typeParam: "number", inputCount: 2 }),
    addPatch("depth_in_deck", "clamp", "Depth in Deck", { value: link("card_depth.output"), min: 0, max: 2 }, { typeParam: "number" }),
    addPatch("depth_spring", "popAnimation", "Depth Spring", { number: link("depth_in_deck.output"), bounciness: 4, speed: 12 }),
    addPatch("card_scale", "transition", "Card Scale", { progress: link("depth_spring.output"), start: 1, end: 0.95 }, { typeParam: "number" }),
    addPatch("card_y", "transition", "Card Y", { progress: link("depth_spring.output"), start: DECK_CENTER[1], end: DECK_CENTER[1] + 18 }, { typeParam: "number" }),
    addPatch("card_x", "add", "Card X", { value1: DECK_CENTER[0], value2: link("card_spring.output") }, { typeParam: "number", inputCount: 2 }),
    addPatch("card_position", "point", "Card Position", { x: link("card_x.output"), y: link("card_y.output") }),
    addPatch("card_rotation", "multiply", "Card Tilt", { value1: link("card_spring.output"), value2: 0.05 }, { typeParam: "number", inputCount: 2 }),
    connect("card_scale.output", "@card.scale"),
    connect("card_position.output", "@card.position"),
    connect("card_rotation.output", "@card.rotation"),

    // Badges fade in with the drag distance
    addPatch("like_opacity", "progress", "Save Badge Opacity", { value: link("card_spring.output"), start: 20, end: 120, clampToRange: true }),
    addPatch("nope_opacity", "progress", "Skip Badge Opacity", { value: link("card_spring.output"), start: -20, end: -120, clampToRange: true }),
    connect("like_opacity.progress", "@card_like.opacity"),
    connect("nope_opacity.progress", "@card_nope.opacity"),
  ],
};
