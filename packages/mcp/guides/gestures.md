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
- Targets are `"@layerId"` (the layer's center), `"@row#2"` for a loop copy, or `[x, y]` in points.
