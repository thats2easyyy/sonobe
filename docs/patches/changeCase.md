<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Change Case

Changes text to uppercase, lowercase, capitalized words, or sentence case.

| | |
|---|---|
| Type key | `changeCase` |
| Category | [Text](README.md#text) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | text transform, uppercase, lowercase, capitalize, title case, all caps, sentence case, touppercase |

## How it works
Change Case rewrites the capital letters in **Text** and outputs the result.

- **Uppercase** makes every letter a capital: "RECENTLY PLAYED".
- **Lowercase** makes every letter small: "recently played".
- **Capitalize Words** capitalizes the first letter of each word and lowercases the rest: "Recently Played".
- **Sentence Case** capitalizes the first letter of each sentence and lowercases the rest: "Recently played".

Characters without capitals, such as digits, emoji, and punctuation, stay the same.

## Tips
- To compare typed text with a known answer, lowercase both sides first.
- When you only need the look on screen, set the Text layer's Transform property instead. Use Change Case when you need the changed text itself, to compare it or send it somewhere.

## Coming from Origami
Formerly Text Transform. The Transform port is named Case, Capitalized is named Capitalize Words, and Sentence Case is new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Text**<br>`text` | `text` | `""` | The text to change. |
| **Case**<br>`case` | `enum` | `uppercase` | Which capitalization to apply. |

**Case options**

- **Uppercase** (`uppercase`): Every letter becomes a capital.
- **Lowercase** (`lowercase`): Every letter becomes small.
- **Capitalize Words** (`capitalize`): The first letter of each word becomes a capital; the rest become small.
- **Sentence Case** (`sentence`): The first letter of each sentence becomes a capital; the rest become small.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `text` | The text with its capitalization changed. |

## Examples

### All-caps section header

```text
layer header text "Header" @24,96 fontSize=13 fontWeight=600 letterSpacing=0.5 text←header_text.output
patch header_text changeCase text="Recently played" case=uppercase
```

### Capitalize names from a list

```text
layer people group "People" @16,160 358x160 layout=column spacing=8
  layer person_name text "Person Name" text←names_title.output
patch names splitText text="maya chen,omar haddad,theo park"
patch names_title changeCase text←names.parts case=capitalize
```

## Common mistakes

- Brand names lose their capitals, like iPhone becoming Iphone: Capitalize Words and Sentence Case lowercase every letter after the first. Type those words the way they should look and leave them out of Change Case.
- Typed answers never match: "Yes" and "yes" are different text. Lowercase both the typed text and the answer before comparing them.

## Pairs well with

- [Text Starts With](textStartsWith.md): Checks whether text begins with a given prefix, such as a slash command or https://.
- [Text Contains](textContains.md): Checks whether text includes a search term anywhere and where the first match starts, for search filters and keyword checks.
- [Equals Exactly](equalsExactly.md): Checks whether two or more values are exactly the same: numbers, indexes, text, colors, points, options, or JSON.
- [Text Replace](textReplace.md): Replaces every occurrence of some text with other text, for templates like "Hi {name}" or removing characters.
- [Split Text](splitText.md): Splits text into a loop of parts wherever a separator appears, like turning "Home,Search,Profile" into three tab labels.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Text Transform (`builtin.texttransform`)
- **Also imports:** `builtin.textTransform`

| Sonobe port | Origami label |
|---|---|
| `case` | Transform |
