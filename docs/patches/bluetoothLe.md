<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Bluetooth LE

Connects to a Bluetooth Low Energy device to read, write, and receive values, for hardware and sensor prototypes.

| | |
|---|---|
| Type key | `bluetoothLe` |
| Category | [Device](README.md#device) |
| Tier | 3 (hardware and platform-specific) |
| Status | Web-limited |
| Search terms | bluetooth, ble, gatt, peripheral, arduino, esp32, heart rate monitor, hardware prototype, iot |

## How it works
Bluetooth LE talks to a nearby Bluetooth Low Energy device, like a heart-rate strap, a smart bulb, or an Arduino board.

1. Send a pulse from a tap into **Connect**. The browser lists nearby devices that offer **Service UUID**, and you pick one.
2. The patch opens **Characteristic UUID**, one value on the device, and reads it once.
3. With **Notifications** on, new values arrive by themselves. **Read** asks again, and **Write** sends **Write Value**.

- **Format** says how bytes become numbers or text, like Unsigned 8-bit for a battery level.
- **Value** is the latest number, **Text** the latest text (or the bytes in hex), and **Received** pulses when a value arrives.
- **Connected** is true while linked, and **Error Message** explains what went wrong.

UUIDs accept standard names like battery_service, 4-character codes like 180F, or full UUIDs.

## Tips
- Use Chrome or Edge on a computer, or Chrome on Android. iPhones can't use Web Bluetooth.
- Before your hardware is ready, test with a phone app that simulates a Bluetooth device.

## Coming from Origami
Origami's Bluetooth LE patches aren't documented. This one patch covers connecting, reading, writing, and notifications.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Connect**<br>`connect` | `pulse` | — | Pulse to open the browser's device chooser and connect to the device you pick; send it from a tap. |
| **Disconnect**<br>`disconnect` | `pulse` | — | Pulse to end the connection. |
| **Read**<br>`read` | `pulse` | — | Pulse to ask the device for the characteristic's current value. |
| **Write**<br>`write` | `pulse` | — | Pulse to send Write Value to the characteristic. |
| **Write Value**<br>`writeValue` | `text` | `"0"` | What Write sends, encoded with Format: a number like 128, text, or hex bytes like 0A FF. |
| **Service UUID**<br>`serviceUuid` | `text` | `"battery_service"` | The service to look for: a standard name like heart_rate, a 4-character code like 180F, or a full UUID. |
| **Characteristic UUID**<br>`characteristicUuid` | `text` | `"battery_level"` | The value inside the service to read, write, or watch, written like Service UUID. |
| **Format**<br>`format` | `enum` | `uint8` | How the characteristic's bytes turn into Value and Text, and how Write Value becomes bytes. |
| **Notifications**<br>`notifications` | `boolean` | `true` | When on, new values arrive by themselves while connected, if the characteristic supports it. |
| **Name Prefix**<br>`namePrefix` | `text` · advanced | `""` | Only list devices whose names start with this text; empty lists every device offering the service. |

**Format options**

- **Unsigned 8-bit** (`uint8`): One byte, 0 to 255, like a battery level.
- **Signed 8-bit** (`int8`): One byte, -128 to 127.
- **Unsigned 16-bit** (`uint16`): Two bytes, little-endian, 0 to 65,535.
- **Signed 16-bit** (`int16`): Two bytes, little-endian, -32,768 to 32,767.
- **Unsigned 32-bit** (`uint32`): Four bytes, little-endian.
- **Signed 32-bit** (`int32`): Four bytes, little-endian.
- **Float 32-bit** (`float32`): Four bytes, little-endian decimal number.
- **Text** (`text`): UTF-8 text, like a command string.
- **Hex Bytes** (`hex`): Raw bytes written as hex pairs, like 0A FF.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Value**<br>`value` | `number` | The latest value as a number, decoded with Format. |
| **Text**<br>`text` | `text` | The latest value as text for the Text format, otherwise its bytes in hex like 0A FF. |
| **Received**<br>`received` | `pulse` | Pulses on the frame a new value arrives from a read or a notification. |
| **Connected**<br>`connected` | `boolean` | True while connected to a device. |
| **Device Name**<br>`deviceName` | `text` | The connected device's name, or empty. |
| **Error Message**<br>`errorMessage` | `text` | What went wrong most recently, like a cancelled chooser; empty after a successful connect. |
| **Loading**<br>`loading` | `boolean` · advanced | True while connecting. |
| **Available**<br>`available` | `boolean` · advanced | True when this browser or app supports Bluetooth LE. |
| **Error**<br>`error` | `boolean` · advanced | True when the last connect, read, or write failed. |

## Examples

### Show a device's battery level

```text
layer battery_label text "Battery Label" @16,200 text←battery.value
layer connect_button rectangle "Connect Button" @16,780 370x56 cornerRadius=14
patch tap_connect interaction layer=@connect_button
patch battery bluetoothLe connect←tap_connect.tap serviceUuid="battery_service" characteristicUuid="battery_level" format=uint8
```

### Grow a heart when a hardware button is pressed

The board sends 1 while its button is held and 0 when released.

```text
layer heart oval "Heart" @171,380 60x60 color=#E5484DFF scale←grow.output
layer pair_button rectangle "Pair Button" @16,780 370x56 cornerRadius=14
patch tap_pair interaction layer=@pair_button
patch board bluetoothLe connect←tap_pair.tap serviceUuid="19b10000-e8f2-537e-4f6c-d104768a1214" characteristicUuid="19b10001-e8f2-537e-4f6c-d104768a1214" format=uint8 notifications=true
patch press popAnimation number←board.value bounciness=10 speed=16
patch grow transition<number> progress←press.output start=1 end=1.3
```

## Common mistakes

- Connect does nothing and Error Message says it needs a tap: browsers only open the device chooser right after someone taps. Wire Connect from an Interaction's Tap, not from When Prototype Starts.
- The chooser lists no devices: the device doesn't advertise Service UUID. Check which service your device offers, or find it by name with Name Prefix.
- Value shows strange, huge numbers: Format doesn't match the device's data. A battery level is Unsigned 8-bit; many sensors send Signed 16-bit or Float 32-bit.
- Nothing works on an iPhone: Safari has no Web Bluetooth. Use Chrome on Android or on a computer.

## Pairs well with

- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Pulse](pulse.md): Turns an on/off state into pulses: one the moment it turns on and another the moment it turns off.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Format Number](formatNumber.md): Turns a number into display text with set decimals, separators, a percent or K/M style, and your own prefix and suffix.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.

## Availability

**Web-limited.** Uses Web Bluetooth, which ships only in Chromium browsers (Chrome and Edge on desktop, Chrome on Android) and the desktop app. Safari, iOS, and Firefox have none, and connecting always needs a tap and the browser's device chooser.

Works in the desktop app, the web player in desktop browsers, and the web player on phones and tablets.

Tier 3: hardware and platform-specific.

## Origami mapping

- **Origami patch:** Bluetooth LE
