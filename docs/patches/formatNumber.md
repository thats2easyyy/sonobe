<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Format Number

Turns a number into display text with set decimals, separators, a percent or K/M style, and your own prefix and suffix.

| | |
|---|---|
| Type key | `formatNumber` |
| Category | [Text](README.md#text) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | number to text, number formatter, decimal places, thousands separator, currency, percent, price, compact number, leading zeros, tofixed |

## How it works
Format Number turns a number into text you can show in a Text layer, like a price, a score, or a like count.

- **Value** is the number to show.
- **Style** writes it as plain digits, as a percentage, or shortened: **Compact** turns 12,345 into 12K.
- **Decimals** sets how many digits follow the decimal point. The number rounds to fit.
- **Prefix** and **Suffix** add text around the number, such as "$" or " of 5". Include any spaces you want.
- **Group Thousands** adds separators: 12,500 instead of 12500.

Advanced ports control rounding, trailing zeros, leading zeros, and the separator characters (1.234,5 in many European languages).

## Tips
- For follower counts, use Compact with Decimals 1 and Trailing Zeros off: 1,200 shows 1.2K and 1,000 shows 1K.
- Countdowns read better with Rounding set to Up, so the label shows 1 until the last second is over.
- To join several values into one label, use Add set to Text.

## Coming from Origami
Origami has no number formatter. Format Number replaces labels built with Add set to Text or with a JavaScript patch.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `number` | `0` | The number to show as text. |
| **Style**<br>`style` | `enum` | `number` | How the number is written: plain digits, a percentage, or shortened with K, M, B, and T. |
| **Decimals**<br>`decimals` | `number` | `0` | How many digits to show after the decimal point, from 0 to 20. With Compact, they apply to the shortened number (1.2K has 1). Range 0 to 20, step 1. |
| **Prefix**<br>`prefix` | `text` | `""` | Text placed before the number, such as "$" or "Page ". |
| **Suffix**<br>`suffix` | `text` | `""` | Text placed after the number, such as " pts" or " of 5". |
| **Group Thousands**<br>`groupThousands` | `boolean` | `true` | When on, separates thousands (12,500); when off, shows 12500. |
| **Trailing Zeros**<br>`trailingZeros` | `boolean` · advanced | `true` | When on, always shows every decimal place (12.50); when off, drops zeros at the end (12.5). |
| **Rounding**<br>`rounding` | `enum` · advanced | `nearest` | How extra decimal places are rounded away. |
| **Minimum Digits**<br>`minimumDigits` | `number` · advanced | `1` | Pads the whole-number part with leading zeros to at least this many digits: 2 shows 7 as 07. Range 1 to 21, step 1. |
| **Separators**<br>`separators` | `enum` · advanced | `commaPeriod` | Which characters separate thousands and decimals. |

**Style options**

- **Number** (`number`): Plain digits, like 1,234.5.
- **Percent** (`percent`): Multiplies by 100 and adds %, so 0.42 shows 42%.
- **Compact** (`compact`): Shortens large numbers with K, M, B, and T, like 12.3K.

**Rounding options**

- **Nearest** (`nearest`): Rounds to the closest value; halves round away from zero, so 2.5 shows 3.
- **Down** (`down`): Rounds toward negative infinity, so 2.9 shows 2 and −2.1 shows −3.
- **Up** (`up`): Rounds toward positive infinity, so 2.1 shows 3.

**Separators options**

- **Comma and Period** (`commaPeriod`): 1,234.5
- **Period and Comma** (`periodComma`): 1.234,5
- **Space and Comma** (`spaceComma`): 1 234,5, with a no-break space

## Outputs

| Output | Type | Description |
|---|---|---|
| **Text**<br>`text` | `text` | The formatted number, including Prefix and Suffix. |

## Examples

### Like count that shortens with K

Tapping adds likes to 1,284 existing ones, and Compact with one decimal shows 1.3K.

```text
layer like_button oval "Like Button" @24,700 48x48
layer like_count text "Like Count" @84,712 text←count_label.text
patch tap_like interaction layer=@like_button
patch likes counter increase←tap_like.tap
patch total add[2] value1←likes.count value2=1284
patch count_label formatNumber value←total.output style=compact decimals=1 trailingZeros=false
```

### Page label for a story

Counter counts from 0, so Add 1 before formatting: the label reads Page 1 of 5 through Page 5 of 5.

```text
layer page_label text "Page Label" @24,60 text←label.text
layer next_button rectangle "Next" @254,780 120x44
patch tap_next interaction layer=@next_button
patch page counter increase←tap_next.tap maximumCount=5
patch page_number add[2] value1←page.count value2=1
patch label formatNumber value←page_number.output suffix=" of 5" prefix="Page "
```

## Common mistakes

- Percent shows 4200% instead of 42%: Percent multiplies by 100 because progress runs from 0 to 1. Feed it 0.42, or use Number with a Suffix of "%" when your value already runs from 0 to 100.
- A price shows 12.5 instead of 12.50: Trailing Zeros is off. Turn it on so every decimal place shows.
- The label shows 1234.567891: the number goes straight into the Text layer. Wire it through Format Number with Decimals set first.

## Pairs well with

- [Counter](counter.md): Keeps a whole-number count that pulses increase, decrease, or jump to a set number, with optional wrap-around.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Add](add.md): Adds numbers or vectors together, or joins pieces of text in order.
- [Loop Count](loopCount.md): Counts how many items a loop has, for sizing containers, showing totals, or keeping an index in range.
- [Stopwatch](stopwatch.md): Measures elapsed seconds that you can start, pause, and reset with pulses.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

Sonobe-native: Origami has no matching patch.
