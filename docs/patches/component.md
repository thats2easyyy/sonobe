<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Component

Runs a group of patches you built once, with its own inputs, outputs, and memory everywhere you use it.

| | |
|---|---|
| Type key | `component` |
| Category | [Components](README.md#components) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | patch component, macro, group into component, reusable patches, function, subgraph, patch group, custom patch, instance, subpatch |

## How it works
A component is a group of patches you build once and reuse, like a function. Publish the inputs and outputs you want to reach from outside, then add a Component patch wherever you need that behavior.

- **Ports** are the component's published inputs and outputs, so every Component patch for one component has the same ports.
- **Each instance remembers on its own.** Two Component patches for a press effect animate their own buttons independently.
- **Edits apply everywhere.** Changing a patch inside updates every instance. To vary something per instance, publish it as an input.
- **Defaults.** An input you leave unset uses the component's default.
- **Loops.** Each published input has a Loop Behavior. **Loop** (the default) runs one copy per item, each with its own memory. **Pass** runs one copy and hands it the whole loop. Outputs from several copies join into one flat loop.

## Tips
- Select patches and choose Create Component (⌃⌘G). Cables that crossed the selection's edge become published ports.
- Need each copy's position in a list? Publish an Index input and connect the loop's Index.
- Double-click a Component patch to open its component, and press ⌥↑ to go back.

## Coming from Origami
Published ports live in the component's interface instead of purple and blue port patches, there's no unlink step, and published ports don't carry min and max limits yet.

## Inputs

This patch adds ports based on how it's set up, so these tables list only the ports it always has.

This patch has no fixed inputs.

## Outputs

This patch has no fixed outputs.

## Examples

### Reuse one press effect on two buttons

Both buttons use the Press Feedback component. Each instance runs its own spring, and the Cancel button sets Depth to press deeper than the default.

```text
component main "Main" (prototype)
layer save_button rectangle "Save Button" @24,720 160x56 cornerRadius=28 scale←save_press.scale
layer cancel_button rectangle "Cancel Button" @218,720 160x56 cornerRadius=28 scale←cancel_press.scale
patch touch_save interaction layer=@save_button
patch touch_cancel interaction layer=@cancel_button
patch save_press component component=press_feedback down←touch_save.down
patch cancel_press component component=press_feedback down←touch_cancel.down depth=0.9

component press_feedback "Press Feedback" (patchComponent)
input depth number "Depth" default=0.95
input down boolean "Down" default=false
output scale number "Scale" ←shrink.output
patch pop popAnimation number←$in.down bounciness=0 speed=20
patch shrink transition<number> progress←pop.output start=1 end←$in.depth
```

### Let each heart in a row remember its own like

Tap uses Loop behavior, so the component runs one copy per heart, and each copy's Switch remembers whether that heart is liked.

```text
component main "Main" (prototype)
layer heart oval "Heart" position←grid.position size←grid.size scale←like.scale
patch rows loop count=3
patch grid gridLayout index←rows.index columns=3 origin=40,400 width=322 itemHeight=88 spacing=24
patch tap_heart interaction layer=@heart
patch like component component=like_toggle tap←tap_heart.tap

component like_toggle "Like Toggle" (patchComponent)
input tap pulse "Tap" loop=loop
output liked boolean "Liked" ←toggle.on
output scale number "Scale" ←grow.output
patch toggle switch flip←$in.tap
patch pop popAnimation number←toggle.on
patch grow transition<number> progress←pop.output start=1 end=1.2
```

## Common mistakes

- A looped component gives one result instead of one per row: its input's Loop Behavior is Pass, so a single copy runs and patches like Loop Count see the whole loop. Set that input to Loop to run one copy per item.
- Changing a value inside the component changed every button: all instances share the component's patches. Publish that value as an input, then set it on each Component patch.
- An output has 25 items for a 5-row list: each copy produced a loop of 5, and copies join into one flat loop. Reduce each copy's loop to one value inside the component, for example with Loop Any or Loop Sum.

## Pairs well with

- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Loop](loop.md): Makes a loop of indices from 0 up to Count minus 1, so layers and patches repeat once per index.
- [Variable Receiver](variableReceiver.md): Outputs the value shared by the Variable Broadcaster with the same name, without a cable.
- [JavaScript](javascript.md): Runs a JavaScript file whose code declares its own inputs and outputs, for logic other patches can't express.
- [Watch](watch.md): Shows a value right on the patch and logs its changes to the console, so you can see what a cable carries.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Patch Component
