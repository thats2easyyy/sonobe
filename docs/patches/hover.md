<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Hover

Reports whether the mouse pointer is over a layer and where it is, for hover highlights and tooltips on desktop.

| | |
|---|---|
| Type key | `hover` |
| Category | [Interaction](README.md#interaction) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | mouse over, mouse enter, hover state, rollover, pointer over, cursor position, mouse position |

## How it works
Hover watches the mouse pointer. **Hovering** is true while the pointer is over **Layer** or one of its children, including while a mouse button is held. **Position** is the pointer location in points from the top-left of the screen, and it keeps its last value after the pointer leaves.

Leave Layer empty to watch the whole prototype. A layer in front blocks hover from layers behind it, unless that layer's Receives Touches is off. Layers at opacity 0 or with Enabled off never report hover.

Phones and tablets have no hover pointer, so Hovering stays false there. Treat hover effects as extras, and make sure tapping still works.

## Tips
- Animate hover changes with a Classic Animation of about 0.15 s so they don't flicker.
- For tooltips, add a Delay set to When Increasing so the tooltip only shows once the pointer rests.
- If a loop copies the layer, each copy reports its own hover, which is handy for list rows.

## Coming from Origami
The Hover output is called Hovering, and Enable is called Enabled. Position is measured from the screen's top-left instead of the parent's center.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Layer**<br>`layer` | `layer` | none | The layer to watch. Leave empty to watch the whole prototype. |
| **Enabled**<br>`enabled` | `boolean` | `true` | When off, Hovering stays false. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Hovering**<br>`hovering` | `boolean` | True while the mouse pointer is over the layer or one of its children. |
| **Position**<br>`position` | `point` (distance) | Pointer position in points from the top-left of the screen; keeps its last value after the pointer leaves. |
| **Local Position**<br>`localPosition` | `point` (distance) · advanced | Pointer position in points from the layer's own top-left corner, following its rotation and scale. |

## Examples

### Darken a button on hover

```text
layer button rectangle "Button" @126,700 150x56 cornerRadius=12 color←tint.output
patch hover_button hover layer=@button
patch ease classicAnimation number←hover_button.hovering duration=0.15
patch tint transition<color> progress←ease.output start=#3478F6FF end=#1F5FD0FF
```

## Common mistakes

- The hover effect never shows on a phone: touch screens have no hover pointer. Give the same feedback on press with Interaction's Down.
- Hover turns off over the button's label: the label is a separate layer in front of the button, so it blocks hover. Put the label inside the button's group, or turn off the label's Receives Touches.
- The highlight flickers at the edge: the layer grows on hover, which moves its edge in and out under the pointer. Scale an inner layer, or watch a Hit Area that doesn't change size.

## Pairs well with

- [Classic Animation](classicAnimation.md): Animates toward a target value over a set duration with an easing curve whenever the target changes.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Delay](delay.md): Holds back changes to a value for a set number of seconds, optionally delaying only rises or only falls.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Hover (`builtin.layer.hover`)

| Sonobe port | Origami label |
|---|---|
| `enabled` | Enable |
| `hovering` | Hover |
