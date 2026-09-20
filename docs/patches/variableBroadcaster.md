<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Variable Broadcaster

Shares a value under a name, so any Variable Receiver with that name can use it without a cable.

| | |
|---|---|
| Type key | `variableBroadcaster` |
| Category | [Utility](README.md#utility) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>W</kbd> |
| Search terms | wireless broadcaster, wireless, variable, set variable, global variable, broadcast, send value, shared value, named value |

## How it works
A Variable Broadcaster gives a value a name. Every Variable Receiver set to the same name outputs that value on the same frame, as if a cable connected them.

- **Value** is the value to share. To tune a constant while the prototype runs, or compare it with a reference, make it a knob instead: knobs have a range and presets, and any input reads one directly.
- **Name** is the variable's name: rename the patch (press Return on it, or type in the Inspector's name field), and every receiver that reads the variable follows. Names are case-sensitive, and an empty name shares nothing.
- **Scope** decides who can receive it. **Local**, the default, reaches receivers in this patch graph only. **Global** also reaches receivers inside every component placed here, and inside their components, all the way down. Global variables never flow up to a parent.
- **Type:** right-click to change the value's type. Receivers match on name, scope, and type.

A component can override a global variable for everything inside it by broadcasting its own global variable with the same name and type. Each receiver uses the nearest one above it.

## Tips
- Press W to insert a broadcaster. Renaming or retyping it updates the receivers that follow it.
- Use variables for values many distant patches need, like scroll position or a dark-mode switch. For nearby patches, a cable or a Splitter is easier to follow.

## Coming from Origami
Formerly Wireless Broadcaster. As in Origami, the broadcaster's title is the variable's name; the document stores it as the patch's Name setting.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `variant` | `0` | The value to share; leave it unconnected to share a typed constant. Its type follows the patch's type, which is number by default. |

## Outputs

This patch has no fixed outputs.

## Settings

Settings configure the patch itself instead of flowing through cables.

| Setting | Type | Default | Description |
|---|---|---|---|
| **Name**<br>`name` | `text` | `""` | The variable's name. Receivers with the same name, scope, and type get this value. |
| **Scope**<br>`scope` | `enum` | `local` | Who can receive it: Local reaches this patch graph; Global also reaches every component nested inside it. |

**Scope options**

- **Local** (`local`): Only this patch graph.
- **Global** (`global`): This patch graph and every component nested inside it.

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `enum`, `json`, `image`, `video`, `sound`, `gradient`, `shape`, `layerEffect`, `layer`.

For other types, a port starts at its zero value unless listed here:

| Type | Port | Default |
|---|---|---|
| `color` | `value` | `#FFFFFFFF` |
| `size` | `value` | `[100, 100]` |

## Examples

### Fade a header as the feed scrolls

The scroll position travels by name instead of by a long cable.

```text
layer feed_window group "Feed Window" @0,0 402x874 clip=true
  layer feed group "Feed" 402x2400 position←feed_scroll.position
layer header rectangle "Header" @0,0 402x96 opacity←header_fade.output
patch feed_scroll scroll layer=@feed scrollY=free
patch share_scroll_y variableBroadcaster name="Scroll Y" value←feed_scroll.y
patch scroll_y variableReceiver<number> name="Scroll Y"
patch fade_amount progress value←scroll_y.output start=0 end=-120 clampToRange=true
patch header_fade transition<number> progress←fade_amount.progress start=1 end=0
```

### Switch every card to dark mode

One global broadcaster in Main reaches a receiver inside each Card instance.

```text
component main "Main" (prototype) 402x874
layer theme_button rectangle "Theme Button" @326,60 60x36 cornerRadius=18
layer card_1 componentInstance:card "Card 1" @16,120 370x200
layer card_2 componentInstance:card "Card 2" @16,340 370x200
patch theme tapToggle layer=@theme_button
patch share_dark_mode variableBroadcaster<boolean> name="Dark Mode" scope="global" value←theme.on
component card "Card" (layerComponent) 370x200
layer card_bg rectangle "Background" 370x200 cornerRadius=20 color←card_color.output
patch dark_mode variableReceiver<boolean> name="Dark Mode" scope="global"
patch card_color optionPicker<color> option←dark_mode.output option0=#FFFFFFFF option1=#1C1C1EFF
```

## Common mistakes

- A receiver outputs 0 and shows a warning: its name, scope, or type doesn't match the broadcaster, often because of different capitalization. Pick the variable from the receiver's Variable menu in the Inspector, which copies all three.
- Receivers inside a component get nothing: the broadcaster's scope is Local, which stops at the component's edge. Set Scope to Global.
- Two broadcasters show an error: they share a name, scope, and type in the same patch graph, so receivers can't tell them apart. Rename one of them.
- Reference values encoded in names, like "Commit Distance (app: 95)": nothing can read or switch to them. Make the value a knob and keep the reference in a locked preset.

## Pairs well with

- [Variable Receiver](variableReceiver.md): Outputs the value shared by the Variable Broadcaster with the same name, without a cable.
- [Splitter](splitter.md): Passes a value through unchanged, so you can name it, reuse it as a constant, tidy cables, or cast it to another type.
- [Scroll](scroll.md): Scrolls a content layer inside its parent with momentum, rubber banding, or paging, and outputs the scroll position and page.
- [Component](component.md): Runs a group of patches you built once, with its own inputs, outputs, and memory everywhere you use it.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Variable Broadcaster (`builtin.wirelessbroadcaster`)
- **Also imports:** `builtin.wirelessBroadcaster`

| Sonobe port | Origami label |
|---|---|
| `value` | Input |
