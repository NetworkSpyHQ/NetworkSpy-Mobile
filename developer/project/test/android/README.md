# VPN Test Project

Standalone native Android app for fast VPN library (`libvpn`) development and debugging.

## Prerequisites

- Android SDK (API 35)
- NDK 27.1.12297006
- A device or emulator with API 24+

Set `ANDROID_HOME` or create `local.properties`:
```
sdk.dir=/path/to/Android/sdk
```

## Build

```bash
cd developer/project/test/android
./gradlew :app:assembleDebug
```

## Install

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Test

1. Open "VPN Test" on device
2. Tap **Start VPN** → grant VPN permission
3. Browse the web → verify internet works
4. Tap **Stop VPN**

## Watch Logs

```bash
adb logcat -s VpnTestService:V vpn:V
adb logcat -s AndroidRuntime:E '*:F'
```

## Iterate

```bash
# Edit C code in library/vpn/src/
# Rebuild (10-30s)
cd developer/project/test/android && ./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The same `libvpn.so` is used by the main app — no code changes needed when transferring fixes.
