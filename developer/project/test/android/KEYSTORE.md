# Why BKS? Android Keystore Formats Explained

## Why We Store the Private Key

Our CA certificate has a matching **RSA 2048-bit private key**. This key is
needed every time we generate a per-host certificate. If we lose it, the CA
becomes useless — we can't sign new certificates. We MUST persist it.

The CA keypair (certificate + private key) is stored in a keystore file:
`filesDir/vpntest_ca.bks`

## Available Keystore Formats

### BKS (BouncyCastle Keystore) — **our choice**

| Property | Value |
|----------|-------|
| Java class | `org.bouncycastle.jce.provider.BouncyCastleProvider` |
| File extension | `.bks` |
| Algorithm | BKS-V1 |
| Encryption | Triple DES (3DES) with password-based key derivation |
| Android support | Any API level (provided by BouncyCastle library) |

**Why we chose BKS:**
1. **Consistent across devices** — JKS/PKCS12 behavior varies between Android versions
2. **Password-protected** — the key is encrypted at rest with our password
3. **Works without Android Keystore** — doesn't require hardware-backed storage, which
   would prevent exporting the certificate for user installation
4. **BouncyCastle is already our dependency** — we use it for X.509 cert generation

### JKS (Java KeyStore) — Java's default

| Property | Value |
|----------|-------|
| Java class | `java.security.KeyStore.getInstance("JKS")` |
| Format | Proprietary Oracle format |
| Android support | Read-only on some versions, write issues on others |

**Why NOT JKS:**
- Write support removed from some Android versions
- Proprietary format tied to Oracle JDK
- Considered deprecated since Java 9

### PKCS#12 (.p12 / .pfx)

| Property | Value |
|----------|-------|
| Java class | `KeyStore.getInstance("PKCS12")` |
| Format | Industry standard (RFC 7292) |
| Encryption | AES-256-CBC or 3DES |

**Why NOT PKCS12 for storage:**
- BouncyCastle's PCKS12 implementation had compatibility issues on some Android versions
- Password-based key derivation differs between Java versions (PKCS12 vs PKCS12-3DES)
- Some Android API levels reject PKCS12 key entries with empty passwords
- **However**, we DO use PKCS12 in-memory for `createSSLContext()` since it's temporary

### Android Keystore (hardware-backed)

| Property | Value |
|----------|-------|
| Java class | `KeyStore.getInstance("AndroidKeyStore")` |
| Storage | TEE (Trusted Execution Environment) or StrongBox |
| Export | **Keys CANNOT be extracted** |

**Why NOT Android Keystore:**
- The private key can never leave the hardware — we can't sign certificates in native C code
- We need the raw key material to pass to OpenSSL via PEM (JNI callback)
- Hardware-backed keys are non-exportable by design (good for security, bad for MITM)

## How We Load/Save BKS

```kotlin
// Saving (on first launch):
val ks = KeyStore.getInstance("BKS", BouncyCastleProvider())
ks.load(null, password)  // Create empty
ks.setKeyEntry("vpn_test_ca", privateKey, password, arrayOf(certificate))
ks.store(FileOutputStream(file), password)

// Loading (subsequent launches):
val ks = KeyStore.getInstance("BKS", BouncyCastleProvider())
ks.load(FileInputStream(file), password)
val cert = ks.getCertificate("vpn_test_ca") as X509Certificate
val key = ks.getKey("vpn_test_ca", password) as PrivateKey
```

## Comparison Table

| Aspect | BKS | JKS | PKCS12 | Android Keystore |
|--------|-----|-----|--------|-----------------|
| Write on Android | ✅ | ❌ (broken) | ⚠️ (quirky) | ✅ |
| Read on Android | ✅ | ✅ | ✅ | ✅ |
| Password protection | ✅ | ✅ | ✅ | N/A (hardware) |
| Key extractable | ✅ | ✅ | ✅ | ❌ |
| Cross-platform | ⚠️ (BouncyCastle) | ⚠️ (Java) | ✅ | ❌ |
| OpenSSL compatible | ✅ (via PEM) | ✅ (via PEM) | ✅ (via PEM) | ❌ |

## The Password

Our BKS keystore uses password `"vpntest"`. In production you'd want something
stronger, but for a test project this is fine. The keystore itself is stored in
the app's private directory (`filesDir`), so only our app can read it.

## Key Takeaway

BKS gives us **reliable write support across all Android versions** with
**password-protected encryption** and **extractable keys** we can pass to OpenSSL.
No other format provides all three.
