# Start here

Sonobe prototypes are **layers** (what people see) plus a **patch graph** (the logic that makes them respond), organized in components. The root component, usually `main`, is the screen. These tools change the person's document through Sonobe's op engine. Every change is validated, becomes one entry in their undo history, and returns the new revision plus the diagnostics it added or resolved.

Related: `importing`, `graph-basics`, `gestures`, `animation`, `simulation`, `troubleshooting`

## The loop

1. **Look first.** Call `get_document_info` (device size, components, what this host can do), then `get_outline`. Use ids exactly as the outline prints them.
2. **Look up patches.** Search with `list_patch_types` by intent ("spring", "drag", "tabs"), then call `describe_patch_types` for exact port keys, types and defaults. Never guess a port key.
3. **Say what you're doing.** Call `begin_work` with a one-line intent.
4. **Start from real screens.** When the person has an app or a design in code, bring its screens in with `import_design` (see the `importing` guide) instead of drawing layers by hand.
5. **Build one feature per batch.** Call `add_layers`, then `add_patches` with `connections`. Give new patches a `ref` and wire them with `"$ref.port"`; refs work in any order within a batch. Name layers by what they are ("Card") and patches by what they do ("Card Grown").
6. **Check.** Read the diagnostics delta in each write result, or call `get_diagnostics` for everything. Suggestions include ops you can pass straight to `apply_ops`.
7. **Prove it.** Call `sim_reset`, `sim_dispatch` the gesture, then `sim_trace` the properties that should change. Compare end values, settle time and overshoot with the feel you were asked for.
8. **Hand off.** Call `finish_work`, then describe the result by layer and patch _names_. Don't show raw ids, addresses or JSON to people.

## Addresses

| You mean                                      | Write                              |
| --------------------------------------------- | ---------------------------------- |
| a patch port                                  | `tap_card.tap`                     |
| a layer property or layer output              | `@card.scale`                      |
| something created earlier in the same batch   | `$tap.tap`, `{ "layer": "$card" }` |
| one copy of a looped value (simulation reads) | `@row.position#2`                  |
| a value inside a component instance (reads)   | `like_button_2/liked.on`           |
| a component's published input / output        | `$in.down` / `$out.scale`          |

An input has at most one connection; an output can feed many inputs. Literal values: numbers, `true`/`false`, text, colors as `"#RRGGBBAA"`, points and sizes as `[x, y]`, layer references as `{ "layer": "card" }`, connections as `{ "link": "pop.output" }`.

## Example: tap a card to grow it

Add the layer:

```json tool:add_layers
{
  "layers": [
    {
      "type": "rectangle",
      "name": "Card",
      "props": {
        "position": [22, 300],
        "size": [358, 220],
        "cornerRadius": 24,
        "color": "#FFFFFFFF"
      }
    }
  ]
}
```

Then the logic in one batch. It follows the ISAT pattern: Interaction (something happened), Switch (remember it), Animation (get there smoothly), Transition (what "there" means in real units), then the card's scale.

```json tool:add_patches
{
  "patches": [
    {
      "ref": "tap",
      "type": "interaction",
      "name": "Tap Card",
      "inputs": { "layer": { "layer": "card" } }
    },
    {
      "ref": "grown",
      "type": "switch",
      "name": "Card Grown",
      "inputs": { "flip": { "link": "$tap.tap" } }
    },
    {
      "ref": "spring",
      "type": "popAnimation",
      "name": "Grow Spring",
      "inputs": { "number": { "link": "$grown.on" }, "bounciness": 5, "speed": 12 }
    },
    {
      "ref": "scale",
      "type": "transition",
      "name": "Card Scale",
      "inputs": { "progress": { "link": "$spring.output" }, "start": 1, "end": 1.08 }
    }
  ],
  "connections": [{ "from": "$scale.output", "to": "@card.scale" }],
  "label": "tap to grow the card"
}
```

The outline now reads (default values like `bounciness=5` are left out):

```text outline
layer card rectangle "Card" @22,300 358x220 scale←card_scale.output color=#FFFFFFFF cornerRadius=24
patch tap_card interaction "Tap Card" layer=@card
patch card_grown switch "Card Grown" flip←tap_card.tap
patch grow_spring popAnimation<number> "Grow Spring" number←card_grown.on speed=12
patch card_scale transition<number> "Card Scale" progress←grow_spring.output start=1 end=1.08
```

Verify it in a simulation. `sim_reset` returns the simId to use:

```json tool:sim_reset
{}
```

```json tool:sim_dispatch
{ "simId": "sim_1", "events": [{ "kind": "tap", "target": "@card" }] }
```

```json tool:sim_trace
{ "simId": "sim_1", "targets": ["@card.scale"], "durationMs": 800 }
```

The trace summary should show `@card.scale` ending at 1.08, settling within a few hundred milliseconds with a small overshoot.

Look at the result as well. `atMs` draws a later frame without moving the session:

```json tool:get_screenshot
{ "simId": "sim_1", "target": "@card", "atMs": 800 }
```

## Habits

- **Small batches.** One feature per `add_patches` call keeps failures easy to fix. Batches are atomic: when one op fails, nothing changes, and the error says which op failed and why.
- **Stay in sync.** Each write returns a `revision`. Pass `expectedRevision` when you act on something you read earlier, so you never overwrite edits the person made in the meantime.
- **Read errors.** A failed call includes a hint and often ready-to-apply `ops`. Nothing changed, so fix the call and retry.
- **Ask before destroying.** `delete_items` asks for a confirmation token when more than 10 items would go. Undo with `undo`, which refuses to throw away a human's edit unless you name it.
- **Headless mode** (a project folder without the app): there's no editor selection, and `get_screenshot` draws the screen itself with approximate text. `get_document_info` says whether changes save automatically or need `save_document`.

## More guides

Fetch the guides that match the task in one call:

```json tool:get_guide
{ "topics": ["gestures", "simulation"] }
```
