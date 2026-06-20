# ANDROID.PLAN.md — Shared VPN Library + Test Project

## Goal

Build the VPN packet-forwarding C library (`libvpn`) as a **standalone shared
module** that can be imported by both:

1. **Test project** (`developer/project/test/android/`) — lightweight native
   Android app for fast VPN development and debugging
2. **Main RN app** (`android/`) — the Expo/React Native production app

The C library lives in one place (`library/vpn/`), both projects reference it.

---

## Directory Layout

```
networkspy-mobile/
├── library/
│   └── vpn/                                ← SHARED C library (single source of truth)
│       ├── CMakeLists.txt
│       ├── include/
│       │   └── vpn.h                        ← public API header
│       └── src/
│           ├── jni.c                        ← JNI entry points
│           ├── ip.c
│           ├── tcp.c
│           ├── udp.c
│           ├── dns.c
│           ├── session.c
│           └── util.c
│
├── developer/
│   └── project/
│       └── test/
│           └── android/                    ← lightweight test app
│               ├── app/
│               │   ├── build.gradle.kts
│               │   ├── CMakeLists.txt       ← references ../../../../library/vpn/CMakeLists.txt
│               │   └── src/main/
│               │       ├── AndroidManifest.xml
│               │       ├── java/com/networkspy/vpntest/
│               │       │   ├── MainActivity.kt
│               │       │   └── VpnTestService.kt
│               │       └── res/layout/activity_main.xml
│               ├── build.gradle.kts
│               ├── settings.gradle.kts
│               └── gradle.properties
│
├── android/                                ← main Expo app (separate)
│   └── app/
│       ├── build.gradle                     ← references ../../library/vpn/CMakeLists.txt
│       └── CMakeLists.txt
│
├── PLAN.md
└── ANDROID.PLAN.md
```

---

## The Shared Library (`library/vpn/`)

The library is a **self-contained CMake project**. It produces `libvpn.so`.
It has NO dependency on React Native, Expo, or any Java/Kotlin framework.

### `library/vpn/CMakeLists.txt`

```cmake
cmake_minimum_required(VERSION 3.10.2)
project("vpn" C)

set(CMAKE_C_STANDARD 11)

add_library(vpn SHARED
    src/jni.c
    src/ip.c
    src/tcp.c
    src/udp.c
    src/dns.c
    src/session.c
    src/util.c
)

target_include_directories(vpn PRIVATE include)

find_library(log-lib log)
target_link_libraries(vpn ${log-lib})
```

### `library/vpn/include/vpn.h`

Single public header that both the test project and main app include:
- Context struct (`vpn_context_t`)
- Session struct (`tcp_session_t`)
- Logging macros
- JNI helper macros (`PROTECT_SOCKET`, etc.)

---

## How Each Project Imports the Library

Both projects use CMake's `add_subdirectory()` to include the shared library.

### Test Project: `developer/project/test/android/app/CMakeLists.txt`

```cmake
cmake_minimum_required(VERSION 3.10.2)

# Import the shared VPN library
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../../../../../library/vpn
                 ${CMAKE_CURRENT_BINARY_DIR}/vpn)
```

That's it. The library compiles into the test APK. No file copying.

### Main App: `android/app/CMakeLists.txt`

```cmake
cmake_minimum_required(VERSION 3.10.2)

# Import the shared VPN library
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../../library/vpn
                 ${CMAKE_CURRENT_BINARY_DIR}/vpn)
```

Same pattern. The main app's `CaptureVpnService.kt` loads `System.loadLibrary("vpn")`.

---

## JNI Entry Points (shared across both projects)

The JNI function names match the **class that calls them**. Each project has
a different class, so the JNI names differ:

| Function | Test Project | Main App |
|----------|-------------|----------|
| `jni_init` | `Java_com_networkspy_vpntest_VpnTestService_jni_1init` | `Java_com_networkspy_mobile_vpn_CaptureVpnService_jni_1init` |
| `jni_start` | `Java_com_networkspy_vpntest_VpnTestService_jni_1start` | `Java_com_networkspy_mobile_vpn_CaptureVpnService_jni_1start` |
| `jni_stop` | `Java_com_networkspy_vpntest_VpnTestService_jni_1stop` | `Java_com_networkspy_mobile_vpn_CaptureVpnService_jni_1stop` |
| `jni_get_mtu` | `Java_com_networkspy_vpntest_VpnTestService_jni_1get_1mtu` | `Java_com_networkspy_mobile_vpn_CaptureVpnService_jni_1get_1mtu` |
| `jni_done` | `Java_com_networkspy_vpntest_VpnTestService_jni_1done` | `Java_com_networkspy_mobile_vpn_CaptureVpnService_jni_1done` |

**Solution**: Use JNI `RegisterNatives` instead of auto-naming. This decouples
the C code from Java package names:

```c
// library/vpn/src/jni.c

static JNINativeMethod methods[] = {
    {"jni_init",     "()V",     (void*)vpn_init},
    {"jni_start",    "(IZILjava/lang/String;I)V", (void*)vpn_start},
    {"jni_stop",     "(I)V",    (void*)vpn_stop},
    {"jni_get_mtu",  "()I",     (void*)vpn_get_mtu},
    {"jni_done",     "()V",     (void*)vpn_done},
};

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *reserved) {
    JNIEnv *env;
    if ((*vm)->GetEnv(vm, (void**)&env, JNI_VERSION_1_6) != JNI_OK)
        return JNI_ERR;

    // Register for BOTH class names — call once for each
    jclass cls_test = (*env)->FindClass(env, "com/networkspy/vpntest/VpnTestService");
    jclass cls_main = (*env)->FindClass(env, "com/networkspy/mobile/vpn/CaptureVpnService");

    if (cls_test)
        (*env)->RegisterNatives(env, cls_test, methods, sizeof(methods)/sizeof(methods[0]));
    if (cls_main)
        (*env)->RegisterNatives(env, cls_main, methods, sizeof(methods)/sizeof(methods[0]));

    return JNI_VERSION_1_6;
}
```

This way the same `libvpn.so` works for both projects with zero changes.
The C functions (`vpn_init`, `vpn_start`, etc.) are just regular C functions
without JNI name mangling.

---

## Test Project Setup

### Why a Separate Project

| Aspect | Full Expo App | Standalone Test Project |
|--------|--------------|------------------------|
| Build time | 2-5 min (JS + native + Expo prebuild) | 10-30 sec (native only) |
| Log output | Mixed RN + native, hard to filter | Pure logcat, clean |
| Debugging | Cannot attach native debugger easily | Android Studio native debugger works |
| Iteration | Full deploy cycle | Instant run, apply changes |
| Dependencies | Expo, RN, Nitro, 100+ packages | Zero — pure Android |
| APK size | 30+ MB | < 5 MB |

### Root `build.gradle.kts`

```kotlin
// developer/project/test/android/build.gradle.kts
plugins {
    id("com.android.application") version "8.7.0" apply false
    id("org.jetbrains.kotlin.android") version "2.1.0" apply false
}
```

### Root `settings.gradle.kts`

```kotlin
pluginManagement {
    repositories { google(); mavenCentral() }
}
rootProject.name = "VpnTest"
include(":app")
```

### `app/build.gradle.kts`

```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.networkspy.vpntest"
    compileSdk = 35
    ndkVersion = "27.1.12297006"

    defaultConfig {
        applicationId = "com.networkspy.vpntest"
        minSdk = 24
        targetSdk = 35
    }

    externalNativeBuild {
        cmake {
            path = file("CMakeLists.txt")
        }
    }
}
```

### `app/src/main/AndroidManifest.xml`

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <application android:allowBackup="true" android:label="VPN Test"
        android:theme="@style/Theme.AppCompat.Light">
        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <service android:name=".VpnTestService"
            android:permission="android.permission.BIND_VPN_SERVICE"
            android:exported="false"
            android:foregroundServiceType="specialUse">
            <intent-filter>
                <action android:name="android.net.VpnService" />
            </intent-filter>
        </service>
    </application>
</manifest>
```

### `VpnTestService.kt`

```kotlin
class VpnTestService : VpnService() {
    companion object {
        init { System.loadLibrary("vpn") }
    }

    private external fun jni_init()
    private external fun jni_start(tun: Int, fwd53: Boolean, rcode: Int,
                                    proxyIp: String, proxyPort: Int)
    private external fun jni_stop(tun: Int)
    private external fun jni_get_mtu(): Int
    private external fun jni_done()

    private var vpnInterface: ParcelFileDescriptor? = null

    override fun onCreate() {
        super.onCreate()
        jni_init()
        startForeground(1, buildNotification())
    }

    private fun startVpn() {
        vpnInterface = Builder()
            .setSession("VPN Test")
            .addAddress("10.0.2.1", 24)
            .addRoute("0.0.0.0", 0)
            .addDnsServer("8.8.8.8")
            .setMtu(jni_get_mtu())
            .setBlocking(false)
            .establish()

        jni_start(vpnInterface!!.fd, false, 3, "", 0)
        Log.i("VpnTest", "VPN started")
    }

    override fun onDestroy() {
        vpnInterface?.let { jni_stop(it.fd) }
        jni_done()
        vpnInterface?.close()
        super.onDestroy()
    }

    override fun onRevoke() { stopSelf(); super.onRevoke() }
}
```

### `MainActivity.kt`

Simple UI with Start/Stop buttons, status text, scrollable log output.

---

## Development Workflow

1. **Edit C code** in `library/vpn/src/`
2. **Build test app**: `cd developer/project/test/android && ./gradlew :app:assembleDebug`
3. **Install**: `adb install -r app/build/outputs/apk/debug/app-debug.apk`
4. **Test**: Tap Start VPN → browse web → verify internet works
5. **Watch logs**: `adb logcat -s VpnTest:V vpn:V`
6. **Iterate**: Fix C code → rebuild (10-30s) → reinstall

### Transfer to Main App

Once the library works in the test project:

1. No code changes needed — the library is already shared
2. Update `android/app/build.gradle` to include CMake if not already present
3. Update `CaptureVpnService.kt` with the same `external fun` declarations
4. Build main app: `npx expo run:android`

The library compiles into both APKs from the same source.

---

## Success Criteria

- [ ] VPN starts → internet works (TCP + UDP + DNS)
- [ ] VPN stops → internet works normally (no residual routes)
- [ ] No crashes after 10 minutes of browsing
- [ ] Memory stable (no OOM, no connection leaks)
- [ ] Logs show proper packet flow in both test and main app
- [ ] Same `libvpn.so` works in both projects without modification

