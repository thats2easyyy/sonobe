# Components

Reusing layers and logic.

Related: `graph-basics`, `loops`, `troubleshooting`

## Kinds

- A **layer component** (`layerComponent`) is a set of layers plus the patches that drive them. It appears in other components as a `componentInstance` layer with `"component": "<id>"`.
- A **patch component** (`patchComponent`) is logic only. It runs as a patch of type `component` with `"component": "<id>"`.
- **Published inputs** (`updateInterface` `inputs`) become props on instance layers or input ports on instance patches. Inside the component, read them as `$in.key`.
- **Published outputs** (`updateInterface` `outputs`) are driven inside by connecting to `$out.key`. Outside, they're outputs of the instance: `save_press.scale`, or `@instance.key` for a layer instance.
- Every instance shares the component's definition. Make per-instance differences into published inputs.

## Turning existing items into a component

`create_component` moves layers and patches into a new component and leaves an instance wired the same way. Connections that cross the boundary become published ports automatically.

```json tool:add_layers
{
  "layers": [
    {
      "type": "rectangle",
      "name": "Like Button",
      "props": {
        "position": [171, 400],
        "size": [60, 60],
        "cornerRadius": 30,
        "color": "#E5E5EAFF"
      }
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
      "name": "Tap Like",
      "inputs": { "layer": { "layer": "like_button" } }
    },
    {
      "ref": "liked",
      "type": "switch",
      "name": "Liked",
      "inputs": { "flip": { "link": "$tap.tap" } }
    },
    {
      "ref": "tint",
      "type": "transition",
      "typeParam": "color",
      "name": "Like Tint",
      "inputs": { "progress": { "link": "$liked.on" }, "start": "#E5E5EAFF", "end": "#FF3B5CFF" }
    }
  ],
  "connections": [{ "from": "$tint.output", "to": "@like_button.color" }]
}
```

```json tool:create_component
{
  "name": "Like Button",
  "layerIds": ["like_button"],
  "patchIds": ["tap_like", "liked", "like_tint"]
}
```

```text outline
layer like_button_2 componentInstance:like_button "Like Button" @171,400 60x60
component like_button "Like Button" (layerComponent) 60x60
patch liked switch "Liked" flip←tap_like.tap
```

The new component gets id `like_button`; the instance layer in `main` gets `like_button_2`. Read inside with `get_outline` and `component: "like_button"`.

## Inside instances

Simulations and `get_items` reach into an instance through its **instance path**: the instance id, a slash, then the address inside (`#n` picks a copy of a looped instance).

```json tool:sim_reset
{}
```

```json tool:sim_dispatch
{ "simId": "sim_1", "events": [{ "kind": "tap", "target": "@like_button_2/like_button" }] }
```

```json tool:sim_get_values
{ "simId": "sim_1", "targets": ["like_button_2/liked.on", "@like_button_2/like_button.color"] }
```

After the tap, `like_button_2/liked.on` is true. Each instance keeps its own state.

## Building a patch component

```json tool:apply_ops
{
  "ops": [
    {
      "op": "addComponent",
      "component": { "id": "press_feedback", "name": "Press Feedback", "kind": "patchComponent" }
    },
    {
      "op": "updateInterface",
      "component": "press_feedback",
      "inputs": { "down": { "key": "down", "name": "Down", "type": "boolean", "default": false } },
      "outputs": { "scale": { "key": "scale", "name": "Scale", "type": "number" } }
    },
    {
      "op": "addPatch",
      "component": "press_feedback",
      "patch": {
        "ref": "pop",
        "type": "popAnimation",
        "name": "Press Spring",
        "inputs": { "number": { "link": "$in.down" }, "bounciness": 0, "speed": 20 }
      }
    },
    {
      "op": "addPatch",
      "component": "press_feedback",
      "patch": {
        "ref": "shrink",
        "type": "transition",
        "name": "Shrink",
        "inputs": { "progress": { "link": "$pop.output" }, "start": 1, "end": 0.95 }
      }
    },
    { "op": "connect", "component": "press_feedback", "from": "$shrink.output", "to": "$out.scale" }
  ],
  "label": "press feedback component"
}
```

Use it on a button:

```json tool:add_layers
{
  "layers": [
    {
      "type": "rectangle",
      "name": "Save Button",
      "props": {
        "position": [121, 700],
        "size": [160, 56],
        "cornerRadius": 28,
        "color": "#007AFFFF"
      }
    }
  ]
}
```

```json tool:add_patches
{
  "patches": [
    {
      "ref": "touch",
      "type": "interaction",
      "name": "Touch Save",
      "inputs": { "layer": { "layer": "save_button" } }
    },
    {
      "ref": "press",
      "type": "component",
      "component": "press_feedback",
      "name": "Save Press",
      "inputs": { "down": { "link": "$touch.down" } }
    }
  ],
  "connections": [{ "from": "$press.scale", "to": "@save_button.scale" }]
}
```

```text outline
patch save_press component:press_feedback "Save Press" down←touch_save.down
component press_feedback "Press Feedback" (patchComponent)
input down boolean "Down" default=false
output scale number "Scale" ←shrink.output
patch press_spring popAnimation<number> "Press Spring" number←$in.down bounciness=0 speed=20
```

## Rebuilding a component

- `updateInterface` merges ports by key: a port you name replaces that key, `null` unpublishes it, and other keys stay. `"replace": true` makes each side you send the whole set. Unpublishing disconnects the port's cables inside and on every instance; the result lists them, and undo brings them back. To rename a key, unpublish it and publish the new one.
- Rebuild in one batch: remove the old patches and add their replacements in the same `apply_ops`, so they keep their ids and simulator paths. Ids removed by an earlier batch are retired: new items skip them (`shrink_2`), and the result says so on a "Retired ids skipped" line.

```json tool:apply_ops
{
  "component": "press_feedback",
  "ops": [
    {
      "op": "updateInterface",
      "replace": true,
      "inputs": {
        "down": { "name": "Down", "type": "boolean", "default": false },
        "depth": { "name": "Depth", "type": "number", "default": 0.95 }
      }
    },
    { "op": "connect", "from": "$in.depth", "to": "shrink.end" }
  ]
}
```

## Variables

- `variableBroadcaster` shares a value under a name. Set it with `"settings": { "name": "Dark Mode", "scope": "global" }`.
- `variableReceiver` outputs it anywhere, with the same name, scope and typeParam. `local` scope stops at the component edge; `global` reaches nested components.

## Limits

- Layer references (`{ "layer": … }`) only reach layers in the same component.
- Links can't reach inside an instance. To use a value from inside a component elsewhere, publish it as an output and connect from the instance.
