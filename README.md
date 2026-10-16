# Vacuula Mobile (Android + iOS)

DISCLAIMER!!! This is not affiliated with Vacuula, it was made as a solution for my own itch.

A React Native / Expo app that controls robots through a [Vacuula](https://github.com/vacuula/vacuula)
server on your network — the same functionality as the server's web interface, in a native app.

## Features

- Connect to a server by host/port (remembered); live updates over the server's event streams, pull-to-refresh.
- **Robots list** with state, battery, dock/offline status. Gen3 (D3–D7) and Gen4 (D8–D10).
- **Control**: start / resume, pause, stop, return to base, find my robot, dismiss alerts; choose
  whole-house / map-zone / spot cleaning, mode (eco/turbo/…; D10 extras), navigation mode, zones, no-go toggle.
- **Maps**: view floor maps with zones and no-go areas; rename, enable/disable, activate Gen4 floorplans,
  toggle Gen4 zones, start Gen3 map exploration.
- **Schedule**: list/add/delete events (Gen3 times converted to/from the robot's UTC clock using the server
  timezone), per-event enable (Gen4), master switch (Gen3), next-run display.
- **History**: past cleanings with duration, area, battery used and the path drawn over the map.
- **Settings**: rename, Gen3 sounds & reminders, Gen4 force-floorplan and language.

Not included yet: drawing/editing zones on the map, firmware updates, push notifications.

## Get the APK

**Download it.** When the run is green, go to the repository's front page and open **Releases** (right
   sidebar) → *Vacuula APK #1* → **vacuula.apk**. (The same file is also attached to the run under *Artifacts*
   as a zip.) You can do this directly in your phone's browser, signed in to GitHub.
**Install on your phone.**
   - Android will ask you to allow installs from your browser: tap **Settings → Allow from this source**.
   - Open the downloaded `vacuula.apk` and tap **Install**. If Play Protect says the app is unrecognised,
     tap **More details → Install anyway** (the app is signed with a development key, not Google Play's).
   - Open **Vacuula**, enter your server's IP address and port (default 80), and connect.

Later builds install over the top of earlier ones (they use the same signing key), so you keep your settings.
If a build fails, open the failed run in **Actions**, click the red step and send me the last lines of its log.

The APK is for 64-bit and 32-bit ARM phones (nearly all phones made in the last decade), not x86 emulators.
iOS cannot be built without a Mac and an Apple developer account; see the note at the bottom.

## Develop (optional, needs Node.js)

```bash
npm install
npx expo start            # try it live with the Expo Go app
npm run typecheck
npm test                  # Jest; spawns a fake Vacuula server (python3 with aiohttp: pip install aiohttp)
```

Layout: `src/lib/` holds the framework-free client, models and store (unit/integration tested);
`app/` is the expo-router screens; `src/components/` shared UI and the SVG map view.

## Status

Written without access to a phone or real robots. The logic is tested against a fake server that mimics the
real API, and the app bundles for both platforms, but the UI has not been run on a device — expect to
tweak layouts. The server has no authentication, so only use it on a trusted network or VPN.

## iOS

iOS apps can only be built with Apple's tools. Options: run `npx eas build -p ios` (Expo's cloud builder; needs
an Apple developer account, about $99/year), or use `npx expo start` with the free *Expo Go* app for testing.
