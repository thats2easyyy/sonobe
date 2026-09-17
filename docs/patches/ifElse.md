<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# If / Else

Outputs one of two values depending on whether a condition is on or off.

| | |
|---|---|
| Type key | `ifElse` |
| Category | [Logic](README.md#logic) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | if, if statement, conditional, ternary, then else, choose, pick between two, when true |

## How it works
If / Else picks between two values. While **Condition** is on, the output is **If True**. While it's off, the output is **If False**.

- **Condition** is an on/off value (boolean), often a Switch's On or a comparison's Output. Numbers count as on when they're greater than 0.
- **If True** and **If False** are the two values to choose from. Change the type to pick between text, colors, points, images, layers, and more.
- **Output** is the chosen value.

## Tips
- The change is instant. Wire the Condition into a Pop Animation and a Transition instead when you want it to animate.
- Both values are always calculated; If / Else only chooses which one to pass on.
- Need more than two choices? Use Option Picker with an Option Switch.

## Coming from Origami
Origami has no If / Else patch. The usual equivalent is an Option Picker with two options and the boolean wired into Option. There, option 0 is the "false" value; here, If True comes first.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Condition**<br>`condition` | `boolean` | `false` | Chooses If True while on and If False while off. Numbers count as on when greater than 0. |
| **If True**<br>`ifTrue` | `variant` | `1` | The value to output while Condition is on. |
| **If False**<br>`ifFalse` | `variant` | `0` | The value to output while Condition is off. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | If True while Condition is on, otherwise If False. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `enum`, `json`, `image`, `video`, `sound`, `gradient`, `shape`, `layerEffect`, `layer`.

For other types, a port starts at its zero value unless listed here:

| Type | Port | Default |
|---|---|---|
| `boolean` | `ifTrue` | `true` |
| `boolean` | `ifFalse` | `false` |
| `text` | `ifTrue` | `"On"` |
| `text` | `ifFalse` | `"Off"` |
| `color` | `ifTrue` | `#000000FF` |
| `color` | `ifFalse` | `#FFFFFFFF` |
| `index` | `ifTrue` | `1` |
| `index` | `ifFalse` | `0` |

## Examples

### Change a button label when you follow

```text
layer follow_button rectangle "Follow Button" @24,120 354x48 cornerRadius=24
layer label text "Label" "Follow" @40,132 text←label_text.output
patch tap_follow interaction layer=@follow_button
patch following switch flip←tap_follow.tap
patch label_text ifElse<text> condition←following.on ifTrue="Following" ifFalse="Follow"
```

### Grow the heart more when liked

If / Else picks the spring's target; Pop Animation makes the change bounce.

```text
layer heart oval "Heart" @183,420 36x36 scale←heart_pop.output
patch tap_heart interaction layer=@heart
patch liked switch flip←tap_heart.tap
patch target ifElse condition←liked.on ifTrue=1.25 ifFalse=1
patch heart_pop popAnimation number←target.output bounciness=12
```

## Common mistakes

- The layer jumps instead of animating: If / Else switches values instantly. Wire the Condition into a Pop Animation and use a Transition to move between the two values.
- The output is always If False: the Condition is wired to a Tap, which is on for only one frame. Wire the tap into a Switch and use its On as the Condition.

## Pairs well with

- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Option Picker](optionPicker.md): Outputs one of several values chosen by an option number, like a different color or title for each tab.
- [Equals Exactly](equalsExactly.md): Checks whether two or more values are exactly the same: numbers, indexes, text, colors, points, options, or JSON.
- [Greater Than](greaterThan.md): Checks whether a value is greater than another, such as a drag passing a threshold or a timer passing a time.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

Sonobe-native: Origami has no matching patch.
