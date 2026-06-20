package com.networkspy.mobile.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.ProxyInfo
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.core.app.NotificationCompat
import com.networkspy.mobile.MainActivity
import java.net.InetSocketAddress

class CaptureVpnService : VpnService() {

    companion object {
        const val TAG = "CaptureVpnService"
        const val ACTION_START = "com.networkspy.mobile.vpn.START"
        const val ACTION_STOP = "com.networkspy.mobile.vpn.STOP"
        const val NOTIFICATION_ID = 1
        const val CHANNEL_ID = "vpn_capture"
        const val PROXY_PORT = 8888

        var isRunning = false

        fun start(context: Context) {
            val intent = Intent(context, CaptureVpnService::class.java).apply {
                action = ACTION_START
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, CaptureVpnService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }

    private var vpnInterface: ParcelFileDescriptor? = null
    private var proxyServer: HttpCaptureProxy? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startVpn()
            ACTION_STOP -> stopVpn()
        }
        return START_STICKY
    }

    private fun startVpn() {
        if (isRunning) return
        Log.d(TAG, "Starting VPN capture service")

        try {
            val proxy = ProxyInfo.buildDirectProxy("127.0.0.1", PROXY_PORT)

            vpnInterface = Builder()
                .setSession("NetworkSpy Capture")
                .addAddress("10.0.2.1", 24)
                .addRoute("0.0.0.0", 0)
                .addDnsServer("8.8.8.8")
                .addDnsServer("8.8.4.4")
                .setHttpProxy(proxy)
                .setMtu(1500)
                .setBlocking(false)
                .establish()
        } catch (e: IllegalStateException) {
            Log.e(TAG, "VPN not prepared, need user consent", e)
            VpnModule.emitError("VPN permission required")
            return
        } catch (e: Exception) {
            Log.e(TAG, "Error establishing VPN", e)
            VpnModule.emitError("Failed to create VPN interface: ${e.message}")
            stopVpn()
            return
        }

        if (vpnInterface == null) {
            Log.e(TAG, "VPN establish returned null - permission not granted")
            VpnModule.emitError("VPN permission not granted")
            return
        }

        Log.d(TAG, "VPN interface created with proxy 127.0.0.1:$PROXY_PORT")

        startForeground(NOTIFICATION_ID, buildNotification())

        proxyServer = HttpCaptureProxy(PROXY_PORT, applicationContext)
        proxyServer?.start()

        isRunning = true
        VpnModule.emitStatus("started")
        Log.d(TAG, "VPN capture started successfully")
    }

    private fun stopVpn() {
        Log.d(TAG, "Stopping VPN capture service")
        isRunning = false

        try {
            proxyServer?.stop()
            proxyServer = null
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping proxy", e)
        }

        try {
            vpnInterface?.close()
            vpnInterface = null
        } catch (e: Exception) {
            Log.e(TAG, "Error closing VPN interface", e)
        }

        VpnModule.emitStatus("stopped")
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun buildNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("NetworkSpy")
            .setContentText("Capturing network traffic...")
            .setSmallIcon(android.R.drawable.ic_menu_manage)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "VPN Capture",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "NetworkSpy traffic capture status"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        stopVpn()
        super.onDestroy()
    }

    override fun onRevoke() {
        stopVpn()
        super.onRevoke()
    }
}
