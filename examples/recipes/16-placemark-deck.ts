/**
 * 16 Placemark Deck: the deck from a real test session, rebuilt as an example. The layers come from a
 * design import (16-placemark-deck/design, planned with planImport), and one batch turns the top card
 * into a template repeated once per place, wires the swipe through a Swipe Card patch component, and
 * puts every number that decides the feel on knobs, with a locked Shipped app preset to compare with.
 */

import { isLinkInput, type InputValue, type InterfacePort, type NewKnob, type Op, type ValueType } from "@sonobe/core";
import { addPatch, comment, connect, homeIndicator, layerRef, link, statusBar, type PatchOptions } from "../lib/kit.ts";
import type { Recipe } from "../lib/recipe.ts";

type Props = Record<string, InputValue>;

/** The places, top card first: name, address, photo credits, and the three photos' asset ids. */
export const PLACES: [string, string, string, string, string, string][] = [
  ["Leonard's Bakery", "933 Kapahulu Ave, Honolulu", "Photos: _e.t · Ken Lund · Banzai Hiroaki", "malasadas", "pastry_case", "bakery_storefront"],
  ["Rainbow Drive-In", "3308 Kanaina Ave, Honolulu", "Photos: Arnold Gatilao · Eugene Kim · John Liu", "plate_lunch", "drive_in_storefront", "mix_plate_and_chili"],
  ["Honolulu Museum of Art", "900 S Beretania St, Honolulu", "Photos: Glamorous Vagabonds · HonoluluMuseumOfArt · Wmpearl", "museum_courtyard", "impressionism_gallery", "japanese_tea_house"],
  ["Mānoa Falls Trail", "3860 Manoa Rd, Honolulu", "Photos: Chouwawa · Daniel Ramirez", "manoa_falls", "forest_trail", "bamboo_steps"],
];

/** Half the card's height: grabbing below it flips the tilt. */
const CARD_HALF_HEIGHT = 239;

const PROPOSAL = "proposal";
const SHIPPED = "shipped_app";

/** A knob with its Proposal and Shipped app values. */
function knob(k: Omit<NewKnob, "values"> & { proposal: number | boolean; shipped: number | boolean }): Op {
  const { proposal, shipped, ...rest } = k;
  return { op: "addKnob", knob: { ...rest, values: { [PROPOSAL]: proposal, [SHIPPED]: shipped } } };
}

/** The knobs, in the order the gesture happens. Shipped app holds what the shipped app does. */
export const KNOBS: Op[] = [
  knob({ id: "vertical_follow", name: "Vertical Follow", group: "Drag", type: "number", min: 0, max: 1, step: 0.05, proposal: 0.3, shipped: 0, description: "How much the card follows your finger up and down. 0 keeps it level." }),
  knob({ id: "tilt_per_point", name: "Tilt per Point", group: "Drag", type: "number", min: 0, max: 0.1, step: 0.001, unit: "°", proposal: 1 / 30, shipped: 1 / 30, description: "Degrees of tilt for each point the card moves sideways." }),
  knob({ id: "grab_tilt", name: "Grab Tilt", group: "Drag", type: "boolean", proposal: true, shipped: false, description: "Grabbing the lower half tilts the card the other way, like a card held at the bottom." }),
  knob({ id: "badge_fade_start", name: "Badge Fade Start", group: "Badges", type: "number", min: 0, max: 200, step: 1, unit: "pt", proposal: 25, shipped: 25, description: "How far the card moves before the heart or ✕ starts to fade in." }),
  knob({ id: "badge_fade_end", name: "Badge Fade End", group: "Badges", type: "number", min: 0, max: 200, step: 1, unit: "pt", proposal: 95, shipped: 25, description: "Where the badge is fully shown. The same as Badge Fade Start makes it pop in." }),
  knob({ id: "commit_pop", name: "Commit Pop", group: "Badges", type: "number", min: 1, max: 1.5, step: 0.01, unit: "×", proposal: 1.15, shipped: 1, description: "How much the badge grows once letting go would vote." }),
  knob({ id: "commit_distance", name: "Commit Distance", group: "Throw", type: "number", min: 40, max: 200, step: 1, unit: "pt", proposal: 95, shipped: 95, description: "How far the card has to be headed when you let go for it to count as a vote." }),
  knob({ id: "throw_lookahead", name: "Throw Lookahead", group: "Throw", type: "number", min: 0, max: 0.5, step: 0.01, unit: "s", proposal: 0.2, shipped: 0, description: "Seconds of release speed added to the drag, so a quick flick counts. 0 judges by distance only." }),
  knob({ id: "spring_response", name: "Spring Response", group: "Spring", type: "number", min: 0.1, max: 1, step: 0.01, unit: "s", proposal: 0.3, shipped: 0.3, description: "How long the card takes to spring home or fly off." }),
  knob({ id: "spring_damping", name: "Spring Damping", group: "Spring", type: "number", min: 0.1, max: 1, step: 0.01, proposal: 0.75, shipped: 0.75, description: "Below 1 the spring overshoots a little before it settles." }),
  knob({ id: "card_flies_out", name: "Card Flies Out", group: "Fly Out", type: "boolean", proposal: true, shipped: false, description: "On: a vote throws the card off screen. Off, as in the shipped app: the card never leaves, and the next place springs back from your finger." }),
  knob({ id: "fly_out_distance", name: "Fly-Out Distance", group: "Fly Out", type: "number", min: 200, max: 1000, step: 10, unit: "pt", proposal: 600, shipped: 600, description: "How far a thrown card flies." }),
  knob({ id: "next_card_scale", name: "Next Card Scale", group: "Next Card", type: "number", min: 0.8, max: 1, step: 0.01, unit: "×", proposal: 0.95, shipped: 1, description: "The card underneath starts this small and grows as the top card nears Commit Distance. 1 shows no rise." }),
  knob({ id: "button_nudge", name: "Button Nudge", group: "Buttons", type: "number", min: 0, max: 60, step: 1, unit: "pt", proposal: 20, shipped: 0, description: "Holding ✕ or ♥ nudges the top card that way." }),
  knob({ id: "button_press_scale", name: "Button Press Scale", group: "Buttons", type: "number", min: 0.8, max: 1, step: 0.01, unit: "×", proposal: 0.92, shipped: 1, description: "How small ✕ and ♥ get while pressed." }),
];

const knobLink = (id: string) => link(`$knob.${id}`);

// ---------------------------------------------------------------------------
// Sections: a comment frame and the nodes that start inside it. The build tidies each frame.
// ---------------------------------------------------------------------------

interface Section {
  id: string;
  title: string;
  color: string;
  at: [number, number];
  /** addPatch ops placed inside the frame, in reading order. */
  patches: Op[];
  /** Layer nodes ("@card") to place inside the frame, after the patches. */
  layers?: string[];
}

const ROW = 40;

/** An addPatch or addComment op that goes into `component` (main when it's undefined). */
function inComponent(op: Op, component: string | undefined): Op {
  if (!component) return op;
  if (op.op === "addPatch" || op.op === "addComment") return { ...op, component };
  throw new Error(`${op.op} can't be moved into a component here.`);
}

/** A section's ops: its patches, then its frame ("section_<id>"), then where its layer nodes start. */
function section(s: Section, component?: string): Op[] {
  const [x, y] = s.at;
  const place = (i: number) => ({ x: x + 24, y: y + 60 + i * ROW });
  const patches = s.patches.map((op, i): Op => (op.op === "addPatch" ? { ...op, patch: { ...op.patch, ui: place(i) } } : op));
  const count = s.patches.length + (s.layers?.length ?? 0);
  const frame = inComponent(comment(`section_${s.id}`, s.title, [x, y, 640, 80 + count * ROW], s.color), component);
  const ops: Op[] = [...patches, frame];
  if (s.layers?.length) {
    const positions = Object.fromEntries(s.layers.map((id, i) => [id, [place(s.patches.length + i).x, place(s.patches.length + i).y] as [number, number]]));
    ops.push(component ? { op: "setNodePositions", component, positions } : { op: "setNodePositions", positions });
  }
  return ops;
}

/**
 * A batch may only link to patches that already exist. Inputs that link to a patch added later in
 * the batch (the feedback loops, and sections that read ahead) are taken out of their addPatch and
 * connected once every patch is there.
 */
function linkAhead(ops: Op[]): Op[] {
  // Per component, the patches the batch hasn't added yet.
  const pending = new Map<string, Set<string>>();
  for (const op of ops) {
    if (op.op !== "addPatch" || !op.patch.id) continue;
    const ids = pending.get(op.component ?? "") ?? new Set<string>();
    pending.set(op.component ?? "", ids.add(op.patch.id));
  }
  const connects: Op[] = [];
  const out = ops.map((op): Op => {
    if (op.op !== "addPatch" || !op.patch.id || !op.patch.inputs) return op;
    const ids = pending.get(op.component ?? "")!;
    ids.delete(op.patch.id);
    const inputs: Props = {};
    for (const [key, value] of Object.entries(op.patch.inputs)) {
      if (isLinkInput(value) && ids.has(value.link.split(".")[0]!)) connects.push({ op: "connect", ...(op.component ? { component: op.component } : {}), from: value.link, to: `${op.patch.id}.${key}` });
      else inputs[key] = value;
    }
    return { ...op, patch: { ...op.patch, inputs } };
  });
  return [...out, ...connects];
}

// ---------------------------------------------------------------------------
// The Swipe Card component: what one copy of the card does.
// ---------------------------------------------------------------------------

const SWIPE_CARD = "swipe_card";

/** addPatch inside Swipe Card. */
const p = (id: string, patchType: string, name: string, inputs: Props = {}, options: PatchOptions = {}): Op => inComponent(addPatch(id, patchType, name, inputs, options), SWIPE_CARD);
const num = { typeParam: "number" };
const two = { typeParam: "number", inputCount: 2 };

/** Interface ports keyed by their key: [name, type, default]. */
const ports = (list: Record<string, [string, ValueType, InputValue?]>): Record<string, InterfacePort> =>
  Object.fromEntries(Object.entries(list).map(([key, [name, type, def]]) => [key, { key, name, type, ...(def !== undefined ? { default: def } : {}) }]));

const SWIPE_CARD_INTERFACE = {
  inputs: ports({
    down: ["Down", "boolean", false],
    translation: ["Translation", "point", [0, 0]],
    velocity: ["Velocity", "point", [0, 0]],
    grabPoint: ["Grab Point", "point", [0, 0]],
    projected: ["Projected Throw", "point", [0, 0]],
    swipedLeft: ["Swiped Left", "pulse"],
    swipedRight: ["Swiped Right", "pulse"],
    passHeld: ["Pass Held", "boolean", false],
    passTapped: ["Pass Tapped", "pulse"],
    yesHeld: ["Yes Held", "boolean", false],
    yesTapped: ["Yes Tapped", "pulse"],
    reset: ["Reset", "pulse"],
    cardAboveGone: ["Card Above Gone", "boolean", true],
    aboveLift: ["Card Above Lift", "number", 1],
    aboveOffset: ["Card Above Offset", "point", [0, 0]],
  }),
  outputs: ports({
    position: ["Position", "point"],
    rotation: ["Rotation", "number"],
    scale: ["Scale", "number"],
    shown: ["Shown", "boolean"],
    touchable: ["Touchable", "boolean"],
    yesBadge: ["Yes Badge Opacity", "number"],
    passBadge: ["Pass Badge Opacity", "number"],
    badgeScale: ["Badge Scale", "number"],
    gone: ["Gone", "boolean"],
    lift: ["Lift", "number"],
  }),
};

const SWIPE_CARD_OUTPUTS: [string, string][] = [
  ["card_spring.output", "position"],
  ["card_tilt.output", "rotation"],
  ["card_scale.output", "scale"],
  ["shown.output", "shown"],
  ["still_in_deck.output", "touchable"],
  ["yes_badge.output", "yesBadge"],
  ["pass_badge.output", "passBadge"],
  ["badge_scale.output", "badgeScale"],
  ["card_gone.on", "gone"],
  ["lift.progress", "lift"],
];

function swipeCardOps(): Op[] {
  const sections: Section[] = [
    { id: "from_main", title: "FROM MAIN · the finger, the buttons, and the card above this one", color: "gray", at: [-640, 0], patches: [], layers: ["$in"] },
    { id: "to_main", title: "TO MAIN · where this copy goes and what it shows", color: "gray", at: [1800, 0], patches: [], layers: ["$out"] },
    {
      id: "top_card",
      title: "1 · IS THIS THE TOP CARD? · not gone, and the card above is (read one frame late, so one ✕ tap throws one card)",
      color: "gray",
      at: [0, 0],
      patches: [
        p("was_gone_last_frame", "delay1", "Was Gone Last Frame", { value: link("card_gone.on") }, { typeParam: "boolean" }),
        p("still_in_deck", "not", "Still in Deck", { value: link("was_gone_last_frame.output") }),
        p("is_top_card", "and", "Is Top Card", { value1: link("$in.cardAboveGone"), value2: link("still_in_deck.output") }, { inputCount: 2 }),
      ],
    },
    {
      id: "buttons",
      title: "2 · ✕ ♥ BUTTONS · holding previews the vote on the top card (Button Nudge), tapping throws it",
      color: "pink",
      at: [0, 300],
      patches: [
        p("holding_pass", "and", "Holding Pass", { value1: link("$in.passHeld"), value2: link("is_top_card.output") }, { inputCount: 2 }),
        p("holding_yes", "and", "Holding Yes", { value1: link("$in.yesHeld"), value2: link("is_top_card.output") }, { inputCount: 2 }),
        p("pass_vote", "and", "Pass Button Vote", { value1: link("$in.passTapped"), value2: link("is_top_card.output") }, { inputCount: 2 }),
        p("yes_vote", "and", "Yes Button Vote", { value1: link("$in.yesTapped"), value2: link("is_top_card.output") }, { inputCount: 2 }),
        p("yes_nudge", "ifElse", "Yes Nudge", { condition: link("holding_yes.output"), ifTrue: 1, ifFalse: 0 }, num),
        p("nudge_side", "ifElse", "Nudge Side", { condition: link("holding_pass.output"), ifTrue: -1, ifFalse: link("yes_nudge.output") }, num),
        p("nudge_x", "multiply", "Nudge X", { value1: link("nudge_side.output"), value2: knobLink("button_nudge") }, two),
      ],
    },
    {
      id: "vote",
      title: "3 · VOTE · a throw (Throw Card) or a tap turns Card Gone on and remembers which way",
      color: "orange",
      at: [0, 700],
      patches: [
        p("went_left", "or", "Went Left", { value1: link("$in.swipedLeft"), value2: link("pass_vote.output") }, { inputCount: 2 }),
        p("went_right", "or", "Went Right", { value1: link("$in.swipedRight"), value2: link("yes_vote.output") }, { inputCount: 2 }),
        p("voted", "or", "Voted", { value1: link("went_left.output"), value2: link("went_right.output") }, { inputCount: 2 }),
        p("card_gone", "switch", "Card Gone", { turnOn: link("voted.output"), turnOff: link("$in.reset") }),
        p("which_way", "optionSwitch", "Which Way", { setTo0: link("went_left.output"), setTo1: link("went_right.output") }, { inputCount: 2 }),
        p("fly_out_side", "optionPicker", "Fly-Out Side", { option: link("which_way.option"), option0: -1, option1: 1 }, two),
        p("fly_out_x", "multiply", "Fly-Out X", { value1: link("fly_out_side.output"), value2: knobLink("fly_out_distance") }, two),
      ],
    },
    {
      id: "target",
      title: "4 · WHERE THE CARD WANTS TO BE · the finger while dragging (Vertical Follow), else flown off (Card Flies Out), else nudged by a held button, else home",
      color: "purple",
      at: [0, 1100],
      patches: [
        p("finger_offset", "pointUnpack", "Finger Offset", { value: link("$in.translation") }),
        p("followed_y", "multiply", "Followed Y", { value1: link("finger_offset.y"), value2: knobLink("vertical_follow") }, two),
        p("held_at", "point", "Held At", { x: link("finger_offset.x"), y: link("followed_y.output") }),
        p("press", "pulse", "Press", { on: link("$in.down") }),
        p("y_at_release", "sampleAndHold", "Y at Release", { value: link("followed_y.output"), sample: link("press.turnedOff") }, num),
        p("flown_x", "ifElse", "Flown X", { condition: knobLink("card_flies_out"), ifTrue: link("fly_out_x.output"), ifFalse: 0 }, num),
        p("thrown_to", "point", "Thrown To", { x: link("flown_x.output"), y: link("y_at_release.output") }),
        p("nudged_to", "point", "Nudged To", { x: link("nudge_x.output"), y: 0 }),
        p("settled_at", "ifElse", "Settled At", { condition: link("follows_card_above.output"), ifTrue: link("$in.aboveOffset"), ifFalse: link("nudged_to.output") }, { typeParam: "point" }),
        p("resting_at", "ifElse", "Resting At", { condition: link("card_gone.on"), ifTrue: link("thrown_to.output"), ifFalse: link("settled_at.output") }, { typeParam: "point" }),
        p("card_target", "ifElse", "Card Target", { condition: link("$in.down"), ifTrue: link("held_at.output"), ifFalse: link("resting_at.output") }, { typeParam: "point" }),
      ],
    },
    {
      id: "spring",
      title: "5 · ONE SPRING GETS IT THERE · starting at the finger's speed (Spring Response, Spring Damping)",
      color: "green",
      at: [0, 1700],
      patches: [
        p("finger_speed", "pointUnpack", "Finger Speed", { value: link("$in.velocity") }),
        p("followed_y_speed", "multiply", "Followed Y Speed", { value1: link("finger_speed.y"), value2: knobLink("vertical_follow") }, two),
        p("throw_speed", "point", "Throw Speed", { x: link("finger_speed.x"), y: link("followed_y_speed.output") }),
        p("spring_feel", "springConverter", "Spring Feel", { response: knobLink("spring_response"), dampingFraction: knobLink("spring_damping") }),
        p("tracking", "or", "Tracking", { value1: link("$in.down"), value2: link("follows_card_above.output") }, { inputCount: 2 }),
        p("card_spring", "springAnimation", "Card Spring", { number: link("card_target.output"), mass: link("spring_feel.mass"), tension: link("spring_feel.tension"), friction: link("spring_feel.friction"), gestureActive: link("tracking.output"), gestureVelocity: link("throw_speed.output") }, { typeParam: "point" }),
      ],
    },
    {
      id: "tilt",
      title: "6 · TILT · Tilt per Point, flipped when you grab the lower half (Grab Tilt)",
      color: "blue",
      at: [0, 2100],
      patches: [
        p("card_offset", "pointUnpack", "Card Offset", { value: link("card_spring.output") }),
        p("grab_point", "pointUnpack", "Grab Point", { value: link("$in.grabPoint") }),
        p("grab_y", "sampleAndHold", "Grab Y", { value: link("grab_point.y"), sample: link("press.turnedOn") }, num),
        p("grabbed_lower_half", "greaterThan", "Grabbed Lower Half", { value1: link("grab_y.output"), value2: CARD_HALF_HEIGHT }, two),
        p("flip_tilt", "and", "Flip Tilt", { value1: link("grabbed_lower_half.output"), value2: knobLink("grab_tilt") }, { inputCount: 2 }),
        p("tilt_direction", "ifElse", "Tilt Direction", { condition: link("flip_tilt.output"), ifTrue: -1, ifFalse: 1 }, num),
        p("card_tilt", "multiply", "Card Tilt", { value1: link("card_offset.x"), value2: knobLink("tilt_per_point"), value3: link("tilt_direction.output") }, { typeParam: "number", inputCount: 3 }),
      ],
    },
    {
      id: "badges",
      title: "7 · BADGES · fade in with distance (Badge Fade Start, Badge Fade End), pop once letting go would vote (Commit Pop)",
      color: "pink",
      at: [0, 2500],
      patches: [
        p("yes_badge_fade", "progress", "Yes Badge Fade", { value: link("card_offset.x"), start: knobLink("badge_fade_start"), end: knobLink("badge_fade_end"), clampToRange: true }),
        p("pass_side_x", "multiply", "Pass Side X", { value1: link("card_offset.x"), value2: -1 }, two),
        p("pass_badge_fade", "progress", "Pass Badge Fade", { value: link("pass_side_x.output"), start: knobLink("badge_fade_start"), end: knobLink("badge_fade_end"), clampToRange: true }),
        p("yes_badge", "ifElse", "Yes Badge", { condition: link("holding_yes.output"), ifTrue: 1, ifFalse: link("yes_badge_fade.progress") }, num),
        p("pass_badge", "ifElse", "Pass Badge", { condition: link("holding_pass.output"), ifTrue: 1, ifFalse: link("pass_badge_fade.progress") }, num),
        p("projected_offset", "pointUnpack", "Projected Offset", { value: link("$in.projected") }),
        p("heading", "absoluteValue", "Heading", { value: link("projected_offset.x") }, num),
        p("would_vote", "greaterThan", "Would Vote", { value1: link("heading.output"), value2: knobLink("commit_distance") }, two),
        p("armed", "or", "Armed", { value1: link("would_vote.output"), value2: link("holding_yes.output"), value3: link("holding_pass.output") }, { inputCount: 3 }),
        p("armed_pop", "popAnimation", "Armed Pop", { number: link("armed.output"), bounciness: 12, speed: 20 }),
        p("badge_scale", "transition", "Badge Scale", { progress: link("armed_pop.output"), start: 1, end: knobLink("commit_pop") }, num),
      ],
    },
    {
      id: "next_card",
      title: "8 · NEXT CARD · Lift tells the card underneath how far to grow (Next Card Scale)",
      color: "green",
      at: [0, 3100],
      patches: [
        p("distance_from_center", "absoluteValue", "Distance From Center", { value: link("card_offset.x") }, num),
        p("lift", "progress", "Lift", { value: link("distance_from_center.output"), start: 0, end: knobLink("commit_distance"), clampToRange: true }),
        p("card_scale", "transition", "Card Scale", { progress: link("$in.aboveLift"), start: knobLink("next_card_scale"), end: 1 }, num),
      ],
    },
    {
      id: "shipped_app",
      title: "9 · THE SHIPPED APP · with Card Flies Out off only the top card shows, the cards under it follow it, and the next place springs back from the finger",
      color: "yellow",
      at: [0, 3400],
      patches: [
        p("stays_in_place", "not", "Stays in Place", { value: knobLink("card_flies_out") }),
        p("card_above_there", "not", "Card Above There", { value: link("$in.cardAboveGone") }),
        p("follows_card_above", "and", "Follows Card Above", { value1: link("stays_in_place.output"), value2: link("card_above_there.output") }, { inputCount: 2 }),
        p("shown", "or", "Shown", { value1: knobLink("card_flies_out"), value2: link("is_top_card.output") }, { inputCount: 2 }),
      ],
    },
  ];
  return [
    { op: "addComponent", component: { id: SWIPE_CARD, name: "Swipe Card", kind: "patchComponent", interface: SWIPE_CARD_INTERFACE } },
    { op: "updateComponent", id: SWIPE_CARD, notes: "One card of the deck. Main runs it once per place: it gets the finger (Drag Card, Throw Card), the buttons and the card above it, and says where this copy goes, how it tilts and scales, what its badges show, and whether it's gone." },
    ...sections.flatMap((s) => section(s, SWIPE_CARD)),
    ...SWIPE_CARD_OUTPUTS.map(([from, key]): Op => ({ op: "connect", component: SWIPE_CARD, from, to: `$out.${key}` })),
  ];
}

// ---------------------------------------------------------------------------
// The layers: turn the imported top card into the template and drop the cards under it.
// ---------------------------------------------------------------------------

const layer = (id: string, props: Record<string, InputValue | null>): Op => ({ op: "updateLayer", id, props });

function layerOps(): Op[] {
  return [
    // The other three cards only carried their place's photos and text, which are now Loop Builder rows.
    { op: "removeLayer", id: "card_2" },
    { op: "removeLayer", id: "card_3" },
    { op: "removeLayer", id: "card_4" },
    // Cards only holds the stack; touches pass through it to its cards, or to End of Deck once they're gone.
    layer("cards", { hitTest: false }),
    // A column, so a two-line place name makes the photos shorter instead of pushing the text off the card.
    layer("card", { layout: "column", padding: [1, 1, 1, 1], spacing: 0 }),
    layer("card_photos", { widthMode: "percent", heightMode: "grow", size: [100, 339], layout: "column", padding: [0, 0, 10, 12], alignment: "bottomLeft" }),
    layer("card_photo_grid", { positioning: "absolute", position: [0, 0], widthMode: "percent", heightMode: "percent", size: [100, 100], layout: "row", spacing: 4 }),
    layer("card_photo_1", { widthMode: "percent", heightMode: "percent", size: [60, 100] }),
    layer("card_side_photos", { widthMode: "grow", heightMode: "percent", size: [138, 100], layout: "column", spacing: 4 }),
    layer("card_photo_2", { widthMode: "percent", heightMode: "grow", size: [100, 167] }),
    layer("card_photo_3", { widthMode: "percent", heightMode: "grow", size: [100, 167] }),
    layer("card_info", { widthMode: "percent", heightMode: "auto", size: [100, 137], layout: "column", spacing: 8, padding: [22, 22, 22, 22] }),
    layer("card_title_row", { widthMode: "percent", heightMode: "auto", size: [100, 44], layout: "row", spacing: 14 }),
    layer("place_name", { widthMode: "grow", heightMode: "auto" }),
    layer("card_yes_badge", { positioning: "absolute" }),
    layer("card_pass_badge", { positioning: "absolute" }),
    // The screen has room for the status bar; draw it, and the home indicator, on top.
    { op: "addLayer", parent: "discover", layer: statusBar("app", "dark") },
    { op: "addLayer", parent: "discover", layer: homeIndicator("app", "dark") },
  ];
}

// ---------------------------------------------------------------------------
// The main graph.
// ---------------------------------------------------------------------------

const loopBuilder = (id: string, name: string, typeParam: string, items: InputValue[]): Op =>
  addPatch(id, "loopBuilder", name, Object.fromEntries(items.map((item, i) => [`item${i}`, item])), { typeParam, inputCount: items.length });

function mainOps(): Op[] {
  const asset = (id: string) => ({ asset: id });
  const sections: Section[] = [
    {
      id: "places",
      title: "PLACES · one Loop Builder per field, one row per card, top card first · add a row to every builder to add a place",
      color: "green",
      at: [0, 0],
      patches: [
        loopBuilder("place_names", "Place Names", "text", PLACES.map((p) => p[0])),
        loopBuilder("place_addresses", "Place Addresses", "text", PLACES.map((p) => p[1])),
        loopBuilder("place_credits", "Place Credits", "text", PLACES.map((p) => p[2])),
        loopBuilder("big_photos", "Big Photos", "image", PLACES.map((p) => asset(p[3]))),
        loopBuilder("top_right_photos", "Top Right Photos", "image", PLACES.map((p) => asset(p[4]))),
        loopBuilder("bottom_right_photos", "Bottom Right Photos", "image", PLACES.map((p) => asset(p[5]))),
      ],
      layers: ["@place_name", "@place_address", "@photo_credits", "@card_photo_1", "@card_photo_2", "@card_photo_3"],
    },
    {
      id: "the_deck",
      title: "THE DECK · Repeat makes one Card per place, index × −1 puts row 0 on top · Drag Card and Throw Card → Swipe Card (open it) → Card",
      color: "blue",
      at: [0, 700],
      patches: [
        addPatch("stack_order", "multiply", "Stack Order", { value1: link("place_names.index"), value2: -1 }, two),
        addPatch("drag_card", "gesture", "Drag Card", { layer: layerRef("card") }),
        addPatch("throw_card", "swipe", "Throw Card", { layer: layerRef("card"), axis: "horizontal", minDistance: knobLink("commit_distance"), minVelocity: 10000, lookahead: knobLink("throw_lookahead") }),
        {
          op: "addPatch",
          patch: {
            id: "swipe_card",
            type: "component",
            component: SWIPE_CARD,
            name: "Swipe Card",
            inputs: {
              down: link("drag_card.down"),
              translation: link("drag_card.translation"),
              velocity: link("drag_card.velocity"),
              grabPoint: link("drag_card.localPosition"),
              projected: link("throw_card.projected"),
              swipedLeft: link("throw_card.swipedLeft"),
              swipedRight: link("throw_card.swipedRight"),
              passHeld: link("tap_pass.down"),
              passTapped: link("tap_pass.tap"),
              yesHeld: link("tap_yes.down"),
              yesTapped: link("tap_yes.tap"),
              reset: link("tap_find_more_places.tap"),
              cardAboveGone: link("card_above_gone_last_frame.output"),
              aboveLift: link("card_above_lift_last_frame.output"),
              aboveOffset: link("card_above_offset_last_frame.output"),
            },
          },
        },
      ],
      layers: ["@card", "@card_yes_badge", "@card_pass_badge"],
    },
    {
      id: "card_above",
      title: "THE CARD ABOVE · each copy reads copy index − 1, one frame late · the top card has none, so Fallback says it's gone and fully lifted",
      color: "purple",
      at: [0, 1200],
      patches: [
        addPatch("card_above", "subtract", "Card Above", { value1: link("place_names.index"), value2: 1 }, two),
        addPatch("card_above_gone", "loopSelect", "Card Above: Gone", { loop: link("swipe_card.gone"), index: link("card_above.output"), outOfRange: "fallback", fallback: true }, { typeParam: "boolean" }),
        addPatch("card_above_gone_last_frame", "delay1", "Card Above: Gone Last Frame", { value: link("card_above_gone.output") }, { typeParam: "boolean" }),
        addPatch("card_above_lift", "loopSelect", "Card Above: Lift", { loop: link("swipe_card.lift"), index: link("card_above.output"), outOfRange: "fallback", fallback: 1 }, num),
        addPatch("card_above_lift_last_frame", "delay1", "Card Above: Lift Last Frame", { value: link("card_above_lift.output") }, num),
        addPatch("card_above_offset", "loopSelect", "Card Above: Offset", { loop: link("swipe_card.position"), index: link("card_above.output"), outOfRange: "fallback", fallback: [0, 0] }, { typeParam: "point" }),
        addPatch("card_above_offset_last_frame", "delay1", "Card Above: Offset Last Frame", { value: link("card_above_offset.output") }, { typeParam: "point" }),
      ],
    },
    {
      id: "buttons",
      title: "BUTTONS · ✕ ♥ shrink while pressed · their taps and holds reach every card, and only the top card acts · Find more places brings the deck back",
      color: "pink",
      at: [0, 1700],
      patches: [
        addPatch("tap_pass", "interaction", "Tap Pass", { layer: layerRef("pass_button") }),
        addPatch("tap_yes", "interaction", "Tap Yes", { layer: layerRef("yes_button") }),
        addPatch("tap_find_more_places", "interaction", "Tap Find More Places", { layer: layerRef("find_more_places_button") }),
        addPatch("pass_press_spring", "popAnimation", "Pass Press Spring", { number: link("tap_pass.down"), bounciness: 0, speed: 20 }),
        addPatch("yes_press_spring", "popAnimation", "Yes Press Spring", { number: link("tap_yes.down"), bounciness: 0, speed: 20 }),
        addPatch("pass_button_scale", "transition", "Pass Button Scale", { progress: link("pass_press_spring.output"), start: 1, end: knobLink("button_press_scale") }, num),
        addPatch("yes_button_scale", "transition", "Yes Button Scale", { progress: link("yes_press_spring.output"), start: 1, end: knobLink("button_press_scale") }, num),
      ],
      layers: ["@pass_button", "@yes_button"],
    },
    {
      id: "deck_empty",
      title: "DECK EMPTY · with every card gone, ✕ ♥ dim to 40% as in the app · with Card Flies Out off, End of Deck waits until then",
      color: "gray",
      at: [0, 2200],
      patches: [
        addPatch("every_card_gone", "loopAll", "Every Card Gone", { loop: link("swipe_card.gone") }),
        addPatch("deck_empty_fade", "popAnimation", "Deck Empty Fade", { number: link("every_card_gone.output"), bounciness: 0, speed: 14 }),
        addPatch("vote_buttons_opacity", "transition", "Vote Buttons Opacity", { progress: link("deck_empty_fade.output"), start: 1, end: 0.4 }, num),
        addPatch("end_of_deck_shown", "or", "End of Deck Shown", { value1: knobLink("card_flies_out"), value2: link("every_card_gone.output") }, { inputCount: 2 }),
      ],
      layers: ["@vote_buttons", "@end_of_deck"],
    },
  ];
  return [
    ...sections.flatMap((s) => section(s)),
    // The category chips' Scroll patch came with the import; give it a frame of its own.
    { op: "updatePatch", id: "scroll_categories", ui: { x: 24, y: 2560 } },
    comment("section_category_chips", "CATEGORY CHIPS · scroll sideways (the design import added this)", [0, 2500, 640, 200], "gray"),
    { op: "setNodePositions", positions: { "@categories_content": [24, 2600] } },
    comment("how_to_read", "HOW TO READ THIS · Card is one layer, repeated once per place in PLACES · Drag Card and Throw Card → Swipe Card (open it for one card's logic) → Card · each copy reads the card above it · the feel is in the Knobs tab (⌘5), and ⌘' flips between Proposal and the locked Shipped app", [0, -120, 1100, 60], "green"),

    connect("place_names.loop", "@place_name.text"),
    connect("place_addresses.loop", "@place_address.text"),
    connect("place_credits.loop", "@photo_credits.text"),
    connect("big_photos.loop", "@card_photo_1.image"),
    connect("top_right_photos.loop", "@card_photo_2.image"),
    connect("bottom_right_photos.loop", "@card_photo_3.image"),
    connect("place_names.loop", "@card.repeat"),
    connect("stack_order.output", "@card.zPosition"),
    connect("swipe_card.position", "@card.position"),
    connect("swipe_card.rotation", "@card.rotation"),
    connect("swipe_card.scale", "@card.scale"),
    connect("swipe_card.shown", "@card.opacity"),
    connect("swipe_card.touchable", "@card.hitTest"),
    connect("swipe_card.yesBadge", "@card_yes_badge.opacity"),
    connect("swipe_card.passBadge", "@card_pass_badge.opacity"),
    connect("swipe_card.badgeScale", "@card_yes_badge.scale"),
    connect("swipe_card.badgeScale", "@card_pass_badge.scale"),
    connect("pass_button_scale.output", "@pass_button.scale"),
    connect("yes_button_scale.output", "@yes_button.scale"),
    connect("vote_buttons_opacity.output", "@vote_buttons.opacity"),
    connect("end_of_deck_shown.output", "@end_of_deck.opacity"),
  ];
}

export const placemarkDeck: Recipe = {
  folder: "16-placemark-deck",
  name: "Placemark Deck",
  description: "A deck of places to vote on, from a real session: drag the top card and throw it, or tap ✕ and ♥. Every number that sets the feel is a knob, and a locked Shipped app preset shows what the app does today.",
  guides: ["07-loops", "12-importing-designs", "13-knobs-and-presets"],
  background: "#F2F2F7FF",
  notes:
    "Drag the top card and let go, or tap ✕ and ♥. Card is one layer repeated once per place; Swipe Card decides what each copy does, and each copy reads the one above it. The Knobs tab (⌘5) holds the feel, and ⌘' flips between Proposal and the locked Shipped app.",
  design: { capture: "16-placemark-deck/design/capture.json", photos: "16-placemark-deck/design/photos.json" },
  tidy: "frames",
  ops: () =>
    linkAhead([
      { op: "addKnobPreset", preset: { id: PROPOSAL, name: "Proposal" } },
      { op: "addKnobPreset", preset: { id: SHIPPED, name: "Shipped app" } },
      ...KNOBS,
      { op: "updateKnobPreset", id: SHIPPED, locked: true },
      ...layerOps(),
      ...swipeCardOps(),
      ...mainOps(),
    ]),
};
