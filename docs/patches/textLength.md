<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Text Length

Counts the characters in text, counting each emoji or accented letter as one character.

| | |
|---|---|
| Type key | `textLength` |
| Category | [Text](README.md#text) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | character count, string length, strlen, count characters, length, how many letters |

## How it works
Text Length counts the characters in **Text** and outputs the count as **Length**.

- Every character counts as 1, including spaces, punctuation, and line breaks.
- An emoji counts as 1, even skin-tone and flag emoji built from several parts, and so does an accented letter.
- Empty text has a length of 0.

## Tips
- A number wired into an on/off port, such as a layer's Enabled, is on while it's above 0. Wire Length there to show something only when the text isn't empty.
- For a character limit, compare Length with the limit using Greater Than, and turn a counter red when it's over.
- Substring counts characters the same way, so positions from one line up with the other.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Text**<br>`text` | `text` | `""` | The text to count. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Length**<br>`length` | `number` | How many characters Text has. Spaces, punctuation, and line breaks count, and each emoji counts as 1. step 1. |

## Examples

### Type out a message letter by letter

Wait's progress runs from 0 to 1 over 2 seconds, Transition scales it to the message's length, and Substring shows that many characters.

```text
layer message text "Message" @24,120 text←typed.output
patch launch whenPrototypeStarts
patch message_text textReplace text="Hi {name}, your order is on its way." find="{name}" replace="Sam"
patch message_length textLength text←message_text.output
patch reveal wait start←launch.started duration=2
patch shown transition<number> progress←reveal.progress start=0 end←message_length.length
patch typed substring text←message_text.output length←shown.output
```

## Common mistakes

- Length never changes: the text is typed into the inspector, so it's a fixed value. Wire the text that changes into Text.
- Length is one more than you expect: a trailing space or line break counts as a character. Remove it from the source, or check what the text holds with Watch.

## Pairs well with

- [Substring](substring.md): Keeps part of some text, a number of characters from a starting position, for initials, previews, and shortened titles.
- [Format Number](formatNumber.md): Turns a number into display text with set decimals, separators, a percent or K/M style, and your own prefix and suffix.
- [Greater Than](greaterThan.md): Checks whether a value is greater than another, such as a drag passing a threshold or a timer passing a time.
- [If / Else](ifElse.md): Outputs one of two values depending on whether a condition is on or off.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Text Length (`builtin.textlength`)
- **Also imports:** `builtin.textLength`

| Sonobe port | Origami label |
|---|---|
| `length` | Output |
