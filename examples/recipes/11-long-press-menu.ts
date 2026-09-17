/** 11 Long-Press Menu: hold a chat message to open a context menu. The bubble squeezes while you hold; tapping anywhere closes it. */

import type { NewLayer } from "@sonobe/core";
import { addLayer, addPatch, connect, group, homeIndicator, layerRef, link, oval, palette, rect, SCREEN, shadow, statusBar, text, type } from "../lib/kit.ts";
import type { Recipe } from "../lib/recipe.ts";

export const HOLD_SECONDS = 0.45;

function bubble(id: string, name: string, content: string, side: "left" | "right", y: number, width: number): NewLayer {
  const mine = side === "right";
  return group(id, name, { position: [mine ? SCREEN.width - 16 - width : 16, y], size: [width, 44], cornerRadius: 20, color: mine ? palette.indigo : palette.surface, hitTest: false, ...shadow("soft") }, [
    text(`${id}_text`, "Text", content, type.callout, mine ? palette.white : palette.ink, { position: [16, 11] }),
  ]);
}

function menuRow(n: number, label: string, color: string, glyph: NewLayer): NewLayer {
  return group(`menu_row_${n}`, label, { position: [0, (n - 1) * 46], size: [230, 46] }, [
    text(`menu_row_${n}_label`, "Label", label, { fontSize: 16, fontWeight: 500 }, color, { position: [16, 13] }),
    glyph,
    ...(n < 4 ? [rect(`menu_row_${n}_divider`, "Divider", { position: [0, 45], size: [230, 1], color: palette.hairline, hitTest: false })] : []),
  ]);
}

export const longPressMenu: Recipe = {
  folder: "11-long-press-menu",
  name: "Long-Press Menu",
  description: "Hold a chat message and it squeezes, then a context menu springs out while the chat dims. A quick tap does nothing; tapping anywhere closes the menu.",
  guides: ["03-states-and-pulses", "06-gestures"],
  background: "#EEF0F5FF",
  notes:
    "Press and hold the message that says Dinner at 8. Hold Message reports progress while you hold and turns Long Press on after 0.45 seconds, which turns Menu Open on. The whole overlay listens for taps, so tapping the backdrop or any action turns it off.",
  ops: () => [
    addLayer(
      group("chat_header", "Chat Header", { size: [SCREEN.width, 120], color: palette.surface, hitTest: false }, [
        rect("chat_back_top", "Back Chevron Top", { position: [18, 76], size: [12, 3], rotation: -45, cornerRadius: 1.5, color: palette.indigo }),
        rect("chat_back_bottom", "Back Chevron Bottom", { position: [18, 84], size: [12, 3], rotation: 45, cornerRadius: 1.5, color: palette.indigo }),
        oval("chat_avatar", "Avatar", { position: [46, 64], size: [40, 40], color: palette.teal }),
        text("chat_name", "Name", "Priya", type.headline, palette.ink, { position: [96, 65] }),
        text("chat_status", "Status", "online", type.footnote, palette.green, { position: [96, 87] }),
        rect("chat_header_divider", "Divider", { position: [0, 119], size: [SCREEN.width, 1], color: palette.hairline }),
      ]),
    ),
    addLayer(statusBar("app", "dark")),
    addLayer(bubble("msg_1", "Message 1", "Are we still on for tonight?", "left", 150, 236)),
    addLayer(bubble("msg_2", "Message 2", "Yes! Leaving work at 7", "right", 206, 196)),
    addLayer(bubble("msg_3", "Message 3", "Perfect", "left", 262, 88)),
    addLayer(bubble("msg_5", "Message 5", "Amazing. See you there", "right", 620, 200)),
    addLayer(
      group("composer", "Composer", { position: [16, 790], size: [370, 44], cornerRadius: 22, color: palette.surface, hitTest: false }, [
        text("composer_placeholder", "Placeholder", "Message", type.callout, palette.ink3, { position: [18, 11] }),
      ]),
    ),

    // The overlay: backdrop and menu, invisible (and untouchable) until the menu opens
    addLayer(
      group("overlay", "Overlay", { size: [SCREEN.width, SCREEN.height], opacity: 0 }, [
        rect("backdrop", "Backdrop", { size: [SCREEN.width, SCREEN.height], color: "#0E0F1A59", backgroundBlur: 14 }),
        group("menu", "Menu", { position: [16, 412], size: [230, 184], cornerRadius: 16, clip: true, color: palette.surface, pivot: [0, 0], ...shadow("glow", palette.black) }, [
          menuRow(1, "Reply", palette.ink, rect("menu_reply_glyph", "Reply Glyph", { position: [196, 17], size: [16, 12], cornerRadius: 3, color: palette.clear, strokeColor: palette.ink, strokeWidth: 2, hitTest: false })),
          menuRow(2, "Copy", palette.ink, rect("menu_copy_glyph", "Copy Glyph", { position: [198, 14], size: [13, 16], cornerRadius: 3, color: palette.clear, strokeColor: palette.ink, strokeWidth: 2, hitTest: false })),
          menuRow(3, "Pin", palette.ink, oval("menu_pin_glyph", "Pin Glyph", { position: [197, 15], size: [14, 14], color: palette.clear, strokeColor: palette.ink, strokeWidth: 2, hitTest: false })),
          menuRow(4, "Delete", palette.red, rect("menu_delete_glyph", "Delete Glyph", { position: [198, 14], size: [13, 17], cornerRadius: 2, color: palette.clear, strokeColor: palette.red, strokeWidth: 2, hitTest: false })),
        ]),
      ]),
    ),

    // The held message sits above the overlay so it stays sharp
    addLayer(
      group("message", "Held Message", { position: [16, 318], size: [300, 64], cornerRadius: 22, color: palette.surface, pivot: [0, 0.5], ...shadow("soft") }, [
        text("message_text", "Text", "Dinner at 8? I booked the", type.callout, palette.ink, { position: [16, 11] }),
        text("message_text_2", "Text Line 2", "corner table.", type.callout, palette.ink, { position: [16, 32] }),
      ]),
    ),
    addLayer(homeIndicator("app", "dark")),

    // Hold → squeeze while holding, open once held long enough
    addPatch("hold_message", "longPress", "Hold Message", { layer: layerRef("message"), duration: HOLD_SECONDS }),
    addPatch("squeeze_spring", "popAnimation", "Squeeze Spring", { number: link("hold_message.progress"), bounciness: 8, speed: 16 }),
    addPatch("message_squeeze", "transition", "Message Squeeze", { progress: link("squeeze_spring.output"), start: 1, end: 0.94 }, { typeParam: "number" }),
    connect("message_squeeze.output", "@message.scale"),

    addPatch("tap_overlay", "interaction", "Tap Outside or an Action", { layer: layerRef("overlay") }),
    addPatch("menu_open", "switch", "Menu Open", { turnOn: link("hold_message.longPress"), turnOff: link("tap_overlay.tap") }),

    // Spring the menu's scale, fade with a fixed duration (no overshoot on opacity)
    addPatch("menu_spring", "popAnimation", "Menu Spring", { number: link("menu_open.on"), bounciness: 6, speed: 18 }),
    addPatch("menu_scale", "transition", "Menu Scale", { progress: link("menu_spring.output"), start: 0.7, end: 1 }, { typeParam: "number" }),
    addPatch("menu_fade", "classicAnimation", "Menu Fade", { number: link("menu_open.on"), duration: 0.18, curve: "cubicOut" }, { typeParam: "number" }),
    connect("menu_scale.output", "@menu.scale"),
    connect("menu_fade.output", "@overlay.opacity"),
  ],
};
