/** 09 Drag and Snap: a picture-in-picture self view you can fling to any corner. The 2D version of the bottom sheet's chain. */

import { addLayer, addPatch, connect, gradient, gradientLayer, group, homeIndicator, layerRef, link, oval, palette, rect, SCREEN, shadow, statusBar, text, type } from "../lib/kit.ts";
import type { Recipe } from "../lib/recipe.ts";

const PIP: [number, number] = [120, 170];
const MARGIN = 16;
const TOP = 76;
const CONTROLS_Y = 764;
/** Top-left position of the self view in each corner. Item 0 is where it starts. */
export const CORNERS = {
  topRight: [SCREEN.width - MARGIN - PIP[0], TOP] as [number, number],
  topLeft: [MARGIN, TOP] as [number, number],
  bottomLeft: [MARGIN, CONTROLS_Y - MARGIN - PIP[1]] as [number, number],
  bottomRight: [SCREEN.width - MARGIN - PIP[0], CONTROLS_Y - MARGIN - PIP[1]] as [number, number],
};

function control(id: string, name: string, x: number, color: string, glyph: [number, number]): ReturnType<typeof group> {
  return group(id, name, { position: [x, 16], size: [60, 60], cornerRadius: 30, color }, [
    rect(`${id}_glyph`, "Glyph", { position: [30 - glyph[0] / 2, 30 - glyph[1] / 2], size: glyph, cornerRadius: 3, color: palette.white, hitTest: false }),
  ]);
}

export const dragAndSnap: Recipe = {
  folder: "09-drag-and-snap",
  name: "Drag and Snap",
  description: "Drag your self view during a video call and fling it toward any corner. It follows your finger, then glides to the corner a throw at that speed would reach.",
  guides: ["05-springs-and-feel", "06-gestures"],
  background: palette.night,
  notes:
    "Drag the small self view and let go, or flick it. Position Under Finger follows the finger from where it was grabbed; on release Nearest Corner After Fling projects the throw and Current Corner remembers it; Self View Spring glides there with the finger's velocity.",
  ops: () => [
    // The remote video
    addLayer(gradientLayer("remote_video", "Remote Video", gradient([[0, "#334155FF"], [1, "#0F172AFF"]]), { size: [SCREEN.width, SCREEN.height], hitTest: false })),
    addLayer(rect("remote_window", "Window Light", { position: [40, 160], size: [150, 220], cornerRadius: 12, color: "#FFFFFF14", hitTest: false })),
    addLayer(oval("remote_shoulders", "Shoulders", { position: [51, 470], size: [300, 380], color: "#1E3A8AFF", hitTest: false })),
    addLayer(oval("remote_head", "Head", { position: [131, 300], size: [140, 170], color: "#D6A77AFF", hitTest: false })),
    addLayer(oval("remote_hair", "Hair", { position: [121, 276], size: [160, 90], color: "#1C1917FF", hitTest: false })),
    addLayer(statusBar("app", "light")),
    addLayer(
      group("call_chip", "Call Chip", { position: [MARGIN, 68], size: [150, 36], cornerRadius: 18, color: "#0000004D", backgroundBlur: 16, hitTest: false }, [
        oval("call_chip_dot", "Live Dot", { position: [14, 13], size: [10, 10], color: palette.green }),
        text("call_chip_label", "Caller", "Jordan · 12:48", type.subhead, palette.white, { position: [32, 8] }),
      ]),
    ),
    addLayer(
      group("controls", "Controls", { position: [0, CONTROLS_Y], size: [SCREEN.width, SCREEN.height - CONTROLS_Y], color: "#00000059", backgroundBlur: 24, hitTest: false }, [
        control("mute_button", "Mute", 36, "#FFFFFF33", [8, 22]),
        control("camera_button", "Camera", 126, "#FFFFFF33", [24, 16]),
        control("flip_button", "Flip Camera", 216, "#FFFFFF33", [22, 22]),
        control("end_button", "End Call", 306, palette.red, [26, 8]),
      ]),
    ),
    addLayer(
      group("pip", "Self View", { position: CORNERS.topRight, size: PIP, cornerRadius: 20, clip: true, strokeColor: "#FFFFFF59", strokeWidth: 1.5, color: palette.nightSurface, ...shadow("glow", palette.black) }, [
        gradientLayer("pip_room", "Room", gradient([[0, "#FDBA74FF"], [1, "#9A3412FF"]]), { size: PIP }),
        oval("pip_shoulders", "Shoulders", { position: [10, 112], size: [100, 110], color: "#0F766EFF" }),
        oval("pip_head", "Head", { position: [36, 50], size: [48, 60], color: "#F1C27DFF" }),
      ]),
    ),
    addLayer(homeIndicator("app", "light")),

    // Measure the finger
    addPatch("pip_gesture", "gesture", "Drag Self View", { layer: layerRef("pip") }),
    addPatch("pip_idle", "not", "Not Dragging", { value: link("pip_gesture.down") }),
    addPatch("finger", "pulse", "Finger Down or Up", { on: link("pip_gesture.down") }),

    // Follow the finger from the grab point
    addPatch("pip_last_frame", "delay1", "Position Last Frame", {}, { typeParam: "point" }),
    addPatch("grab_position", "sampleAndHold", "Position at Grab", { value: link("pip_last_frame.output"), sample: link("pip_idle.output") }, { typeParam: "point" }),
    addPatch("finger_position", "add", "Position Under Finger", { value1: link("grab_position.output"), value2: link("pip_gesture.translation") }, { typeParam: "point", inputCount: 2 }),

    // Decide which corner on release
    addPatch("corners", "loopBuilder", "Corners", { item0: CORNERS.topRight, item1: CORNERS.topLeft, item2: CORNERS.bottomLeft, item3: CORNERS.bottomRight }, { typeParam: "point", inputCount: 4 }),
    addPatch("fling_corner", "snap", "Nearest Corner After Fling", { value: link("pip_last_frame.output"), velocity: link("pip_gesture.velocity"), mode: "points", points: link("corners.loop"), deceleration: "normal" }, { typeParam: "point" }),
    addPatch("current_corner", "counter", "Current Corner", { jump: link("finger.turnedOff"), jumpToNumber: link("fling_corner.index") }),
    addPatch("corner_position", "loopSelect", "Corner Position", { loop: link("corners.loop"), index: link("current_corner.count") }, { typeParam: "point" }),

    // Animate with the finger's velocity
    addPatch("pip_target", "ifElse", "Finger or Corner", { condition: link("pip_gesture.down"), ifTrue: link("finger_position.output"), ifFalse: link("corner_position.output") }, { typeParam: "point" }),
    addPatch("pip_spring", "springAnimation", "Self View Spring", { number: link("pip_target.output"), tension: 220, friction: 22, gestureActive: link("pip_gesture.down"), gestureVelocity: link("pip_gesture.velocity") }, { typeParam: "point" }),
    connect("pip_spring.output", "@pip.position"),
    connect("pip_spring.output", "pip_last_frame.value"),

    // Lift slightly while held
    addPatch("pip_press", "popAnimation", "Press Spring", { number: link("pip_gesture.down"), bounciness: 0, speed: 20 }),
    addPatch("pip_lift", "transition", "Lift While Held", { progress: link("pip_press.output"), start: 1, end: 1.06 }, { typeParam: "number" }),
    connect("pip_lift.output", "@pip.scale"),
  ],
};
