<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Splitter

Passes a value through unchanged, so you can name it, reuse it as a constant, tidy cables, or cast it to another type.

| | |
|---|---|
| Type key | `splitter` |
| Category | [Utility](README.md#utility) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>X</kbd> |
| Search terms | pass through, passthrough, junction, relay, cast, convert type, named value, constant, reroute, identity |

## How it works
A Splitter outputs exactly what it receives, on the same frame. It doesn't change the value; it gives the value a place in the graph and a name.

- **Value** is the value to pass on. Leave it unconnected and type a value to make a named constant, like a card width that several patches share.
- **Output** is Value, unchanged.
- **Type:** right-click the patch to change its type. A Splitter accepts a cable of any type and converts the value to its own type, so it doubles as a cast: a number becomes a point with both parts equal, text like `"12"` becomes 12, a 2D point gains a third part of 0, and JSON becomes a typed value.

## Tips
- Rename a Splitter (⇧⏎) after what the value means, like "Press Progress". Cables that start at a named Splitter explain themselves.
- Press X in the patch editor to insert one. A Splitter inserted on a port takes that port's name.
- When one value feeds patches far apart, a Variable Broadcaster with Receivers keeps the graph tidier than long cables.

## Coming from Origami
Same patch. Origami leaves both ports unlabeled; Sonobe calls them Value and Output.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `variant` | `0` | The value to pass on; leave it unconnected to type a constant. Its type follows the patch's type, which is number by default. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | Value, unchanged, on the same frame. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `enum`, `json`, `image`, `video`, `sound`, `gradient`, `shape`, `layerEffect`, `layer`.

For other types, a port starts at its zero value unless listed here:

| Type | Port | Default |
|---|---|---|
| `color` | `value` | `#FFFFFFFF` |
| `size` | `value` | `[100, 100]` |

## Examples

### Share one card width across layers

Change 358 on the Splitter and both layers resize together.

```text
layer card rectangle "Card" @16,120 size←card_size.output
layer banner rectangle "Banner" @16,360 size←banner_size.output
patch card_width splitter "Card Width" value=358
patch card_size size width←card_width.output height=220
patch banner_size size width←card_width.output height=64
```

### Name a press progress that drives three properties

One named junction replaces three cables from the spring and says what the value means.

```text
layer glow oval "Glow" @101,380 200x96 opacity←press_glow.output
layer button rectangle "Button" @121,400 160x56 cornerRadius=28 scale←press_scale.output opacity←press_fade.output
patch press interaction layer=@button
patch press_spring popAnimation number←press.down
patch press_progress splitter "Press Progress" value←press_spring.output
patch press_scale transition<number> progress←press_progress.output start=1 end=0.94
patch press_fade transition<number> progress←press_progress.output start=1 end=0.8
patch press_glow transition<number> progress←press_progress.output start=0 end=0.6
```

## Common mistakes

- Typing a new value into the Splitter changes nothing: a cable drives Value, and a connected input ignores its typed value. Disconnect the cable to use the Splitter as a constant.
- A layer turns into a square after you change a Splitter's type to size: casting a number copies it into both width and height. Use a Size or Point patch to set each part on its own.
- Two quick pulses count as one downstream: a Splitter set to on/off passes a pulse as a one-frame true, and back-to-back trues merge. Wire the pulse straight into the input that must see every pulse.

## Pairs well with

- [Variable Broadcaster](variableBroadcaster.md): Shares a value under a name, so any Variable Receiver with that name can use it without a cable.
- [Watch](watch.md): Shows a value right on the patch and logs its changes to the console, so you can see what a cable carries.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Option Picker](optionPicker.md): Outputs one of several values chosen by an option number, like a different color or title for each tab.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Splitter (`builtin.splitter`)

| Sonobe port | Origami label |
|---|---|
| `value` | Input |
| `output` | Output |
