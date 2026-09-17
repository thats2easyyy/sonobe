<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Substring

Keeps part of some text, a number of characters from a starting position, for initials, previews, and shortened titles.

| | |
|---|---|
| Type key | `substring` |
| Category | [Text](README.md#text) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | trim text, slice, truncate, first letters, initials, cut text, shorten text, ellipsis |

## How it works
Substring keeps a stretch of **Text** and drops the rest.

- **Start** is the character to begin at, counted from 0, so 0 is the first character.
- **Length** is how many characters to keep. Asking for more than remain keeps everything to the end.
- **Ellipsis** adds "…" at the end when characters after the kept part were cut off.
- Emoji and accented letters count as one character, the same as in Text Length.

For example, Text "Saturday" with Start 0 and Length 3 gives "Sat".

## Tips
- For initials, use Length 1 on a first name and a last name, then join them with Add set to Text.
- To shorten how a Text layer looks on screen, set its Max Lines property instead. Use Substring when you need the shortened text itself.
- Animate Length from 0 up to the text's length for a typewriter effect.

## Coming from Origami
Formerly Trim Text. Position is named Start, and Ellipsis is new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Text**<br>`text` | `text` | `""` | The text to take characters from. |
| **Start**<br>`start` | `index` | `0` | Which character to begin at, counted from 0. A Start past the last character gives empty text. At least 0, step 1. |
| **Length**<br>`length` | `number` | `3` | How many characters to keep from Start. 0 gives empty text, and more than remain keeps the rest. At least 0, step 1. |
| **Ellipsis**<br>`ellipsis` | `boolean` | `false` | When on, adds "…" after the kept characters if characters after them were cut off. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `text` | The kept characters. |

## Examples

### Initials for an avatar

```text
layer avatar oval "Avatar" @24,120 56x56 color="#5E5CE6FF"
layer initials_label text "Initials" @38,137 fontSize=17 fontWeight=600 textColor="#FFFFFFFF" text←initials.output
patch first_initial substring text="Maya" length=1
patch last_initial substring text="Chen" length=1
patch initials add<text>[2] value1←first_initial.output value2←last_initial.output
```

### Shorten a long title with an ellipsis

Shows "Weekend hiking…": the space before the ellipsis is trimmed.

```text
layer card_title text "Card Title" @24,300 text←short_title.output
patch short_title substring text="Weekend hiking trails near the coast" length=15 ellipsis=true
```

## Common mistakes

- The first letter is missing: Start counts from 0, so Start 1 begins at the second character. Set Start to 0.
- The output is empty: Start is past the last character, or Length is 0. Lower Start or raise Length.

## Pairs well with

- [Text Length](textLength.md): Counts the characters in text, counting each emoji or accented letter as one character.
- [Add](add.md): Adds numbers or vectors together, or joins pieces of text in order.
- [Text Contains](textContains.md): Checks whether text includes a search term anywhere and where the first match starts, for search filters and keyword checks.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Trim Text (`builtin.textsubstring`)
- **Also imports:** `builtin.textSubstring`

| Sonobe port | Origami label |
|---|---|
| `start` | Position |
