<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Variable Receiver

Outputs the value shared by the Variable Broadcaster with the same name, without a cable.

| | |
|---|---|
| Type key | `variableReceiver` |
| Category | [Utility](README.md#utility) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>Shift</kbd>+<kbd>W</kbd> |
| Search terms | wireless receiver, wireless, get variable, read variable, global variable, receive value, listen, shared value |

## How it works
A Variable Receiver outputs whatever its matching Variable Broadcaster shares, on the same frame, as if a cable ran between them.

- **Name** (click the title) picks the variable. The menu lists local variables from this patch graph and global variables from here and from every component this one sits inside. Choosing one copies its name, scope, and type.
- **Output** is the broadcaster's value. When nothing matches, Output is the type's empty value (0, off, or empty text), and the patch shows a warning.

When more than one global broadcaster above a receiver shares its name and type, the nearest one wins, so a component can override a value for everything inside it.

## Tips
- Click the receiver's radio icon to jump to its broadcaster.
- Press ⇧W to insert a receiver.
- Receivers are read-only. To change a shared value, change what drives the broadcaster.

## Coming from Origami
Formerly Wireless Receiver. Global overrides work the same way.

## Inputs

This patch adds ports based on how it's set up, so these tables list only the ports it always has.

This patch has no fixed inputs.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | The shared value from the matching broadcaster; the type's empty value (0, off, or empty text) when nothing matches. |

## Settings

Settings configure the patch itself instead of flowing through cables.

| Setting | Type | Default | Description |
|---|---|---|---|
| **Name**<br>`name` | `text` | `""` | The variable to receive. It matches a broadcaster with the same name, scope, and type. |
| **Scope**<br>`scope` | `enum` | `local` | Where to look: Local reads this patch graph; Global looks here first, then in each component this one sits inside. |

**Scope options**

- **Local** (`local`): Only this patch graph.
- **Global** (`global`): This patch graph and every component nested inside it.

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `enum`, `json`, `image`, `video`, `sound`, `gradient`, `shape`, `layerEffect`, `layer`.

## Examples

### Use one header height in two places

Change 96 on the broadcaster and both the header and the content below it follow.

```text
layer header rectangle "Header" @0,0 size←header_size.output
layer content group "Content" 402x778 position←content_offset.output
patch header_height variableBroadcaster name="Header Height" value=96
patch height_for_header variableReceiver<number> name="Header Height"
patch header_size size width=402 height←height_for_header.output
patch height_for_content variableReceiver<number> name="Header Height"
patch content_offset point x=0 y←height_for_content.output
```

## Common mistakes

- The receiver shows a warning and outputs 0: no broadcaster with the same name, scope, and type reaches it, often because of a typo or different capitalization. Choose the variable from the receiver's name menu.
- A receiver inside a component still reads the parent's value after you add an override: the component's broadcaster is Local, so it doesn't override globals. Set that broadcaster's Scope to Global.

## Pairs well with

- [Variable Broadcaster](variableBroadcaster.md): Shares a value under a name, so any Variable Receiver with that name can use it without a cable.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Progress](progress.md): Converts a number from any range into progress, where Start gives 0 and End gives 1.
- [Component](component.md): Runs a group of patches you built once, with its own inputs, outputs, and memory everywhere you use it.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Variable Receiver (`builtin.wirelessreceiver`)
- **Also imports:** `builtin.wirelessReceiver`
