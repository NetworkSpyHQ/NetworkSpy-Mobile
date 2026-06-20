# How the VPN Service Works

## Overview

This is a **local VPN proxy** that intercepts all network traffic on the device, forwards it through real sockets, and sends responses back — making the phone think it's talking directly to the internet when in reality every packet passes through our code.

It has two layers:
- **Kotlin/Java layer** (`VpnTestService.kt`) — Android VPN lifecycle, permission dialogs, UI
- **C native layer** (`library/vpn/`) — packet parsing, TCP/UDP/DNS forwarding, socket I/O

---

## 1. Starting the VPN

### 1.1 User clicks "Start VPN"

1. `MainActivity.prepareAndStartVpn()` calls `VpnService.prepare(this)`
2. Android shows a system dialog: *"Allow VPN to monitor network traffic?"*
3. If user accepts (`RESULT_OK`), `startVpnService()` runs
4. This starts `VpnTestService` as a foreground service (`startForegroundService`)

### 1.2 `VpnTestService.onCreate()`

```
System.loadLibrary("vpn")     → loads libvpn.so
jni_init()                    → allocates native context, looks up JNI methods
createNotificationChannel()   → creates Android notification channel for foreground
```

### 1.3 `VpnTestService.startVpn()`

This is where the **TUN interface** (virtual network card) gets created:

```kotlin
vpnInterface = Builder()
    .setSession("VPN Test")
    .addAddress("10.0.2.1", 24)     // VPN's internal IP
    .addRoute("0.0.0.0", 0)         // route ALL traffic through VPN
    .addDnsServer("8.8.8.8")        // DNS server pushed to device
    .addDnsServer("8.8.4.4")
    .setMtu(jni_get_mtu())          // MTU = 1500
    .setBlocking(true)
    .establish()                    // creates the TUN interface
```

**What this does:**
- Creates a virtual network interface (TUN) on the device
- All IP packets from apps go through this interface
- Returns a `ParcelFileDescriptor` — the file descriptor (fd) we read/write raw IP packets from

Then:
```
startForeground()    → shows persistent "VPN is active" notification
jni_start(tunFd)     → hands the fd to native code, starts packet processing
```

### 1.4 Native `vpn_start()` (`jni.c`)

```
g_ctx->running = true
g_ctx->tun_fd = tunFd           // store the TUN file descriptor
create pipe for shutdown signalling
spawn tun_reader_thread         // reads IP packets from TUN fd
spawn cleanup_thread            // every 30s, cleans up idle TCP sessions
```

---

## 2. The TUN Interface (File Descriptor)

**TUN** is a virtual network device at layer 3 (IP). When you write an IP packet to it, the OS delivers it to apps as if it came from the network. When apps send packets, the OS delivers them to the TUN, and we read them.

```
┌──────────┐      raw IP packets      ┌──────────────┐
│  Chrome  │ ←──────────────────────→ │  TUN device  │ ←─── our VPN reads/writes via fd
│  (apps)  │                           │  (kernel)    │
└──────────┘                           └──────────────┘
```

- Reading from `tun_fd` gets us an **outgoing** IP packet (app → internet)
- Writing to `tun_fd` injects an **incoming** IP packet (internet → app)
- `fd` (file descriptor) is just a number (like 90, 93) that identifies the TUN device

---

## 3. How Packets Flow

### 3.1 TUN Reader Thread

This thread runs a loop reading raw IP packets from the TUN fd:

```
while (running) {
    len = read(tun_fd, buffer, 32767)
    handle_ip_packet(buffer, len)
}
```

`handle_ip_packet()` parses the IP header and dispatches based on protocol:

```
IP packet
├── protocol = 6  (TCP)  → handle_tcp_packet()
├── protocol = 17 (UDP)  → handle_udp_packet()
└── other                → ignored
```

**IPv6 is NOT supported.** Packets with `version != 4` are dropped.

### 3.2 TCP Forwarding

When an app (e.g. Chrome) opens a TCP connection to `example.com:443`:

```
App                    Our VPN                     Real Server
 │                       │                             │
 │──TCP SYN──────────→  │  (read from TUN)             │
 │                       │──socket(), connect()──────→ │  (real TCP connection)
 │                       │←───SYN-ACK────────────────  │  (kernel handles handshake)
 │←──TCP SYN-ACK───────  │  (write to TUN)             │
 │                       │                             │
 │──TCP ACK───────────→ │                             │
 │──TLS ClientHello───→ │──write(socket_fd)──────────→│
 │                       │←──read(socket_fd)───────────│
 │←──TLS ServerHello───  │  (write to TUN)             │
 │                       │                             │
 │   ... bidirectional data flows ...                  │
```

**Key points:**
- Each app TCP connection gets a **real server socket** (AF_INET, SOCK_STREAM)
- The socket is `protect()`ed — tells Android to bypass the VPN for this socket
- A **reader thread** (`tcp_server_reader`) reads server responses and writes them back to TUN
- TCP sessions are tracked in a hash table (`sessions[MAX_SESSIONS]`) with 256 slots
- Sessions timeout after 60 seconds of inactivity

### 3.3 DNS Handling

DNS uses UDP port 53. Our code intercepts DNS queries:

```
App's DNS resolver → TUN → our VPN intercepts port 53 → forwards to 8.8.8.8
                                                               ↓
                                                       receives response
                                                               ↓
                                                        writes back to TUN
                                                               ↓
App receives DNS response ← TUN ←──────────────────────┘
```

**Important:** The DNS server returned to the app is spoofed to look like it came from 8.8.8.8. The app doesn't know our VPN intercepted it.

### 3.4 Non-DNS UDP

**Dropped.** We deliberately drop non-DNS UDP packets (e.g. QUIC/HTTP3 on port 443). This forces Chrome to fall back to TCP (which we handle correctly). Without this, QUIC would fail because our stateless UDP forwarding can't handle multi-packet QUIC connections.

---

## 4. Stopping the VPN

### 4.1 User clicks "Stop VPN"

1. `MainActivity` calls `VpnTestService.activeService?.stopVpn()` **directly**
2. Then calls `stopService(intent)` to tear down the Android service

### 4.2 `stopVpn()` sequence

```
jni_stop(fd):
    g_ctx->running = false                    → signals all threads to stop
    shutdown(tun_fd, SHUT_RD)                  → unblocks TUN reader's read() call
    close all session sockets                  → unblocks TCP reader threads
    clear session list

vpnInterface?.close()                         → closes the TUN file descriptor

jni_done():
    vpn_stop (if still running)                → safety catch
    delete JNI global reference
    set g_ctx = NULL                           → next init creates new context
```

### 4.3 Shutdown sequence (what happens in native)

```
Main thread                      TUN reader thread            TCP reader threads
    │                                  │                           │
    │─jni_stop()                       │                           │
    │  running = false                 │                           │
    │  shutdown(tun_fd)               │                           │
    │  close(session sockets)         │                           │
    │                                  │─read() returns 0 (EOF)───│─read() returns error
    │                                  │  checks running=false    │  loop exits
    │                                  │  exits loop              │  exits thread
    │                                  │                          │
    │─vpnInterface.close()             │                          │
    │─jni_done()                       │                          │
    │  g_ctx = NULL                    │                          │
```

Benign errors during shutdown (`TUN write failed: Bad file descriptor`, `TCP read error: Bad file descriptor`) are expected — threads are exiting when their fd's are already closed.

---

## 5. Key Native Components

### 5.1 `struct vpn_context` (vpn.h)

The global state of the VPN:

| Field | Purpose |
|-------|---------|
| `jvm`, `instance`, `mid_protect`, `mid_on_traffic` | JNI references for calling back to Java |
| `tun_fd` | File descriptor of the TUN interface |
| `running` | Flag to signal threads to stop |
| `sessions[256]` | Hash table of active TCP connections |
| `sessions_lock` | Mutex protecting the session table |
| `tun_thread`, `cleanup_thread` | pthread IDs |

### 5.2 `protect_socket()` (util.c)

Calls `VpnService.protect(int fd)` via JNI. This tells Android: "this socket bypasses the VPN and goes directly to the real network." Without this, the socket's traffic would loop back through the VPN forever.

### 5.3 TCP Checksums

Every TCP packet we build must have correct checksums, or the kernel will drop them. We compute TCP checksums using a pseudo-header (source IP, dest IP, protocol, TCP length) plus the TCP header and payload. Same for UDP.

### 5.4 Sequence Numbers

We maintain two independent TCP sequences:
- **Client side** (`client_seq`, `client_ack`): tracking the app's TCP stream through TUN
- **Server side** (`server_seq`): tracking what we send/receive on the real socket

These are completely independent — the app and server each see a different TCP connection.

---

## 6. File Overview

| File | Purpose |
|------|---------|
| `VpnTestService.kt` | Android VPN service lifecycle, UI callbacks |
| `MainActivity.kt` | Test UI with start/stop buttons and traffic log |
| `library/vpn/src/jni.c` | JNI bridge: init, start, stop, traffic notifications |
| `library/vpn/src/ip.c` | IP header parsing and building |
| `library/vpn/src/tcp.c` | TCP proxy: connection tracking, data forwarding |
| `library/vpn/src/udp.c` | UDP handler: DNS interception, non-DNS drop |
| `library/vpn/src/dns.c` | DNS forwarder: relay queries to 8.8.8.8 |
| `library/vpn/src/session.c` | TCP session hash table (create, lookup, remove, cleanup) |
| `library/vpn/src/util.c` | Checksum calculation (IP, TCP, UDP), socket protect |
| `library/vpn/include/vpn.h` | Shared types, constants, function declarations |
| `Makefile` | Build, install, launch, log, clean recipes |

---

## 7. Common Issues We Fixed

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| App crash on start | `FindClass` for nonexistent class left pending JNI exception | Clear exception with `ExceptionClear()` |
| UI not showing traffic | `notify_traffic()` didn't attach JVM thread | Added `AttachCurrentThread` |
| Pages not loading | Chrome uses QUIC (UDP 443), our stateless UDP broken | Drop non-DNS UDP, force TCP fallback |
| SSL error on first load | ~~Reader thread started too early~~ (reverted; QUIC was real cause) | Fixed by dropping QUIC |
| Stop button not working | `stopService()` doesn't guarantee immediate stop | Direct call via `activeService` reference |
| Crash on stop | Mutex destroyed while threads still accessing it | Don't destroy mutex; let threads exit naturally |
