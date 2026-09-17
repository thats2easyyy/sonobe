<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Format Date & Time

Turns seconds into readable text: a clock time, a date, a media timestamp like 2:05, or your own % pattern.

| | |
|---|---|
| Type key | `formatDateTime` |
| Category | [Text](README.md#text) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | date & time formatter, date formatter, time formatter, strftime, clock, timestamp, media time, duration, epoch |

## How it works
Format Date & Time turns **Time**, a number of seconds, into text.

- For clock times and dates, Time is a timestamp: seconds since January 1, 1970, UTC. Device Time and most web APIs give timestamps like this.
- For **Media Time** and **Short Media Time**, Time is a duration, such as a video's current time. 125 seconds shows 02:05 or 2:05, and an hour or more adds hours (1:02:05).
- **Custom** uses **Custom Format**, a pattern of % codes:

| Code | Shows | Code | Shows |
|---|---|---|---|
| %A | Saturday | %a | Sat |
| %B | March | %b | Mar |
| %d | 14 | %Y | 2026 |
| %H | 18 (24-hour) | %I | 06 (12-hour) |
| %M | 30 | %S | 05 |
| %p | PM | %y | 26 |

Put a hyphen after % to drop leading zeros: %-I:%M %p shows 6:30 PM.

Names of months and days are in English. The advanced **Time Zone** port chooses between the device's time zone and UTC.

## Tips
- For a live clock, wire Device Time into Time.
- For elapsed time from Stopwatch, use Media Time.

## Coming from Origami
Formerly Date & Time Formatter. The formats are the same, and Time Zone is new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Time**<br>`time` | `number` | `0` | Seconds since January 1, 1970 (UTC) for clock times and dates, or a duration in seconds for the Media Time formats. |
| **Format**<br>`format` | `enum` | `time12Hour` | How the text looks: a clock time, a date, a media timestamp, or a custom pattern. |
| **Custom Format**<br>`customFormat` | `text` | `"%H:%M:%S"` | The pattern used when Format is Custom, such as "%B %-d" for March 14. Codes start with %. |
| **Time Zone**<br>`timeZone` | `enum` · advanced | `device` | Which time zone clock times and dates are shown in; the Media Time formats ignore it. |

**Format options**

- **12-Hour Time (6:30 PM)** (`time12Hour`)
- **12-Hour Time with Seconds (6:30:05 PM)** (`time12HourSeconds`)
- **24-Hour Time (18:30)** (`time24Hour`)
- **24-Hour Time with Seconds (18:30:05)** (`time24HourSeconds`)
- **Short Date (2026-03-14)** (`shortDateYmd`)
- **Short Date (14-03-2026)** (`shortDateDmy`)
- **Short Date (03-14-2026)** (`shortDateMdy`)
- **Medium Date (Mar 14, 2026)** (`mediumDateMdy`)
- **Medium Date (14 Mar, 2026)** (`mediumDateDmy`)
- **Long Date (March 14, 2026)** (`longDateMdy`)
- **Long Date (14 March, 2026)** (`longDateDmy`)
- **Media Time (02:05)** (`mediaTime`): Treats Time as a duration, with zero-padded minutes.
- **Short Media Time (2:05)** (`shortMediaTime`): Treats Time as a duration, without padding the first number.
- **Custom** (`custom`): Uses the % codes in Custom Format.

**Time Zone options**

- **Device** (`device`): The time zone of the device running the prototype.
- **UTC** (`utc`): Coordinated Universal Time, the same everywhere.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Text**<br>`text` | `text` | The formatted time or date. |

## Examples

### Recording timer

Stopwatch's Time is a duration, so Media Time counts 00:00, 00:01, and so on.

```text
layer record_button oval "Record" @163,700 64x64 color="#FF3B30FF"
layer timer_label text "Timer" @170,640 text←timer_text.text
patch tap_record interaction layer=@record_button
patch recording switch flip←tap_record.tap
patch rec_pulses pulse on←recording.on
patch timer stopwatch start←rec_pulses.turnedOn stop←rec_pulses.turnedOff
patch timer_text formatDateTime time←timer.time format=mediaTime
```

### Event date from a timestamp

Shows Saturday, March 14 at 6:30 PM.

```text
layer event_date text "Event Date" @24,160 text←date_label.text
patch date_label formatDateTime time=1773513000 format=custom customFormat="%A, %B %-d at %-I:%M %p" timeZone=utc
```

## Common mistakes

- A timer shows strange hours or minutes: clock and date formats treat Time as a date in your time zone. Use Media Time for durations, such as Stopwatch's Time.
- The date shows January 1, 1970: Time is 0 or a small number. Wire in a timestamp in seconds, such as from Device Time.
- The date is thousands of years off, or the text is empty: the timestamp is in milliseconds. Divide it by 1000 before wiring it into Time.

## Pairs well with

- [Device Time](deviceTime.md): Reads the real date and time from the device's clock, for status bar clocks, dates, and countdowns.
- [Stopwatch](stopwatch.md): Measures elapsed seconds that you can start, pause, and reset with pulses.
- [Video Info](videoInfo.md): Reads a Video layer's current time, length, and progress, for scrubbers, time labels, and player controls.
- [Time](time.md): Counts the seconds and frames since the prototype started.
- [Loop Over Array](loopOverArray.md): Turns a JSON array into a loop, one item per element, so layers repeat for each entry.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Date & Time Formatter (`builtin.time.formatter`)

| Sonobe port | Origami label |
|---|---|
| `text` | Output |
