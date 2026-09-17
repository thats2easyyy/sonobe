<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Patch reference

Every built-in Sonobe patch, grouped the way the patch picker groups them. Each page covers what the patch does, its ports and defaults, examples, common mistakes, what it pairs well with, where it runs, and how it maps to Origami.

**199 patches** in 16 categories: 79 everyday essentials (tier 1), 105 for breadth (tier 2), and 15 hardware and platform-specific patches (tier 3).

| Status | Meaning | Patches |
|---|---|---:|
| Supported | Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation. | 177 |
| Web-limited | Works only on some platforms or browsers, or needs a permission, a tap first, a secure page, or special hardware. | 20 |
| Not on the web yet | Loads from files and outputs idle values, but can't run on the web yet. | 2 |

## Categories

| Category | What belongs | Patches |
|---|---|---:|
| [Interaction](#interaction) | Pointer, touch, keyboard, and gesture input on layers or the screen, plus scroll and drag physics. | 14 |
| [Animation](#animation) | Values moving over time and reshaped progress: springs, tweens, curves, transitions, smoothing, velocity, and spring converters. | 18 |
| [State & Time](#state--time) | Memory and timing: switches, counters, options, pulses, delays, timers, and clocks. | 16 |
| [Logic](#logic) | Boolean logic, comparisons, and choosing between values. | 11 |
| [Math](#math) | Arithmetic, rounding, ranges, snapping, trigonometry, expressions, and randomness. | 20 |
| [Loops](#loops) | Creating, reading, reshaping, and combining loops. | 20 |
| [Text](#text) | Measuring, searching, and editing text, and formatting numbers and dates. | 11 |
| [Color](#color) | Building and converting colors and gradients. | 7 |
| [Data & Network](#data--network) | JSON objects and arrays, data files, HTTP, WebSockets, and encoding. | 25 |
| [Device](#device) | Device information, sensors, haptics, speech, and hardware. | 11 |
| [Media](#media) | Image, video, and sound assets and playback; camera and microphone; detection on images. | 14 |
| [Shapes](#shapes) | Vector shapes for Shape layers. | 8 |
| [Layers & Effects](#layers--effects) | Reading layer geometry, converting coordinates, and producing layer effects. | 5 |
| [Utility](#utility) | Plumbing: pass-through, variables, pack and unpack, debugging, and prototype control. | 17 |
| [Components](#components) | Patch component instances. | 1 |
| [Scripting](#scripting) | Code patches. | 1 |

## Interaction

Pointer, touch, keyboard, and gesture input on layers or the screen, plus scroll and drag physics.

| Patch | Key | What it does | Tier | Status |
|---|---|---|---:|---|
| [Interaction](interaction.md) | `interaction` | Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is. | 1 | Supported |
| [Gesture](gesture.md) | `gesture` | Tracks a press on a layer with its drag offset and speed, for animations that follow the finger and fling on release. | 1 | Supported |
| [Swipe](swipe.md) | `swipe` | Pulses when a press on a layer ends in a swipe, with separate pulses for left, right, up, and down. | 1 | Supported |
| [Long Press](longPress.md) | `longPress` | Turns on when a press is held still on a layer for a set time, and tells a quick tap apart from a hold. | 1 | Supported |
| [Double Tap](doubleTap.md) | `doubleTap` | Tells single taps from double taps, pulsing Double Tap on a quick second tap and Single Tap when no second tap comes. | 1 | Supported |
| [Tap Toggle](tapToggle.md) | `tapToggle` | Flips between on and off each time a layer is tapped, combining Interaction and Switch in one patch. | 1 | Supported |
| [Hover](hover.md) | `hover` | Reports whether the mouse pointer is over a layer and where it is, for hover highlights and tooltips on desktop. | 1 | Supported |
| [Keyboard](keyboard.md) | `keyboard` | Reports whether a key on a physical keyboard is held down, for desktop shortcuts and quick testing toggles. | 1 | Supported |
| [Drag](drag.md) | `drag` | Lets people drag a layer around and outputs where it should be, with optional bounds, axis lock, and momentum. | 1 | Supported |
| [Scroll](scroll.md) | `scroll` | Scrolls a content layer inside its parent with momentum, rubber banding, or paging, and outputs the scroll position and page. | 1 | Supported |
| [Mouse](mouse.md) | `mouse` | Reports the mouse pointer's position, which buttons are held, and how fast the scroll wheel or trackpad is scrolling. | 2 | Supported |
| [Touches](touches.md) | `touches` | Lists every finger touching the screen or a layer as loops of positions and pressures, for multi-touch effects. | 2 | Supported |
| [Pop Switch](popSwitch.md) | `popSwitch` | Swipes or pinches a value between two states, then springs to the nearer one and reports whether it's on. | 2 | Supported |
| [Momentum Scrolling](momentumScrolling.md) | `momentumScrolling` | Adds flick momentum and rubber-band bounds to a value you track yourself, for custom scroll and drag physics. | 2 | Supported |

## Animation

Values moving over time and reshaped progress: springs, tweens, curves, transitions, smoothing, velocity, and spring converters.

| Patch | Key | What it does | Tier | Status |
|---|---|---|---:|---|
| [Pop Animation](popAnimation.md) | `popAnimation` | Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed. | 1 | Supported |
| [Spring Animation](springAnimation.md) | `springAnimation` | Animates toward a target with a physical spring defined by mass, tension, and friction, and can continue a thrown gesture's velocity. | 1 | Supported |
| [Classic Animation](classicAnimation.md) | `classicAnimation` | Animates toward a target value over a set duration with an easing curve whenever the target changes. | 1 | Supported |
| [Transition](transition.md) | `transition` | Turns a progress value into a value between Start and End, so one animation can drive any property. | 1 | Supported |
| [Progress](progress.md) | `progress` | Converts a number from any range into progress, where Start gives 0 and End gives 1. | 1 | Supported |
| [Reverse Progress](reverseProgress.md) | `reverseProgress` | Flips a progress value so 0 becomes 1 and 1 becomes 0, for animations that run the opposite way. | 1 | Supported |
| [Repeating Animation](repeatingAnimation.md) | `repeatingAnimation` | Runs a progress value from 0 to 1 over and over, either restarting each time or swinging back and forth. | 1 | Supported |
| [Smooth Value](smoothValue.md) | `smoothValue` | Smooths a changing number over time, so noisy or jumpy values glide toward their latest value. | 1 | Supported |
| [Velocity](velocity.md) | `velocity` | Measures how fast a value is changing, in units per second, by comparing it with the previous frame. | 1 | Supported |
| [Spring Preset](springPreset.md) | `springPreset` | Picks a named spring feel, like Snappy or Bouncy, and outputs matching values for every kind of spring patch. | 1 | Supported |
| [Fluid Spring Animation](fluidSpringAnimation.md) | `fluidSpringAnimation` | Animates toward a target with an Apple-style spring you tune by response time and damping fraction. | 2 | Supported |
| [Spring Converter](springConverter.md) | `springConverter` | Converts an iOS-style spring, set by response and damping fraction, into Spring Animation and Pop Animation settings. | 2 | Supported |
| [Bouncy Converter](bouncyConverter.md) | `bouncyConverter` | Converts Pop Animation's bounciness and speed into the tension and friction that Spring Animation uses. | 2 | Supported |
| [Curve](curve.md) | `curve` | Reshapes a 0–1 progress value with an easing curve, so steady motion speeds up or slows down near the ends. | 2 | Supported |
| [Cubic Bezier Curve](cubicBezierCurve.md) | `cubicBezierCurve` | Reshapes a 0–1 progress value with a custom cubic-bezier easing curve, the same as CSS cubic-bezier(). | 2 | Supported |
| [Cubic Bezier Animation](cubicBezierAnimation.md) | `cubicBezierAnimation` | Animates toward a target over a set duration along a custom cubic-bezier easing curve. | 2 | Supported |
| [Arc Transition](arcTransition.md) | `arcTransition` | Maps a 0–1 progress onto one smooth curve from Start through Middle to End, for out-and-back or curved motion. | 2 | Supported |
| [Keyframes](keyframes.md) | `keyframes` | Maps a progress value through several keyframes, each a stop and a value, like a timeline driven by any number. | 2 | Supported |

## State & Time

Memory and timing: switches, counters, options, pulses, delays, timers, and clocks.

| Patch | Key | What it does | Tier | Status |
|---|---|---|---:|---|
| [Switch](switch.md) | `switch` | Remembers whether something is on or off and changes when it gets a pulse. | 1 | Supported |
| [Counter](counter.md) | `counter` | Keeps a whole-number count that pulses increase, decrease, or jump to a set number, with optional wrap-around. | 1 | Supported |
| [Pulse](pulse.md) | `pulse` | Turns an on/off state into pulses: one the moment it turns on and another the moment it turns off. | 1 | Supported |
| [Pulse on Change](pulseOnChange.md) | `pulseOnChange` | Sends a pulse whenever a watched value changes, such as a new page number or a different tab. | 1 | Supported |
| [When Prototype Starts](whenPrototypeStarts.md) | `whenPrototypeStarts` | Sends one pulse on the prototype's first frame, and again each time the prototype restarts. | 1 | Supported |
| [Sample and Hold](sampleAndHold.md) | `sampleAndHold` | Captures a value when you tell it to and keeps it, like remembering where a drag started. | 1 | Supported |
| [Option Switch](optionSwitch.md) | `optionSwitch` | Remembers which of several options is selected, counted from 0, and changes when an option's pulse arrives. | 1 | Supported |
| [Option Picker](optionPicker.md) | `optionPicker` | Outputs one of several values chosen by an option number, like a different color or title for each tab. | 1 | Supported |
| [Option Sender](optionSender.md) | `optionSender` | Sends a value to the one selected output and a default to all the others, like highlighting only the active tab. | 2 | Supported |
| [Option Equals](optionEquals.md) | `optionEquals` | Finds which option a value matches and outputs its number, or −1 when nothing matches. | 2 | Supported |
| [Delay](delay.md) | `delay` | Holds back changes to a value for a set number of seconds, optionally delaying only rises or only falls. | 1 | Supported |
| [Delay One Frame](delay1.md) | `delay1` | Outputs whatever its input was on the previous frame, for feedback loops and frame-to-frame comparisons. | 1 | Supported |
| [Wait](wait.md) | `wait` | Starts a timer on a pulse and turns Done on once the duration has passed, reporting progress along the way. | 1 | Supported |
| [Repeating Pulse](repeatingPulse.md) | `repeatingPulse` | Sends a pulse over and over at a steady interval, like a metronome. | 1 | Supported |
| [Time](time.md) | `time` | Counts the seconds and frames since the prototype started. | 1 | Supported |
| [Stopwatch](stopwatch.md) | `stopwatch` | Measures elapsed seconds that you can start, pause, and reset with pulses. | 2 | Supported |

## Logic

Boolean logic, comparisons, and choosing between values.

| Patch | Key | What it does | Tier | Status |
|---|---|---|---:|---|
| [And](and.md) | `and` | Turns on only while every one of its inputs is on. | 1 | Supported |
| [Or](or.md) | `or` | Turns on while at least one of its inputs is on, which also merges several pulses into one cable. | 1 | Supported |
| [Not](not.md) | `not` | Outputs the opposite of an on/off value: on becomes off and off becomes on. | 1 | Supported |
| [Equals](equals.md) | `equals` | Checks whether two numbers or points are equal within a tolerance, for values that never land exactly on a round number. | 1 | Supported |
| [Equals Exactly](equalsExactly.md) | `equalsExactly` | Checks whether two or more values are exactly the same: numbers, indexes, text, colors, points, options, or JSON. | 1 | Supported |
| [Greater Than](greaterThan.md) | `greaterThan` | Checks whether a value is greater than another, such as a drag passing a threshold or a timer passing a time. | 1 | Supported |
| [Greater Than or Equal](greaterThanOrEqual.md) | `greaterThanOrEqual` | Checks whether a value is at least another value, so reaching the threshold exactly also counts. | 1 | Supported |
| [Less Than](lessThan.md) | `lessThan` | Checks whether a value is less than another, such as a scroll pulled past the top or an item before the current one. | 1 | Supported |
| [Less Than or Equal](lessThanOrEqual.md) | `lessThanOrEqual` | Checks whether a value is at most another value, so matching the threshold exactly also counts. | 1 | Supported |
| [If / Else](ifElse.md) | `ifElse` | Outputs one of two values depending on whether a condition is on or off. | 1 | Supported |
| [In Range](inRange.md) | `inRange` | Checks whether a number lies between a minimum and a maximum, and tells you if it's below or above instead. | 2 | Supported |

## Math

Arithmetic, rounding, ranges, snapping, trigonometry, expressions, and randomness.

| Patch | Key | What it does | Tier | Status |
|---|---|---|---:|---|
| [Add](add.md) | `add` | Adds numbers or vectors together, or joins pieces of text in order. | 1 | Supported |
| [Subtract](subtract.md) | `subtract` | Subtracts one or more values from a starting value, such as finding how far apart two positions are. | 1 | Supported |
| [Multiply](multiply.md) | `multiply` | Multiplies values together, for scaling a number, spacing looped layers, or turning 0–1 progress into distance. | 1 | Supported |
| [Divide](divide.md) | `divide` | Divides a value by one or more values, outputting 0 with a warning instead of breaking when you divide by zero. | 1 | Supported |
| [Modulo](modulo.md) | `modulo` | Outputs the remainder after dividing, for wrapping a count back to 0, finding grid columns, or alternating items. | 1 | Supported |
| [Power](power.md) | `power` | Raises a value to a power, for squaring numbers, doubling at each step, or bending 0–1 progress into a curve. | 1 | Supported |
| [Square Root](squareRoot.md) | `squareRoot` | Outputs the square root of a value, for undoing a square, sizing even grids, and working out distances. | 1 | Supported |
| [Absolute Value](absoluteValue.md) | `absoluteValue` | Turns negative values into positive ones, for measuring how far something moved in either direction. | 1 | Supported |
| [Round](round.md) | `round` | Rounds a number to the nearest whole number or decimal place, and also outputs it rounded down and rounded up. | 1 | Supported |
| [Min](min.md) | `min` | Outputs the smallest of its inputs, for capping a value from above or picking the shorter of two sizes. | 1 | Supported |
| [Max](max.md) | `max` | Outputs the largest of its inputs, for keeping a value from dropping below a limit or picking the taller of two sizes. | 1 | Supported |
| [Clamp](clamp.md) | `clamp` | Keeps a value between a minimum and a maximum, so scrolling, dragging, or progress can't go past its limits. | 1 | Supported |
| [Remap](remap.md) | `remap` | Converts a value from one range to another, like turning scroll distance 0–150 into a header height from 120 to 64. | 1 | Supported |
| [Snap](snap.md) | `snap` | Moves a value to the nearest step or point, and can use flick velocity to predict where it lands, for grids and carousels. | 1 | Supported |
| [Math Expression](mathExpression.md) | `mathExpression` | Calculates numbers from a formula you type, creating an input for each variable and an output for each result. | 1 | Supported |
| [Random](random.md) | `random` | Picks a random number between Start and End, and picks a new one each time Randomize gets a pulse. | 2 | Supported |
| [Sine](sine.md) | `sine` | Turns an angle in degrees into a smooth wave from -1 to 1, for bobbing, breathing, and circular motion. | 2 | Supported |
| [Cosine](cosine.md) | `cosine` | Turns an angle in degrees into a smooth wave from -1 to 1 that starts at its peak, for swinging and circular motion. | 2 | Supported |
| [Arctangent](arctangent.md) | `arctangent` | Measures the direction of an X and Y offset as an angle in degrees, so a layer can point toward a finger or another layer. | 2 | Supported |
| [Length](length.md) | `length` | Measures how far a number, point, or vector is from zero, such as how far a drag has traveled in any direction. | 2 | Supported |

## Loops

Creating, reading, reshaping, and combining loops.

| Patch | Key | What it does | Tier | Status |
|---|---|---|---:|---|
| [Loop](loop.md) | `loop` | Makes a loop of indices from 0 up to Count minus 1, so layers and patches repeat once per index. | 1 | Supported |
| [Loop Builder](loopBuilder.md) | `loopBuilder` | Collects several values of one type, like names, colors, or images, into a loop that repeats layers once per value. | 1 | Supported |
| [Loop Count](loopCount.md) | `loopCount` | Counts how many items a loop has, for sizing containers, showing totals, or keeping an index in range. | 1 | Supported |
| [Loop Select](loopSelect.md) | `loopSelect` | Picks items out of a loop by position, to show the tapped item's details or to reorder a list. | 1 | Supported |
| [Loop Option Switch](loopOptionSwitch.md) | `loopOptionSwitch` | Remembers which item in a loop pulsed most recently, like which tab or card was tapped. | 1 | Supported |
| [Any](loopAny.md) | `loopAny` | Turns a loop of on/off values into one value that's on when at least one item is on, like any card being tapped. | 1 | Supported |
| [All](loopAll.md) | `loopAll` | Turns a loop of on/off values into one value that's on only when every item is on, like all boxes being checked. | 2 | Supported |
| [Loop Filter](loopFilter.md) | `loopFilter` | Keeps, drops, or repeats each item of a loop, for filtered lists, selected items, or a value repeated a set number of times. | 2 | Supported |
| [Loop Sum](loopSum.md) | `loopSum` | Adds up every item in a loop into one total, like a cart price, a count of checked items, or a content height. | 2 | Supported |
| [Running Total](runningTotal.md) | `runningTotal` | Gives each item in a loop the total of the items before it, for stacking uneven rows or staggering delays. | 2 | Supported |
| [Grid Layout](gridLayout.md) | `gridLayout` | Calculates a position and size for each item so repeated layers fill a grid of evenly sized columns. | 2 | Supported |
| [Loop Reverse](loopReverse.md) | `loopReverse` | Flips a loop so its last item comes first. | 2 | Supported |
| [Loop Shuffle](loopShuffle.md) | `loopShuffle` | Puts a loop's items in a random order each time it gets a pulse, and keeps that order until the next one. | 2 | Supported |
| [Loop Dedupe](loopDedupe.md) | `loopDedupe` | Removes repeated items from a loop, keeping the first of each. | 2 | Supported |
| [Loop Insert](loopInsert.md) | `loopInsert` | Adds a value into a loop at a chosen position each time it gets a pulse. | 2 | Supported |
| [Loop Append](loopAppend.md) | `loopAppend` | Adds a value to the end of a loop each time it gets a pulse. | 2 | Supported |
| [Loop Remove](loopRemove.md) | `loopRemove` | Removes the item at a chosen position from a loop each time it gets a pulse. | 2 | Supported |
| [Loop Remove Last](loopRemoveLast.md) | `loopRemoveLast` | Removes a loop's last item each time it gets a pulse, like undoing the latest addition. | 2 | Supported |
| [Loop to Array](loopToArray.md) | `loopToArray` | Packs a whole loop into one JSON array you can send, store, or inspect. | 2 | Supported |
| [Loop Over Array](loopOverArray.md) | `loopOverArray` | Turns a JSON array into a loop, one item per element, so layers repeat for each entry. | 2 | Supported |

## Text

Measuring, searching, and editing text, and formatting numbers and dates.

| Patch | Key | What it does | Tier | Status |
|---|---|---|---:|---|
| [Format Number](formatNumber.md) | `formatNumber` | Turns a number into display text with set decimals, separators, a percent or K/M style, and your own prefix and suffix. | 1 | Supported |
| [Text Length](textLength.md) | `textLength` | Counts the characters in text, counting each emoji or accented letter as one character. | 1 | Supported |
| [Split Text](splitText.md) | `splitText` | Splits text into a loop of parts wherever a separator appears, like turning "Home,Search,Profile" into three tab labels. | 2 | Supported |
| [Text Starts With](textStartsWith.md) | `textStartsWith` | Checks whether text begins with a given prefix, such as a slash command or https://. | 2 | Supported |
| [Text Ends With](textEndsWith.md) | `textEndsWith` | Checks whether text ends with a given suffix, such as a file extension or a question mark. | 2 | Supported |
| [Text Contains](textContains.md) | `textContains` | Checks whether text includes a search term anywhere and where the first match starts, for search filters and keyword checks. | 2 | Supported |
| [Text Replace](textReplace.md) | `textReplace` | Replaces every occurrence of some text with other text, for templates like "Hi {name}" or removing characters. | 2 | Supported |
| [Change Case](changeCase.md) | `changeCase` | Changes text to uppercase, lowercase, capitalized words, or sentence case. | 2 | Supported |
| [Substring](substring.md) | `substring` | Keeps part of some text, a number of characters from a starting position, for initials, previews, and shortened titles. | 2 | Supported |
| [Measure Text](measureText.md) | `measureText` | Measures how wide and tall text would be in a given font and size, so shapes can fit around a label. | 2 | Supported |
| [Format Date & Time](formatDateTime.md) | `formatDateTime` | Turns seconds into readable text: a clock time, a date, a media timestamp like 2:05, or your own % pattern. | 2 | Supported |

## Color

Building and converting colors and gradients.

| Patch | Key | What it does | Tier | Status |
|---|---|---|---:|---|
| [Hex Color](hexColor.md) | `hexColor` | Turns a hex code such as #FF5F6D into a color you can wire into any color property. | 1 | Supported |
| [RGB Color](rgbColor.md) | `rgbColor` | Builds a color from red, green, blue, and alpha numbers between 0 and 1. | 1 | Supported |
| [HSL Color](hslColor.md) | `hslColor` | Builds a color from hue, saturation, lightness, and alpha between 0 and 1, for rainbows, tints, and shades. | 1 | Supported |
| [Color to Hex](colorToHex.md) | `colorToHex` | Turns a color into hex code text such as #FF5F6D, for labels, data, and handoff. | 2 | Supported |
| [Color to RGB](colorToRgb.md) | `colorToRgb` | Splits a color into red, green, blue, and alpha numbers between 0 and 1. | 2 | Supported |
| [Color to HSL](colorToHsl.md) | `colorToHsl` | Splits a color into hue, saturation, lightness, and alpha numbers between 0 and 1. | 2 | Supported |
| [Gradient Builder](gradientBuilder.md) | `gradientBuilder` | Builds a linear, radial, or angular gradient from color stops, ready for a layer's Gradient property. | 2 | Supported |

## Data & Network

JSON objects and arrays, data files, HTTP, WebSockets, and encoding.

| Patch | Key | What it does | Tier | Status |
|---|---|---|---:|---|
| [JSON Array](jsonArray.md) | `jsonArray` | Builds a JSON array from a list of values, such as tab titles or ids, to read by position or send as data. | 2 | Supported |
| [JSON Object](jsonObject.md) | `jsonObject` | Builds a JSON object with one named value, like {"name": "Ada"}, for request bodies, headers, and nested data. | 2 | Supported |
| [Value at Index](valueAtIndex.md) | `valueAtIndex` | Reads one element of a JSON array by its position, counted from 0, like the first search result. | 2 | Supported |
| [Value for Key](valueForKey.md) | `valueForKey` | Reads one named field from a JSON object, such as a product's name or price. | 2 | Supported |
| [Value at Path](valueAtPath.md) | `valueAtPath` | Reads a value deep inside JSON with a dot path like results.0.title, including every match with * or a .. search. | 2 | Supported |
| [Set Value for Key](setValueForKey.md) | `setValueForKey` | Adds or replaces one named field in a JSON object and outputs the updated copy. | 2 | Supported |
| [Get Keys](getKeys.md) | `getKeys` | Lists the names of every entry in a JSON object as an array of text, so you can show or loop over them. | 2 | Supported |
| [Object Join](objectJoin.md) | `objectJoin` | Merges several JSON objects into one, with later objects overwriting keys that earlier ones already have. | 2 | Supported |
| [Array Append](arrayAppend.md) | `arrayAppend` | Adds an item to the end of a JSON array each time it gets a pulse, remembering everything added so far. | 2 | Supported |
| [Array Count](arrayCount.md) | `arrayCount` | Counts how many elements a JSON array has, such as the number of search results or items in a cart. | 2 | Supported |
| [Array Join](arrayJoin.md) | `arrayJoin` | Joins several JSON arrays end to end into one array, such as pinned posts followed by the feed. | 2 | Supported |
| [Array Reverse](arrayReverse.md) | `arrayReverse` | Outputs a JSON array's elements in the opposite order, like showing the newest message first. | 2 | Supported |
| [Array Sort](arraySort.md) | `arraySort` | Sorts a JSON array from smallest to largest or the reverse, optionally by a field such as price or name. | 2 | Supported |
| [Array Index Of](arrayIndexOf.md) | `arrayIndexOf` | Finds where an item sits in a JSON array and whether it's there at all, such as checking if a post is saved. | 2 | Supported |
| [Subarray](subarray.md) | `subarray` | Takes a run of elements from a JSON array, such as the first five results or one page of a feed. | 2 | Supported |
| [JSON to Text](jsonToText.md) | `jsonToText` | Turns any JSON value into readable JSON text, for checking data on screen or sending it as a message. | 2 | Supported |
| [Text to JSON](textToJson.md) | `textToJson` | Reads text written in JSON format and turns it into data the JSON patches can use. | 2 | Supported |
| [JSON File](jsonFile.md) | `jsonFile` | Loads a JSON file from your project, such as a product list or mock feed, so prototypes work without a server. | 2 | Supported |
| [Network Request](networkRequest.md) | `networkRequest` | Loads JSON, text, images, video, or sound from a URL when it gets a pulse, and reports loading and errors. | 2 | Web-limited |
| [Open URL](openUrl.md) | `openUrl` | Opens a website, email, phone number, or app link outside the prototype when it gets a pulse. | 2 | Web-limited |
| [WebSocket Connection](webSocketConnection.md) | `webSocketConnection` | Keeps a live two-way connection to a WebSocket server open while Connect is on, for sending and receiving messages instantly. | 2 | Web-limited |
| [WebSocket Send](webSocketSend.md) | `webSocketSend` | Sends a text or JSON message over a WebSocket connection when it gets a pulse. | 2 | Supported |
| [WebSocket Receive](webSocketReceive.md) | `webSocketReceive` | Outputs the text or JSON messages a server sends over a WebSocket connection, and pulses when each new one arrives. | 2 | Supported |
| [Base64 Encode](base64Encode.md) | `base64Encode` | Turns text, JSON, an image, or a sound into base64 text for sending inside requests, links, or JSON. | 2 | Supported |
| [Base64 Decode](base64Decode.md) | `base64Decode` | Turns base64 text back into text, JSON, an image, or a sound. | 2 | Supported |

## Device

Device information, sensors, haptics, speech, and hardware.

| Patch | Key | What it does | Tier | Status |
|---|---|---|---:|---|
| [Device Info](deviceInfo.md) | `deviceInfo` | Reports the screen size, safe area, orientation, dark mode, and input style of the device the prototype runs on. | 2 | Supported |
| [Device Motion](deviceMotion.md) | `deviceMotion` | Reads how a phone is tilted, moving, and rotating, for tilt effects, parallax, and shake gestures. | 2 | Web-limited |
| [Device Time](deviceTime.md) | `deviceTime` | Reads the real date and time from the device's clock, for status bar clocks, dates, and countdowns. | 2 | Supported |
| [Vibrate](vibrate.md) | `vibrate` | Buzzes the phone's vibration motor for a moment each time it gets a pulse. | 2 | Web-limited |
| [Text to Speech](textToSpeech.md) | `textToSpeech` | Speaks text aloud with a system voice, for voice assistants, spoken directions, and accessibility demos. | 2 | Web-limited |
| [Haptic](haptic.md) | `haptic` | Plays a short tactile tap or pattern, like a light impact or a success buzz, each time it gets a pulse. | 3 | Web-limited |
| [Location](location.md) | `location` | Reports where the device is on Earth as latitude and longitude, or a preset city so demos work anywhere. | 3 | Web-limited |
| [Game Controller](gameController.md) | `gameController` | Reads a game controller's buttons, triggers, D-pad, and thumbsticks, for TV, console, and game prototypes. | 3 | Web-limited |
| [Interface Orientation](interfaceOrientation.md) | `interfaceOrientation` | Chooses which ways the interface turns when the device rotates, and which orientation it starts in. | 3 | Supported |
| [Soft Keyboard](softKeyboard.md) | `softKeyboard` | Reports the on-screen keyboard's height and slide progress, so text inputs and buttons can ride above it. | 3 | Web-limited |
| [Bluetooth LE](bluetoothLe.md) | `bluetoothLe` | Connects to a Bluetooth Low Energy device to read, write, and receive values, for hardware and sensor prototypes. | 3 | Web-limited |

## Media

Image, video, and sound assets and playback; camera and microphone; detection on images.

| Patch | Key | What it does | Tier | Status |
|---|---|---|---:|---|
| [Sound Player](soundPlayer.md) | `soundPlayer` | Plays a sound file with play, pause, looping, volume, speed, pitch, and pan, and reports where playback is. | 2 | Web-limited |
| [Image](imageAsset.md) | `imageAsset` | Holds a picture from your assets or a web address, ready to send to Image layers and other patches. | 2 | Supported |
| [Video](videoAsset.md) | `videoAsset` | Holds a video clip from your assets or a web address, ready to send to Video layers and other patches. | 2 | Supported |
| [Image Info](imageInfo.md) | `imageInfo` | Reads a picture's natural size, pixel density, name, and aspect ratio, so layouts can match the image. | 2 | Supported |
| [Video Info](videoInfo.md) | `videoInfo` | Reads a Video layer's current time, length, and progress, for scrubbers, time labels, and player controls. | 2 | Supported |
| [Photo Picker](photoPicker.md) | `photoPicker` | Opens the system photo picker so people can choose photos or videos, then outputs what they chose. | 2 | Web-limited |
| [Camera](camera.md) | `camera` | Shows the live camera feed and takes photos or records videos you can show in Image and Video layers. | 3 | Web-limited |
| [Microphone](microphone.md) | `microphone` | Listens to the device microphone for live sound levels and records clips you can play back. | 3 | Web-limited |
| [Audio Metering](audioMetering.md) | `audioMetering` | Measures how loud a sound is and how loud its low to high pitches are, so layers can react to music or your voice. | 3 | Web-limited |
| [Snapshot](snapshot.md) | `snapshot` | Captures a layer, or the whole screen, as a picture when it gets a pulse. | 3 | Web-limited |
| [Face Detection](faceDetection.md) | `faceDetection` | Finds faces in an Image or Video layer and outputs where each face, its eyes, and its mouth are. | 3 | Not on the web yet |
| [Hand Detection](handDetection.md) | `handDetection` | Finds hands in an Image or Video layer and outputs where each hand and its fingertips are. | 3 | Not on the web yet |
| [Object Detection](objectDetection.md) | `objectDetection` | Finds the most eye-catching regions of an Image or Video layer, for smart cropping and highlighting subjects. | 3 | Web-limited |
| [QR Code Detection](qrCodeDetection.md) | `qrCodeDetection` | Scans an Image or Video layer for QR codes and outputs each code's text and corners. | 3 | Web-limited |

## Shapes

Vector shapes for Shape layers.

| Patch | Key | What it does | Tier | Status |
|---|---|---|---:|---|
| [Circle Shape](circleShape.md) | `circleShape` | Makes a circle shape from a center point and a radius, for dots, rings, and progress arcs in a Shape layer. | 2 | Supported |
| [Oval Shape](ovalShape.md) | `ovalShape` | Makes an oval shape from a center point and a size, for ellipses, blobs, and squash-and-stretch effects in a Shape layer. | 2 | Supported |
| [Rounded Rectangle Shape](roundedRectangleShape.md) | `roundedRectangleShape` | Makes a rectangle shape with rounded corners, for cards, pills, and buttons you want to stroke, trim, morph, or combine. | 2 | Supported |
| [Triangle Shape](triangleShape.md) | `triangleShape` | Makes a triangle shape from three corner points, for play icons, arrows, and tooltip tails in a Shape layer. | 2 | Supported |
| [Line Shape](lineShape.md) | `lineShape` | Makes a straight or smoothed line through two or more points, for dividers, connectors, progress tracks, and charts. | 2 | Supported |
| [SVG Path Shape](svgPathShape.md) | `svgPathShape` | Turns SVG path data, like an icon copied from a design tool, into a shape for a Shape layer, scaled to the size you want. | 2 | Supported |
| [Shape Union](shapeUnion.md) | `shapeUnion` | Combines two or more shapes into one shape so they share a single fill, stroke, and shadow in one Shape layer. | 2 | Supported |
| [JSON to Shape](jsonToShape.md) | `jsonToShape` | Builds a shape from a JSON list of drawing commands, for custom paths that come from data, scripts, or other patches. | 2 | Supported |

## Layers & Effects

Reading layer geometry, converting coordinates, and producing layer effects.

| Patch | Key | What it does | Tier | Status |
|---|---|---|---:|---|
| [Layer Info](layerInfo.md) | `layerInfo` | Reads a layer's size, position, scale, anchor, and parent as they were laid out on the previous frame. | 2 | Supported |
| [Convert Position](convertPosition.md) | `convertPosition` | Converts a point from one layer's coordinate space to another's, so a layer can line up with a layer in a different group. | 2 | Supported |
| [Blur Effect](blurEffect.md) | `blurEffect` | Creates a blur for a layer's Effects property, softening everything the layer draws, with an option to keep its edges sharp. | 2 | Supported |
| [Color Controls Effect](colorControlsEffect.md) | `colorControlsEffect` | Adjusts a layer's brightness, contrast, saturation, and hue through its Effects property. | 2 | Supported |
| [Glass Effect](glassEffect.md) | `glassEffect` | Turns a layer into a pane of glass that frosts, tints, and bends whatever sits behind it, with a bright rim along its edge. | 3 | Web-limited |

## Utility

Plumbing: pass-through, variables, pack and unpack, debugging, and prototype control.

| Patch | Key | What it does | Tier | Status |
|---|---|---|---:|---|
| [Splitter](splitter.md) | `splitter` | Passes a value through unchanged, so you can name it, reuse it as a constant, tidy cables, or cast it to another type. | 1 | Supported |
| [Variable Broadcaster](variableBroadcaster.md) | `variableBroadcaster` | Shares a value under a name, so any Variable Receiver with that name can use it without a cable. | 1 | Supported |
| [Variable Receiver](variableReceiver.md) | `variableReceiver` | Outputs the value shared by the Variable Broadcaster with the same name, without a cable. | 1 | Supported |
| [Watch](watch.md) | `watch` | Shows a value right on the patch and logs its changes to the console, so you can see what a cable carries. | 1 | Supported |
| [Point](point.md) | `point` | Combines an X and a Y number into one point for a layer's Position, Anchor, Pivot, or any other 2D input. | 1 | Supported |
| [Point Unpack](pointUnpack.md) | `pointUnpack` | Splits a 2D point, such as a touch position, into separate X and Y numbers. | 1 | Supported |
| [Size](size.md) | `size` | Combines a width and a height into one size for a layer's Size or any other size input. | 1 | Supported |
| [Size Unpack](sizeUnpack.md) | `sizeUnpack` | Splits a size into separate Width and Height numbers. | 1 | Supported |
| [Restart Prototype](restartPrototype.md) | `restartPrototype` | Restarts the whole prototype from its first frame when it gets a pulse, as if you pressed Restart in the viewer. | 2 | Supported |
| [Point 3D](point3d.md) | `point3d` | Combines three numbers into one 3D point, such as separate X, Y, and Z scale amounts. | 2 | Supported |
| [Point 3D Unpack](point3dUnpack.md) | `point3dUnpack` | Splits a 3D point into its X, Y, and Z numbers so you can use or change each one on its own. | 2 | Supported |
| [Point 4D](point4d.md) | `point4d` | Combines four numbers into one 4D point so you can animate, compare, or pass four values as one. | 2 | Supported |
| [Point 4D Unpack](point4dUnpack.md) | `point4dUnpack` | Splits a 4D point into its X, Y, Z, and W numbers so each one can drive something different. | 2 | Supported |
| [Edges](edges.md) | `edges` | Combines four side distances into one Edges value for padding and insets, in top, right, bottom, left order. | 2 | Supported |
| [Edges Unpack](edgesUnpack.md) | `edgesUnpack` | Splits an Edges value into separate top, right, bottom, and left distances. | 2 | Supported |
| [Corner Radii](cornerRadii.md) | `cornerRadii` | Combines four corner radii into one value so a layer can round each corner by a different amount. | 2 | Supported |
| [Corner Radii Unpack](cornerRadiiUnpack.md) | `cornerRadiiUnpack` | Splits a Corner Radii value into the radius of each corner: top left, top right, bottom right, and bottom left. | 2 | Supported |

## Components

Patch component instances.

| Patch | Key | What it does | Tier | Status |
|---|---|---|---:|---|
| [Component](component.md) | `component` | Runs a group of patches you built once, with its own inputs, outputs, and memory everywhere you use it. | 1 | Supported |

## Scripting

Code patches.

| Patch | Key | What it does | Tier | Status |
|---|---|---|---:|---|
| [JavaScript](javascript.md) | `javascript` | Runs a JavaScript file whose code declares its own inputs and outputs, for logic other patches can't express. | 1 | Supported |
