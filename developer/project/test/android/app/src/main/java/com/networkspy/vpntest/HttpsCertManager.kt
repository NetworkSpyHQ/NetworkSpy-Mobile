package com.networkspy.vpntest

import android.content.Context
import android.util.Base64
import org.bouncycastle.asn1.x500.X500Name
import org.bouncycastle.asn1.x509.*
import org.bouncycastle.cert.X509v3CertificateBuilder
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder
import java.io.File
import java.math.BigInteger
import java.security.*
import java.security.cert.X509Certificate
import java.util.*
import javax.net.ssl.*

object HttpsCertManager {
    private const val CA_ALIAS = "vpn_test_ca"
    private const val KEYSTORE_PASSWORD = "vpntest"
    private val PROVIDER = BouncyCastleProvider()

    data class CertKeyPair(val certificate: X509Certificate, val privateKey: PrivateKey)

    @Volatile var rootCA: CertKeyPair? = null

    @Volatile var initialized = false

    fun ensureInitialized(context: Context) {
        if (initialized) return
        initialized = true
        init(context)
    }

    fun init(context: Context) {
        val ksFile = File(context.filesDir, "vpntest_ca.bks")
        if (ksFile.exists()) {
            loadCA(ksFile)
        } else {
            generateCA(ksFile)
        }
    }

    fun generateCertForHost(hostname: String): CertKeyPair? {
        val ca = rootCA ?: return null
        return generateCertificate(hostname, ca.certificate, ca.privateKey)
    }

    private fun loadCA(ksFile: File) {
        try {
            val ks = KeyStore.getInstance("BKS", PROVIDER)
            ks.load(ksFile.inputStream(), KEYSTORE_PASSWORD.toCharArray())
            if (ks.containsAlias(CA_ALIAS)) {
                val cert = ks.getCertificate(CA_ALIAS) as X509Certificate
                val key = ks.getKey(CA_ALIAS, KEYSTORE_PASSWORD.toCharArray()) as PrivateKey
                rootCA = CertKeyPair(cert, key)
            }
        } catch (_: Exception) {
            generateCA(ksFile)
        }
    }

    private fun generateCA(ksFile: File) {
        try {
            val keyPair = generateRSAKeyPair()
            val cert = generateRootCert(keyPair)
            rootCA = CertKeyPair(cert, keyPair.private)

            val ks = KeyStore.getInstance("BKS", PROVIDER)
            ks.load(null, KEYSTORE_PASSWORD.toCharArray())
            ks.setKeyEntry(CA_ALIAS, keyPair.private, KEYSTORE_PASSWORD.toCharArray(),
                arrayOf(cert))
            ks.store(ksFile.outputStream(), KEYSTORE_PASSWORD.toCharArray())
        } catch (e: Exception) {
            android.util.Log.e("HttpsCertManager", "Failed to generate CA", e)
        }
    }

    fun getCAInstallData(): String? {
        val cert = rootCA?.certificate ?: return null
        return Base64.encodeToString(cert.encoded, Base64.NO_WRAP)
    }

    fun exportCAPEM(context: Context): File? {
        val cert = rootCA?.certificate ?: return null
        val pem = "-----BEGIN CERTIFICATE-----\n" +
                  Base64.encodeToString(cert.encoded, Base64.DEFAULT) +
                  "-----END CERTIFICATE-----\n"

        return try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                // Android 10+: use MediaStore for Downloads
                val values = android.content.ContentValues().apply {
                    put(android.provider.MediaStore.Downloads.DISPLAY_NAME, "vpn-test-ca.crt")
                    put(android.provider.MediaStore.Downloads.MIME_TYPE, "application/x-x509-ca-cert")
                    put(android.provider.MediaStore.Downloads.IS_PENDING, 1)
                }
                val resolver = context.contentResolver
                val uri = resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                if (uri != null) {
                    resolver.openOutputStream(uri)?.use { it.write(pem.toByteArray()) }
                    values.clear()
                    values.put(android.provider.MediaStore.Downloads.IS_PENDING, 0)
                    resolver.update(uri, values, null, null)
                }
                // Return a file for the toast path
                File(android.os.Environment.getExternalStoragePublicDirectory(
                    android.os.Environment.DIRECTORY_DOWNLOADS), "vpn-test-ca.crt")
            } else {
                val dir = android.os.Environment.getExternalStoragePublicDirectory(
                    android.os.Environment.DIRECTORY_DOWNLOADS)
                dir.mkdirs()
                val file = File(dir, "vpn-test-ca.crt")
                file.writeText(pem)
                file.setReadable(true, false)
                file
            }
        } catch (e: Exception) {
            android.util.Log.e("HttpsCertManager", "export failed", e)
            null
        }
    }

    private fun generateRSAKeyPair(): KeyPair {
        val gen = KeyPairGenerator.getInstance("RSA")
        gen.initialize(2048, SecureRandom())
        return gen.generateKeyPair()
    }

    private fun generateRootCert(keyPair: KeyPair): X509Certificate {
        val now = Date()
        val serial = BigInteger.valueOf(System.currentTimeMillis())
        val issuer = X500Name("CN=VPN Test CA, O=VPN Test, C=US")
        val subject = issuer
        val notAfter = Date(now.time + 10L * 365 * 24 * 3600 * 1000)

        val builder: X509v3CertificateBuilder = JcaX509v3CertificateBuilder(
            issuer, serial, now, notAfter, subject, keyPair.public
        )

        builder.addExtension(Extension.basicConstraints, true, BasicConstraints(true))
        builder.addExtension(Extension.keyUsage, true, KeyUsage(KeyUsage.keyCertSign or KeyUsage.cRLSign))
        builder.addExtension(Extension.subjectKeyIdentifier, false,
            SubjectKeyIdentifier(keyPair.public.encoded))

        val signer = JcaContentSignerBuilder("SHA256WithRSA").setProvider(PROVIDER).build(keyPair.private)
        return JcaX509CertificateConverter().setProvider(PROVIDER).getCertificate(builder.build(signer))
    }

    private fun generateCertificate(hostname: String, caCert: X509Certificate, caKey: PrivateKey): CertKeyPair? {
        return try {
            val keyPair = generateRSAKeyPair()
            val now = Date()
            val serial = BigInteger.valueOf(System.currentTimeMillis())
            val issuer = X500Name(caCert.subjectX500Principal.name)
            val subject = X500Name("CN=$hostname, O=VPN Test")

            val builder: X509v3CertificateBuilder = JcaX509v3CertificateBuilder(
                issuer, serial, now,
                Date(now.time + 365L * 24 * 3600 * 1000),
                subject, keyPair.public
            )

            val altNames = GeneralNames(GeneralName(GeneralName.dNSName, hostname))
            builder.addExtension(Extension.subjectAlternativeName, false, altNames)
            builder.addExtension(Extension.basicConstraints, false, BasicConstraints(false))
            builder.addExtension(Extension.keyUsage, false,
                KeyUsage(KeyUsage.digitalSignature or KeyUsage.keyEncipherment))
            builder.addExtension(Extension.extendedKeyUsage, false,
                ExtendedKeyUsage(arrayOf(KeyPurposeId.id_kp_serverAuth)))

            val signer = JcaContentSignerBuilder("SHA256WithRSA").setProvider(PROVIDER).build(caKey)
            val cert = JcaX509CertificateConverter().setProvider(PROVIDER).getCertificate(builder.build(signer))
            CertKeyPair(cert, keyPair.private)
        } catch (e: Exception) {
            android.util.Log.e("HttpsCertManager", "Failed to generate cert for $hostname", e)
            null
        }
    }

    fun createSSLContext(hostname: String): SSLContext? {
        val certKey = generateCertForHost(hostname) ?: return null
        return try {
            val ks = KeyStore.getInstance("PKCS12")
            ks.load(null, null)
            ks.setKeyEntry("cert", certKey.privateKey, "".toCharArray(), arrayOf(certKey.certificate))
            val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
            kmf.init(ks, "".toCharArray())
            val ctx = SSLContext.getInstance("TLS")
            ctx.init(kmf.keyManagers, null, SecureRandom())
            ctx
        } catch (e: Exception) {
            android.util.Log.e("HttpsCertManager", "Failed to create SSLContext for $hostname", e)
            null
        }
    }

    fun generateCertPEMForHost(hostname: String): String? {
        val certKey = generateCertForHost(hostname) ?: return null
        return try {
            val sb = StringBuilder()
            sb.append("-----BEGIN CERTIFICATE-----\n")
            sb.append(Base64.encodeToString(certKey.certificate.encoded, Base64.DEFAULT))
            sb.append("-----END CERTIFICATE-----\n")
            sb.append("-----BEGIN PRIVATE KEY-----\n")
            sb.append(Base64.encodeToString(certKey.privateKey.encoded, Base64.DEFAULT))
            sb.append("-----END PRIVATE KEY-----\n")
            sb.toString()
        } catch (_: Exception) { null }
    }
}
