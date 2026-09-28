# Scooter Hub

A dark, dashboard-style React Native (Expo, TypeScript) app for electric scooters. It connects over Bluetooth LE, identifies the scooter, reads the telemetry the scooter actually exposes, tracks rides, logs errors and maintenance, and includes a BLE developer inspector.

The app never invents values. If a scooter does not expose something, the UI shows **Not available**. If a command is not documented for that scooter, it shows **Unsupported**.

## Get the APK

Scooter Hub is a real native Android app (React Native, not a web page): it uses Android's Bluetooth LE stack through `react-native-ble-plx`, Android location services, notifications and a foreground service. The full Gradle project is in `android/` (manifest, resources, icons, permissions, `app.scooterhub.mobile`, version 3.0.0 / code 3).

Three ways to get an installable `ScooterHub.apk`, easiest first:

1. **GitHub Actions (free, no Android tools needed).** Push this folder to a GitHub repository, open the **Actions** tab, run **Android APK**, and download the `ScooterHub-apk` artifact (it contains `ScooterHub.apk`). Pushing a tag like `v3.0.0` also attaches the APK to a GitHub Release. The workflow is in `.github/workflows/android-apk.yml`.
2. **EAS cloud build (free Expo account).**
   ```bash
   npm install
   npx eas-cli@latest login
   npx eas-cli@latest build -p android --profile preview
   ```
   The `preview` profile in `eas.json` produces an APK and prints a download link.
3. **On your own computer** with Android Studio (SDK + JDK 17) installed:
   ```bash
   npm install
   npm run apk          # → ScooterHub.apk in the project folder
   # after changing app.json, re-sync the native project first:
   npx expo prebuild --platform android
   ```

To install, copy the APK to the phone and open it (allow "install unknown apps" for your file manager once). The release APK is signed with the debug key, which is fine for sideloading; use your own keystore or EAS for the Play Store.

Before calling a build ready, walk through **TESTING.md** on a real phone and scooter.

## Run it (development)

BLE and maps need native modules, so **Expo Go will not work**. Use a development build:

```bash
npm install
npx expo run:android        # or: npx expo run:ios   (needs Xcode on macOS)
# or build in the cloud:
npx eas-cli@latest build --profile development --platform android
```

Then `npm start` and open the dev build on a real phone (BLE does not work in simulators).

Android maps need a Google Maps API key. Add it to `app.json`:

```json
"android": { "config": { "googleMaps": { "apiKey": "YOUR_KEY" } } }
```

Checks:

```bash
npm run typecheck
npm test            # protocol decoders tested against published packet captures
```

## What works with which scooter

| Scooter | Protocol adapter | What you get |
| --- | --- | --- |
| Xiaomi M365, M365 Pro (older, unencrypted BLE firmware) | `xiaomi-m365` (55AA) | Speed, battery %, voltage, current, power (calculated), battery temps, controller temp, odometer, trip distance/time, range, error/warning codes, cell voltages, BMS health/cycles/capacity, tail light / cruise / KERS state and controls |
| Ninebot ES1/ES2/ES4 (older, unencrypted BLE firmware) | `ninebot-es` (5AA5), read-only | Same telemetry plus riding mode and reported power |
| Xiaomi Electric Scooter 4 Pro (2nd Gen), `xiaomi.scooter.t2336` | `xiaomi-t2336` (encrypted securitychip login + MIoT SPEC), read-only | Battery %, voltage, current, power, range, trip distance/time, average speed, odometer, battery and controller temperature, fault code, battery health (SOH), charge cycles, remaining mAh, charging state, firmware and serials. Needs the scooter key from the owner's Xiaomi account plus the scooter PIN (Settings > Xiaomi scooter key). The scooter has no live-speed value; the dashboard shows phone GPS speed during a ride, labelled as such |
| Xiaomi 1S, Essential, Pro 2, 3 | `xiaomi-m365` if the scooter answers the 55AA register read (older BLE firmware) | As M365 |
| Xiaomi 4, 4 Pro (1st Gen), 4 Lite, 4 Ultra, 5 / 5 Pro / 5 Max, 6, 6 Ultra | `xiaomi-t2336`, experimental | Same securitychip login (confirmed identical for the 5 Pro in github.com/KuziaMother/SCOOTER_5_PRO docs/BLE.md). Values come from Xiaomi's official MIoT property list for the model (miot-spec.org), loaded once during key setup; only properties with a known name are read, including live speed where the model has one. Not yet confirmed on a real scooter |
| NAVEE (e.g. ST5 Max) | recognised, `generic-ble` | Not supported: NAVEE's login uses secret keys taken from the NAVEE app, which Scooter Hub will not use |
| Ninebot MAX G30, Segway ZT3 Pro, anything else | `generic-ble` | Standard Bluetooth Battery / Device Information services if present, plus the developer inspector |

**Encrypted firmware:** newer Xiaomi/Ninebot BLE firmware encrypts this link. Scooter Hub never bypasses encryption. It reads encrypted Xiaomi scooters only by logging in with the owner's own key and PIN exactly as the Xiaomi Home app does (a login with the existing key, not a new pairing, so the Mi Home binding is untouched). After login it only sends property GET requests: no lock, unlock or settings writes. Other encrypted scooters answer nothing, and the app says so and falls back to the generic profile.

No public protocol documentation was found for the Segway ZT3 Pro, so it is listed in the database with generic support only. Use Developer Mode to inspect it; add an adapter once a documented protocol exists.

## Protocol sources

Every UUID, frame format, register and scaling in `src/protocols` cites its source in code comments:

- Bluetooth SIG assigned numbers (Battery 0x180F/0x2A19, Device Information 0x180A): https://www.bluetooth.com/specifications/assigned-numbers/
- Nordic UART Service UUIDs: https://docs.nordicsemi.com/bundle/ncs-latest/page/nrf/libraries/bluetooth/services/nus.html
- Xiaomi/Ninebot framing, commands and register maps: https://github.com/etransport/ninebot-docs/wiki (pages `protocol`, `M365ESC`, `M365BMS`, `ES2ESC`, `ES2BMS`)
- Reference implementation (Ninebot checksum includes the length byte, host address 0x3E, 20-byte BLE writes): https://github.com/etransport/py9b
- Captured Mi Home traffic with scaling examples (used as test vectors): https://github.com/CamiAlfa/M365-BLE-PROTOCOL/blob/master/protocolo
- Encryption on newer firmware: https://www.irmo.de/2023/11/08/e-scooter-bluetooth-hacking/
- Xiaomi 4 Pro 2nd Gen (t2336) login, SPEC channel and property map (MIT): https://github.com/mehesbalazs/xiaomi-scooter-4-pro-2 (`docs/protocol.md`, `scooter.py`). Crypto uses the audited @noble libraries; AES-CCM is tested against OpenSSL and the full login/read flow against a simulated scooter in `src/protocols/__tests__/xiaomiSecure.test.ts`

## Safety rules built into the code

- Polling only sends documented **read** requests.
- Detection probes one documented register read per protocol; nothing else is written.
- Write commands exist only for Xiaomi tail light, cruise control and KERS, using the exact frames captured from the Mi Home app, and each one asks for confirmation.
- No speed-limit, activation, odometer, reset or firmware commands anywhere. The developer raw-write tool is off by default, requires a second switch plus confirmation, and blocks those command codes and the speed-limit registers (`src/protocols/writeGuard.ts`).
- Clearing errors is not offered: no supported protocol documents it.
- Temperature warnings come only from overheat codes the scooter reports; the app sets no thresholds of its own.
- Firmware page is informational only.

## Architecture

```
src/
├── app/                     Expo Router screens (UI)
│   ├── (tabs)/              Dashboard, Live, Ride, Diagnostics, More
│   └── bluetooth, battery, motor, controls, performance, map, history,
│       garage, scooter/[id], ride/[id], maintenance, firmware, database,
│       developer (BLE Lab), settings, identify, info, health, stats,
│       achievements, themes, dashboard-layout
├── services/
│   ├── ScooterManager.ts    connection lifecycle, polling, errors, alerts, auto-reconnect
│   ├── RideTracker.ts       start/stop rides, 1 Hz sampling
│   ├── GPSManager.ts        expo-location wrapper
│   ├── rideMath.ts          ride statistics, standing-start times (pure, tested)
│   ├── stats.ts             period totals, records, insights, achievements (pure, tested)
│   ├── health.ts            health summary from reported codes (pure, tested)
│   ├── Notifier.ts          in-app + phone notifications, maintenance reminders
│   └── telemetryHistory.ts  time series for live graphs
├── ble/
│   ├── BluetoothManager.ts  react-native-ble-plx: scan, connect, GATT, read/write/notify
│   └── uuids.ts             sourced UUIDs only
├── protocols/
│   ├── types.ts             ScooterProtocol interface, Reading (value or null)
│   ├── registry.ts          protocol factory + detection
│   ├── UartRegisterProtocol.ts  shared request/response over Nordic UART
│   ├── xiaomi/              55AA frame codec + M365 decoder
│   ├── ninebot/             5AA5 frame codec + ES decoder
│   ├── generic/             standard BLE services
│   ├── errorCodes.ts        documented error tables
│   └── writeGuard.ts        developer-write blocklist
├── data/scooterDatabase.ts  models, specs, protocol mapping
├── data/themes.ts         background themes
├── widgets/               Android home-screen widget
├── store/                   zustand stores persisted with AsyncStorage
└── ui/                      theme, gauges, charts, glass cards, map
```

Data flow: `UI → ScooterManager → BleSession (BLE layer) → ScooterProtocol → model decoder`.

### Adding a scooter

1. Implement `ScooterProtocol` (or extend `UartRegisterProtocol` for a register bus). Cite the source for every UUID, frame and scaling.
2. Register it in `protocols/registry.ts` (`createProtocol` and `detectProtocol`).
3. Add the model to `data/scooterDatabase.ts` with its `protocol` id.
4. Add a test in `protocols/__tests__` with real captured frames.

## What's new in 2.0

Everything from 1.0 is still there. Added on top:

- **Themes:** Sunset (original), Deep Space, Nebula and Aurora with twinkling stars, Carbon, Synthwave, Deep Ocean, Midnight, or your own photo. Seven accent colours plus a dynamic accent that turns green while charging, orange on a warning code and red on a critical code (only what the scooter reports). More → Themes.
- **Dashboard layouts:** Classic, Compact, Large speed, Battery focused, Diagnostic, Ride mode, or pick and order your own cards. Each card subscribes only to the values it shows, so telemetry ticks don't rebuild the whole screen.
- **Connection sequence:** Searching → Scooter found → Connecting → Reading scooter data → Connected, with haptics, a "<model> connected" banner, connected time and auto-reconnect (per-scooter auto-connect switch in the garage).
- **Scooter health:** Normal / Warning / Critical per system (battery, motor, controller, communication, lights, errors, firmware), built only from documented error codes and connection state. Anything the scooter doesn't report is **Unknown**, never "fine".
- **Advanced scooter info:** every identity, firmware, battery and usage field the protocol exposes; database specs are labelled as manufacturer specs.
- **Battery:** remaining Wh (calculated from reported mAh × voltage), live %, voltage and power graphs, energy-flow animation (Battery → Controller → Motor, reversing only when the scooter reports negative current while moving).
- **Motor:** animated motor / controller / battery temperature gauges. They turn red only on the scooter's own overheat codes.
- **Rides:** average and peak power, Wh/km, elevation gain and loss, graphs for speed, battery, power, temperature and elevation. Maps colour the route by speed, battery, elevation, temperature or acceleration; tap the route to see that point's telemetry.
- **Statistics:** today / week / month / year / all time, all-time records, most efficient ride, and insights computed only from your recorded rides.
- **Achievements:** distance, ride count, long rides, maintenance and consistency. None reward speed.
- **Garage:** km per scooter, custom icon or photo, per-scooter rides, stats, maintenance, errors, firmware, settings and connection history.
- **Maintenance:** tires, tire pressure, brakes, pads, bearings, suspension, screws, lights, charging port, battery, cleaning, general service; last/next date, notes, reminders; Due soon / Due / Completed.
- **Notifications:** low battery, high temperature (scooter codes), errors, disconnect, maintenance, charging complete, abnormal telemetry. Each has its own switch, and they can also appear as phone notifications.
- **Android home-screen widget:** battery, connection state, speed and last ride. iOS widgets need a native WidgetKit extension and are not included.
- **BLE Lab:** the developer inspector, plus a connected-device card and live packets-per-second.
- **Privacy:** export, import (merges, never overwrites), delete rides, delete scooter profiles, delete location history (strips GPS from rides, keeps the rest).
- **Motion:** spring entrances, smoothly counting numbers, skeleton loaders, blurred tab bar, haptics, expandable cards, pull to refresh. Settings → Reduce motion turns the animations off.

## What's new in 3.0

Added on top of 2.0; nothing was removed.

- **Data integrity labels everywhere:** every tile shows **Measured**, **Calculated**, **Estimated** or **Unavailable**, plus its source (Scooter BLE, Scooter BMS, Phone GPS, Phone accelerometer, Ride history, Model database).
- **Interactive 3D scooter** (dashboard, profile, full-screen viewer): drag to rotate, pinch to zoom, reset camera. Wheels spin at the scooter-reported speed, headlight/brake/tail light and battery strip follow reported states only. It is always labelled as a generic visualization, because no exact per-model 3D models exist. Turn indicators stay unlit: no supported protocol reports them.
- **Cockpit mode:** full-screen, huge speed, four swipeable pages (speed + battery, power + temperatures, map, ride stats), optional keep-screen-on while open, rotates to landscape.
- **G-force:** longitudinal acceleration/braking from scooter speed (calculated) or GPS (estimated), and from the phone accelerometer after a mount calibration (lateral only then). Peaks per session.
- **Performance:** current/avg/max speed, RPM and peak, power and peak, voltage, current, acceleration, distance, energy, Wh/km, six live graphs.
- **Personal range estimate** learned from your rides (weighted recent Wh/km × remaining energy, or km per battery %), marked Estimated and "preliminary" until there's enough history.
- **Voltage sag:** resting vs loaded voltage, max drop, voltage-vs-current scatter, per-ride history, neutral wording only.
- **Rides:** separate motor/controller/battery temperature graphs with tap-for-details, a timeline slider that scrubs the map marker and all readouts, **Ride replay** (0.25×–4×, play/pause/restart/seek), ride comparison, and a data-based ride analysis.
- **Route heatmap** of your own routes (opt-in each visit, stays on the phone).
- **Personal records** (each links to its ride) and **Scooter Hub Wrapped** yearly recap.
- **More achievements:** 10 and 50 hours riding, most efficient ride. None reward speed.
- **Dashboard presets:** Minimal, Performance, Battery, Diagnostic, Cockpit (plus the 2.0 layouts and custom).
- **OLED / low-power mode:** black background, no photo or effects, bigger numbers, graphs refresh once a second.
- **Haptics and sounds:** optional, rate-limited, only on events (connect, disconnect, ride start/end, achievements, warnings, buttons). Sounds are off by default and respect silent mode.
- **Background ride tracking:** with Settings → Background tracking on, rides keep recording with the screen off through an Android foreground service ("Recording ride" notification). That service also keeps the Bluetooth connection alive while recording.
- **BLE Lab discovery workflow:** device summary (manufacturer from advertised company ID when known, services, characteristics, MTU), per-characteristic capabilities, raw bytes/hex/ASCII, timestamps, notification Hz, 20k-packet capture with JSON/CSV debug export. Arbitrary writes still disabled by default.
- **Easter eggs** (Settings → Easter eggs): launch animation, a first-connection celebration, and a few hidden things to find. They never touch data.
- Handles Bluetooth off, location services off, permission denial, disconnects and app backgrounding without crashing.

## Hidden developer mode

Tap the logo on the **More** tab seven times (or toggle it in Settings). It shows services, characteristic UUIDs and properties, lets you read and subscribe, and logs every TX/RX packet with timestamps, hex and decoded values. Logs export as JSON through the share sheet.

## Not in this version

- iOS home-screen widgets.
- Exact per-model 3D scooter models (a labelled generic model is used).
- A prebuilt APK from this environment (its network policy blocks the Android SDK download); build it with the steps above.
- Cloud sync (all data is local).
- Languages other than English.
