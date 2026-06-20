# SSL Decryption Architecture

## Goal

Decrypt HTTPS traffic passing through the VPN so the UI can display plaintext HTTP
requests and responses — like a man-in-the-middle proxy, but running inside the VPN
at native C speed.

---

## How HTTPS TLS Interception Works

```
┌──────────┐                    ┌──────────────┐                    ┌──────────┐
│  Chrome  │                    │  Our VPN (C)  │                    │  Server  │
│ (client) │                    │   libvpn.so   │                    │ (real)   │
└────┬─────┘                    └──────┬────────┘                    └────┬─────┘
     │                                 │                                  │
     │──TCP SYN (port 443)──────────→  │                                  │
     │                                 │──TCP connect()────────────────→  │
     │←──TCP SYN-ACK─────────────────  │                                  │
     │                                 │                                  │
     │──TLS ClientHello─────────────→ │  extract SNI hostname            │
     │  (SNI: example.com)            │  ↓                               │
     │                                 │  [SPAWN SSL THREAD]              │
     │                                 │  ↓                               │
     │                                 │  Generate fake cert for host     │
     │                                 │  SSL_accept(client) ← as SERVER  │
     │                                 │  ↓                               │
     │  ← SSL handshake →              │                                  │
     │                                 │  SSL_connect(server) ← as CLIENT │
     │                                 │                                  │  ← SSL handshake →
     │                                 │                                  │
     │──GET / HTTP/1.1──────────────→  │  SSL_read() → PLAINTEXT         │
     │                                 │  📸 CAPTURE REQUEST             │
     │                                 │  SSL_write() → server            │────→
     │                                 │                                  │
     │                                 │  SSL_read() ← server            │←────
     │                                 │  📸 CAPTURE RESPONSE            │
     │←──HTTP/1.1 200 OK─────────────  │  SSL_write() → client            │
     │                                 │                                  │
     │   [bidirectional data relay]    │                                  │
     │                                 │                                  │
```

The VPN splits one TLS connection into TWO:
1. **Client side**: VPN acts as a **TLS server**, presenting a fake certificate
   signed by the user-installed CA cert. Chrome trusts it because the CA is
   installed on the device.
2. **Server side**: VPN acts as a **TLS client**, connecting to the real server
   with proper TLS. The server sees a normal HTTPS connection.

Between the two, the VPN reads and writes **plaintext**, which is captured.

---

## Current State

### Done

| Component | Status | Location |
|-----------|--------|----------|
| OpenSSL 3.4.1 compiled for arm64 | Done | `library/vpn/openssl/prebuilt/arm64-v8a/` |
| OpenSSL linked into libvpn.so | Done | `library/vpn/CMakeLists.txt` |
| TLS interception scaffold | Done | `library/vpn/src/tls_proxy.c` |
| Certificate generation (Java) | Done | `HttpsCertManager.kt` |
| CA export to PEM (.crt) | Done | `HttpsCertManager.kt` |
| SNI hostname extraction | Done | `library/vpn/src/http.c : tls_extract_sni()` |

### Not Done

| Task | Why Needed |
|------|-----------|
| Wire `tls_intercept()` into TCP flow | Currently just a TODO comment |
| Spawn SSL work on background thread | SSL handshake takes 100-500ms; blocks TUN reader |
| Pass fake cert from Java → C via JNI | Need per-host certificate signed by our CA |
| Full plaintext relay (bidirectional) | Currently only reads first request |
| Capture and send to UI | Need JSON events for Capture tab |

---

## Implementation Plan

### Step 1: Pass Certificate from Java to Native

**Problem**: `tls_proxy.c` generates an ephemeral self-signed cert (not trusted).
We need to use the CA from `HttpsCertManager.kt` to sign per-host certificates.

**Solution**: Add JNI callback `requestCert(hostname: String): String` that returns
a PEM-encoded certificate + private key pair.

```c
// In jni.c or new cert_bridge.c
static SSL_CTX *get_ssl_ctx_for_host(const char *hostname) {
    // Call Java: String certAndKey = VpnTestService.requestCert(hostname)
    // Parse PEM cert + private key
    // Create SSL_CTX, load cert+key, return
}
```

### Step 2: Spawn SSL Thread

**Problem**: SSL handshake is blocking. If done on the TUN reader thread, all
other TCP connections freeze during the handshake.

**Solution**: When SNI is extracted in `handle_tcp_packet`, instead of proceeding
with normal TCP forwarding, spawn a new thread that handles the full SSL lifecycle.

```c
// In tcp.c, after tls_extract_sni() returns:
if (s->is_https && s->sni_host[0]) {
    struct ssl_thread_args *args = malloc(sizeof(*args));
    args->client_fd = s->socket_fd;  // the socket connected to the VPN client proxy
    args->dst_ip = s->dst_ip;
    args->dst_port = s->dst_port;
    strcpy(args->hostname, s->sni_host);
    
    pthread_t thread;
    pthread_create(&thread, NULL, ssl_intercept_thread, args);
    pthread_detach(thread);
    
    // Mark session as SSL-handled; don't do normal TCP forwarding
    s->state = S_CLOSED;
    return;
}
```

### Step 3: Full SSL Interception Thread

```c
void *ssl_intercept_thread(void *arg) {
    struct ssl_thread_args *a = arg;
    
    // 1. Get SSL_CTX for this host (with fake cert signed by our CA)
    SSL_CTX *ctx = get_ssl_ctx_for_host(a->hostname);
    
    // 2. Accept TLS from client
    SSL *client_ssl = SSL_new(ctx);
    SSL_set_fd(client_ssl, a->client_fd);
    SSL_accept(client_ssl);
    
    // 3. Connect TLS to real server
    int server_fd = socket(AF_INET, SOCK_STREAM, 0);
    protect_socket(g_ctx, server_fd);
    struct sockaddr_in addr = { .sin_family = AF_INET, ... };
    connect(server_fd, &addr, sizeof(addr));
    
    SSL *server_ssl = SSL_new(client_ctx);  // standard TLS client context
    SSL_set_fd(server_ssl, server_fd);
    SSL_connect(server_ssl);
    
    // 4. Bidirectional relay with capture
    //    Two threads: client→server and server→client
    //    Each reads plaintext, forwards, and captures
    
    // 5. Cleanup
    SSL_free(client_ssl);
    SSL_free(server_ssl);
    close(server_fd);
    free(a);
}
```

### Step 4: Capture and Forward to UI

```c
// In the relay loop, when data is read:
char *plaintext = malloc(len + 1);
SSL_read(client_ssl, plaintext, len);

// Send to Java via JNI
char json[8192];
snprintf(json, sizeof(json),
    "{\"id\":%d,\"type\":\"https_decrypted\",\"host\":\"%s\",\"data_hex\":\"",
    session_id, hostname);
hex_encode(plaintext, len, json + strlen(json));
strcat(json, "\"}");
on_http_event(g_ctx, json);
```

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `library/vpn/src/tls_proxy.c` | Rewrite | Full SSL interception with relay threads |
| `library/vpn/src/jni.c` | Add | `mid_on_request_cert` JNI callback |
| `library/vpn/src/tcp.c` | Modify | Spawn SSL thread when HTTP is detected |
| `library/vpn/include/vpn.h` | Add | `ssl_thread_args` struct |
| `VpnTestService.kt` | Add | `requestCert(hostname): String` native callback |
| `HttpsCertManager.kt` | Add | `generateCertPEMForHost(hostname): String` method |
| `MainActivity.kt` | Update | Decode hex body and show in Capture tab |

---

## Data Flow Summary

```
1. Chrome opens https://example.com
2. TCP SYN → our VPN intercepts
3. Client sends TLS ClientHello (SNI: example.com)
4. Native extracts SNI, spawns SSL thread
5. SSL thread calls Java: "give me cert for example.com"
6. Java generates cert (RSA 2048, signed by CA, SAN: example.com)
7. Java returns PEM cert + key to C
8. C calls SSL_accept(client_ssl) → handshake with Chrome
9. C calls SSL_connect(server_ssl) → handshake with real server
10. Chrome sends GET / → C reads plaintext → captures → forwards to server
11. Server responds 200 OK → C reads plaintext → captures → forwards to Chrome
12. UI shows: ↑ GET /, ↓ 200 OK text/html
```

---

## Why This Works

- **Certificate trust**: User installed our CA cert. Chrome trusts any cert
  signed by that CA. We generate per-host certs on the fly.
- **No proxy**: Everything happens inside the VPN. No separate TCP server on
  localhost. The VPN key icon stays.
- **Native speed**: SSL operations in C via OpenSSL are 10-50x faster than
  Java's SSLEngine. Handshake is sub-millisecond for cached sessions.
- **Full capture**: Since we decrypt, we see the raw HTTP request and response.
  Headers, body, everything.

---

## OpenSSL Build Notes

```
OpenSSL 3.4.1 compiled for android-arm64
Flags: no-asm no-shared no-apps no-tests no-docs
Output: libssl.a (1.2 MB) + libcrypto.a (6.8 MB)
Linked into: libvpn.so (~9 MB debug, ~3 MB release)
```

To rebuild for other architectures:
```bash
cd library/vpn/openssl
./build.sh  # currently arm64 only; add armeabi-v7a, x86, x86_64 loops
```
