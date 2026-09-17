<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Keyboard

Reports whether a key on a physical keyboard is held down, for desktop shortcuts and quick testing toggles.

| | |
|---|---|
| Type key | `keyboard` |
| Category | [Interaction](README.md#interaction) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>K</kbd> |
| Search terms | key press, keydown, hotkey, keyboard shortcut, arrow keys, spacebar, key held |

## How it works
Keyboard watches one key or a combination of keys. **Down** is true while every key in **Key** is held.

- Type a single character, like `a`, `1`, or `/`, or a key name: `Space`, `Enter`, `Escape`, `Tab`, `Backspace`, `Up`, `Down`, `Left`, `Right`, `Shift`, `Control`, `Option`, `Command`, or `F1` to `F12`. Names aren't case-sensitive, and `A` watches the same key as `a`.
- Join keys with `+` for a combination, like `Shift+Up` or `Command+K`.
- The viewer needs keyboard focus, so click the prototype first. Typing into a Text Field layer doesn't count.

Phones and tablets without a hardware keyboard never press keys, so use Keyboard for desktop prototypes and quick testing.

## Tips
- Wire Down into a Switch's Flip to toggle something with a key. It flips once per press.
- Wire `Right` and `Left` into a Counter's Increase and Decrease to step through pages.
- Keys match the character they type. With Shift held, `1` types `!`, so watch `!` instead of `Shift+1`.

## Coming from Origami
Key names from Origami files, like `up` or `shift`, work as they are. Combinations and Enabled are new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Enabled**<br>`enabled` | `boolean` | `true` | When off, Down stays false. |
| **Key**<br>`key` | `text` | `"Space"` | The key to watch: a character like a, or a name like Space, Enter, Up, or Shift; join keys with + for a combination. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Down**<br>`down` | `boolean` | True while every key in Key is held. |

## Examples

### Press Space to show a panel

```text
layer panel rectangle "Panel" @0,600 402x274 cornerRadius=24 opacity←fade.output
patch space_key keyboard key="Space"
patch toggle switch flip←space_key.down
patch fade classicAnimation number←toggle.on duration=0.25
```

### Hold Shift+Up to lift a card

```text
layer card rectangle "Card" @37,300 328x200 cornerRadius=20 scale←lift.output
patch shift_up keyboard key="Shift+Up"
patch pop popAnimation number←shift_up.down
patch lift transition<number> progress←pop.output start=1 end=1.1
```

## Common mistakes

- Pressing the key does nothing: the viewer doesn't have keyboard focus, or you're typing into a Text Field. Click the prototype, then press the key.
- The panel disappears when you let go of the key: Down is a state that turns off on release. Wire it into a Switch's Flip when the change should stay.
- Shift+1 never turns on: with Shift held the key types !, and keys match the character they type. Watch ! instead.

## Pairs well with

- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Counter](counter.md): Keeps a whole-number count that pulses increase, decrease, or jump to a set number, with optional wrap-around.
- [Pulse](pulse.md): Turns an on/off state into pulses: one the moment it turns on and another the moment it turns off.
- [Option Switch](optionSwitch.md): Remembers which of several options is selected, counted from 0, and changes when an option's pulse arrives.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Keyboard (`builtin.keyboard`)
