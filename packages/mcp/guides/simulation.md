# Simulation

Checking your work by running the prototype.

Related: `start-here`, `gestures`, `animation`, `troubleshooting`

## Sessions

- `sim_reset` starts a deterministic simulation: fixed timestep (60 fps unless the document says 120), seeded randomness, and deterministic clock time.
- It steps frame 0 and returns a `simId`. Sessions are independent of each other and of the person's live viewer, and never change the document.
- Edits made after `sim_reset` hot-swap into the session on its next call (the result says so). Call `sim_reset` again for a clean start.

## Tools

| Tool             | Does                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `sim_dispatch`   | sends input and steps through it; reports hits and warnings                                                                       |
| `sim_step`       | advances `frames` or `ms`, or `until: "idle"`, or until a condition like `{ "target": "@card.scale", "op": ">=", "value": 1.07 }` |
| `sim_trace`      | samples targets every frame for `durationMs` with scheduled `events`; returns a table plus summaries                              |
| `sim_get_values` | current values right now                                                                                                          |
| `get_screenshot` | an image for visual QA (needs the Sonobe app)                                                                                     |

**Events** share one shape everywhere. `atMs` is the time from the start of the call.

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

## Reading traces

- By default, `sim_trace` runs on a **copy** from the session's current state, so the session doesn't move. Pass `advance: true` to move it.
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

## Limits

- Simulations read the root component only.
- A trace covers up to 60 s, and a step call covers up to 2 minutes.
- **Runtime issues** show up in results: a patch that isn't implemented yet (it outputs default values), script errors, and loop limits.
- **Platform services** (network, sound, camera) do nothing in simulation.
- **Screenshots** need the Sonobe app. Headless mode explains this and points to values and traces instead.
