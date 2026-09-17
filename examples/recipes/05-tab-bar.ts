/** 05 Tab Bar: four tabs. Option Switch remembers which one, Option Pickers turn that into positions, springs slide the screens and the indicator. */

import type { NewLayer, Op } from "@sonobe/core";
import { addLayer, addPatch, connect, gradient, gradientLayer, group, homeIndicator, layerRef, link, oval, palette, rect, SCREEN, shadow, statusBar, text, type } from "../lib/kit.ts";
import type { Recipe } from "../lib/recipe.ts";

const TAB_WIDTH = SCREEN.width / 4;
const INDICATOR_WIDTH = 56;
/** Left edge of the indicator pill under each tab. */
export const INDICATOR_X = [0, 1, 2, 3].map((i) => TAB_WIDTH / 2 + i * TAB_WIDTH - INDICATOR_WIDTH / 2);

const TABS = ["home", "explore", "saved", "profile"] as const;
const LABELS = { home: "Home", explore: "Explore", saved: "Saved", profile: "Profile" } as const;

/** Icon layers per tab, drawn from basic shapes. Each part is tinted by its tab's color, as a fill or as a stroke. */
function icon(tab: (typeof TABS)[number]): { layers: NewLayer[]; tinted: string[] } {
  const cx = TAB_WIDTH / 2;
  const off = { hitTest: false };
  switch (tab) {
    case "home":
      return {
        layers: [
          rect("home_icon_roof", "Roof", { position: [cx - 8, 12], size: [16, 16], rotation: 45, cornerRadius: 3, color: palette.ink3, ...off }),
          rect("home_icon", "House", { position: [cx - 10, 20], size: [20, 14], cornerRadius: 3, color: palette.ink3, ...off }),
        ],
        tinted: ["@home_icon_roof.color", "@home_icon.color"],
      };
    case "explore":
      return {
        layers: [
          oval("explore_icon", "Compass", { position: [cx - 11, 12], size: [22, 22], color: palette.clear, strokeColor: palette.ink3, strokeWidth: 2.5, ...off }),
          oval("explore_icon_dot", "Needle", { position: [cx - 3, 20], size: [6, 6], color: palette.ink3, ...off }),
        ],
        tinted: ["@explore_icon.strokeColor", "@explore_icon_dot.color"],
      };
    case "saved":
      return {
        layers: [rect("saved_icon", "Bookmark", { position: [cx - 8, 11], size: [16, 23], cornerRadius: 4, color: palette.ink3, ...off })],
        tinted: ["@saved_icon.color"],
      };
    case "profile":
      return {
        layers: [
          oval("profile_icon", "Head", { position: [cx - 6, 11], size: [12, 12], color: palette.ink3, ...off }),
          rect("profile_icon_body", "Body", { position: [cx - 10, 25], size: [20, 10], cornerRadius: 5, color: palette.ink3, ...off }),
        ],
        tinted: ["@profile_icon.color", "@profile_icon_body.color"],
      };
  }
}

function tabButton(tab: (typeof TABS)[number], index: number): NewLayer {
  return group(`tab_${tab}`, `${LABELS[tab]} Tab`, { position: [index * TAB_WIDTH, 0], size: [TAB_WIDTH, 90] }, [
    ...icon(tab).layers,
    text(`${tab}_label`, `${LABELS[tab]} Label`, LABELS[tab], { fontSize: 11, fontWeight: 600 }, palette.ink3, { position: [TAB_WIDTH / 2, 46], anchor: [0.5, 0], textAlignment: "center" }),
  ]);
}

function card(id: string, name: string, at: [number, number], size: [number, number], colors: [string, string], title: string, detail: string): NewLayer {
  return group(id, name, { position: at, size, cornerRadius: 24, clip: true, ...shadow("soft") }, [
    gradientLayer(`${id}_fill`, "Fill", gradient([[0, colors[0]], [1, colors[1]]], [0, 0], [1, 1]), { size }),
    text(`${id}_title`, "Title", title, type.headline, palette.white, { position: [20, size[1] - 56] }),
    text(`${id}_detail`, "Detail", detail, type.footnote, palette.white70, { position: [20, size[1] - 32] }),
  ]);
}

function screen(id: string, name: string, title: string, subtitle: string, children: NewLayer[]): NewLayer {
  return group(id, name, { size: [SCREEN.width, SCREEN.height] }, [
    text(`${id}_title`, "Title", title, type.largeTitle, palette.ink, { position: [24, 76] }),
    text(`${id}_subtitle`, "Subtitle", subtitle, type.callout, palette.ink2, { position: [24, 120] }),
    ...children,
  ]);
}

function savedRow(n: number, title: string, detail: string, colors: [string, string]): NewLayer {
  return group(`saved_row_${n}`, title, { position: [24, 164 + (n - 1) * 84], size: [354, 72], cornerRadius: 18, color: palette.surface, ...shadow("soft") }, [
    rect(`saved_row_${n}_thumb`, "Thumbnail", { position: [12, 12], size: [48, 48], cornerRadius: 12, gradient: gradient([[0, colors[0]], [1, colors[1]]], [0, 0], [1, 1]) }),
    text(`saved_row_${n}_title`, "Title", title, type.headline, palette.ink, { position: [76, 15] }),
    text(`saved_row_${n}_detail`, "Detail", detail, type.footnote, palette.ink2, { position: [76, 39] }),
  ]);
}

function tabTint(tab: (typeof TABS)[number], index: number): Op[] {
  const targets = [...icon(tab).tinted, `@${tab}_label.textColor`];
  return [
    addPatch(`${tab}_selected`, "equals", `${LABELS[tab]} Selected`, { value1: link("current_tab.option"), value2: index }, { typeParam: "number" }),
    addPatch(`${tab}_tint_spring`, "popAnimation", `${LABELS[tab]} Tint Spring`, { number: link(`${tab}_selected.output`), bounciness: 0, speed: 20 }),
    addPatch(`${tab}_tint`, "transition", `${LABELS[tab]} Tint`, { progress: link(`${tab}_tint_spring.output`), start: palette.ink3, end: palette.indigo }, { typeParam: "color" }),
    ...targets.map((to) => connect(`${tab}_tint.output`, to)),
  ];
}

export const tabBar: Recipe = {
  folder: "05-tab-bar",
  name: "Tab Bar",
  description: "Four tabs that slide between screens. Option Switch remembers the tab, Option Pickers turn it into positions, and springs move the screens and the indicator.",
  guides: ["02-isat", "03-states-and-pulses"],
  background: palette.canvas,
  notes:
    "Tap a tab. Each tab's Tap pulses one Set to input on Current Tab; Screen Offset and Indicator X pick a position for that tab, and two Pop Animations slide there. Each tab's tint reads Equals on the same option number.",
  ops: () => [
    addLayer(
      group("screens", "Screens", { size: [SCREEN.width * 4, SCREEN.height], layout: "row" }, [
        screen("screen_home", "Home Screen", "Good morning", "Tuesday · 3 things today", [
          card("focus_card", "Focus Card", [24, 164], [354, 200], ["#8B5CF6FF", "#5B5CF6FF"], "Focus session", "25 min · starts 9:30"),
          card("walk_card", "Walk Card", [24, 384], [167, 150], ["#FF9A62FF", "#FF3D71FF"], "Walk", "4,210 steps"),
          card("water_card", "Water Card", [211, 384], [167, 150], ["#5EEAD4FF", "#14B8A6FF"], "Water", "5 of 8 cups"),
        ]),
        screen("screen_explore", "Explore Screen", "Explore", "Pick something new", [
          card("design_tile", "Design Tile", [24, 164], [167, 200], ["#FDE68AFF", "#F59E0BFF"], "Design", "128 lessons"),
          card("music_tile", "Music Tile", [211, 164], [167, 200], ["#A5B4FCFF", "#6366F1FF"], "Music", "86 lessons"),
          card("travel_tile", "Travel Tile", [24, 384], [167, 200], ["#7DD3FCFF", "#0284C7FF"], "Travel", "54 guides"),
          card("food_tile", "Food Tile", [211, 384], [167, 200], ["#FCA5A5FF", "#EF4444FF"], "Food", "210 recipes"),
        ]),
        screen("screen_saved", "Saved Screen", "Saved", "4 items", [
          savedRow(1, "Morning stretch", "Routine · 12 min", ["#86EFACFF", "#16A34AFF"]),
          savedRow(2, "Lemon ricotta pasta", "Recipe · 25 min", ["#FDE68AFF", "#EAB308FF"]),
          savedRow(3, "Night Drive", "Playlist · 18 songs", ["#F0ABFCFF", "#8B5CF6FF"]),
          savedRow(4, "Kyoto in autumn", "Guide · 7 days", ["#FDBA74FF", "#DB2777FF"]),
        ]),
        screen("screen_profile", "Profile Screen", "Profile", "Member since 2024", [
          oval("profile_avatar", "Avatar", { position: [153, 170], size: [96, 96], gradient: gradient([[0, "#8B5CF6FF"], [1, "#FF3D71FF"]], [0, 0], [1, 1]), ...shadow("soft") }),
          text("profile_name", "Name", "Ari Lopez", type.title2, palette.ink, { position: [SCREEN.width / 2, 286], anchor: [0.5, 0], textAlignment: "center" }),
          text("profile_handle", "Handle", "@ari", type.callout, palette.ink2, { position: [SCREEN.width / 2, 318], anchor: [0.5, 0], textAlignment: "center" }),
          card("stats_card", "Stats Card", [24, 370], [354, 120], ["#1A1B2AFF", "#0E0F1AFF"], "42 day streak", "Longest this year"),
        ]),
      ]),
    ),
    addLayer(statusBar("app", "dark")),
    addLayer(
      group("tab_bar", "Tab Bar", { position: [0, SCREEN.height - 90], size: [SCREEN.width, 90], color: "#FFFFFFF2", backgroundBlur: 20, shadowColor: palette.black, shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: [0, -4] }, [
        rect("tab_bar_divider", "Divider", { size: [SCREEN.width, 1], color: palette.hairline, hitTest: false }),
        rect("indicator", "Indicator", { position: [INDICATOR_X[0]!, 6], size: [INDICATOR_WIDTH, 36], cornerRadius: 18, color: "#5B5CF61F", hitTest: false }),
        ...TABS.map((tab, i) => tabButton(tab, i)),
      ]),
    ),
    addLayer(homeIndicator("app", "dark")),

    // Interaction → Option Switch
    ...TABS.map((tab) => addPatch(`tap_${tab}`, "interaction", `Tap ${LABELS[tab]}`, { layer: layerRef(`tab_${tab}`) })),
    addPatch("current_tab", "optionSwitch", "Current Tab", Object.fromEntries(TABS.map((tab, i) => [`setTo${i}`, link(`tap_${tab}.tap`)])), { inputCount: 4 }),

    // Option Picker → Pop Animation → layer
    addPatch("screen_offset", "optionPicker", "Screen Offset", { option: link("current_tab.option"), option0: 0, option1: -SCREEN.width, option2: -2 * SCREEN.width, option3: -3 * SCREEN.width }, { typeParam: "number", inputCount: 4 }),
    addPatch("screen_spring", "popAnimation", "Screen Spring", { number: link("screen_offset.output"), bounciness: 0, speed: 16 }),
    addPatch("screens_position", "point", "Screens Position", { x: link("screen_spring.output"), y: 0 }),
    connect("screens_position.output", "@screens.position"),
    addPatch("indicator_offset", "optionPicker", "Indicator X", { option: link("current_tab.option"), option0: INDICATOR_X[0]!, option1: INDICATOR_X[1]!, option2: INDICATOR_X[2]!, option3: INDICATOR_X[3]! }, { typeParam: "number", inputCount: 4 }),
    addPatch("indicator_spring", "popAnimation", "Indicator Spring", { number: link("indicator_offset.output"), bounciness: 5, speed: 14 }),
    addPatch("indicator_position", "point", "Indicator Position", { x: link("indicator_spring.output"), y: 6 }),
    connect("indicator_position.output", "@indicator.position"),

    // Tints: each tab asks "am I the current tab?"
    ...TABS.flatMap((tab, i) => tabTint(tab, i)),
  ],
};
