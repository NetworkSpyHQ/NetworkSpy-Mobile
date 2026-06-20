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
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class CaptureVpnService : VpnService() {

    companion object {
        const val TAG = "CaptureVpnService"
        const val NOTIFICATION_ID = 1
        const val CHANNEL_ID = "vpn_capture"
        const val PROXY_PORT = 8888

        // Set to false to disable all VPN logging
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
    }

    private var vpnInterface: ParcelFileDescriptor? = null
    private var proxyServer: HttpCaptureProxy? = null
    private val executor: ExecutorService = Executors.newCachedThreadPool()
    private val tcpTunnels = ConcurrentHashMap<String, TcpTunnel>()
    private var tunOutput: FileOutputStream? = null

    override fun onCreate() {
        super.onCreate()
        activeService = this
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startVpn()
        return START_STICKY
    }

    private fun startVpn() {
        if (isRunning) return
        logd("Starting VPN")

        try {
            vpnInterface = Builder()
                .setSession("NetworkSpy Capture")
                .addAddress("10.0.2.1", 24)
                .addRoute("0.0.0.0", 0)
                .addDnsServer("8.8.8.8")
                .addDnsServer("8.8.4.4")
                .setMtu(1500)
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

        tunOutput = FileOutputStream(vpnInterface!!.fileDescriptor)

        proxyServer = HttpCaptureProxy(PROXY_PORT, applicationContext)
        proxyServer?.start()

        isRunning = true
        VpnModule.emitStatus("started")

        executor.execute { packetLoop(vpnInterface!!) }
        logd("VPN started with packet forwarding")
    }

    private fun stopVpn() {
        if (!isRunning) return
        logd("Stopping VPN")
        isRunning = false

        try { vpnInterface?.close() } catch (_: Exception) {}
        vpnInterface = null
        tunOutput = null

        tcpTunnels.values.forEach { try { it.close() } catch (_: Exception) {} }
        tcpTunnels.clear()

        try { proxyServer?.stop() } catch (_: Exception) {}
        proxyServer = null

        executor.shutdownNow()

        VpnModule.emitStatus("stopped")
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun packetLoop(vpnFd: ParcelFileDescriptor) {
        val input = FileInputStream(vpnFd.fileDescriptor)
        val buffer = ByteArray(32767)
        var count = 0L

        try {
            while (isRunning && !Thread.interrupted()) {
                val len = input.read(buffer)
                if (len <= 0) continue
                count++
                try {
                    handlePacket(buffer, len)
                } catch (e: Exception) {
                    loge("Packet error: ${e.message}")
                }
            }
        } catch (e: Exception) {
            if (isRunning) loge("Loop error: ${e.message}")
        } finally {
            logd("Packet loop ended. $count packets")
        }
    }

    private fun handlePacket(data: ByteArray, length: Int) {
        if (length < 20) return
        val version = (data[0].toInt() shr 4) and 0x0F
        if (version != 4) return

        val protocol = data[9].toInt() and 0xFF
        when (protocol) {
            6 -> handleTcp(data, length)
            17 -> handleUdp(data, length)
        }
    }

    // ── TCP ──────────────────────────────────────────────────

    private fun handleTcp(data: ByteArray, length: Int) {
        val ipHdrLen = (data[0].toInt() and 0x0F) * 4
        if (length < ipHdrLen + 20) return

        val srcIp = ByteArray(4); System.arraycopy(data, 12, srcIp, 0, 4)
        val dstIp = ByteArray(4); System.arraycopy(data, 16, dstIp, 0, 4)
        val srcPort = ((data[ipHdrLen].toInt() and 0xFF) shl 8) or (data[ipHdrLen + 1].toInt() and 0xFF)
        val dstPort = ((data[ipHdrLen + 2].toInt() and 0xFF) shl 8) or (data[ipHdrLen + 3].toInt() and 0xFF)
        val flags = data[ipHdrLen + 13].toInt() and 0xFF
        val isSyn = (flags and 0x02) != 0
        val isRst = (flags and 0x04) != 0
        val isFin = (flags and 0x01) != 0
        val tcpHdrLen = ((data[ipHdrLen + 12].toInt() shr 4) and 0x0F) * 4
        val payloadOff = ipHdrLen + tcpHdrLen
        val payloadLen = length - payloadOff
        val seqNum = ByteBuffer.wrap(data, ipHdrLen + 4, 4).int
        val key = "${ipStr(srcIp)}:$srcPort->${ipStr(dstIp)}:$dstPort"

        if (dstPort == PROXY_PORT) return

        if (isSyn && !isRst) {
            tcpTunnels[key]?.close()
            val tunnel = TcpTunnel(srcIp, dstIp, srcPort, dstPort, ipHdrLen, seqNum)
            tcpTunnels[key] = tunnel
            executor.execute { tunnel.run() }
        } else if (isRst) {
            tcpTunnels.remove(key)?.close()
        } else if (isFin) {
            tcpTunnels[key]?.sendFin()
        } else if (payloadLen > 0) {
            tcpTunnels[key]?.sendData(data, payloadOff, payloadLen)
        }
    }

    inner class TcpTunnel(
        private val srcIp: ByteArray,
        private val dstIp: ByteArray,
        private val srcPort: Int,
        private val dstPort: Int,
        private val ipHdrLen: Int,
        clientSeq: Int
    ) {
        private var socket: Socket? = null
        private var mySeq = (Math.random() * Int.MAX_VALUE).toInt()
        private var clientSeqNum = clientSeq
        private var sentSynAck = false

        fun run() {
            try {
                val sock = Socket()
                protect(sock)
                sock.connect(InetSocketAddress(InetAddress.getByAddress(dstIp), dstPort), 10000)
                socket = sock

                val synAck = buildTcpPacket(0x12, ByteArray(0), 0) // SYN+ACK
                mySeq++ // SYN consumes 1 seq number
                sentSynAck = true

                writeToTun(synAck)

                // Read from server, write to TUN
                val buf = ByteArray(8192)
                while (isRunning) {
                    val len = sock.getInputStream().read(buf)
                    if (len <= 0) break
                    if (len > 0) {
                        val pkt = buildTcpPacket(0x18, buf, len) // PSH+ACK
                        writeToTun(pkt)
                        mySeq += len
                    }
                }
            } catch (_: Exception) {}
            close()
        }

        fun sendData(data: ByteArray, off: Int, len: Int) {
            try {
                socket?.getOutputStream()?.write(data, off, len)
                clientSeqNum += len
            } catch (_: Exception) {
                close()
            }
        }

        fun sendFin() {
            try { socket?.shutdownOutput() } catch (_: Exception) {}
            close()
        }

        fun close() {
            tcpTunnels.remove("${ipStr(srcIp)}:$srcPort->${ipStr(dstIp)}:$dstPort")
            try { socket?.close() } catch (_: Exception) {}
        }

        private fun buildTcpPacket(flags: Int, payload: ByteArray, payloadLen: Int): ByteArray {
            val tcpLen = 20 + payloadLen
            val totalLen = ipHdrLen + tcpLen
            val pkt = ByteArray(totalLen)

            // IP header
            pkt[0] = 0x45.toByte()
            pkt[2] = ((totalLen shr 8) and 0xFF).toByte()
            pkt[3] = (totalLen and 0xFF).toByte()
            pkt[8] = 64; pkt[9] = 6 // TTL, TCP
            System.arraycopy(dstIp, 0, pkt, 12, 4) // src = original dst
            System.arraycopy(srcIp, 0, pkt, 16, 4) // dst = original src

            // TCP header
            pkt[ipHdrLen] = ((dstPort shr 8) and 0xFF).toByte()
            pkt[ipHdrLen + 1] = (dstPort and 0xFF).toByte()
            pkt[ipHdrLen + 2] = ((srcPort shr 8) and 0xFF).toByte()
            pkt[ipHdrLen + 3] = (srcPort and 0xFF).toByte()
            // Seq
            putInt32(pkt, ipHdrLen + 4, mySeq)
            // Ack
            putInt32(pkt, ipHdrLen + 8, clientSeqNum + 1)
            // Data offset + flags
            pkt[ipHdrLen + 12] = 0x50.toByte()
            pkt[ipHdrLen + 13] = flags.toByte()
            // Window
            pkt[ipHdrLen + 14] = 0xFF.toByte()
            pkt[ipHdrLen + 15] = 0xFF.toByte()

            System.arraycopy(payload, 0, pkt, ipHdrLen + 20, payloadLen)
            return pkt
        }

        private fun putInt32(buf: ByteArray, off: Int, v: Int) {
            buf[off] = ((v shr 24) and 0xFF).toByte()
            buf[off + 1] = ((v shr 16) and 0xFF).toByte()
            buf[off + 2] = ((v shr 8) and 0xFF).toByte()
            buf[off + 3] = (v and 0xFF).toByte()
        }
    }

    // ── UDP ──────────────────────────────────────────────────

    private fun handleUdp(data: ByteArray, length: Int) {
        val ipHdrLen = (data[0].toInt() and 0x0F) * 4
        if (length < ipHdrLen + 8) return

        val srcIp = ByteArray(4); System.arraycopy(data, 12, srcIp, 0, 4)
        val dstIp = ByteArray(4); System.arraycopy(data, 16, dstIp, 0, 4)
        val srcPort = ((data[ipHdrLen].toInt() and 0xFF) shl 8) or (data[ipHdrLen + 1].toInt() and 0xFF)
        val dstPort = ((data[ipHdrLen + 2].toInt() and 0xFF) shl 8) or (data[ipHdrLen + 3].toInt() and 0xFF)
        val udpLen = ((data[ipHdrLen + 4].toInt() and 0xFF) shl 8) or (data[ipHdrLen + 5].toInt() and 0xFF)
        val payloadOff = ipHdrLen + 8
        val payloadLen = minOf(length - payloadOff, udpLen - 8)

        if (payloadLen <= 0) return

        executor.execute {
            try {
                DatagramSocket().use { socket ->
                    protect(socket)
                    socket.soTimeout = 10000
                    val payload = ByteArray(payloadLen)
                    System.arraycopy(data, payloadOff, payload, 0, payloadLen)
                    socket.send(DatagramPacket(payload, payloadLen, InetAddress.getByAddress(dstIp), dstPort))

                    val respBuf = ByteArray(4096)
                    val resp = DatagramPacket(respBuf, respBuf.size)
                    socket.receive(resp)

                    // Write UDP response back to TUN
                    val pkt = buildUdpPacket(dstIp, srcIp, dstPort, srcPort, resp.data, resp.length)
                    writeToTun(pkt)
                }
            } catch (_: Exception) {}
        }
    }

    private fun buildUdpPacket(
        srcIp: ByteArray, dstIp: ByteArray,
        srcPort: Int, dstPort: Int,
        payload: ByteArray, payloadLen: Int
    ): ByteArray {
        val udpLen = 8 + payloadLen
        val totalLen = 20 + udpLen
        val pkt = ByteArray(totalLen)

        pkt[0] = 0x45.toByte()
        pkt[2] = ((totalLen shr 8) and 0xFF).toByte(); pkt[3] = (totalLen and 0xFF).toByte()
        pkt[8] = 64; pkt[9] = 17 // TTL, UDP
        System.arraycopy(srcIp, 0, pkt, 12, 4)
        System.arraycopy(dstIp, 0, pkt, 16, 4)

        pkt[20] = ((srcPort shr 8) and 0xFF).toByte(); pkt[21] = (srcPort and 0xFF).toByte()
        pkt[22] = ((dstPort shr 8) and 0xFF).toByte(); pkt[23] = (dstPort and 0xFF).toByte()
        pkt[24] = ((udpLen shr 8) and 0xFF).toByte(); pkt[25] = (udpLen and 0xFF).toByte()

        System.arraycopy(payload, 0, pkt, 28, payloadLen)
        return pkt
    }

    // ── helpers ──────────────────────────────────────────────

    private fun writeToTun(pkt: ByteArray) {
        tunOutput?.let { synchronized(it) { it.write(pkt) } }
    }

    private fun ipStr(ip: ByteArray): String =
        "${ip[0].toUByte()}.${ip[1].toUByte()}.${ip[2].toUByte()}.${ip[3].toUByte()}"

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
        super.onDestroy()
    }

    override fun onRevoke() {
        stopVpn()
        super.onRevoke()
    }
}
