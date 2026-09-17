<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Location

Reports where the device is on Earth as latitude and longitude, or a preset city so demos work anywhere.

| | |
|---|---|
| Type key | `location` |
| Category | [Device](README.md#device) |
| Tier | 3 (hardware and platform-specific) |
| Status | Web-limited |
| Search terms | gps, geolocation, latitude, longitude, coordinates, current location, where am i, map location |

## How it works
Location reports where the device is on Earth. **Latitude** runs from -90 (South Pole) to 90 (North Pole), and **Longitude** from -180 to 180, both in degrees.

- **Override** swaps the real location for a preset city. On Current Location, the viewer asks permission the first time and then follows the device as it moves.
- **Name** is the city for an override, or the coordinates as text for the real location.
- **Available** is true once there's a location to report.
- **Enabled** turns location off, and the device stops tracking.
- Advanced outputs: **Accuracy** in meters, **Loading** while waiting for a first reading, and **Error Message** when location fails.

## Tips
- Demo with an override city so the prototype works on any computer without a permission prompt.
- Round coordinates with Format Number before showing them.
- Insert Latitude and Longitude into a weather or map URL with Text Replace, then fetch it with Network Request.

## Coming from Origami
Override's city list differs, and Name shows coordinates for the real location because Sonobe has no geocoding service. Enabled, Available, Accuracy, Loading, and Error Message are new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Enabled**<br>`enabled` | `boolean` | `true` | When off, the device stops tracking location, Available turns false, and the values hold. |
| **Override**<br>`override` | `enum` | `current` | Current Location uses the device's real position; pick a city to use its coordinates instead, with no permission prompt. |

**Override options**

- **Current Location** (`current`): The device's real position; asks permission the first time.
- **San Francisco** (`sanFrancisco`): City center, 37.7749, -122.4194.
- **New York** (`newYork`): City center, 40.7128, -74.006.
- **Mexico City** (`mexicoCity`): City center, 19.4326, -99.1332.
- **São Paulo** (`saoPaulo`): City center, -23.5505, -46.6333.
- **London** (`london`): City center, 51.5074, -0.1278.
- **Paris** (`paris`): City center, 48.8566, 2.3522.
- **Lagos** (`lagos`): City center, 6.5244, 3.3792.
- **Cape Town** (`capeTown`): City center, -33.9249, 18.4241.
- **Dubai** (`dubai`): City center, 25.2048, 55.2708.
- **Mumbai** (`mumbai`): City center, 19.076, 72.8777.
- **Singapore** (`singapore`): City center, 1.3521, 103.8198.
- **Tokyo** (`tokyo`): City center, 35.6762, 139.6503.
- **Sydney** (`sydney`): City center, -33.8688, 151.2093.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Latitude**<br>`latitude` | `number` (angle) | Degrees north (positive) or south (negative) of the equator, from -90 to 90. |
| **Longitude**<br>`longitude` | `number` (angle) | Degrees east (positive) or west (negative) of Greenwich, from -180 to 180. |
| **Name**<br>`name` | `text` | The city name for an override, or the coordinates as text for the real location. |
| **Available**<br>`available` | `boolean` | True once there's a location to report. |
| **Accuracy**<br>`accuracy` | `number` (distance) · advanced | How far off the real location might be, in meters; 0 for override cities. |
| **Loading**<br>`loading` | `boolean` · advanced | True while waiting for the first reading of the real location. |
| **Error Message**<br>`errorMessage` | `text` · advanced | Why the location isn't available, such as a denied permission; empty when everything works. |

## Examples

### Show where the device is

```text
layer place_label text "Place Label" @16,120 text←where.name
patch where location override=current
```

### Drop a pin once a demo city is known

```text
layer pin oval "Pin" @191,400 20x20 color=#E5484DFF scale←drop.output
patch where location override=tokyo
patch drop popAnimation number←where.available bounciness=8 speed=14
```

## Common mistakes

- Latitude and Longitude stay 0 on a phone: the web player opened over http://, and browsers only share location with secure pages. Use an override city, or open the prototype from a secure link.
- A permission prompt interrupts every demo: Current Location asks for access. Pick an override city for presentations.
- The map shows the wrong spot: many map and weather services want longitude first. Check which order the URL expects.

## Pairs well with

- [Format Number](formatNumber.md): Turns a number into display text with set decimals, separators, a percent or K/M style, and your own prefix and suffix.
- [Text Replace](textReplace.md): Replaces every occurrence of some text with other text, for templates like "Hi {name}" or removing characters.
- [Network Request](networkRequest.md): Loads JSON, text, images, video, or sound from a URL when it gets a pulse, and reports loading and errors.
- [If / Else](ifElse.md): Outputs one of two values depending on whether a condition is on or off.
- [Math Expression](mathExpression.md): Calculates numbers from a formula you type, creating an input for each variable and an output for each result.

## Availability

**Web-limited.** Uses the Geolocation API, which needs the person's permission and a secure page, so the http:// LAN player can't use it, and Linux desktops have no location service. Override cities work everywhere.

Works in the desktop app, the web player in desktop browsers, and the web player on phones and tablets.

Tier 3: hardware and platform-specific.

## Origami mapping

- **Origami patch:** Location (`builtin.gps`)
