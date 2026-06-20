package com.networkspy.vpntest

import android.util.Log
import java.io.InputStream
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

class HttpsProxy(private val port: Int) {
    private val TAG = "HttpsProxy"
    private var serverSocket: ServerSocket? = null
    private val executor: ExecutorService = Executors.newCachedThreadPool()
    @Volatile var running = false
    @Volatile var captureEnabled = true

    var onCapture: ((String) -> Unit)? = null

    fun start() {
        running = true
        executor.execute { acceptLoop() }
    }

    fun stop() {
        running = false
        try { serverSocket?.close() } catch (_: Exception) {}
        executor.shutdownNow()
    }

    private fun acceptLoop() {
        try {
            serverSocket = ServerSocket(port, 50)
            Log.i(TAG, "Proxy listening on port $port")
            while (running) {
                try {
                    val client = serverSocket!!.accept()
                    executor.execute { handleConnection(client) }
                } catch (_: Exception) {
                    if (!running) break
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Proxy accept failed: ${e.message}")
        }
    }

    private fun handleConnection(clientSocket: Socket) {
        try {
            clientSocket.soTimeout = 30000

            val clientIn = clientSocket.getInputStream()
            val clientOut = clientSocket.getOutputStream()

            // Read hostname header: first line = "HOST:hostname:port\n"
            val hostHeader = readLine(clientIn) ?: run { clientSocket.close(); return }
            if (!hostHeader.startsWith("HOST:")) {
                clientSocket.close()
                return
            }
            val parts = hostHeader.removePrefix("HOST:").split(":")
            if (parts.size < 2) { clientSocket.close(); return }
            val hostname = parts[0]
            val destPort = parts.getOrElse(1) { "443" }.toIntOrNull() ?: 443

            Log.i(TAG, "Proxy connection to $hostname:$destPort")

            val serverSocket: Socket
            val serverIn: InputStream
            val serverOut: OutputStream

            if (destPort == 443) {
                // HTTPS: do TLS interception
                val sslCtx = HttpsCertManager.createSSLContext(hostname)
                if (sslCtx == null) {
                    Log.e(TAG, "Failed to create SSL context for $hostname")
                    clientSocket.close()
                    return
                }

                // TLS with client (as server)
                val clientSsl = sslCtx.socketFactory.createSocket(
                    clientSocket, hostname, clientSocket.port, true
                ) as SSLSocket
                clientSsl.useClientMode = false
                clientSsl.startHandshake()

                // Connect to real server
                val factory = SSLSocketFactory.getDefault() as SSLSocketFactory
                serverSocket = factory.createSocket(hostname, destPort) as SSLSocket
                serverSocket.soTimeout = 30000
                (serverSocket as SSLSocket).startHandshake()
                serverIn = serverSocket.getInputStream()
                serverOut = serverSocket.getOutputStream()

                // Read HTTP request from client
                val reqData = readHttpData(clientSsl.inputStream)
                if (reqData != null) {
                    val reqStr = String(reqData)
                    emitCapture("request", hostname, reqStr.take(2048))
                    serverOut.write(reqData)
                    serverOut.flush()
                }

                // Read HTTP response from server
                val respData = readHttpData(serverIn)
                if (respData != null) {
                    val respStr = String(respData)
                    emitCapture("response", hostname, respStr.take(2048))
                    clientSsl.outputStream.write(respData)
                    clientSsl.outputStream.flush()
                }

                clientSsl.close()
                serverSocket.close()
            } else {
                // HTTP: forward directly (already handled through proxy forwarding)
                serverSocket = Socket(hostname, destPort)
                serverSocket.soTimeout = 30000
                serverIn = serverSocket.getInputStream()
                serverOut = serverSocket.getOutputStream()

                // Forward data bidirectionally
                val thread1 = threadCopy("req", clientIn, serverOut)
                val thread2 = threadCopy("resp", serverIn, clientOut, hostname)
                thread1.join(30000)
                thread2.join(30000)
                serverSocket.close()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Proxy error: ${e.message}")
        } finally {
            try { clientSocket.close() } catch (_: Exception) {}
        }
    }

    private fun readLine(input: InputStream): String? {
        val sb = StringBuilder()
        var c: Int
        while (input.read().also { c = it } != -1) {
            if (c == '\n'.code) break
            if (c != '\r'.code) sb.append(c.toChar())
        }
        return if (sb.isEmpty()) null else sb.toString()
    }

    private fun readHttpData(input: InputStream): ByteArray? {
        val buffer = ByteArray(32768)
        var totalRead = 0
        var done = false
        try {
            while (!done && totalRead < buffer.size) {
                val n = input.read(buffer, totalRead, minOf(4096, buffer.size - totalRead))
                if (n < 0) break
                totalRead += n
                // Check for end of HTTP headers
                val headers = String(buffer, 0, totalRead)
                val headerEnd = headers.indexOf("\r\n\r\n")
                if (headerEnd >= 0) {
                    val contentLength = extractContentLength(headers)
                    if (contentLength >= 0) {
                        val bodyStart = headerEnd + 4
                        if (totalRead >= bodyStart + contentLength) done = true
                    } else {
                        // No Content-Length, just read what's available
                        break
                    }
                }
            }
        } catch (_: Exception) {}
        return if (totalRead > 0) buffer.copyOf(totalRead) else null
    }

    private fun extractContentLength(headers: String): Int {
        for (line in headers.split("\r\n")) {
            if (line.lowercase().startsWith("content-length:")) {
                return line.substring(15).trim().toIntOrNull() ?: -1
            }
        }
        return -1
    }

    private fun threadCopy(tag: String, input: InputStream, output: OutputStream, hostname: String? = null): Thread {
        val thread = Thread {
            try {
                val buf = ByteArray(8192)
                var total = 0
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    output.write(buf, 0, n)
                    output.flush()
                    total += n
                    if (hostname != null && total > 0 && total < 32768) {
                        val data = buf.copyOf(n)
                        if (tag == "resp") {
                            emitCapture("response", hostname, String(data).take(2048))
                        }
                    }
                }
            } catch (_: Exception) {}
        }
        thread.isDaemon = true
        thread.start()
        return thread
    }

    private fun emitCapture(type: String, host: String, data: String) {
        if (!captureEnabled) return
        val safe = data.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r")
        val json = "{\"type\":\"proxy_$type\",\"host\":\"$host\",\"data\":\"${safe.take(2048)}\"}"
        onCapture?.invoke(json)
    }
}
