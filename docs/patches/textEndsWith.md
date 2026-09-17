<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Text Ends With

Checks whether text ends with a given suffix, such as a file extension or a question mark.

| | |
|---|---|
| Type key | `textEndsWith` |
| Category | [Text](README.md#text) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | ends with, suffix, has suffix, endswith, file extension, text suffix |

## How it works
Text Ends With outputs **Ends With**: true when **Text** finishes with **Suffix**, and false otherwise.

- It checks the very last characters, so a trailing space or line break counts: "hello " doesn't end with "hello".
- **Case Sensitive** is off by default, so "clip.MP4" ends with ".mp4". Turn it on when capitals matter.
- An empty Suffix always matches.

## Tips
- Check file types by extension: ".mp4" for videos, ".png" for images.
- Wire Ends With into a layer's Enabled to show a badge only when the text matches.
- Need a match anywhere in the text? Use Text Contains.

## Coming from Origami
Origami's version always matches capitals exactly and has no Case Sensitive port. Imported patches turn Case Sensitive on to keep that behavior.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Text**<br>`text` | `text` | `""` | The text to check. |
| **Suffix**<br>`suffix` | `text` | `""` | The text that might appear at the very end of Text. An empty Suffix always matches. |
| **Case Sensitive**<br>`caseSensitive` | `boolean` | `false` | When on, capital letters must match exactly; when off, case is ignored, so "clip.MP4" ends with ".mp4". |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Ends With**<br>`endsWith` | `boolean` | True while Text finishes with Suffix. |

## Examples

### Show a play icon for video attachments

Case Sensitive is off, so the uppercase extension still matches.

```text
layer attachment rectangle "Attachment" @16,300 358x200 cornerRadius=12
layer play_icon oval "Play Icon" @171,376 48x48 enabled←is_video.endsWith
patch is_video textEndsWith text="beach-day.MP4" suffix=".mp4"
```

## Common mistakes

- A match is missed: the text ends with a space or line break, which counts. Remove it at the source, or use Text Contains when the position doesn't matter.
- "photo.jpeg" isn't treated as an image: the patch checks one Suffix, such as ".jpg". Use one Text Ends With per extension and combine them with Or.

## Pairs well with

- [Text Starts With](textStartsWith.md): Checks whether text begins with a given prefix, such as a slash command or https://.
- [Text Contains](textContains.md): Checks whether text includes a search term anywhere and where the first match starts, for search filters and keyword checks.
- [Or](or.md): Turns on while at least one of its inputs is on, which also merges several pulses into one cable.
- [Option Picker](optionPicker.md): Outputs one of several values chosen by an option number, like a different color or title for each tab.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Text Ends With (`builtin.textsuffix`)
- **Also imports:** `builtin.textSuffix`

| Sonobe port | Origami label |
|---|---|
| `endsWith` | Output |
