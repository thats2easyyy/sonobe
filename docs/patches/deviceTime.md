<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Device Time

Reads the real date and time from the device's clock, for status bar clocks, dates, and countdowns.

| | |
|---|---|
| Type key | `deviceTime` |
| Category | [Device](README.md#device) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | clock, current time, date, now, epoch, unix time, timestamp, time of day, wall clock |

## How it works
Device Time reads the clock of the device running the prototype, so it shows the real time. Unlike Time, restarting the prototype doesn't reset it.

- **Seconds** counts whole seconds since January 1, 1970 (UTC), the standard way computers store a moment. Wire it into Format Date & Time to show a readable date or time.
- **Milliseconds** is the part of the current second, from 0 to 999.
- **Time of Day** is seconds since midnight in the device's time zone, with fractions, from 0 up to 86,400.
- **Enabled** freezes the outputs while off.

## Tips
- For an analog clock, multiply Time of Day by 6 for the second hand's rotation, by 0.1 for the minute hand, and by 1/120 for the hour hand.
- Count down to a moment by subtracting Seconds from that moment's seconds.
- Drive animations from Time instead. The device clock can jump when the system time changes.

## Coming from Origami
Enable is called Enabled. Time of Day is new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Enabled**<br>`enabled` | `boolean` | `true` | When on, the outputs follow the device clock. When off, they hold their last values. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Seconds**<br>`seconds` | `number` (duration) | Whole seconds since January 1, 1970 (UTC); wire into Format Date & Time for readable text. |
| **Milliseconds**<br>`milliseconds` | `number` | The part of the current second in milliseconds, from 0 to 999. |
| **Time of Day**<br>`timeOfDay` | `number` (duration) | Seconds since midnight in the device's time zone, with fractions, from 0 up to 86,400. |

## Examples

### Sweep an analog clock's hands

Rotations come from Time of Day: 6° per second for the second hand and 0.1° per second for the minute hand.

```text
layer second_hand rectangle "Second Hand" @201,400 2x120 anchor=[0.5,1] pivot=[0.5,1] rotation←second_angle.output
layer minute_hand rectangle "Minute Hand" @201,400 4x100 anchor=[0.5,1] pivot=[0.5,1] rotation←minute_angle.output
patch clock deviceTime
patch second_angle multiply[2] value1←clock.timeOfDay value2=6
patch minute_angle multiply[2] value1←clock.timeOfDay value2=0.1
```

### Count down the seconds to 2027

1798761600 is midnight UTC on January 1, 2027, in seconds since 1970.

```text
layer countdown text "Countdown" @16,120 text←remaining.output
patch clock deviceTime
patch remaining subtract[2] value1=1798761600 value2←clock.seconds
```

## Common mistakes

- The text shows a huge number like 1789000000: Seconds counts from 1970. Wire it into Format Date & Time, or use Time of Day for the time since midnight.
- An animation driven by Device Time jumps now and then: the device clock can change while the prototype runs. Drive animations from Time, and use Device Time to show real dates and times.

## Pairs well with

- [Format Date & Time](formatDateTime.md): Turns seconds into readable text: a clock time, a date, a media timestamp like 2:05, or your own % pattern.
- [Multiply](multiply.md): Multiplies values together, for scaling a number, spacing looped layers, or turning 0–1 progress into distance.
- [Subtract](subtract.md): Subtracts one or more values from a starting value, such as finding how far apart two positions are.
- [Time](time.md): Counts the seconds and frames since the prototype started.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Device Time (`builtin.time.device`)

| Sonobe port | Origami label |
|---|---|
| `enabled` | Enable |
