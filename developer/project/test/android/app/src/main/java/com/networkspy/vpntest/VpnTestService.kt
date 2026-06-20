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
        const val PROXY_PORT = 8888

        @Volatile var isRunning = false
        @Volatile var activeService: VpnTestService? = null

        var listener: ((String) -> Unit)? = null
        var captureListener: ((String) -> Unit)? = null

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

    // Called from native code via JNI
    @Suppress("unused")
    private fun onTraffic(msg: String) {
        listener?.invoke(msg)
    }

    @Suppress("unused")
    private fun onHttpCapture(json: String) {
        captureListener?.invoke(json)
    }

    // ── State ──────────────────────────────────────────────────

    private var vpnInterface: ParcelFileDescriptor? = null
    private var proxy: HttpsProxy? = null

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

    fun startVpn() {
        if (isRunning) return

        listener?.invoke("VPN starting...")
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

        proxy = HttpsProxy(PROXY_PORT).also {
            it.onCapture = { json -> captureListener?.invoke(json) }
            it.start()
        }
        listener?.invoke("Proxy started on port $PROXY_PORT")

        jni_start(vpnInterface!!.fd, false, 3, "127.0.0.1", PROXY_PORT)

        isRunning = true
        listener?.invoke("VPN started")
        Log.i(TAG, "VPN started successfully")
    }

    fun stopVpn() {
        if (!isRunning) return
        listener?.invoke("VPN stopping...")
        Log.i(TAG, "Stopping VPN...")
        isRunning = false

        vpnInterface?.let { jni_stop(it.fd) }
        try { vpnInterface?.close() } catch (_: Exception) {}
        vpnInterface = null

        try { proxy?.stop() } catch (_: Exception) {}
        proxy = null

        listener?.invoke("VPN stopped")
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
