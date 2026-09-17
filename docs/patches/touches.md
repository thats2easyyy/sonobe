<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Touches

Lists every finger touching the screen or a layer as loops of positions and pressures, for multi-touch effects.

| | |
|---|---|
| Type key | `touches` |
| Category | [Interaction](README.md#interaction) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | multi-touch, multitouch, fingers, all touches, touch points, pressure, force touch, finger count |

## How it works
Touches reports every finger currently pressed, as **loops** (lists that make a patch or layer repeat once per item).

- **Positions** holds one point per finger, in points from the prototype's top-left. Link it to a layer's Position to draw one copy of the layer under each finger.
- **Pressures** holds how hard each finger presses, from 0 to 1.
- **IDs** gives each finger a number that stays the same until it lifts.
- **Count** is how many fingers are down.
- **JSON** has the same data as a list of objects, handy for debugging.

Leave **Layer** empty to watch the whole screen, or pick a layer to count only touches that started on it.

## Tips
- A mouse is one pointer. Test multi-touch on a phone with the web player.
- Fingers are listed in the order they touched. When one lifts, the fingers after it move up a place; use IDs to follow a particular finger.
- Most screens and mice can't sense pressure and report a fixed value.

## Coming from Origami
Origami outputs one JSON structure; Sonobe outputs typed loops plus a JSON output for compatibility. Positions start at the top-left with y down, and Pressure runs 0 to 1 instead of Force 0 to 6.67. Layer and Enabled are new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Layer**<br>`layer` | `layer` | none | Only count touches that started on this layer or its children; empty counts every touch on the screen. |
| **Enabled**<br>`enabled` | `boolean` | `true` | When on, touches are reported; when off, every output is empty. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Positions**<br>`positions` | `point` (distance) · whole loop | A loop with each finger's position, in points from the prototype's top-left. |
| **Pressures**<br>`pressures` | `number` (progress) · whole loop | A loop with how hard each finger presses, 0 (lightest) to 1 (hardest). |
| **IDs**<br>`ids` | `index` · whole loop | A loop with each finger's id, which stays the same until that finger lifts. |
| **Count**<br>`count` | `number` | How many fingers are touching right now. step 1. |
| **JSON**<br>`json` | `json` | The same touches as a JSON array of { id, position, pressure } objects. |

## Examples

### Draw a dot under every finger

Positions is a loop, so the dot layer repeats once per finger.

```text
layer finger_dot oval "Finger Dot" 60x60 anchor=[0.5,0.5] position←fingers.positions
patch fingers touches
```

### Show how many fingers are down

```text
layer count_label text "Count Label" @16,80 text←fingers.count
patch fingers touches
```

## Common mistakes

- Only one dot ever appears: you're testing with a mouse, which is a single pointer. Open the web player on a phone to try several fingers.
- A dot jumps to another finger when one lifts: positions are listed in touch order, so indices shift. Use IDs to follow a specific finger.

## Pairs well with

- [Loop Count](loopCount.md): Counts how many items a loop has, for sizing containers, showing totals, or keeping an index in range.
- [Loop Select](loopSelect.md): Picks items out of a loop by position, to show the tapped item's details or to reorder a list.
- [Length](length.md): Measures how far a number, point, or vector is from zero, such as how far a drag has traveled in any direction.
- [Watch](watch.md): Shows a value right on the patch and logs its changes to the console, so you can see what a cable carries.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Touches (`builtin.touches`)

| Sonobe port | Origami label |
|---|---|
| `json` | Touches |
