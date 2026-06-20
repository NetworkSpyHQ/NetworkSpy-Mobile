package com.networkspy.vpntest

import android.app.Activity
import android.content.Intent
import android.net.VpnService
import android.os.Bundle
import android.widget.Button
import android.widget.ScrollView
import android.widget.TextView
import android.widget.LinearLayout
import android.widget.Toast
import android.widget.FrameLayout
import android.view.Gravity
import android.graphics.Color
import android.graphics.Typeface

class MainActivity : Activity() {

    private val VPN_REQUEST_CODE = 42
    private lateinit var statusText: TextView
    private lateinit var hashText: TextView
    private lateinit var trafficLog: TextView
    private lateinit var captureLog: TextView
    private lateinit var trafficScroll: ScrollView
    private lateinit var captureScroll: ScrollView
    private lateinit var trafficTab: TextView
    private lateinit var captureTab: TextView
    private lateinit var tabContainer: LinearLayout
    private lateinit var startButton: Button
    private lateinit var stopButton: Button

    data class CaptureEntry(
        val id: Int,
        val type: String,
        val method: String,
        val url: String,
        val host: String,
        val status: Int,
        val contentType: String,
        val headers: String,
        val bodyHex: String
    )

    private val captureEntries = mutableListOf<CaptureEntry>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        VpnTestService.listener = { msg -> appendLog(msg) }
        VpnTestService.captureListener = { json -> handleCapture(json) }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16, 48, 16, 16)
        }

        statusText = TextView(this).apply {
            text = "VPN Status: Idle"
            textSize = 16f
            setPadding(0, 0, 0, 2)
        }
        root.addView(statusText)

        hashText = TextView(this).apply {
            text = BuildConfig.GIT_HASH
            textSize = 10f
            setPadding(0, 0, 0, 8)
        }
        root.addView(hashText)

        val buttonRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        val startButton = Button(this).apply {
            text = "Start VPN"
            setOnClickListener { prepareAndStartVpn() }
        }
        this.startButton = startButton
        buttonRow.addView(startButton)
        val stopButton = Button(this).apply {
            text = "Stop VPN"
            isEnabled = false
            setOnClickListener { stopVpn() }
        }
        this.stopButton = stopButton
        buttonRow.addView(stopButton)
        root.addView(buttonRow)

        tabContainer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 12, 0, 4)
        }

        trafficTab = createTab("Traffic", true) { showTraffic() }
        captureTab = createTab("Capture", false) { showCapture() }
        tabContainer.addView(trafficTab)
        tabContainer.addView(captureTab)
        root.addView(tabContainer)

        trafficLog = TextView(this).apply {
            text = "Log output:\n"
            textSize = 11f
            setPadding(4, 4, 4, 4)
        }
        trafficScroll = ScrollView(this).apply { addView(trafficLog) }

        captureLog = TextView(this).apply {
            text = ""
            textSize = 11f
            setPadding(4, 4, 4, 4)
        }
        captureScroll = ScrollView(this).apply {
            addView(captureLog)
            visibility = android.view.View.GONE
        }

        val contentFrame = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f
            )
        }
        contentFrame.addView(trafficScroll)
        contentFrame.addView(captureScroll)
        root.addView(contentFrame)

        setContentView(root)
    }

    private fun createTab(label: String, active: Boolean, onClick: () -> Unit): TextView {
        return TextView(this).apply {
            text = "  $label  "
            textSize = 13f
            setPadding(12, 6, 12, 6)
            setOnClickListener { onClick() }
            updateTabStyle(this, active)
        }
    }

    private fun updateTabStyle(tab: TextView, active: Boolean) {
        if (active) {
            tab.setBackgroundColor(Color.parseColor("#2196F3"))
            tab.setTextColor(Color.WHITE)
            tab.setTypeface(null, Typeface.BOLD)
        } else {
            tab.setBackgroundColor(Color.parseColor("#E0E0E0"))
            tab.setTextColor(Color.BLACK)
            tab.setTypeface(null, Typeface.NORMAL)
        }
    }

    private fun showTraffic() {
        updateTabStyle(trafficTab, true)
        updateTabStyle(captureTab, false)
        trafficScroll.visibility = android.view.View.VISIBLE
        captureScroll.visibility = android.view.View.GONE
    }

    private fun showCapture() {
        updateTabStyle(trafficTab, false)
        updateTabStyle(captureTab, true)
        trafficScroll.visibility = android.view.View.GONE
        captureScroll.visibility = android.view.View.VISIBLE
        refreshCaptureLog()
    }

    private fun handleCapture(json: String) {
        try {
            val entries = parseHttpJson(json)
            if (entries != null) {
                captureEntries.add(entries)
                runOnUiThread { refreshCaptureLog() }
            }
        } catch (_: Exception) {}
    }

    private fun parseHttpJson(json: String): CaptureEntry? {
        var id = 0
        var type = ""
        var method = ""
        var url = ""
        var host = ""
        var status = 0
        var contentType = ""
        var headersHex = ""
        var bodyHex = ""

        val pairs = json.removeSurrounding("{", "}").replace("\\\\\"", "'").split("\",") .joinToString("\n").split(",\"") .joinToString("\n").split(",")
        val tokens = json.removeSurrounding("{", "}").split(",\"")
        for (token in tokens) {
            val clean = token.trim().removeSurrounding("\"")
            val colon = clean.indexOf(':')
            if (colon < 0) continue
            val key = clean.substring(0, colon).trim().removeSurrounding("\"")
            val value = clean.substring(colon + 1).trim().removeSurrounding("\"")

            when (key) {
                "id" -> id = value.toIntOrNull() ?: 0
                "type" -> type = value
                "hdr_hex" -> headersHex = value
                "body_hex" -> bodyHex = value
            }

            if (type == "request") {
                val headerText = hexToString(headersHex)
                val lines = headerText.split("\r\n")
                if (lines.isNotEmpty()) {
                    val firstLine = lines[0].split(" ")
                    if (firstLine.size >= 2) {
                        method = firstLine[0]
                        url = firstLine[1]
                    }
                }
                for (line in lines) {
                    if (line.lowercase().startsWith("host:")) {
                        host = line.substring(5).trim()
                    }
                }
            }

            if (type == "response") {
                val headerText = hexToString(headersHex)
                val lines = headerText.split("\r\n")
                if (lines.isNotEmpty()) {
                    val firstLine = lines[0].split(" ")
                    if (firstLine.size >= 2) {
                        status = firstLine[1].toIntOrNull() ?: 0
                    }
                }
                for (line in lines) {
                    if (line.lowercase().startsWith("content-type:")) {
                        contentType = line.substring(13).trim()
                    }
                }
            }
        }

        if (id == 0) return null

        val existing = captureEntries.find { it.id == id }
        if (existing != null) {
            val idx = captureEntries.indexOf(existing)
            val merged = existing.copy(
                type = if (type == "response" || type == "request") type else existing.type,
                method = if (method.isNotEmpty()) method else existing.method,
                url = if (url.isNotEmpty()) url else existing.url,
                host = if (host.isNotEmpty()) host else existing.host,
                status = if (status > 0) status else existing.status,
                contentType = if (contentType.isNotEmpty()) contentType else existing.contentType,
                headers = if (headersHex.isNotEmpty()) hexToString(headersHex) else existing.headers,
                bodyHex = if (bodyHex.isNotEmpty()) bodyHex else existing.bodyHex
            )
            captureEntries[idx] = merged
            return merged
        }

        return CaptureEntry(id, type, method, url, host, status, contentType,
            hexToString(headersHex), bodyHex)
    }

    private fun hexToString(hex: String): String {
        if (hex.isEmpty()) return ""
        return try {
            val bytes = ByteArray(hex.length / 2)
            for (i in bytes.indices) {
                bytes[i] = hex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
            }
            String(bytes)
        } catch (_: Exception) { hex }
    }

    private fun refreshCaptureLog() {
        val sb = StringBuilder()
        val formatter = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault())

        for (entry in captureEntries.reversed()) {
            val ts = formatter.format(java.util.Date())
            val icon = when (entry.type) {
                "https" -> "\uD83D\uDD12"
                "request" -> "\u2191"
                else -> "\u2193"
            }
            val status = if (entry.status > 0) " ${entry.status}" else ""

            val line = when {
                entry.type == "https" -> "$icon https://${entry.host}"
                entry.type == "request" -> "$icon ${entry.method}$status ${entry.host}${entry.url}"
                else -> "$icon$status ${entry.contentType}"
            }
            sb.append("[$ts] $line\n")

            if (entry.headers.isNotEmpty() && entry.headers.length > 4) {
                val preview = entry.headers.split("\r\n").take(6).joinToString("\n")
                sb.append("$preview\n")
            }
        }

        if (sb.isEmpty()) {
            sb.append("No HTTP traffic captured yet.\n")
            sb.append("Visit a website in your browser after starting VPN.\n")
        }

        captureLog.text = sb.toString()
    }

    private fun appendLog(msg: String) {
        runOnUiThread {
            val timestamp = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault())
                .format(java.util.Date())
            trafficLog.append("[$timestamp] $msg\n")
        }
    }

    private fun prepareAndStartVpn() {
        val intent = VpnService.prepare(this)
        if (intent != null) {
            startActivityForResult(intent, VPN_REQUEST_CODE)
        } else {
            startVpnService()
        }
    }

    private fun startVpnService() {
        val intent = Intent(this, VpnTestService::class.java)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
        updateUI(true)
    }

    private fun stopVpn() {
        VpnTestService.activeService?.stopVpn()
        val intent = Intent(this, VpnTestService::class.java)
        stopService(intent)
        updateUI(false)
    }

    private fun updateUI(running: Boolean) {
        if (running) {
            statusText.text = "VPN Status: Running"
            startButton.isEnabled = false
            stopButton.isEnabled = true
        } else {
            statusText.text = "VPN Status: Idle"
            startButton.isEnabled = true
            stopButton.isEnabled = false
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == VPN_REQUEST_CODE) {
            if (resultCode == Activity.RESULT_OK) {
                startVpnService()
            } else {
                Toast.makeText(this, "VPN permission denied", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onDestroy() {
        VpnTestService.listener = null
        VpnTestService.captureListener = null
        super.onDestroy()
    }
}
