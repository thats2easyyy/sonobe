/**
 * The five in-app lessons. Each step checks real editor state, so a lesson finishes only when the
 * prototype actually works: cables connected to the right ports, values set, the prototype tapped.
 */

import type { Component } from "@sonobe/core";
import { findLinked, firedSince, isLinked, layerPropSource, numberInput, patchesOfType, patchOnLayer } from "./queries.ts";
import { firstPrototypeStarter, listsWithLoopsStarter, springFeelStarter, statesAndPulsesStarter } from "./starters.ts";
import type { Lesson, LessonContext, LessonTarget } from "./types.ts";

const node = (id: string | undefined): string => `.sb-pe .react-flow__node[data-id="${id ?? ""}"]`;
const handleOf = (id: string | undefined, handle: string): LessonTarget | null => (id ? { selector: `${node(id)} .react-flow__handle[data-handleid="${handle}"]` } : null);
const layerRow = (layerId: string): LessonTarget => ({ selector: `#sb-layers [data-layer-id="${layerId}"]`, closest: ".sb-tree__row" });
const inViewer = (layerId: string): LessonTarget => ({ selector: `#sb-viewer [data-layer="${layerId}"]` });
const INSPECTOR: LessonTarget = { selector: "#sb-inspector" };

/** Lesson 1's chain: Interaction on @photo → Switch.flip → Pop Animation.number → the Transition driving @photo.scale. */
export function photoChain(c: Component) {
  const tap = patchOnLayer(c, "interaction", "photo");
  const toggle = tap ? findLinked(c, "switch", "flip", tap, "tap") : undefined;
  const spring = toggle ? findLinked(c, "popAnimation", "number", toggle, "on") : undefined;
  const scale = layerPropSource(c, "photo", "scale")?.patchId;
  const driven = !!scale && !!spring && isLinked(c, scale, "progress", spring, "output");
  return { tap, toggle, spring, scale, driven };
}

const showPatches = (app: { setViewMode(mode: "split" | "patches" | "canvas"): void }, ctx?: LessonContext) => {
  if (!ctx || ctx.ui.viewMode === "canvas") app.setViewMode("split");
};

export const FIRST_PROTOTYPE: Lesson = {
  id: "first-prototype",
  number: 1,
  title: "Your first prototype",
  summary: "Make a photo grow when you tap it, with the four patches behind most interactions.",
  level: 0,
  minutes: 5,
  outcomes: ["Listen for a tap on a layer", "Remember it with a Switch", "Animate with a spring", "Map 0…1 onto a real size"],
  guide: "01-first-prototype",
  starter: firstPrototypeStarter,
  steps: [
    {
      id: "touch",
      title: "Make the photo listen for taps",
      body: "In **Layers**, point at **Photo** and press its hand button, then choose **Tap**. Sonobe adds an **Interaction** patch that watches the photo.",
      tip: "Patches are the building blocks of behavior. Layers are what you see; patches decide what happens.",
      target: layerRow("photo"),
      prepare: (app) => showPatches(app),
      check: (ctx) => !!photoChain(ctx.component).tap,
    },
    {
      id: "switch",
      title: "Remember the tap with a Switch",
      body: "A tap lasts a single frame. To remember it, drag from the Interaction's **Tap** output into empty space in the patch editor, type **Switch**, and press Return.",
      tip: "Can't see the patch? Point at the patch editor and press Shift+1 to fit everything in view.",
      target: (ctx) => handleOf(photoChain(ctx.component).tap, "out:tap"),
      check: (ctx) => {
        const chain = photoChain(ctx.component);
        if (chain.toggle) return true;
        const loose = chain.tap ? patchesOfType(ctx.component, "switch").find((id) => isLinked(ctx.component, id, "turnOn", chain.tap!) || isLinked(ctx.component, id, "turnOff", chain.tap!)) : undefined;
        return { done: false, hint: loose ? "That Switch listens on Turn On or Turn Off. For tap to toggle, connect Tap to Flip." : null };
      },
    },
    {
      id: "spring",
      title: "Animate it with a spring",
      body: "Drag from the Switch's **On** output into empty space and add a **Pop Animation**. It moves smoothly toward 1 when the switch turns on, and back to 0 when it turns off.",
      target: (ctx) => handleOf(photoChain(ctx.component).toggle, "out:on"),
      check: (ctx) => !!photoChain(ctx.component).spring,
    },
    {
      id: "drive",
      title: "Drive the photo's scale",
      body: "Drag the Pop Animation's **Output** onto the **Progress** input of **Photo Scale**. That Transition already sets the photo's Scale.",
      tip: "A Transition turns progress from 0 to 1 into any range: Start at 0, End at 1.",
      target: (ctx) => {
        const chain = photoChain(ctx.component);
        return handleOf(chain.scale, "in:progress") ?? handleOf(chain.spring, "out:output");
      },
      check: (ctx) => photoChain(ctx.component).driven,
    },
    {
      id: "end",
      title: "Choose how big it grows",
      body: "Click **Photo Scale** to select it. In the **Inspector**, set **End** to **1.2**, so the photo grows to 120%.",
      target: (ctx) => {
        const { scale } = photoChain(ctx.component);
        return scale && ctx.selection.patches.includes(scale) ? INSPECTOR : scale ? { selector: node(scale) } : null;
      },
      check: (ctx) => {
        const { scale } = photoChain(ctx.component);
        if (!scale) return false;
        const end = numberInput(ctx.component, scale, "end", 1);
        if (end >= 1.05) return true;
        return { done: false, hint: ctx.selection.patches.includes(scale) ? "End is still 1, so the photo can't grow. Try 1.2." : null };
      },
    },
    {
      id: "tap",
      title: "Tap the photo",
      body: "Click the photo in the **Viewer**. It springs up to 1.2×. Click again and it springs back.",
      tip: "Try clicking again while it's still moving. The spring turns around smoothly instead of starting over.",
      target: inViewer("photo"),
      check: (ctx) => {
        const { tap, toggle } = photoChain(ctx.component);
        return !!tap && (firedSince(ctx.fired, `${tap}.tap`) > 0 || (!!toggle && ctx.value(`${toggle}.on`) === true));
      },
    },
  ],
  celebrate: {
    title: "You built a prototype",
    body: "Interaction → Switch → Animation → Transition. Designers call it ISAT, and it's behind nearly every tap, toggle, and press you'll build.",
  },
};

export const STATES_AND_PULSES: Lesson = {
  id: "states-and-pulses",
  number: 2,
  title: "States vs pulses",
  summary: "See why a tap flashes for one frame, and how a Switch turns it into something that lasts.",
  level: 1,
  minutes: 5,
  outcomes: ["Tell a pulse from a state", "Spot the one-frame flash", "Fix it with a Switch"],
  guide: "03-states-and-pulses",
  starter: statesAndPulsesStarter,
  steps: [
    {
      id: "touch",
      title: "Listen for taps on the button",
      body: "In **Layers**, point at **Button**, press its hand button, and choose **Tap**.",
      target: layerRow("button"),
      prepare: (app) => showPatches(app),
      check: (ctx) => !!patchOnLayer(ctx.component, "interaction", "button"),
    },
    {
      id: "direct",
      title: "Wire the tap straight to the light",
      body: "Drag the Interaction's **Tap** output onto the **Progress** input of **Glow**, the Transition that sets the lamp's brightness.",
      target: (ctx) => handleOf(patchOnLayer(ctx.component, "interaction", "button"), "out:tap"),
      check: (ctx) => {
        const tap = patchOnLayer(ctx.component, "interaction", "button");
        return !!tap && isLinked(ctx.component, "glow", "progress", tap, "tap");
      },
    },
    {
      id: "flash",
      title: "Tap the button and watch closely",
      body: "Click **Toggle the light** in the Viewer. The lamp flashes for a single frame and goes dark. **Tap** is a pulse: it's on for one frame, like a doorbell ringing.",
      tip: "Diagnostics warns about this too: a pulse is wired where a steady value is expected.",
      target: inViewer("button"),
      check: (ctx) => {
        const tap = patchOnLayer(ctx.component, "interaction", "button");
        return !!tap && isLinked(ctx.component, "glow", "progress", tap, "tap") && firedSince(ctx.fired, `${tap}.tap`) > 0;
      },
    },
    {
      id: "switch",
      title: "Remember it with a Switch",
      body: "A **Switch** remembers. Drag from **Tap** into empty space and add a **Switch**. Then drag the Switch's **On** output onto Glow's **Progress**. A new cable replaces the old one.",
      target: (ctx) => {
        const tap = patchOnLayer(ctx.component, "interaction", "button");
        const toggle = tap ? findLinked(ctx.component, "switch", "flip", tap, "tap") : undefined;
        return toggle ? handleOf(toggle, "out:on") : handleOf(tap, "out:tap");
      },
      check: (ctx) => {
        const tap = patchOnLayer(ctx.component, "interaction", "button");
        const toggle = tap ? findLinked(ctx.component, "switch", "flip", tap, "tap") : undefined;
        if (!toggle) return false;
        if (isLinked(ctx.component, "glow", "progress", toggle, "on")) return true;
        return { done: false, hint: "The Switch is listening. Now connect its On output to Glow's Progress." };
      },
    },
    {
      id: "stays",
      title: "Tap again",
      body: "Click the button. This time the light stays on until the next tap. **On** is a state: it keeps its value until something changes it.",
      target: inViewer("button"),
      check: (ctx) => {
        const tap = patchOnLayer(ctx.component, "interaction", "button");
        const toggle = tap ? findLinked(ctx.component, "switch", "flip", tap, "tap") : undefined;
        return !!toggle && isLinked(ctx.component, "glow", "progress", toggle, "on") && ctx.value(`${toggle}.on`) === true;
      },
    },
  ],
  celebrate: {
    title: "Pulses happen, states last",
    body: "Taps, swipes, and timers pulse. Switches, counters, and hover hold a state. When something flickers, look for a pulse where a state belongs.",
  },
};

export const SPRING_FEEL: Lesson = {
  id: "spring-feel",
  number: 3,
  title: "Spring feel",
  summary: "Tune a spring from sluggish to bouncy to snappy, and feel the difference in your hands.",
  level: 2,
  minutes: 4,
  outcomes: ["Select a patch and edit it in the Inspector", "Make a spring bouncy", "Make a spring snappy"],
  guide: "05-springs-and-feel",
  starter: springFeelStarter,
  steps: [
    {
      id: "feel",
      title: "Feel the starting spring",
      body: "Click the card in the **Viewer**, then click it again. Bounciness 0 and Speed 4 make it drift into place like a heavy drawer.",
      target: inViewer("card"),
      prepare: (app) => showPatches(app),
      check: (ctx) => firedSince(ctx.fired, "tap_card.tap") > 0,
    },
    {
      id: "select",
      title: "Select the spring",
      body: "Click **Zoom Spring** in the patch editor. Its settings appear in the **Inspector**.",
      target: { selector: node("zoom_spring") },
      check: (ctx) => ctx.selection.patches.includes("zoom_spring"),
    },
    {
      id: "bounce",
      title: "Add some bounce",
      body: "In the Inspector, set **Bounciness** to **12**, or pick the **Bouncy** preset. Then tap the card: it overshoots and settles back.",
      target: INSPECTOR,
      check: (ctx) => numberInput(ctx.component, "zoom_spring", "bounciness", 5) >= 10,
    },
    {
      id: "snappy",
      title: "Make it snappy",
      body: "Set **Speed** to **20** and **Bounciness** to **3**. A fast spring arrives quickly, and low bounciness keeps it calm.",
      target: INSPECTOR,
      check: (ctx) => {
        const speed = numberInput(ctx.component, "zoom_spring", "speed", 10);
        const bounciness = numberInput(ctx.component, "zoom_spring", "bounciness", 5);
        if (speed >= 16 && bounciness <= 5) return true;
        return { done: false, hint: speed >= 16 ? "Fast enough. Now bring Bounciness down to 5 or less." : bounciness <= 5 ? "Calm enough. Now raise Speed to 16 or more." : null };
      },
    },
    {
      id: "compare",
      title: "Compare the feel",
      body: "Tap the card again. Snappy suits buttons and toggles; bouncy suits playful moments. Engineers can copy matching SwiftUI, Android, and CSS values from the Inspector.",
      target: inViewer("card"),
      check: (ctx) => firedSince(ctx.fired, "tap_card.tap") > 0,
    },
  ],
  celebrate: {
    title: "You can tune feel",
    body: "Two numbers change how an interaction feels. When something feels mushy, raise Speed. When it feels stiff, add a little Bounciness.",
  },
};

export const LISTS_WITH_LOOPS: Lesson = {
  id: "lists-with-loops",
  number: 4,
  title: "Lists with loops",
  summary: "Turn one row into a whole list: a Loop copies a layer once for every index.",
  level: 3,
  minutes: 5,
  outcomes: ["Add a patch from the patch picker", "Make copies with a Loop", "Place each copy with its index"],
  guide: "07-loops",
  starter: listsWithLoopsStarter,
  steps: [
    {
      id: "loop",
      title: "Add a Loop",
      body: "Double-click empty space in the patch editor, or press **Insert patch** in its toolbar. Type **Loop** and press Return.",
      target: { selector: '.sb-pe button[aria-label="Insert patch"]' },
      prepare: (app) => showPatches(app),
      check: (ctx) => patchesOfType(ctx.component, "loop").length > 0,
    },
    {
      id: "count",
      title: "Choose how many rows",
      body: "Select the **Loop** and set **Count** to **5** in the Inspector. A Loop counts out indexes: 0, 1, 2, 3, 4.",
      target: (ctx) => {
        const loop = patchesOfType(ctx.component, "loop")[0];
        return loop && ctx.selection.patches.includes(loop) ? INSPECTOR : loop ? { selector: node(loop) } : null;
      },
      check: (ctx) => patchesOfType(ctx.component, "loop").some((id) => numberInput(ctx.component, id, "count", 3) >= 5),
    },
    {
      id: "index",
      title: "Place each copy by its index",
      body: "Drag the Loop's **Index** output onto the first **Value** input of **Row Spacing**. Row Spacing multiplies each index by 76, so every copy lands 76 points lower.",
      target: (ctx) => handleOf(patchesOfType(ctx.component, "loop")[0], "out:index"),
      check: (ctx) => patchesOfType(ctx.component, "loop").some((id) => isLinked(ctx.component, "row_spacing", "value1", id, "index")),
    },
    {
      id: "copies",
      title: "See the copies",
      body: "Look at the **Viewer**: the one **Row** layer now draws once for every index. Anything a loop feeds gets copied, one per item.",
      tip: "Nothing changed? Make sure the prototype is playing (the Play button in the toolbar).",
      target: { selector: "#sb-viewer" },
      check: (ctx) => ctx.copies("row") >= 5,
    },
    {
      id: "more",
      title: "Grow the list",
      body: "Set the Loop's **Count** to **8**. The list grows, and nothing else had to change.",
      target: INSPECTOR,
      check: (ctx) => patchesOfType(ctx.component, "loop").some((id) => numberInput(ctx.component, id, "count", 3) >= 8) && ctx.copies("row") >= 8,
    },
  ],
  celebrate: {
    title: "One layer, many copies",
    body: "Feeds, grids, page dots, and carousels all start like this. Next, try Loop Builder to give each copy its own text or color.",
  },
};

const copiedSince = (ctx: LessonContext, start: LessonContext, kinds: readonly ("setup" | "config" | "prompt")[]) => kinds.some((k) => (ctx.connect.copied[k] ?? 0) > (start.connect.copied[k] ?? 0));

export const BUILDING_WITH_CLAUDE: Lesson = {
  id: "building-with-claude",
  number: 5,
  title: "Building with Claude",
  summary: "Connect Claude Desktop or Claude Code on your own plan, then watch Claude work in your prototype.",
  level: 0,
  minutes: 6,
  outcomes: ["Connect Claude to Sonobe", "Start with a good prompt", "Review and undo what Claude changes"],
  guide: "11-working-with-claude",
  steps: [
    {
      id: "open",
      title: "Open Connect Claude",
      body: "Press **Connect Claude** in the toolbar. Sonobe works with Claude Desktop or Claude Code on your own Claude plan. There's no API key to paste.",
      target: { selector: ".sb-claudebtn" },
      check: (ctx, start) => ctx.connect.open || ctx.connect.openCount > start.connect.openCount,
    },
    {
      id: "setup",
      title: "Copy the setup",
      body: "Pick **Claude Code** or **Claude Desktop**, then press **Copy**. Run the command in a terminal, or paste the config into Claude Desktop and restart it.",
      target: { selector: ".sb-connect .sb-copyblock__button" },
      manual: "I've already set this up",
      prepare: (app) => app.openConnect(),
      check: (ctx, start) => copiedSince(ctx, start, ["setup", "config"]),
    },
    {
      id: "prompt",
      title: "Copy a starter prompt",
      body: "Under **Try asking**, copy a prompt and paste it into Claude. The Beginners prompts ask Claude to explain each patch as it goes.",
      target: { selector: ".sb-connect__prompts" },
      manual: "Skip this",
      prepare: (app) => app.openConnect(),
      check: (ctx, start) => copiedSince(ctx, start, ["prompt"]),
    },
    {
      id: "activity",
      title: "Find AI Activity",
      body: "Close the dialog and open **AI Activity** at the bottom of the window. Everything Claude changes shows up there, one undo step per change.",
      target: { selector: "#sb-hudx-tab-ai" },
      check: (ctx) => ctx.ui.hudTab === "ai" && !ctx.ui.hudCollapsed,
    },
    {
      id: "change",
      title: "Ask Claude for a change",
      body: "In Claude, ask: “Make the title bigger, then tell me what you changed.” The change appears in **AI Activity**, and Undo takes it back.",
      tip: "Claude reaches your open prototype through the desktop app. In a browser, save a project folder and use the headless command from Connect Claude.",
      target: { selector: "#sb-hud" },
      manual: "I'll try this later",
      check: (ctx, start) => ctx.agentChanges > start.agentChanges,
    },
  ],
  celebrate: {
    title: "Claude is on your team",
    body: "Ask Claude to build, to explain, or to check your work with a simulation. You stay in charge: every change is visible and undoable.",
  },
};

export const LESSONS: readonly Lesson[] = [FIRST_PROTOTYPE, STATES_AND_PULSES, SPRING_FEEL, LISTS_WITH_LOOPS, BUILDING_WITH_CLAUDE];

export function getLesson(id: string | null | undefined): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}

/** The lesson after `id`, if any. */
export function nextLesson(id: string): Lesson | undefined {
  const index = LESSONS.findIndex((l) => l.id === id);
  return index >= 0 ? LESSONS[index + 1] : undefined;
}
