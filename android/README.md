# NetworkSpy Mobile — Android

This is the **React Native / Expo production app** for NetworkSpy Mobile, a
VPN-based traffic capture and inspection tool for Android (similar to
[NetworkSpy.app](https://networkspy.app)).

## What It Does

- Runs a local VPN service to intercept all device traffic (TCP, UDP, DNS)
- Captures HTTP request/response headers and bodies
- Extracts TLS SNI for HTTPS host identification
- Displays a real-time traffic log in a React Native UI

## Why a Split Project

The VPN packet-forwarding engine is written in **C (`libvpn.so`)** and shared
between two Android projects:

| Project | Path | Purpose |
|---------|------|---------|
| **Test app** | `developer/project/test/android/` | Lightweight native-only Android app for fast VPN development and debugging |
| **Main RN app** | `android/` | Full Expo/React Native production app (this directory) |

### Benefits of Splitting

- **Faster iteration**: The test app builds in 10–30 seconds (native only) vs.
  2–5 minutes for the full Expo build.
- **Cleaner debugging**: Pure `logcat` output without RN noise. Android Studio's
  native debugger works directly.
- **No framework dependencies**: The test app is a plain Android project — no
  Expo, React Native, or Nitro modules.
- **Smaller APK for testing**: `< 5 MB` vs. `30+ MB` for the full app.

## Shared Library

The C VPN engine lives at `library/vpn/` and is imported by both projects via
CMake's `add_subdirectory()`:

```cmake
# android/app/CMakeLists.txt
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../../library/vpn
                 ${CMAKE_CURRENT_BINARY_DIR}/vpn)
```

The library uses JNI `RegisterNatives` so the same `libvpn.so` works for both
projects without modification. Once the VPN engine works in the test app, it
works in the React Native app with zero code changes.

## Architecture

```
CaptureVpnService (Kotlin)
  └── TUN interface (virtual network device)
       └── libvpn (C) — packet forwarding engine
            ├── TCP state machine & forwarding
            ├── UDP forwarding
            ├── DNS interception
            ├── HTTP parsing & proxy redirect
            └── TLS SNI extraction
                 └── HttpCaptureProxy (Kotlin, 127.0.0.1:8888)
                      └── VpnModule → React Native UI
```

## Build & Run

The main app is built through Expo:

```bash
npx expo run:android
```

For VPN engine development, use the test project instead:

```bash
cd developer/project/test/android
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb logcat -s VpnTest:V vpn:V
```

## Capabilities

- Full TCP stream forwarding (HTTP, HTTPS, WebSockets, custom protocols)
- UDP forwarding (DNS, QUIC, VoIP)
- HTTP request/response capture (method, URL, headers, body)
- HTTPS host identification via TLS SNI extraction
- DNS query logging and interception
- Real-time traffic UI via React Native events
