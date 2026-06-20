# PLAN: VPN Packet Forwarding Implementation

## Problem

The Kotlin-based TCP tunnel in `CaptureVpnService.kt` is unreliable because
implementing TCP state machines in application code is extremely error-prone.
Issues observed:

- Packet-level sequence number tracking is fragile
- Socket binding to the VPN virtual IP (10.0.2.1) prevents real network routing
- `protect()` must be called correctly on every socket fd
- TCP requires proper SYN/SYN-ACK/ACK handshake, window management, retransmission
- UDP (DNS) forwarding requires response assembly and TUN writeback
- Thread management with concurrent connections leads to resource exhaustion

**The only reliable approach used by production VPN apps (NetGuard, TunProxy,
intra, etc.) is a native C library that handles IP/TCP/UDP forwarding.**

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│  CaptureVpnService (Kotlin)                      │
│  - extends VpnService                            │
│  - creates TUN interface                         │
│  - passes TUN fd to native code                  │
│  - HttpCaptureProxy on 127.0.0.1:8888            │
│  - VpnModule for RN bridge                       │
└──────────────┬───────────────────────────────────┘
               │ jni_start(tunFd, proxyHost, proxyPort)
               ▼
┌──────────────────────────────────────────────────┐
│  libvpn (C) - packet forwarding engine           │
│                                                  │
│  Modules:                                        │
│  ├── ip.c      - IP packet reader/writer         │
│  ├── tcp.c     - TCP state machine & forwarding  │
│  ├── udp.c     - UDP forwarding                  │
│  ├── dns.c     - DNS interception & forwarding   │
│  ├── dhcp.c    - DHCP response for clients       │
│  ├── icmp.c    - ICMP echo for keepalive         │
│  ├── session.c - connection state tracking       │
│  ├── http.c    - HTTP parsing & proxy redirect   │
│  ├── tls.c     - TLS SNI extraction              │
│  └── util.c    - checksums, logging, helpers     │
│                                                  │
│  Threading:                                      │
│  - One dedicated thread reads TUN in a loop      │
│  - Per-connection TCP sessions tracked in hash   │
│    table with state: NEW → CONNECTING → CONNECTED│
│    → CLOSING → CLOSED                            │
│  - UDP handled per-packet with timeout           │
│                                                  │
│  Socket protection:                              │
│  - Every socket created by native code calls     │
│    back to Java via JNI: protect(int fd): bool   │
│  - This marks the fd to bypass VPN routing       │
│  - Must be called BEFORE connect/bind            │
└──────────────────────────────────────────────────┘
```

---

## C Library Design (Minimal, Non-GPL)

### 1. Entry Point (jni.c)

```
JNIEXPORT void JNICALL
Java_com_networkspy_mobile_vpn_CaptureVpnService_jni_1start(
    JNIEnv *env, jobject instance,
    jint tunFd, jboolean fwd53, jint rcode,
    jstring proxyIp, jint proxyPort)
```

- Save JNI references (`g_jvm`, `g_instance`, `g_mid_protect`)
- Create a pipe for signaling shutdown
- Spawn the TUN reader thread
- Spawn the DNS/UDP handler thread
- Initialize session table

### 2. TUN Reader Thread

```
void* tun_reader(void* arg) {
    uint8_t buffer[TUN_MTU];
    while (!shutdown) {
        int len = read(tun_fd, buffer, sizeof(buffer));
        if (len < 0) break;
        handle_ip_packet(buffer, len);
    }
}
```

- Read raw IP packets from TUN fd (blocking)
- Parse IP header to determine protocol (TCP=6, UDP=17, ICMP=1)
- Dispatch to appropriate handler

### 3. TCP Forwarding (tcp.c)

For each TCP connection (identified by 4-tuple: srcIP, srcPort, dstIP, dstPort):

1. **SYN received** → Create session, create protected socket, `connect()` to
   destination, send SYN-ACK back through TUN with spoofed source IP
2. **ACK received** (handshake completion) → Mark session CONNECTED
3. **Data from client** → `write()` to server socket
4. **Data from server** → Build IP+TCP packet, `write()` to TUN
5. **FIN received** → `shutdown(SHUT_WR)` on server socket, send FIN-ACK
6. **RST received** → Close both sides

Key details:
- Each connection gets its own server socket tracked in a hash table
- Sequence numbers must be tracked: client_seq (from client's SYN seq),
  server_seq (randomly generated for SYN-ACK)
- TCP checksums must be recalculated for every crafted packet
- IP header must be built with src=dstIP, dst=srcIP (spoofing the server)
- Timeout on connect: 10 seconds, then send RST to client

### 4. UDP Forwarding (udp.c)

For each UDP packet:
1. Create a protected `DatagramSocket`
2. `sendto()` the payload to the destination
3. Wait for response with timeout (10s for DNS, 30s for other)
4. Build IP+UDP response packet with swapped src/dst
5. `write()` response to TUN

DNS (port 53): Optionally intercept and forward through specified DNS server
instead of the packet's original destination.

### 5. DNS Handling (dns.c)

- Parse DNS query from UDP payload
- Forward to configured DNS server (e.g., 8.8.8.8)
- Cache responses (TTL-based)
- Handle A (IPv4), AAAA (IPv6), CNAME records
- Return cached results when available

### 6. HTTP Proxy Integration (http.c)

The native code accepts a proxy host:port. When TCP traffic to port 80/443 is
detected:
1. Instead of creating a direct socket to the destination...
2. Connect to the local proxy at 127.0.0.1:8888
3. Send the original HTTP request through the proxy
4. The proxy captures headers/body and forwards to real server
5. Response flows back through proxy → native code → TUN → client

For HTTPS (port 443):
- Extract SNI from TLS ClientHello for host identification
- Pass TLS traffic through transparently (or tunnel through proxy via CONNECT)

### 7. Session Management (session.c)

Track each active connection:
```
struct session {
    uint32_t src_ip, dst_ip;
    uint16_t src_port, dst_port;
    int socket;            // server socket fd
    int version;           // 4 or 6
    int protocol;          // TCP, UDP, ICMP
    int state;             // NEW, CONNECTING, CONNECTED, CLOSING
    uint32_t client_seq;   // last seen client sequence
    uint32_t server_seq;   // next server sequence to use
    time_t created;
    time_t last_activity;
    uint64_t tx_bytes, rx_bytes;
};
```

- Hash table keyed by 4-tuple
- Periodic cleanup of idle/stale sessions (60s timeout)
- Max sessions limit (configurable, default 256)

---

## Kotlin Service Changes

`CaptureVpnService.kt` simplified:

1. **Load native library** in companion `init { System.loadLibrary("vpn") }`
2. **Declare native methods**: `external fun jni_init()`, `jni_start(...)`,
   `jni_stop(...)`, `jni_get_mtu(): Int`, `jni_done()`
3. **`startVpn()`**: create TUN via `Builder.establish()`, call
   `jni_start(tunFd, false, 3, "127.0.0.1", PROXY_PORT)`
4. **`stopVpn()`**: call `jni_stop()`, close TUN, stop proxy
5. **`protect(fd: Int): Boolean`**: method inherited from `VpnService` — native
   code calls this via JNI to protect each socket before connecting

No more Kotlin TCP tunnels, packet loops, or sequence number tracking.

---

## Build Setup

### CMakeLists.txt

```cmake
cmake_minimum_required(VERSION 3.10.2)
add_library(vpn SHARED
    src/main/cpp/jni.c
    src/main/cpp/ip.c
    src/main/cpp/tcp.c
    src/main/cpp/udp.c
    src/main/cpp/dns.c
    src/main/cpp/dhcp.c
    src/main/cpp/icmp.c
    src/main/cpp/session.c
    src/main/cpp/http.c
    src/main/cpp/tls.c
    src/main/cpp/util.c
)
find_library(log-lib log)
target_link_libraries(vpn ${log-lib})
```

### build.gradle

```groovy
externalNativeBuild {
    cmake {
        path "CMakeLists.txt"
    }
}
```

---

## HTTP Capture Flow

With this architecture, traffic capture works as follows:

1. User's device → App → VPN TUN → **native C library**
2. Native C detects HTTP (port 80) → redirects to **HttpCaptureProxy** at 127.0.0.1:8888
3. Proxy parses request, captures method/URL/headers/body
4. Proxy forwards to real server, captures response
5. Proxy sends captured data to **VpnModule → RN via events**
6. Traffic list displays captured entries in real-time
7. For HTTPS (port 443): native C extracts SNI from ClientHello, tunnels the
   connection directly (no MITM), captures host only

---

## Implementation Steps

1. Write the C library from scratch following the descriptions above
   - Start with `ip.c` + `tcp.c` + `udp.c` (minimum viable)
   - Add `dns.c`, `session.c` for reliability
   - Add `http.c` + `tls.c` for capture integration
   - Add `util.c` for checksums and helpers

2. Set up CMakeLists.txt and build.gradle

3. Simplify `CaptureVpnService.kt` to delegate to native code

4. Keep `HttpCaptureProxy.kt` as-is (it already works)

5. Test: start VPN → browse web → check traffic appears in list
   - Verify TCP connections succeed (websites load)
   - Verify UDP/DNS works (domain resolution)
   - Verify HTTP capture (traffic entries appear)
   - Verify HTTPS capture (host appears, TLS tunnels through)

---

## Why This Works

- **C handles TCP correctly**: C has direct access to socket APIs, can build
  raw IP/TCP packets, and can manage sequence numbers precisely.
- **Protected sockets bypass VPN**: Every socket created by the C library is
  marked with `protect()` so it goes directly to the real network, not back
  into the TUN (infinite loop).
- **Single threaded TUN reader**: All packets are processed sequentially in
  the reader thread, avoiding concurrent access to the TUN fd.
- **Per-connection worker threads**: Each TCP connection gets its own thread
  for bidirectional forwarding, using standard socket `read()`/`write()`.
- **Proven pattern**: This is the exact architecture used by NetGuard,
  intra, TunProxy, and every other production Android VPN app.
