# Animation

Making values move with the right feel.

Related: `graph-basics`, `gestures`, `simulation`

## ISAT

Most interactions chain four jobs, one patch each:

```text
Interaction ─▶ Switch ─▶ Animation (0…1, moving) ─▶ Transition ─▶ layer property
 (a pulse)     (state)                               (real units)
```

- Keep the animated value between 0 and 1, and convert to units only in the Transition.
- One spring can then drive many properties through several Transitions, and they all arrive together.
- Skip the Switch when the change should end on release: feed `down` straight into the Animation.

## Animation patches

| Patch                          | Feel                             | Inputs                                                                                                                   |
| ------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `popAnimation`                 | springy, quick to tune           | `number` (target), `bounciness` (default 5; 0 means no bounce), `speed` (default 10)                                     |
| `springAnimation`              | physical spring, gesture handoff | `number`, `mass`, `tension`, `friction`, `gestureActive`, `gestureVelocity`                                              |
| `springPreset`                 | named feels                      | `preset` (`smooth`, `snappy`, `bouncy`, `gentle`, `custom`) outputs values for either spring                             |
| `classicAnimation`             | fixed duration and easing        | `number`, `duration` (seconds), `curve` (`linear`, `quadraticInOut`, `cubicOut`, `exponentialOut`, `sinusoidalInOut`, …) |
| `transition`                   | maps 0…1 onto units              | `progress`, `start`, `end`; typeParam `number`, `point`, `size`, `color`, …                                              |
| `progress` / `reverseProgress` | ranges into 0…1, and 1 − x       | `value`, `start`, `end`, `clampToRange`                                                                                  |
| `delay` / `wait`               | timing                           | `delay` holds changes back; `wait` starts a timer on a pulse                                                             |

- Every animation patch has typeParam variants, so you can animate points and colors directly.
- A retargeted spring keeps its velocity, so interrupting it mid-flight looks natural.
- A classic animation restarts over its full duration.

## Example: slide in a menu and tint its button

```json tool:add_layers
{
  "layers": [
    {
      "type": "rectangle",
      "name": "Menu",
      "props": { "position": [-300, 0], "size": [300, 874], "color": "#1C1C1EFF" }
    },
    {
      "type": "rectangle",
      "name": "Menu Button",
      "props": { "position": [16, 62], "size": [44, 44], "cornerRadius": 22 }
    }
  ]
}
```

```json tool:add_patches
{
  "patches": [
    {
      "ref": "tap",
      "type": "interaction",
      "name": "Tap Menu Button",
      "inputs": { "layer": { "layer": "menu_button" } }
    },
    {
      "ref": "open",
      "type": "switch",
      "name": "Menu Open",
      "inputs": { "flip": { "link": "$tap.tap" } }
    },
    {
      "ref": "spring",
      "type": "popAnimation",
      "name": "Menu Spring",
      "inputs": { "number": { "link": "$open.on" }, "bounciness": 0, "speed": 14 }
    },
    {
      "ref": "slide",
      "type": "transition",
      "typeParam": "point",
      "name": "Menu Slide",
      "inputs": { "progress": { "link": "$spring.output" }, "start": [-300, 0], "end": [0, 0] }
    },
    {
      "ref": "tint",
      "type": "transition",
      "typeParam": "color",
      "name": "Button Tint",
      "inputs": {
        "progress": { "link": "$spring.output" },
        "start": "#E5E5EAFF",
        "end": "#007AFFFF"
      }
    }
  ],
  "connections": [
    { "from": "$slide.output", "to": "@menu.position" },
    { "from": "$tint.output", "to": "@menu_button.color" }
  ]
}
```

Tune the feel without rewiring:

```json tool:set_values
{ "updates": [{ "target": "menu_spring.bounciness", "value": 4 }] }
```

```text outline
layer menu rectangle "Menu" 300x874 position←menu_slide.output color=#1C1C1EFF
layer menu_button rectangle "Menu Button" @16,62 44x44 color←button_tint.output cornerRadius=22
patch menu_spring popAnimation<number> "Menu Spring" number←menu_open.on bounciness=4 speed=14
patch menu_slide transition<point> "Menu Slide" progress←menu_spring.output start=-300,0 end=0,0
patch button_tint transition<color> "Button Tint" progress←menu_spring.output start=#E5E5EAFF end=#007AFFFF
```

## Tuning with traces

- Trace the animated property after the gesture: `sim_trace` with targets `["@menu.position"]` and `durationMs` 1000, with a tap event on `@menu_button`.
- Each summary gives start, end, settle time and overshoot, and those numbers are what you tune against.
- **Snappy, no visible bounce:** Pop Animation with `bounciness` 0–3 and `speed` 14–20. Aim for overshoot near 0 and settle under 400 ms.
- **Playful:** `bounciness` 8–12. Expect 5–15% overshoot.
- **Overshoot on opacity** goes past 1 and flickers. Use `bounciness` 0, or `classicAnimation`, for fades.
- A property that **jumps instead of animating** usually has a Switch or Interaction wired straight into a Transition. Put an animation patch in between.
