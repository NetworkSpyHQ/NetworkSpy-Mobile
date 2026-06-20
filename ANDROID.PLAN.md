# ANDROID.PLAN.md — Standalone VPN Library Development & Test Project

## Goal

Develop the VPN packet-forwarding C library (`libvpn`) in isolation using a
lightweight native Android project. Decouple VPN testing from the main Expo
app so iteration is fast and unaffected by JS build times, Expo tooling, or
React Native overhead.

---

## Directory Layout

```
networkspy-mobile/
├── developer/
│   └── project/
│       └── test/
│           └── android/                    ← NEW: standalone test project
│               ├── app/
│               │   ├── build.gradle.kts
│               │   └── src/
│               │       └── main/
│               │           ├── AndroidManifest.xml
│               │           ├── java/com/networkspy/vpntest/
│               │           │   ├── MainActivity.kt         ← single screen
│               │           │   └── VpnTestService.kt       ← test VPN service
│               │           ├── cpp/                         ← C library (same as production)
│               │           │   ├── jni.c
│               │           │   ├── ip.c / ip.h
│               │           │   ├── tcp.c / tcp.h
│               │           │   ├── udp.c / udp.h
│               │           │   ├── dns.c / dns.h
│               │           │   ├── session.c / session.h
│               │           │   ├── util.c / util.h
│               │           │   └── vpn.h                    ← shared header
│               │           └── res/
│               │               ├── layout/activity_main.xml
│               │               └── values/strings.xml
│               ├── CMakeLists.txt
│               ├── build.gradle.kts          ← root
│               ├── settings.gradle.kts
│               └── gradle.properties
│
├── android/                                  ← main Expo app (separate)
├── PLAN.md
└── ANDROID.PLAN.md                           ← this file
```

---

## Why a Separate Project

| Aspect | Full Expo App | Standalone Test Project |
|--------|--------------|------------------------|
| Build time | 2-5 min (JS + native + Expo prebuild) | 10-30 sec (native only) |
| Log output | Mixed RN + native, hard to filter | Pure logcat, clean |
| Debugging | Cannot attach native debugger easily | Android Studio native debugger works |
| Iteration | Full deploy cycle | Instant run, apply changes |
| Dependencies | Expo, RN, Nitro, 100+ packages | Zero — pure Android |
| APK size | 30+ MB | < 5 MB |

---

## Test Project Structure

### 1. Root `build.gradle.kts`

```kotlin
// developer/project/test/android/build.gradle.kts
plugins {
    id("com.android.application") version "8.7.0" apply false
    id("org.jetbrains.kotlin.android") version "2.1.0" apply false
}
```

### 2. Root `settings.gradle.kts`

```kotlin
pluginManagement {
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "VpnTest"
include(":app")
```

### 3. App `build.gradle.kts`

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

### 4. `app/CMakeLists.txt`

```cmake
cmake_minimum_required(VERSION 3.10.2)
add_library(vpn SHARED
    src/main/cpp/jni.c
    src/main/cpp/ip.c
    src/main/cpp/tcp.c
    src/main/cpp/udp.c
    src/main/cpp/dns.c
    src/main/cpp/session.c
    src/main/cpp/util.c
)
find_library(log-lib log)
target_link_libraries(vpn ${log-lib})
```

### 5. `app/src/main/AndroidManifest.xml`

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <application android:allowBackup="true" android:label="VPN Test">
        <activity android:name=".MainActivity"
            android:exported="true"
            android:theme="@style/Theme.AppCompat.Light">
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

### 6. `MainActivity.kt` — Simple Test UI

```kotlin
class MainActivity : AppCompatActivity() {
    private lateinit var btnStart: Button
    private lateinit var btnStop: Button
    private lateinit var tvStatus: TextView
    private lateinit var tvLog: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        btnStart = findViewById(R.id.btn_start)
        btnStop = findViewById(R.id.btn_stop)
        tvStatus = findViewById(R.id.tv_status)
        tvLog = findViewById(R.id.tv_log)

        btnStart.setOnClickListener { startVpn() }
        btnStop.setOnClickListener { stopVpn() }
    }

    private fun startVpn() {
        val intent = VpnService.prepare(this)
        if (intent != null) {
            startActivityForResult(intent, 1)
        } else {
            onActivityResult(1, RESULT_OK, null)
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == 1 && resultCode == RESULT_OK) {
            startService(Intent(this, VpnTestService::class.java))
            tvStatus.text = "VPN: RUNNING"
        }
    }

    private fun stopVpn() {
        stopService(Intent(this, VpnTestService::class.java))
        tvStatus.text = "VPN: STOPPED"
    }
}
```

**Layout** (`res/layout/activity_main.xml`):
```
LinearLayout (vertical)
├── Button "Start VPN"
├── Button "Stop VPN"
├── TextView (status)
└── ScrollView > TextView (log output — append from logcat listener)
```

### 7. `VpnTestService.kt` — Minimal VPN Service

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

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startVpn()
        return START_STICKY
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

    override fun onRevoke() {
        stopSelf()
        super.onRevoke()
    }
}
```

---

## C Library Development

### File List

| File | Purpose |
|------|---------|
| `vpn.h` | Shared types, constants, logging macros |
| `jni.c` | JNI entry points (`jni_init`, `jni_start`, `jni_stop`) |
| `ip.c` | IP header parsing, TUN reader loop |
| `tcp.c` | TCP state machine, socket creation, bidirectional pipe |
| `udp.c` | UDP forwarding with response writeback |
| `dns.c` | DNS query parsing, caching, forwarding |
| `session.c` | Connection hash table, cleanup |
| `util.c` | Checksums, byte ordering, IP string formatting |

### Key Types (`vpn.h`)

```c
typedef struct {
    JNIEnv *env;
    jobject instance;
    jmethodID mid_protect;
    int tun_fd;
    int shutdown;
    // proxy config
    char proxy_host[64];
    int proxy_port;
} vpn_context_t;

typedef struct {
    uint32_t src_ip, dst_ip;
    uint16_t src_port, dst_port;
    int socket_fd;
    int state;       // 0=NEW, 1=CONNECTING, 2=CONNECTED, 3=CLOSING
    uint32_t seq_client;
    uint32_t seq_server;
    time_t created;
    uint64_t tx, rx;
} tcp_session_t;
```

### JNI Entry Points (`jni.c`)

```c
JNIEXPORT void JNICALL
Java_com_networkspy_vpntest_VpnTestService_jni_1init(JNIEnv *env, jobject instance) {
    // Save JNI references globally
    g_ctx.env = env;
    g_ctx.instance = (*env)->NewGlobalRef(env, instance);
    // Get protect() method ID
    jclass cls = (*env)->GetObjectClass(env, instance);
    g_ctx.mid_protect = (*env)->GetMethodID(env, cls, "protect", "(I)Z");
    // Initialize session table, DNS cache
}

JNIEXPORT void JNICALL
Java_com_networkspy_vpntest_VpnTestService_jni_1start(
    JNIEnv *env, jobject instance, jint tun, jboolean fwd53,
    jint rcode, jstring proxy_ip, jint proxy_port) {

    g_ctx.tun_fd = tun;
    // Parse proxy config
    // Spawn TUN reader thread
    pthread_create(&g_tun_thread, NULL, tun_reader, NULL);
}

JNIEXPORT void JNICALL
Java_com_networkspy_vpntest_VpnTestService_jni_1stop(
    JNIEnv *env, jobject instance, jint tun) {

    g_ctx.shutdown = 1;
    close(tun); // Unblock reader thread
    pthread_join(g_tun_thread, NULL);
    // Clean up sessions
}
```

### Socket Protection

Every socket created in C must be protected via JNI callback:

```c
static int protect_socket(int fd) {
    JNIEnv *env;
    (*g_jvm)->AttachCurrentThread(g_jvm, &env, NULL);
    jboolean ok = (*env)->CallBooleanMethod(env, g_ctx.instance,
                                             g_ctx.mid_protect, fd);
    (*g_jvm)->DetachCurrentThread(g_jvm);
    return ok ? 0 : -1;
}
```

Called immediately after `socket()` and before `connect()`/`bind()`.

### Build & Run

```bash
cd developer/project/test/android

# Build
./gradlew :app:assembleDebug

# Install & run
adb install app/build/outputs/apk/debug/app-debug.apk

# Watch logs
adb logcat -s VpnTest:V vpn:V
```

---

## Development Workflow

1. **Write C code** in `app/src/main/cpp/`
2. **Build**: `./gradlew :app:assembleDebug` (10-30 seconds)
3. **Install**: `adb install -r app/build/outputs/apk/debug/app-debug.apk`
4. **Test**: Tap Start VPN → browse web → verify internet works
5. **Debug**: `adb logcat -s VpnTest:V vpn:V` for packet-level logs
6. **Iterate**: Fix C code, rebuild, reinstall (fast cycle)

Once the C library works reliably in the test project, **copy the `.c`/`.h`
files** to the main app's `android/app/src/main/cpp/` and update the
Kotlin service to match.

---

## Success Criteria

- [ ] Start VPN → internet works (websites load, DNS resolves)
- [ ] TCP connections succeed (multiple concurrent)
- [ ] UDP forwarding works (DNS, QUIC)
- [ ] VPN stop → internet works normally
- [ ] No crashes after 10 minutes of active browsing
- [ ] Memory stable (no OOM from connection leaks)
- [ ] Logs show proper packet flow: SYN → SYN-ACK → data → FIN

Once all criteria are met, the C library is ready for integration into the
main Expo app.
