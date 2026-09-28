# Scooter Hub — device test checklist

The code is typechecked, unit-tested (protocol decoders, ride math, stats, health, range, records, ride analysis) and bundled for Android in CI. Everything below needs a **real Android phone** (BLE does not work in emulators) and, for the scooter items, a real scooter. Tick each one before calling a build release-ready.

Install: build `ScooterHub.apk` (see README → Get the APK), copy it to the phone, open it, allow "install unknown apps" once.

## Install and startup
- [ ] APK installs; launcher shows the Scooter Hub icon and name.
- [ ] First launch shows the logo intro (skip: Settings → Easter eggs off) and lands on the dashboard.
- [ ] Force-close and reopen: settings, theme, garage, rides and achievements are still there.
- [ ] Reboot the phone, open the app: data intact, auto-connect tries the last scooter (if enabled).

## Permissions
- [ ] Bluetooth permission prompt appears on first scan (Android 12+: "Nearby devices").
- [ ] Deny it: the app says Bluetooth permission is needed and does not crash; granting later works.
- [ ] Location prompt appears when starting a ride; deny → ride records scooter data without a route.
- [ ] Background tracking on (Settings → Ride tracking): Android asks for "Allow all the time"; refusing falls back to foreground-only recording.
- [ ] Notifications prompt (Android 13+); deny → in-app alerts still work.

## Bluetooth
- [ ] Bluetooth off → dashboard badge says "Bluetooth off"; turning it on is detected.
- [ ] Scan lists nearby BLE devices with RSSI; the stepper shows SEARCHING → SCOOTER FOUND.
- [ ] Connect to a supported scooter: CONNECTING → READING SCOOTER DATA → CONNECTED, "<model> connected", haptic.
- [ ] Unknown/encrypted scooter: falls back to generic BLE; BLE Lab lists its services and characteristics.
- [ ] Live values update; values the scooter doesn't send show "Not available".
- [ ] Turn the scooter off → "Scooter disconnected" alert; with auto-reconnect it reconnects when back in range.
- [ ] Disconnect button disconnects cleanly (scooter can be connected again).

## Rides and GPS
- [ ] Start/stop a ride; the summary shows distance, speed, battery, power, Wh/km (or Not available).
- [ ] Location services off → clear message, no crash.
- [ ] With background tracking: start a ride, lock the screen for 5 min, unlock → route and samples continue; "Recording ride" notification visible while recording and gone after stopping.
- [ ] Ride replay plays at 0.25×–4×, slider seeks instantly; timeline on the ride page moves the map marker.

## Notifications
- [ ] Low battery, disconnect, error, charging complete and maintenance reminders appear in the shade when enabled, and not when their switch is off.

## Display
- [ ] Rotate the phone: Cockpit, 3D scooter and Ride replay rotate; other screens stay portrait.
- [ ] Cockpit "keep screen on" keeps the display awake only while Cockpit is open.
- [ ] OLED mode: black background, no animations, larger numbers.
- [ ] Themes, accent colours and your own photo apply everywhere.
- [ ] Home-screen widget can be added and shows battery / connection / last ride.

## Stress
- [ ] 30 minutes connected with the dashboard, a live graph and a ride recording at the same time: no stutter, no growing lag, memory stable (Android Studio profiler or `adb shell dumpsys meminfo app.scooterhub.mobile`).
