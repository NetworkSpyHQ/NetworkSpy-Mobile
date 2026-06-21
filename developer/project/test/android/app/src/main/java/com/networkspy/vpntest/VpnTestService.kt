package com.networkspy.vpntest

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.core.app.NotificationCompat

class VpnTestService : VpnService() {

    companion object {
        private const val TAG = "VpnTestService"
        private const val NOTIFICATION_ID = 1
        private const val CHANNEL_ID = "vpn_test_channel"
        const val MAX_BUFFERED = 200

        @Volatile var isRunning = false
        @Volatile var isIntercepting = false
        @Volatile var activeService: VpnTestService? = null

        var listener: ((String) -> Unit)? = null
        var captureListener: ((String) -> Unit)? = null

        private val bufferedLogs = mutableListOf<String>()
        private val bufferedCaptures = mutableListOf<String>()

        fun drainBufferedLogs() {
            val l = listener ?: return
            synchronized(bufferedLogs) {
                for (msg in bufferedLogs) { l(msg) }
                bufferedLogs.clear()
            }
        }

        fun drainBufferedCaptures() {
            val l = captureListener ?: return
            synchronized(bufferedCaptures) {
                for (msg in bufferedCaptures) { l(msg) }
                bufferedCaptures.clear()
            }
        }

        private fun emitOrBuffer(msg: String, buffer: MutableList<String>, listener: ((String) -> Unit)?) {
            val l = listener
            if (l != null) {
                l(msg)
            } else {
                synchronized(buffer) {
                    buffer.add(msg)
                    if (buffer.size > MAX_BUFFERED) buffer.removeAt(0)
                }
            }
        }

        fun emitTraffic(msg: String) {
            emitOrBuffer(msg, bufferedLogs, listener)
        }

        fun emitCapture(msg: String) {
            emitOrBuffer(msg, bufferedCaptures, captureListener)
        }

        init {
            System.loadLibrary("vpn")
        }
    }

    // ── Native methods ─────────────────────────────────────────

    private external fun jni_init()
    private external fun jni_start(tunFd: Int, fwd53: Boolean, rcode: Int,
                                    proxyIp: String, proxyPort: Int)
    private external fun jni_stop(tunFd: Int)
    private external fun jni_get_mtu(): Int
    private external fun jni_done()
    private external fun jni_set_intercept(enabled: Boolean)

    // Called from native code via JNI
    @Suppress("unused")
    private fun onTraffic(msg: String) {
        emitTraffic(msg)
    }

    @Suppress("unused")
    private fun onHttpCapture(json: String) {
        emitCapture(json)
    }

    // Called from native code via JNI to get a cert for a hostname
    @Suppress("unused")
    private fun requestCert(hostname: String): String {
        return HttpsCertManager.generateCertPEMForHost(hostname) ?: ""
    }

    // ── State ──────────────────────────────────────────────────

    private var vpnInterface: ParcelFileDescriptor? = null

    override fun onCreate() {
        super.onCreate()
        activeService = this
        HttpsCertManager.init(this)
        createNotificationChannel()
        jni_init()
        Log.i(TAG, "Service created, native lib initialized")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startVpn()
        return START_STICKY
    }

    fun toggleIntercept(): Boolean {
        isIntercepting = !isIntercepting
        jni_set_intercept(isIntercepting)
        val msg = "Intercept ${if (isIntercepting) "ENABLED" else "DISABLED"}"
        emitCapture("{\"type\":\"system\",\"msg\":\"$msg\"}")
        emitTraffic(msg)
        return isIntercepting
    }

    fun startVpn() {
        if (isRunning) return

        emitTraffic("VPN starting...")
        Log.i(TAG, "Starting VPN...")
        try {
            vpnInterface = Builder()
                .setSession("VPN Test")
                .addAddress("10.0.2.1", 24)
                .addRoute("0.0.0.0", 0)
                .addDnsServer("8.8.8.8")
                .addDnsServer("8.8.4.4")
                .setMtu(jni_get_mtu())
                .setBlocking(true)
                .establish()
        } catch (e: Exception) {
            Log.e(TAG, "VPN establish failed: ${e.message}", e)
            stopSelf()
            return
        }

        if (vpnInterface == null) {
            Log.e(TAG, "VPN interface is null")
            stopSelf()
            return
        }

        startForeground(NOTIFICATION_ID, buildNotification())

        jni_start(vpnInterface!!.fd, false, 3, "", 0)

        isRunning = true
        emitTraffic("VPN started")
        Log.i(TAG, "VPN started successfully")
    }

    fun stopVpn() {
        if (!isRunning) return
        emitTraffic("VPN stopping...")
        Log.i(TAG, "Stopping VPN...")
        isRunning = false

        vpnInterface?.let { jni_stop(it.fd) }
        try { vpnInterface?.close() } catch (_: Exception) {}
        vpnInterface = null

        emitTraffic("VPN stopped")
        Log.i(TAG, "VPN stopped")
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun buildNotification(): Notification {
        val pi = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("VPN Test")
            .setContentText("VPN is active")
            .setSmallIcon(android.R.drawable.ic_menu_manage)
            .setOngoing(true)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID, "VPN Service",
                NotificationManager.IMPORTANCE_LOW
            )
            ch.description = "VPN test service channel"
            getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        }
    }

    override fun onDestroy() {
        stopVpn()
        jni_done()
        activeService = null
        super.onDestroy()
    }

    override fun onRevoke() {
        stopVpn()
        super.onRevoke()
    }
}
