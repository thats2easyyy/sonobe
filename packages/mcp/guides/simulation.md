# Simulation

Checking your work by running the prototype.

Related: `start-here`, `gestures`, `animation`, `troubleshooting`

## Sessions

- `sim_reset` starts a deterministic simulation: fixed timestep (60 fps unless the document says 120), seeded randomness, and deterministic clock time.
- It steps frame 0 and returns a `simId`. Sessions are independent of each other and of the person's live viewer, and never change the document.
- Edits made after `sim_reset` hot-swap into the session on its next call (the result says so) and are laid out without advancing time. Call `sim_reset` again for a clean start.

## Tools

| Tool             | Does                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `sim_dispatch`   | sends input and steps through it; reports hits and warnings                                                                       |
| `sim_step`       | advances `frames` or `ms`, or `until: "idle"`, or until a condition like `{ "target": "@card.scale", "op": ">=", "value": 1.07 }` |
| `sim_trace`      | samples targets every frame for `durationMs` with scheduled `events`; returns a table plus summaries                              |
| `sim_get_values` | current values right now                                                                                                          |
| `sim_override`   | changes values inside this simulation only, never the person's document (see Overrides)                                           |
| `get_screenshot` | a PNG of the screen or one layer, at the session's frame or `atMs` later (see Screenshots)                                        |

**Events** share one shape everywhere. `atMs` is the time from the start of the call. Each input finds its target when it fires, so a tap at `atMs` 400 hits whatever is on screen by then, and the hit report describes that moment. A layer that isn't in the frame yet (a loop with fewer copies) is skipped with a warning.

```json events
[
  { "kind": "tap", "target": "@card", "holdMs": 50 },
  { "kind": "longPress", "target": "@photo", "durationMs": 600 },
  { "kind": "drag", "from": "@knob", "to": [300, 422], "durationMs": 300, "release": true },
  { "kind": "hover", "target": "@button" },
  { "kind": "scroll", "target": "@feed", "dy": -400 },
  { "kind": "key", "key": "Space" },
  { "kind": "text", "layer": "name_field", "value": "Ada" },
  { "kind": "pointer", "phase": "down", "x": 201, "y": 437, "atMs": 100 },
  { "kind": "orientation", "orientation": "landscape" }
]
```

**Addresses:**

- `patchId.port` reads patch outputs and inputs.
- `@layerId.prop` reads resolved layer properties and layer outputs.
- A `#n` suffix picks one loop copy (`@row.position#2`).
- Inside a component instance, put the instance path first: `like_button_2/liked.on`, `@like_button_2/like_button.color`. Paths chain through nested instances, and `card#2/...` picks copy 2 of a looped instance. `get_items` takes the same paths.

## Reading traces

- By default, `sim_trace` runs on a **copy** from the session's current state, so the session doesn't move. Pass `advance: true` to move it; the session then keeps going until the trace's events finish, so a drag longer than the trace still releases.
- The copy replays everything since `sim_reset`, so it gets slower as a session runs. After about 20,000 steps there's no copy to make: `sim_trace` refuses with the error code "sim_copy_unavailable". Pass `advance: true`, or `sim_reset` and replay the interaction.
- `t_ms` counts frames from the start of the trace, so it keeps rising even when Restart Prototype fires.
- Rows are evenly sampled down to `maxRows`; summaries always use every frame.
- **start / end:** the first and last sampled values.
- **settled by:** when the value came within 0.1% of its final value and stayed. "Still moving" means extend `durationMs`.
- **overshoot:** how far it went past the end value, also as a percent of the distance moved.
- **range:** the min and max. For vectors, summaries use the component that moves most.

## Example: press feedback

```json tool:apply_ops
{
  "ops": [
    {
      "op": "addLayer",
      "layer": {
        "ref": "button",
        "type": "rectangle",
        "name": "Button",
        "props": { "position": [121, 700], "size": [160, 56], "cornerRadius": 28 }
      }
    },
    {
      "op": "addPatch",
      "patch": {
        "ref": "press",
        "type": "interaction",
        "name": "Press Button",
        "inputs": { "layer": { "layer": "$button" } }
      }
    },
    {
      "op": "addPatch",
      "patch": {
        "ref": "spring",
        "type": "popAnimation",
        "name": "Press Spring",
        "inputs": { "number": { "link": "$press.down" }, "bounciness": 0, "speed": 20 }
      }
    },
    {
      "op": "addPatch",
      "patch": {
        "ref": "shrink",
        "type": "transition",
        "name": "Press Scale",
        "inputs": { "progress": { "link": "$spring.output" }, "start": 1, "end": 0.94 }
      }
    },
    { "op": "connect", "from": "$shrink.output", "to": "@$button.scale" }
  ]
}
```

```json tool:sim_reset
{}
```

Hold for half a second, release, and watch the scale go down and come back:

```json tool:sim_trace
{
  "simId": "sim_1",
  "targets": ["@button.scale", "press_button.down"],
  "durationMs": 1200,
  "events": [{ "kind": "longPress", "target": "@button", "durationMs": 500, "atMs": 100 }],
  "maxRows": 12
}
```

```json tool:sim_step
{ "simId": "sim_1", "until": "idle", "watch": ["@button.scale"] }
```

## Screenshots

- `get_screenshot` draws `"viewer"` (the whole screen) or `"@layerId"` (the screen cropped to one layer's box, so layers in front still cover it; `"@row#2"` for a loop copy).
- `isolate: true` with a layer target draws only that layer and its children, where they are. That's how to see the card under the top card: isolate `"@card_2"`, or `"@card#2"` for a loop copy.
- With `simId` it shows that session's current frame, overrides included. `atMs` shows the frame that many milliseconds later, drawn on a copy, so the session doesn't move.
- Headless servers draw the screen without the app. Text uses approximate metrics, and video, Lottie and shaders show placeholders; the result's notes list what's approximate. Without `simId`, a headless screenshot shows the prototype once its start-up animations settle (up to 5 s), or `atMs` after it starts.
- Use screenshots to check the look. For timing and exact values, trust `sim_trace` and `sim_get_values`.

Press the button again and look at it mid-press:

```json tool:sim_dispatch
{ "simId": "sim_1", "events": [{ "kind": "pointer", "phase": "down", "x": 201, "y": 728 }] }
```

```json tool:get_screenshot
{ "simId": "sim_1", "target": "@button", "atMs": 300 }
```

## Overrides

To look under a layer or try a value, change it in the simulation with `sim_override` instead of editing and undoing. The person's document, live viewer, undo history and saved files stay as they are.

- `set` pins values on patch inputs and layer properties (null for the default). `ops` takes value ops: `setInput`, `connect`, `disconnect`, `updateLayer` with `props`, and `updatePatch` with `muted`. Setting a target again replaces its override; pinning a connected input replaces the connection in the simulation.
- An override changes the layer or patch itself, so it applies to every loop copy and every instance of a component: `"@card/badge.opacity"` changes the component `card` runs. A `#n` target is refused; to see one copy alone, take an isolated screenshot.
- Overrides stay on through the person's edits. When an edit makes one impossible (its layer was deleted), it's dropped and the next result says so.
- `clear` takes override ids (`"ov_2"`), targets, or `"all"`. `sim_reset` clears them unless you pass `keepOverrides: true`. `restart: true` starts the simulation over from frame 0 with them.
- Results count them in the header, `sim_get_values` marks overridden values, and screenshots say when they show overrides the person's document doesn't have.

Try a bouncier press and a squarer button, without touching the document:

```json tool:sim_override
{
  "simId": "sim_1",
  "set": [{ "target": "press_spring.bounciness", "value": 12 }],
  "ops": [{ "op": "updateLayer", "id": "button", "props": { "cornerRadius": 8 } }]
}
```

```json tool:get_screenshot
{ "simId": "sim_1", "target": "@button", "isolate": true }
```

One loop copy can't be overridden on its own:

```json tool-error:sim_override
{ "simId": "sim_1", "set": [{ "target": "@button.opacity#2", "value": 0 }] }
```

```json tool:sim_override
{ "simId": "sim_1", "clear": "all" }
```

## Limits

- A trace covers up to 60 s, and a step call covers up to 2 minutes.
- **Runtime issues** show up in results: a patch that isn't implemented yet (it outputs default values), script errors, and loop limits.
- **Platform services** (network, sound, camera) do nothing in simulation.
