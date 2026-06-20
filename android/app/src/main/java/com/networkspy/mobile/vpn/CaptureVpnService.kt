package com.networkspy.mobile.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.core.app.NotificationCompat
import com.networkspy.mobile.MainActivity

class CaptureVpnService : VpnService() {

    companion object {
        const val TAG = "CaptureVpnService"
        const val NOTIFICATION_ID = 1
        const val CHANNEL_ID = "vpn_capture"
        const val PROXY_PORT = 8888

        private const val DEBUG = true

        private fun log(level: Int, msg: String, tr: Throwable? = null) {
            if (!DEBUG) return
            when (level) {
                Log.DEBUG -> Log.d(TAG, msg, tr)
                Log.INFO -> Log.i(TAG, msg, tr)
                Log.WARN -> Log.w(TAG, msg, tr)
                Log.ERROR -> Log.e(TAG, msg, tr)
                Log.VERBOSE -> Log.v(TAG, msg, tr)
            }
        }

        private fun logd(msg: String) = log(Log.DEBUG, msg)
        private fun logi(msg: String) = log(Log.INFO, msg)
        private fun logw(msg: String) = log(Log.WARN, msg)
        private fun loge(msg: String, tr: Throwable? = null) = log(Log.ERROR, msg, tr)

        @Volatile var isRunning = false
        private var activeService: CaptureVpnService? = null

        fun start(context: Context) {
            val intent = Intent(context, CaptureVpnService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            activeService?.stopVpn()
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

    // ── Service state ───────────────────────────────────────────

    private var vpnInterface: ParcelFileDescriptor? = null
    private var proxyServer: HttpCaptureProxy? = null

    override fun onCreate() {
        super.onCreate()
        activeService = this
        createNotificationChannel()
        jni_init()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startVpn()
        return START_STICKY
    }

    private fun startVpn() {
        if (isRunning) return
        logd("Starting VPN (native)")

        try {
            vpnInterface = Builder()
                .setSession("NetworkSpy Capture")
                .addAddress("10.0.2.1", 24)
                .addRoute("0.0.0.0", 0)
                .addDnsServer("8.8.8.8")
                .addDnsServer("8.8.4.4")
                .setMtu(jni_get_mtu())
                .setBlocking(true)
                .establish()
        } catch (e: IllegalStateException) {
            VpnModule.emitError("VPN permission required")
            return
        } catch (e: Exception) {
            VpnModule.emitError("VPN establish failed: ${e.message}")
            return
        }

        if (vpnInterface == null) {
            VpnModule.emitError("VPN permission not granted")
            return
        }

        startForeground(NOTIFICATION_ID, buildNotification())

        proxyServer = HttpCaptureProxy(PROXY_PORT, applicationContext)
        proxyServer?.start()

        // Delegate all packet forwarding to native C library
        val tunFd = vpnInterface!!.fd
        jni_start(tunFd, false, 3, "127.0.0.1", PROXY_PORT)

        isRunning = true
        VpnModule.emitStatus("started")
        logd("VPN started (native forwarding)")
    }

    private fun stopVpn() {
        if (!isRunning) return
        logd("Stopping VPN")
        isRunning = false

        vpnInterface?.let { jni_stop(it.fd) }

        try { vpnInterface?.close() } catch (_: Exception) {}
        vpnInterface = null

        try { proxyServer?.stop() } catch (_: Exception) {}
        proxyServer = null

        VpnModule.emitStatus("stopped")
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    // ── Notification / lifecycle ────────────────────────────────

    private fun buildNotification(): Notification {
        val pi = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("NetworkSpy")
            .setContentText("Capturing network traffic...")
            .setSmallIcon(android.R.drawable.ic_menu_manage)
            .setOngoing(true).setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_LOW).build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL_ID, "VPN Capture", NotificationManager.IMPORTANCE_LOW)
            ch.description = "NetworkSpy traffic capture"
            getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        }
    }

    override fun onDestroy() {
        activeService = null
        stopVpn()
        jni_done()
        super.onDestroy()
    }

    override fun onRevoke() {
        stopVpn()
        super.onRevoke()
    }
}
