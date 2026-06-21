# How HTTPS Interception Certificates Work

## Why We Need Certificate Management

When you browse `https://example.com`, your browser expects the server to present a
TLS certificate proving it really is `example.com`. The certificate must be signed
by a Certificate Authority (CA) that the browser trusts.

Our VPN sits between the browser and real server. To decrypt the traffic, we must:

1. **Impersonate the server** — present a fake certificate for `example.com` to the browser
2. **The browser must trust it** — the fake cert must be signed by a CA the browser trusts
3. **We create our own CA** — the user installs our CA certificate once, then we can issue
   certificates for any website on the fly

```
┌──────────────────────────────────────────────────────────────┐
│                     One-time setup                           │
│                                                              │
│  1. App generates CA key + certificate                      │
│  2. User installs CA cert in Android Settings               │
│  3. Android now trusts anything signed by our CA             │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│              Per-connection (on the fly)                      │
│                                                              │
│  1. Chrome opens https://example.com                         │
│  2. VPN extracts SNI hostname: "example.com"                 │
│  3. VPN calls: HttpsCertManager.generateCertForHost("ex...") │
│  4. Returns: new cert for "example.com" signed by our CA     │
│  5. VPN presents this cert to Chrome                         │
│  6. Chrome verifies: signed by installed CA ✅ → trusts it   │
│  7. Handshake completes, data flows in plaintext             │
└──────────────────────────────────────────────────────────────┘
```

## The Code: `HttpsCertManager.kt`

### 1. CA Generation (first launch)

```kotlin
// HttpsCertManager.init()
private fun generateCA(ksFile: File) {
    val keyPair = generateRSAKeyPair()       // 2048-bit RSA
    val cert = generateRootCert(keyPair)      // Self-signed CA certificate

    // Store in BKS keystore for persistence
    val ks = KeyStore.getInstance("BKS", PROVIDER)
    ks.setKeyEntry(CA_ALIAS, keyPair.private, password, arrayOf(cert))
    ks.store(ksFile.outputStream(), password)

    rootCA = CertKeyPair(cert, keyPair.private)
}
```

The CA certificate has:
- `CN=VPN Test CA` — the name you see when installing
- `BasicConstraints: CA=true` — marks it as a Certificate Authority
- `KeyUsage: keyCertSign, cRLSign` — allowed to sign other certificates
- 10-year validity

### 2. Per-Host Certificate Generation

```kotlin
// HttpsCertManager.generateCertForHost("example.com")
private fun generateCertificate(hostname: String, caCert: X509Certificate, caKey: PrivateKey) {
    val keyPair = generateRSAKeyPair()       // New 2048-bit key for this host

    val builder = JcaX509v3CertificateBuilder(
        issuer  = X500Name(caCert.subject)   // "CN=VPN Test CA"
        subject = X500Name("CN=$hostname")   // "CN=example.com"
        publicKey = keyPair.public
    )

    // Critical extensions:
    builder.addExtension(Extension.subjectAlternativeName, false,
        GeneralNames(GeneralName(dNSName, hostname)))   // SAN: example.com
    builder.addExtension(Extension.basicConstraints, false,
        BasicConstraints(false))                         // NOT a CA
    builder.addExtension(Extension.extendedKeyUsage, false,
        ExtendedKeyUsage(KeyPurposeId.id_kp_serverAuth)) // Server auth only

    // Sign with CA's private key
    val signer = JcaContentSignerBuilder("SHA256WithRSA").build(caKey)
    val cert = signer.sign(builder)
}
```

### 3. Export for Installation

```kotlin
// HttpsCertManager.exportCAPEM()
fun exportCAPEM(context: Context): File {
    // Writes PEM format to Downloads/vpn-test-ca.crt:
    // -----BEGIN CERTIFICATE-----
    // MIID... (base64 encoded DER)
    // -----END CERTIFICATE-----
}
```

## The Trust Chain

```
┌──────────────────────────────┐
│  Root CA: "VPN Test CA"      │  ← User installed this in Settings
│  (self-signed, CA=true)      │     Android trusts it system-wide
└──────────────┬───────────────┘
               │ signs
               ▼
┌──────────────────────────────┐
│  Leaf: "CN=example.com"      │  ← Generated on the fly
│  (signed by VPN Test CA)     │     Presented to Chrome for TLS
│  SAN: example.com            │
│  EKU: serverAuth             │
└──────────────────────────────┘
```

Chrome's verification:
1. Receives cert for `example.com`
2. Checks SAN matches the URL ✅
3. Follows chain to issuer: `VPN Test CA`
4. Finds `VPN Test CA` in system trust store (user installed it) ✅
5. Validates signature ✅
6. **Trusts the connection**

## Why BouncyCastle?

Android's built-in `java.security.cert` APIs don't support creating X.509 v3
certificates with extensions (SAN, EKU, etc). We use BouncyCastle (`bcpkix`)
for:

- `X509v3CertificateBuilder` — construct certificates programmatically
- `JcaContentSignerBuilder` — sign with SHA-256 RSA
- `GeneralNames` — add Subject Alternative Names (browsers require this)

## Files Involved

| File | Purpose |
|------|---------|
| `HttpsCertManager.kt` | Generate CA, generate per-host certs, export PEM |
| `MainActivity.kt` | "Install CA Cert" button, calls export + opens Settings |
| `library/vpn/src/tls_proxy.c` | Uses cert via JNI callback `requestCert(hostname)` |

## Key Points

- **CA is generated once**, stored in `filesDir/vpntest_ca.bks` (BouncyCastle keystore)
- **Per-host certs are ephemeral** — generated on demand, never stored
- **RSA 2048-bit keys** for both CA and leaf certificates
- **Cert lifetime**: CA = 10 years, leaf = 1 year
- **The user MUST install the CA** — without it, Chrome shows certificate errors
