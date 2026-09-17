<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Text Replace

Replaces every occurrence of some text with other text, for templates like "Hi {name}" or removing characters.

| | |
|---|---|
| Type key | `textReplace` |
| Category | [Text](README.md#text) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | find and replace, replace all, substitute, template, placeholder, string replace, remove characters |

## How it works
Text Replace searches **Text** for **Find** and puts **Replace** in place of every match.

- Matches are found left to right and never overlap: replacing "aa" in "aaa" makes one replacement.
- **Replace** can be empty, which deletes every match.
- **Case Sensitive** is off by default, so Find "hi" also replaces "Hi". Turn it on to replace only exact capitals.
- Find is plain text, not a pattern: characters like $ and * match themselves.
- An empty Find leaves the text unchanged.

## Tips
- Write templates with placeholders such as {name}, then fill each placeholder with its own Text Replace.
- Chain patches to replace several things, such as removing both spaces and dashes from a phone number.
- Use Change Case after it when the result needs consistent capitals.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Text**<br>`text` | `text` | `""` | The text to search. |
| **Find**<br>`find` | `text` | `""` | The text to look for. Every match is replaced, and an empty Find changes nothing. |
| **Replace**<br>`replace` | `text` | `""` | The text that takes each match's place. Leave it empty to delete the matches. |
| **Case Sensitive**<br>`caseSensitive` | `boolean` | `false` | When on, capital letters must match exactly; when off, case is ignored, so Find "hi" also replaces "Hi" and "HI". |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `text` | Text with every match of Find replaced. |

## Examples

### Greet whichever account is signed in

Tapping the avatar switches accounts, and the greeting fills in the new name.

```text
layer greeting_label text "Greeting" @24,90 text←greeting.output
layer avatar oval "Avatar" @326,80 48x48
patch tap_avatar interaction layer=@avatar
patch account switch flip←tap_avatar.tap
patch account_name optionPicker<text>[2] option←account.on option0="Sam" option1="Priya"
patch greeting textReplace text="Welcome back, {name}!" find="{name}" replace←account_name.output
```

## Common mistakes

- Only one placeholder gets filled: one Text Replace fills one placeholder. Chain a second patch for {date}, wiring the first Output into its Text.
- Parts of other words change too: Find matches inside words, so "art" also changes "start". Include the spaces around the word in both Find and Replace.

## Pairs well with

- [Change Case](changeCase.md): Changes text to uppercase, lowercase, capitalized words, or sentence case.
- [Format Number](formatNumber.md): Turns a number into display text with set decimals, separators, a percent or K/M style, and your own prefix and suffix.
- [Split Text](splitText.md): Splits text into a loop of parts wherever a separator appears, like turning "Home,Search,Profile" into three tab labels.
- [Text Contains](textContains.md): Checks whether text includes a search term anywhere and where the first match starts, for search filters and keyword checks.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Text Replace (`builtin.textreplace`)
- **Also imports:** `builtin.textReplace`
