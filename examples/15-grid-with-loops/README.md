# Grid with Loops

A palette of twelve color tiles in three columns, made from one layer. The tiles pop in one after another. Tap a tile and it gets a white ring while the preview card above animates to its color and shows the hex code.

Level 3 · Guide: [07 Loops](../../docs/guides/07-loops.md)

## What you'll learn

- How one layer becomes twelve: bind any of its props to a looped value and it repeats once per item.
- Placing copies with Grid Layout.
- Giving every copy its own value: a color from HSL Color, a label from Format Number.
- Staggering an entrance with per-index durations.
- Knowing which copy was tapped with Loop Option Switch, and reading one item back out with Loop Select.

## Build it step by step

1. **One tile.** Add a Group named Tile (`tile`) with Corner Radius 18 and a white stroke of 0, and a text label (`tile_label`) inside. It has no position or size yet. The loop provides those.
2. **Twelve indices.** Add a Loop (`tiles`, Count 12). Its Index output is the list 0, 1, 2, … 11.
3. **Place them.** Add a Grid Layout (`tile_grid`) with Index from `tiles.index`, Columns 3, Origin `[16, 290]`, Width 370, Item Height 116 and Spacing 10. Connect its Position and Size to the Tile. There are now twelve tiles in four rows.
4. **Color each one.** Add a Divide (`hue`: index ÷ 12) and an HSL Color (`tile_colors`) with Hue from it, Saturation 0.72 and Lightness 0.6, into the Tile's Color. Hue runs 0…1 around the color wheel, so twelve steps make a rainbow.
5. **Number each one.** Add an Add (`tile_number`: index + 1) and a Format Number (`tile_numbers`) with Minimum Digits 2 and Prefix "#", into the label's Text.
6. **Stagger the entrance.** Add When Prototype Starts (`started`) and a Wait (`intro_wait`, 0.15 s). Add a Multiply (`stagger_delay`: index × 0.04), and a Delay (`tile_shown`, boolean) with Value from `intro_wait.done` and Duration from `stagger_delay.output`. Feed that into a Pop Animation (`intro_spring`), then a Transition (`tile_scale`, 0.6 → 1) into Scale, and a Progress (`tile_opacity`, 0 → 0.6, clamped) into Opacity.
7. **Tap to pick.** Add an Interaction (`tap_tile`) on Tile. Its Tap is a loop too, with one pulse per copy. Add a Loop Option Switch (`selected_tile`) with Select from it. It remembers the index of the copy tapped last.
8. **Ring the pick.** Add Equals (`is_selected`) comparing `tiles.index` with `selected_tile.option`, a Pop Animation (`select_spring`), and a Transition (`ring_width`, 0 → 4) into the Tile's Stroke Width.
9. **The preview.** Add a Loop Select (`selected_color`, color) with Loop from `tile_colors.color` and Index from `selected_tile.option`. It picks one color out of the twelve. Add a Pop Animation on color (`preview_color`) into the preview card's Color, and a Color to Hex (`preview_hex`) into its label.

## The patch chain

```text
Tiles (loop ×12) ─index─┬─▶ Tile Grid ──position · size──▶ Tile (×12)
                        ├─▶ Hue Step (÷ 12) ──▶ Tile Color (HSL) ──color──┬─▶ Tile · Color
                        │                                                 └─▶ Selected Color (Loop Select) ─┬─▶ Preview Color (Pop, color) ─▶ Preview · Color
                        ├─▶ Tile Number (+ 1) ──▶ Tile Label ("#01") ─▶ Tile Number · Text                  └─▶ Preview Hex ─▶ Preview Hex · Text
                        ├─▶ Stagger Delay (× 0.04) ──▶ Tile Shown (Delay) ◀── Short Pause ◀── Prototype Starts
                        │                                   └─▶ Intro Spring ──▶ Tile Scale · Tile Opacity ──▶ Tile
                        └─▶ Is Selected ◀── Selected Tile (Loop Option Switch) ◀── Tap Tile (loop of taps)
                                 └─▶ Select Spring ──▶ Ring Width ──▶ Tile · Stroke Width
```

| Patch | Type | Its one job |
|---|---|---|
| `tiles` | Loop | The indices 0…11. Anything fed by it runs once per index. |
| `tile_grid` | Grid Layout | Each index's position and size in a three-column grid. |
| `hue`, `tile_colors` | Divide, HSL Color | A different hue per tile. |
| `tile_number`, `tile_numbers` | Add, Format Number | "#01" to "#12". |
| `started`, `intro_wait` | When Prototype Starts, Wait | Start the entrance a moment after launch. |
| `stagger_delay`, `tile_shown` | Multiply, Delay | Per tile: wait index × 0.04 seconds longer. |
| `intro_spring`, `tile_scale`, `tile_opacity` | Pop Animation, Transition, Progress | Pop each tile in with its own spring. |
| `tap_tile`, `selected_tile` | Interaction, Loop Option Switch | Which copy was tapped last (tile 0 until the first tap). |
| `is_selected`, `select_spring`, `ring_width` | Equals, Pop Animation, Transition | Per tile: spring a ring in if selected, out otherwise. |
| `selected_color`, `preview_color`, `preview_hex` | Loop Select, Pop Animation, Color to Hex | Read the selected color out of the loop, animate to it, and show its hex. |

Why the short pause? Delay starts at its input's first value. If the input were already on at the first frame, every tile would skip its delay and appear at once. The 0.15-second Wait makes sure the change happens after launch.

## Check it

`test.json` checks the grid geometry: tile 5 at `[142.667, 416]`, tiles 116.667 wide, and tile 8 labeled "#08". It checks the stagger (tile 1 is in by 0.3 s while tile 12 hasn't started) and the pick: tapping tile 8 moves the ring from tile 1 to tile 8, and the preview shows #5099E2.

```sh
npx vitest run examples/run.test.ts -t 15-grid-with-loops
```

In the simulator, target one copy with `#n`: tap `@tile#7`, or read `@tile.opacity#11`.

## Variations

- **More tiles.** Change the Loop's Count and the Hue Step divisor. The grid grows by itself.
- **Masonry heights.** Use a Loop Builder of heights instead of a fixed Item Height, and compute each y with Running Total.
- **Filter.** Use Loop Filter to keep only warm hues, and feed its output into the grid.
- **Press feedback per tile.** Feed `tap_tile.down` into a Pop Animation and a Transition from 1 to 0.94, then multiply it with `tile_scale.output` into Scale.
- **Selection as a Switch per tile.** Replace Loop Option Switch with a Switch fed by `tap_tile.tap`, so every tile toggles on its own (multi-select).

## Common mistakes

- **Copies stacked in one spot.** A looped layer repeats in place. Wire Grid Layout (or your own positions) into Position.
- **Hue from 0 to 360.** HSL Color's hue runs 0…1 here, so 80 wraps around and everything turns red.
- **A loop of one.** A loop with a single item behaves like a plain value, which is handy but can hide a wiring mistake. Check the "×N" badge on the cable.
- **Loops of different lengths meeting.** Shorter loops wrap around. Keep every loop that feeds the tile at 12 items.
