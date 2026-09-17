<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Split Text

Splits text into a loop of parts wherever a separator appears, like turning "Home,Search,Profile" into three tab labels.

| | |
|---|---|
| Type key | `splitText` |
| Category | [Text](README.md#text) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | split string, explode, tokenize, text to loop, comma separated, csv, separate words, split by |

## How it works
Split Text cuts **Text** apart wherever **Token** appears and outputs the pieces as a loop: a list of values that makes a layer repeat once per item.

- **Token** is the separator, such as a comma, a space, or a line break. It must match exactly, including capital letters, and it isn't included in the parts.
- **Parts** is the loop of pieces, in order. When Token doesn't appear, Parts holds the whole text as one item.
- **Count** is how many parts there are.
- An empty Token splits the text into single characters, which is handy for animating letter by letter.
- Two tokens in a row leave an empty part between them. Turn on the advanced **Skip Empty** port to drop empty parts.

## Tips
- Wire Parts into a Text layer inside a group with Layout set to Row or Column to get one label per part.
- Feed Count into a Loop patch to get an index for staggering animations.
- A loop of texts splits each one and joins all the parts into one loop.

## Coming from Origami
The output is named Parts, and Count and Skip Empty are new. An empty Token splits into characters instead of returning the whole text.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Text**<br>`text` | `text` · whole loop | `""` | The text to split. A loop of texts splits each one and joins all the parts into one loop. |
| **Token**<br>`token` | `text` | `","` | The separator to split at, such as "," or " "; it's left out of the parts. Leave it empty to split into single characters. |
| **Skip Empty**<br>`skipEmpty` | `boolean` · advanced | `false` | When on, drops empty parts, such as the one between two commas in a row or after a trailing comma. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Parts**<br>`parts` | `text` · whole loop | A loop of the pieces between separators, in order. When Token doesn't appear, it holds the whole text as one item. |
| **Count**<br>`count` | `number` | How many parts there are. step 1. |

## Examples

### Tab labels from one line of text

```text
layer tab_bar group "Tab Bar" @0,780 390x64 layout=row spacingMode=evenly
  layer tab_label text "Tab Label" text←labels.parts
patch labels splitText text="Home,Search,Inbox,Profile"
```

### Reveal a sentence word by word

Loop turns Count into an index for each word, and Transition gives each word a later start: 0.3 s, 0.45 s, 0.6 s, and so on.

```text
layer sentence group "Sentence" @24,200 342x40 layout=row spacing=6
  layer word text "Word" text←words.parts opacity←fade.output
patch words splitText text="Make something people love" token=" "
patch word_index loop count←words.count
patch launch whenPrototypeStarts
patch stagger transition<number> progress←word_index.index start=0.3 end=0.45
patch reveal wait start←launch.started duration←stagger.output
patch fade popAnimation number←reveal.done bounciness=0 speed=12
```

## Common mistakes

- Every label after the first starts with a space: the text has a space after each comma, but Token is only ",". Set Token to ", ".
- Only one item appears: Token doesn't appear in the text, or its capital letters differ. Make Token match the separator exactly.
- The copies stack on top of each other: each part makes its own copy of the layer at the same position. Put the layer in a group with Layout set to Row or Column.

## Pairs well with

- [Loop](loop.md): Makes a loop of indices from 0 up to Count minus 1, so layers and patches repeat once per index.
- [Loop Select](loopSelect.md): Picks items out of a loop by position, to show the tapped item's details or to reorder a list.
- [Loop Filter](loopFilter.md): Keeps, drops, or repeats each item of a loop, for filtered lists, selected items, or a value repeated a set number of times.
- [Text Replace](textReplace.md): Replaces every occurrence of some text with other text, for templates like "Hi {name}" or removing characters.
- [Change Case](changeCase.md): Changes text to uppercase, lowercase, capitalized words, or sentence case.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Split Text (`builtin.textsplitbytoken`)
- **Also imports:** `builtin.textSplitByToken`

| Sonobe port | Origami label |
|---|---|
| `parts` | Output |
