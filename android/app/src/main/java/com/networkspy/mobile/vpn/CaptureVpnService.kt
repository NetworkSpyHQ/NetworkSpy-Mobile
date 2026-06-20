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
        const val ACTION_START = "com.networkspy.mobile.vpn.START"
        const val ACTION_STOP = "com.networkspy.mobile.vpn.STOP"
        const val NOTIFICATION_ID = 1
        const val CHANNEL_ID = "vpn_capture"
        const val PROXY_PORT = 8888

        @Volatile var isRunning = false
        private var activeService: CaptureVpnService? = null

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
            activeService?.stopVpn()
        }
    }

    private var vpnInterface: ParcelFileDescriptor? = null
    private var proxyServer: HttpCaptureProxy? = null
    private val executor: ExecutorService = Executors.newCachedThreadPool()
    private val tcpConnections = ConcurrentHashMap<String, TcpTunnel>()

    override fun onCreate() {
        super.onCreate()
        activeService = this
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
        Log.d(TAG, "Starting VPN")

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
            Log.e(TAG, "VPN not prepared")
            VpnModule.emitError("VPN permission required")
            return
        } catch (e: Exception) {
            Log.e(TAG, "Error establishing VPN", e)
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

        isRunning = true
        VpnModule.emitStatus("started")

        executor.execute { packetLoop(vpnInterface!!) }
        Log.d(TAG, "VPN started with packet forwarder")
    }

    private fun stopVpn() {
        if (!isRunning) return
        Log.d(TAG, "Stopping VPN")
        isRunning = false

        // Close TUN first to unblock packet loop
        try { vpnInterface?.close() } catch (_: Exception) {}
        vpnInterface = null

        // Close all TCP tunnels
        tcpConnections.values.forEach { try { it.close() } catch (_: Exception) {} }
        tcpConnections.clear()

        // Stop proxy
        try { proxyServer?.stop() } catch (_: Exception) {}
        proxyServer = null

        // Shutdown thread pool
        executor.shutdownNow()

        VpnModule.emitStatus("stopped")
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun packetLoop(vpnFd: ParcelFileDescriptor) {
        val input = FileInputStream(vpnFd.fileDescriptor)
        val output = FileOutputStream(vpnFd.fileDescriptor)
        val buffer = ByteArray(32767)
        var count = 0L

        try {
            while (isRunning && !Thread.interrupted()) {
                val len = input.read(buffer)
                if (len <= 0) continue
                count++

                try {
                    handlePacket(buffer, len, output)
                } catch (e: Exception) {
                    Log.e(TAG, "Packet handle error: ${e.message}")
                }
            }
        } catch (e: Exception) {
            if (isRunning) Log.e(TAG, "Packet loop error: ${e.message}")
        } finally {
            Log.d(TAG, "Packet loop ended. $count packets processed")
        }
    }

    private fun handlePacket(data: ByteArray, length: Int, tunOut: FileOutputStream) {
        if (length < 20) return
        val version = (data[0].toInt() shr 4) and 0x0F
        if (version != 4) return

        val protocol = data[9].toInt() and 0xFF
        when (protocol) {
            6 -> handleTcp(data, length, tunOut)
            17 -> handleUdp(data, length)
        }
    }

    private fun handleTcp(data: ByteArray, length: Int, tunOut: FileOutputStream) {
        val ipHdrLen = (data[0].toInt() and 0x0F) * 4
        if (length < ipHdrLen + 20) return

        val srcIp = ByteArray(4); System.arraycopy(data, 12, srcIp, 0, 4)
        val dstIp = ByteArray(4); System.arraycopy(data, 16, dstIp, 0, 4)

        val srcPort = ((data[ipHdrLen].toInt() and 0xFF) shl 8) or (data[ipHdrLen + 1].toInt() and 0xFF)
        val dstPort = ((data[ipHdrLen + 2].toInt() and 0xFF) shl 8) or (data[ipHdrLen + 3].toInt() and 0xFF)

        val flags = data[ipHdrLen + 13].toInt() and 0xFF
        val isSyn = (flags and 0x02) != 0
        val isFin = (flags and 0x01) != 0
        val isRst = (flags and 0x04) != 0
        val seqNum = ByteBuffer.wrap(data, ipHdrLen + 4, 4).getInt()

        val key = "${ipStr(srcIp)}:$srcPort->${ipStr(dstIp)}:$dstPort"
        val tcpHdrLen = ((data[ipHdrLen + 12].toInt() shr 4) and 0x0F) * 4
        val payloadOff = ipHdrLen + tcpHdrLen
        val payloadLen = length - payloadOff

        if (dstPort == PROXY_PORT) return

        if (isSyn && !isRst) {
            startTcpTunnel(key, srcIp, srcPort, dstIp, dstPort, ipHdrLen, seqNum, tunOut)
        } else if (isRst) {
            tcpConnections.remove(key)?.close()
        } else if (isFin) {
            tcpConnections[key]?.let { tunnel ->
                tunnel.sendFin()
            }
        } else if (payloadLen > 0) {
            tcpConnections[key]?.let { tunnel ->
                val payload = ByteArray(payloadLen)
                System.arraycopy(data, payloadOff, payload, 0, payloadLen)
                tunnel.sendData(payload)
            }
        }
    }

    private fun startTcpTunnel(
        key: String,
        srcIp: ByteArray, srcPort: Int,
        dstIp: ByteArray, dstPort: Int,
        ipHdrLen: Int, clientSeq: Int,
        tunOut: FileOutputStream
    ) {
        val tunnel = TcpTunnel(key, srcIp, srcPort, dstIp, dstPort, ipHdrLen, clientSeq, tunOut)
        tcpConnections[key] = tunnel
        executor.execute { tunnel.run(this) }
    }

    private fun handleUdp(data: ByteArray, length: Int) {
        val ipHdrLen = (data[0].toInt() and 0x0F) * 4
        if (length < ipHdrLen + 8) return

        val dstIp = ByteArray(4); System.arraycopy(data, 16, dstIp, 0, 4)
        val dstPort = ((data[ipHdrLen + 2].toInt() and 0xFF) shl 8) or (data[ipHdrLen + 3].toInt() and 0xFF)
        val udpLen = ((data[ipHdrLen + 4].toInt() and 0xFF) shl 8) or (data[ipHdrLen + 5].toInt() and 0xFF)
        val payloadOff = ipHdrLen + 8
        val payloadLen = minOf(length - payloadOff, udpLen - 8)

        if (payloadLen <= 0) return

        executor.execute {
            try {
                val socket = DatagramSocket().also { protect(it) }
                val payload = ByteArray(payloadLen)
                System.arraycopy(data, payloadOff, payload, 0, payloadLen)
                socket.send(DatagramPacket(payload, payloadLen, InetAddress.getByAddress(dstIp), dstPort))

                // Try to get response
                socket.soTimeout = 5000
                val respBuf = ByteArray(4096)
                val resp = DatagramPacket(respBuf, respBuf.size)
                socket.receive(resp)
                socket.close()
            } catch (_: Exception) {}
        }
    }

    inner class TcpTunnel(
        private val key: String,
        private val srcIp: ByteArray,
        private val srcPort: Int,
        private val dstIp: ByteArray,
        private val dstPort: Int,
        private val ipHdrLen: Int,
        clientSeq: Int,
        private val tunOut: FileOutputStream
    ) {
        private var socket: Socket? = null
        private var mySeq = (Math.random() * Int.MAX_VALUE).toInt()
        private var clientSeqNum = clientSeq

        fun run(service: CaptureVpnService) {
            try {
                val sock = Socket()
                service.protect(sock)
                sock.connect(InetSocketAddress(InetAddress.getByAddress(dstIp), dstPort), 10000)

                socket = sock

                // Build SYN-ACK response
                val synAck = buildSynAck()
                synchronized(tunOut) { tunOut.write(synAck) }

                // Read from server, write to TUN
                executor.execute {
                    try {
                        val buf = ByteArray(8192)
                        while (isRunning && socket != null) {
                            val len = sock.getInputStream().read(buf)
                            if (len <= 0) break
                            val pkt = buildResponsePacket(buf, len)
                            synchronized(tunOut) { tunOut.write(pkt) }
                        }
                    } catch (_: Exception) {}
                    close()
                }
            } catch (e: Exception) {
                // Send RST
                val rst = buildRst()
                try { synchronized(tunOut) { tunOut.write(rst) } } catch (_: Exception) {}
                tcpConnections.remove(key)
            }
        }

        fun sendData(payload: ByteArray) {
            clientSeqNum += payload.size
            socket?.getOutputStream()?.write(payload)
        }

        fun sendFin() {
            try { socket?.shutdownOutput() } catch (_: Exception) {}
        }

        fun close() {
            tcpConnections.remove(key)
            try { socket?.close() } catch (_: Exception) {}
        }

        private fun buildSynAck(): ByteArray {
            val pkt = ByteArray(ipHdrLen + 20)
            // IP header
            pkt[0] = 0x45.toByte()
            val totalLen = pkt.size
            pkt[2] = ((totalLen shr 8) and 0xFF).toByte(); pkt[3] = (totalLen and 0xFF).toByte()
            pkt[8] = 64; pkt[9] = 6 // TTL=64, TCP
            System.arraycopy(dstIp, 0, pkt, 12, 4) // src = original dst
            System.arraycopy(srcIp, 0, pkt, 16, 4) // dst = original src
            // TCP header
            pkt[ipHdrLen] = ((dstPort shr 8) and 0xFF).toByte(); pkt[ipHdrLen + 1] = (dstPort and 0xFF).toByte()
            pkt[ipHdrLen + 2] = ((srcPort shr 8) and 0xFF).toByte(); pkt[ipHdrLen + 3] = (srcPort and 0xFF).toByte()
            val seqOff = ipHdrLen + 4
            pkt[seqOff] = ((mySeq shr 24) and 0xFF).toByte(); pkt[seqOff + 1] = ((mySeq shr 16) and 0xFF).toByte()
            pkt[seqOff + 2] = ((mySeq shr 8) and 0xFF).toByte(); pkt[seqOff + 3] = (mySeq and 0xFF).toByte()
            val ackNum = clientSeqNum + 1
            val ackOff = ipHdrLen + 8
            pkt[ackOff] = ((ackNum shr 24) and 0xFF).toByte(); pkt[ackOff + 1] = ((ackNum shr 16) and 0xFF).toByte()
            pkt[ackOff + 2] = ((ackNum shr 8) and 0xFF).toByte(); pkt[ackOff + 3] = (ackNum and 0xFF).toByte()
            pkt[ipHdrLen + 12] = 0x50.toByte() // data offset 5, no options
            pkt[ipHdrLen + 13] = 0x12.toByte() // SYN+ACK
            pkt[ipHdrLen + 14] = (0xFF).toByte(); pkt[ipHdrLen + 15] = (0xFF).toByte() // window
            return pkt
        }

        private fun buildResponsePacket(data: ByteArray, len: Int): ByteArray {
            val pkt = ByteArray(ipHdrLen + 20 + len)
            // IP header
            pkt[0] = 0x45.toByte()
            val totalLen = pkt.size
            pkt[2] = ((totalLen shr 8) and 0xFF).toByte(); pkt[3] = (totalLen and 0xFF).toByte()
            pkt[8] = 64; pkt[9] = 6
            System.arraycopy(dstIp, 0, pkt, 12, 4)
            System.arraycopy(srcIp, 0, pkt, 16, 4)
            // TCP header
            pkt[ipHdrLen] = ((dstPort shr 8) and 0xFF).toByte(); pkt[ipHdrLen + 1] = (dstPort and 0xFF).toByte()
            pkt[ipHdrLen + 2] = ((srcPort shr 8) and 0xFF).toByte(); pkt[ipHdrLen + 3] = (srcPort and 0xFF).toByte()
            val seqOff = ipHdrLen + 4
            pkt[seqOff] = ((mySeq shr 24) and 0xFF).toByte(); pkt[seqOff + 1] = ((mySeq shr 16) and 0xFF).toByte()
            pkt[seqOff + 2] = ((mySeq shr 8) and 0xFF).toByte(); pkt[seqOff + 3] = (mySeq and 0xFF).toByte()
            mySeq += len
            val ackNum = clientSeqNum
            val ackOff = ipHdrLen + 8
            pkt[ackOff] = ((ackNum shr 24) and 0xFF).toByte(); pkt[ackOff + 1] = ((ackNum shr 16) and 0xFF).toByte()
            pkt[ackOff + 2] = ((ackNum shr 8) and 0xFF).toByte(); pkt[ackOff + 3] = (ackNum and 0xFF).toByte()
            pkt[ipHdrLen + 12] = 0x50.toByte()
            pkt[ipHdrLen + 13] = 0x18.toByte() // PSH+ACK
            pkt[ipHdrLen + 14] = (0xFF).toByte(); pkt[ipHdrLen + 15] = (0xFF).toByte()
            System.arraycopy(data, 0, pkt, ipHdrLen + 20, len)
            return pkt
        }

        private fun buildRst(): ByteArray {
            val pkt = ByteArray(ipHdrLen + 20)
            pkt[0] = 0x45.toByte()
            val totalLen = pkt.size
            pkt[2] = ((totalLen shr 8) and 0xFF).toByte(); pkt[3] = (totalLen and 0xFF).toByte()
            pkt[8] = 64; pkt[9] = 6
            System.arraycopy(dstIp, 0, pkt, 12, 4)
            System.arraycopy(srcIp, 0, pkt, 16, 4)
            pkt[ipHdrLen] = ((dstPort shr 8) and 0xFF).toByte(); pkt[ipHdrLen + 1] = (dstPort and 0xFF).toByte()
            pkt[ipHdrLen + 2] = ((srcPort shr 8) and 0xFF).toByte(); pkt[ipHdrLen + 3] = (srcPort and 0xFF).toByte()
            pkt[ipHdrLen + 12] = 0x50.toByte()
            pkt[ipHdrLen + 13] = 0x04.toByte() // RST
            return pkt
        }
    }

    private fun ipStr(ip: ByteArray): String = "${ip[0].toUByte()}.${ip[1].toUByte()}.${ip[2].toUByte()}.${ip[3].toUByte()}"

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
    override fun onRevoke() { stopVpn(); super.onRevoke() }
}
