package com.networkspy.mobile.vpn

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

class HttpCaptureProxy(
    private val port: Int,
    private val context: Context
) {
    companion object {
        const val TAG = "HttpCaptureProxy"
    }

    private var serverSocket: ServerSocket? = null
    private val executor: ExecutorService = Executors.newCachedThreadPool()
    @Volatile private var running = false

    fun start() {
        if (running) return
        running = true
        executor.execute {
            try {
                serverSocket = ServerSocket(port, 50, java.net.InetAddress.getByName("127.0.0.1"))
                Log.d(TAG, "Proxy listening on 127.0.0.1:$port")

                while (running) {
                    try {
                        val client = serverSocket?.accept() ?: continue
                        executor.execute { handleClient(client) }
                    } catch (e: Exception) {
                        if (running) Log.e(TAG, "Accept error: ${e.message}")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Server socket error: ${e.message}")
            }
        }
    }

    fun stop() {
        running = false
        try {
            serverSocket?.close()
        } catch (_: Exception) {}
        executor.shutdownNow()
    }

    private fun handleClient(client: Socket) {
        try {
            client.use { sock ->
                sock.soTimeout = 30000
                val input = sock.getInputStream()
                val output = sock.getOutputStream()

                val requestLine = readLine(input) ?: return
                if (requestLine.isBlank()) return

                val parts = requestLine.split(" ", limit = 3)
                if (parts.size < 3) return

                val method = parts[0].uppercase()
                val target = parts[1]

                Log.d(TAG, "Proxy request: $method $target")

                if (method == "CONNECT") {
                    handleConnect(target, sock, input, output)
                } else {
                    handleHttp(method, target, input, output)
                }
            }
        } catch (e: Exception) {
            if (running) Log.e(TAG, "Client handler error: ${e.message}")
        }
    }

    private fun handleConnect(
        hostPort: String,
        client: Socket,
        clientInput: InputStream,
        clientOutput: OutputStream
    ) {
        val colonIdx = hostPort.lastIndexOf(':')
        val host = if (colonIdx > 0) hostPort.substring(0, colonIdx) else hostPort
        val port = if (colonIdx > 0) hostPort.substring(colonIdx + 1).toIntOrNull() ?: 443 else 443

        val id = UUID.randomUUID().toString()
        val timestamp = System.currentTimeMillis()

        try {
            val server = SSLSocketFactory.getDefault().createSocket(host, port) as SSLSocket
            server.startHandshake()

            clientOutput.write("HTTP/1.1 200 Connection Established\r\n\r\n".toByteArray())
            clientOutput.flush()

            pipeWithCopy(client, server, clientInput)

            emitEntry(
                id = id, method = "CONNECT", url = "https://$host:$port",
                host = host, path = "/", statusCode = 200,
                duration = System.currentTimeMillis() - timestamp,
                responseSize = 0, isSecure = true, error = null,
                timestamp = timestamp
            )
        } catch (e: Exception) {
            try {
                clientOutput.write("HTTP/1.1 502 Bad Gateway\r\n\r\n".toByteArray())
                clientOutput.flush()
            } catch (_: Exception) {}

            emitEntry(
                id = id, method = "CONNECT", url = "https://$host:$port",
                host = host, path = "/", statusCode = 0,
                duration = System.currentTimeMillis() - timestamp,
                responseSize = 0, isSecure = true, error = e.message,
                timestamp = timestamp
            )
        }
    }

    private fun handleHttp(
        method: String,
        target: String,
        input: InputStream,
        output: OutputStream
    ) {
        val id = UUID.randomUUID().toString()
        val timestamp = System.currentTimeMillis()
        val startNanos = System.nanoTime()

        val headers = LinkedHashMap<String, String>()
        var contentLength = 0
        var line = readLine(input) ?: ""
        while (line.isNotEmpty()) {
            val ci = line.indexOf(':')
            if (ci > 0) {
                val name = line.substring(0, ci).trim().lowercase()
                val value = line.substring(ci + 1).trim()
                headers[name] = value
                if (name == "content-length") {
                    contentLength = value.toIntOrNull() ?: 0
                }
            }
            line = readLine(input) ?: ""
        }

        val rawBody = if (contentLength > 0) {
            val bytes = ByteArray(contentLength)
            var read = 0
            while (read < contentLength) {
                val r = input.read(bytes, read, contentLength - read)
                if (r == -1) break
                read += r
            }
            String(bytes, 0, read)
        } else null

        val requestHeaders = mutableMapOf<String, String>()
        headers.forEach { (k, v) -> requestHeaders[k] = v }

        try {
            val url = URL(target)
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = method
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.instanceFollowRedirects = false

            for ((name, value) in headers) {
                if (name == "connection" || name == "proxy-connection" || name == "proxy-authorization") continue
                conn.setRequestProperty(name, value)
            }

            if (rawBody != null && method in listOf("POST", "PUT", "PATCH")) {
                conn.doOutput = true
                conn.outputStream.use { it.write(rawBody.toByteArray()) }
            }

            val status = conn.responseCode
            val responseBody = try {
                conn.inputStream.readBytes()
            } catch (e: Exception) {
                conn.errorStream?.readBytes()
            }

            val responseHeaders = mutableMapOf<String, String>()
            conn.headerFields.forEach { (key, values) ->
                if (key != null && values != null) {
                    for (v in values) responseHeaders[key] = v
                }
            }

            output.write("HTTP/1.1 $status ${conn.responseMessage}\r\n".toByteArray())
            conn.headerFields.forEach { (key, values) ->
                if (key != null && values != null) {
                    for (v in values) output.write("$key: $v\r\n".toByteArray())
                }
            }
            output.write("\r\n".toByteArray())
            if (responseBody != null) output.write(responseBody)
            output.flush()

            val duration = (System.nanoTime() - startNanos) / 1_000_000
            val responseSize = responseBody?.size?.toLong() ?: 0

            emitEntry(
                id = id, method = method, url = target,
                host = url.host, path = url.path.ifEmpty { "/" },
                statusCode = status, duration = duration,
                responseSize = responseSize,
                isSecure = target.startsWith("https"),
                error = null, timestamp = timestamp,
                requestHeaders = requestHeaders, requestBody = rawBody,
                responseHeaders = responseHeaders,
                responseBody = responseBody?.let { String(it) }
            )

            conn.disconnect()
        } catch (e: Exception) {
            val duration = (System.nanoTime() - startNanos) / 1_000_000
            try {
                output.write("HTTP/1.1 502 Bad Gateway\r\n\r\n".toByteArray())
                output.flush()
            } catch (_: Exception) {}

            val u = try { URL(target) } catch (_: Exception) { null }
            emitEntry(
                id = id, method = method, url = target,
                host = u?.host ?: target, path = u?.path?.ifEmpty { "/" } ?: "/",
                statusCode = 0, duration = duration, responseSize = 0,
                isSecure = target.startsWith("https"),
                error = e.message, timestamp = timestamp,
                requestHeaders = requestHeaders, requestBody = rawBody
            )
        }
    }

    private fun pipeWithCopy(client: Socket, server: Socket, clientInput: InputStream) {
        val c2s = executor.submit {
            try {
                clientInput.copyTo(server.getOutputStream(), 8192)
            } catch (_: Exception) {}
        }
        val s2c = executor.submit {
            try {
                server.getInputStream().copyTo(client.getOutputStream(), 8192)
            } catch (_: Exception) {}
        }
        try { c2s.get(30, java.util.concurrent.TimeUnit.SECONDS) } catch (_: Exception) {}
        try { s2c.get(30, java.util.concurrent.TimeUnit.SECONDS) } catch (_: Exception) {}
    }

    private fun emitEntry(
        id: String, method: String, url: String, host: String, path: String,
        statusCode: Int, duration: Long, responseSize: Long, isSecure: Boolean,
        error: String?, timestamp: Long,
        requestHeaders: Map<String, String>? = null,
        requestBody: String? = null,
        responseHeaders: Map<String, String>? = null,
        responseBody: String? = null
    ) {
        val payload = JSONObject().apply {
            put("id", id)
            put("method", method)
            put("url", url)
            put("host", host)
            put("path", path)
            put("statusCode", statusCode)
            put("duration", duration)
            put("requestHeaders", JSONObject(requestHeaders ?: emptyMap<String, String>()))
            put("responseHeaders", JSONObject(responseHeaders ?: emptyMap<String, String>()))
            put("requestBody", requestBody ?: JSONObject.NULL)
            put("responseBody", responseBody ?: JSONObject.NULL)
            put("timestamp", timestamp)
            put("isSecure", isSecure)
            put("contentType", responseHeaders?.get("content-type") ?: JSONObject.NULL)
            put("responseSize", responseSize)
            put("error", error ?: JSONObject.NULL)
        }
        VpnModule.emitTraffic(payload.toString())
    }

    private fun readLine(input: InputStream): String? {
        val sb = StringBuilder()
        var prev = -1
        while (true) {
            val b = input.read()
            if (b == -1) return if (sb.isEmpty()) null else sb.toString()
            if (b == '\n'.code) {
                if (prev == '\r'.code && sb.isNotEmpty()) sb.deleteCharAt(sb.length - 1)
                return sb.toString()
            }
            sb.append(b.toChar())
            prev = b
        }
    }
}
