# Gestures

Turning touches, drags, hovers and keys into values.

Related: `animation`, `simulation`, `troubleshooting`

## Who receives a touch

- Hit tests run front to back. The front-most layer under the finger catches the touch, and it **bubbles to that layer's parents**, never to layers behind it.
- A layer receives touches only when `enabled` is on, `opacity` is above 0, and `hitTest` (Receives Touches) is on.
- Use a `hitArea` layer for an invisible or bigger target, and `hitSlop` to enlarge small targets.
- Text in front of a card blocks the card. Group them and listen to the group, or turn off `hitTest` on the text.
- A patch with no `layer` input set listens to the whole screen.

## Gesture patches

| Patch         | Use it for                             | Key outputs                                                           |
| ------------- | -------------------------------------- | --------------------------------------------------------------------- |
| `interaction` | press and tap                          | `down` (state), `tap` (pulse on release), `position`, `localPosition` |
| `tapToggle`   | tap flips on/off, in one patch         | `on`, `turnedOn`, `turnedOff`                                         |
| `longPress`   | hold still for `duration` seconds      | `longPress` (state), `progress`, `tap` (quick tap)                    |
| `swipe`       | a press that ends in a swipe           | `swiped`, `swipedLeft`/`Right`/`Up`/`Down` (pulses)                   |
| `drag`        | move a layer with the finger           | `position`, `dragging`, `velocity`                                    |
| `gesture`     | follow the finger, then fling          | `translation`, `velocity`, `down`                                     |
| `scroll`      | scroll content with momentum or paging | `position`, `x`, `y`, `pageX`, `pageY`                                |
| `hover`       | the mouse is over a layer (desktop)    | `hovering`, `position`                                                |
| `keyboard`    | a key is held (desktop)                | `down` (state)                                                        |

Gesture patches only compute values. Nothing moves until you connect an output to a layer property (`drag.position` into `@knob.position`) or into the logic.

- **Down or Tap?** `down` turns off when the finger lifts: good for "pressed" feedback. When the change should stay, wire `tap` into a Switch's `flip`.
- **Several gestures, one effect.** An input takes one connection, so merge the pulses with `or` and wire its output into the Switch. Merge `tap` pulses, not `down` states: a held state keeps Or on, and nothing downstream sees the next tap. For a loop of taps (one per copy), use `loopAny`.

```json tool:add_layers
{
  "layers": [
    { "type": "rectangle", "name": "Close", "props": { "position": [334, 62], "size": [44, 44] } },
    { "type": "rectangle", "name": "Scrim", "props": { "position": [0, 760], "size": [402, 114] } }
  ]
}
```

```json tool:add_patches
{
  "patches": [
    { "ref": "a", "type": "interaction", "name": "Tap Close", "inputs": { "layer": { "layer": "close" } } },
    { "ref": "b", "type": "interaction", "name": "Tap Scrim", "inputs": { "layer": { "layer": "scrim" } } },
    {
      "ref": "any",
      "type": "or",
      "name": "Dismiss Tapped",
      "inputs": { "value1": { "link": "$a.tap" }, "value2": { "link": "$b.tap" } }
    },
    { "ref": "gone", "type": "switch", "name": "Dismissed", "inputs": { "turnOn": { "link": "$any.output" } } }
  ]
}
```

```text outline
patch dismiss_tapped or×2 "Dismiss Tapped" value1←tap_close.tap value2←tap_scrim.tap
patch dismissed switch "Dismissed" turnOn←dismiss_tapped.output
```

## Example: a slider knob

```json tool:add_layers
{
  "layers": [
    {
      "type": "rectangle",
      "name": "Track",
      "props": { "position": [40, 420], "size": [322, 4], "color": "#D1D1D6FF" }
    },
    {
      "type": "oval",
      "name": "Knob",
      "props": { "position": [40, 400], "size": [44, 44], "color": "#007AFFFF" }
    }
  ]
}
```

`startPosition` matches where the knob is drawn. `min` and `max` bound the position itself, and `clip` keeps it inside them.

```json tool:add_patches
{
  "patches": [
    {
      "ref": "slide",
      "type": "drag",
      "name": "Slide Knob",
      "inputs": {
        "layer": { "layer": "knob" },
        "startPosition": [40, 400],
        "axis": "horizontal",
        "clip": true,
        "min": [18, 400],
        "max": [340, 400]
      }
    }
  ],
  "connections": [{ "from": "$slide.position", "to": "@knob.position" }]
}
```

```text outline
layer knob oval "Knob" 44x44 position←slide_knob.position color=#007AFFFF
patch slide_knob drag "Slide Knob" layer=@knob startPosition=40,400 axis=horizontal clip=true min=18,400 max=340,400
```

## Example: hold a photo to peek

```json tool:add_layers
{
  "layers": [
    {
      "type": "rectangle",
      "name": "Photo",
      "props": { "position": [51, 520], "size": [300, 200], "cornerRadius": 16 }
    }
  ]
}
```

```json tool:add_patches
{
  "patches": [
    {
      "ref": "hold",
      "type": "longPress",
      "name": "Hold Photo",
      "inputs": { "layer": { "layer": "photo" }, "duration": 0.4 }
    },
    {
      "ref": "pop",
      "type": "popAnimation",
      "name": "Peek Spring",
      "inputs": { "number": { "link": "$hold.longPress" }, "bounciness": 8, "speed": 12 }
    },
    {
      "ref": "grow",
      "type": "transition",
      "name": "Peek Scale",
      "inputs": { "progress": { "link": "$pop.output" }, "start": 1, "end": 1.1 }
    }
  ],
  "connections": [{ "from": "$grow.output", "to": "@photo.scale" }]
}
```

```text outline
patch hold_photo longPress "Hold Photo" layer=@photo duration=0.4
patch peek_spring popAnimation<number> "Peek Spring" number←hold_photo.longPress bounciness=8 speed=12
```

## Example: fling a card, then spring it home

Hand the finger's speed to the spring so a flick carries through instead of stopping dead.

```json tool:add_layers
{
  "layers": [
    {
      "type": "group",
      "name": "Stage",
      "props": { "position": [37, 250], "size": [328, 420] },
      "children": [{ "type": "rectangle", "name": "Card", "props": { "size": [328, 420] } }]
    }
  ]
}
```

```json tool:add_patches
{
  "patches": [
    { "ref": "touch", "type": "gesture", "name": "Touch Card", "inputs": { "layer": { "layer": "card" } } },
    {
      "ref": "follow", "type": "springAnimation", "typeParam": "point", "name": "Card Follow",
      "inputs": {
        "number": { "link": "$touch.translation" },
        "gestureActive": { "link": "$touch.down" }, "gestureVelocity": { "link": "$touch.velocity" }
      }
    }
  ],
  "connections": [{ "from": "$follow.output", "to": "@card.position" }]
}
```

- While `down` is on, `gestureActive` makes the spring follow `translation` exactly. On release the target returns to 0,0 and the spring starts at the finger's `velocity`.
- Wire the gesture's own `velocity`. A `velocity` patch on a position reads 0 on the release frame.

```json tool:sim_reset
{}
```

```json tool:sim_trace
{
  "simId": "sim_1", "targets": ["@card.position"], "durationMs": 1000, "maxRows": 10,
  "events": [{ "kind": "drag", "from": "@card", "to": [360, 700], "durationMs": 120 }]
}
```

## Simulating gestures

```json events
[
  { "kind": "drag", "from": "@knob", "to": [300, 422], "durationMs": 300 },
  { "kind": "longPress", "target": "@photo", "durationMs": 600, "atMs": 500 },
  { "kind": "hover", "target": "@knob", "atMs": 1200 },
  { "kind": "key", "key": "Space", "atMs": 1300 }
]
```

- `sim_dispatch` reports which layer each touch hit and which interaction patches heard it.
- It warns when a touch hits nothing (naming the nearest layer with a touch patch) or when another layer sits in front of the target.
- Targets are `"@layerId"` (the layer's center), `"@row#2"` for a loop copy, `"@like_button_2/like_button"` for a layer inside a component instance, or `[x, y]` in points.
- `scroll` hovers the pointer over the target before the wheel turns, as a real mouse does, so `scroll` patches take it.
