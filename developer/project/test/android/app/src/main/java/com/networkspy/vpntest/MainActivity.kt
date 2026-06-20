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
        val id: Int, val type: String, val method: String, val url: String,
        val host: String, val status: Int, val contentType: String,
        val headers: String, val bodyHex: String, val proxyData: String
    )

    private val captureEntries = mutableListOf<CaptureEntry>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        HttpsCertManager.ensureInitialized(this)

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

        val buttonRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        startButton = Button(this).apply {
            text = "Start VPN"
            setOnClickListener { prepareAndStartVpn() }
        }
        buttonRow.addView(startButton)
        stopButton = Button(this).apply {
            text = "Stop VPN"
            isEnabled = false
            setOnClickListener { stopVpn() }
        }
        buttonRow.addView(stopButton)
        root.addView(buttonRow)

        val certButton = Button(this).apply {
            text = "Install CA Cert"
            setOnClickListener { installCACert() }
        }
        root.addView(certButton)

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
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
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
            val entry = parseHttpJson(json)
            if (entry != null) {
                captureEntries.add(entry)
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
        var proxyData = ""

        val pairs = json.removeSurrounding("{", "}").split(",\"")
        for (pair in pairs) {
            val clean = pair.trim().removeSurrounding("\"")
            val colon = clean.indexOf(':')
            if (colon < 0) continue
            val key = clean.substring(0, colon).trim().removeSurrounding("\"")
            val value = clean.substring(colon + 1).trim().removeSurrounding("\"")

            when (key) {
                "id" -> id = value.toIntOrNull() ?: 0
                "type" -> type = value
                "hdr_hex" -> headersHex = value
                "body_hex" -> bodyHex = value
                "host" -> host = value
                "data" -> proxyData = value
            }
        }

        if (type == "request") {
            val headerText = hexToString(headersHex)
            val lines = headerText.split("\r\n")
            if (lines.isNotEmpty()) {
                val firstLine = lines[0].split(" ")
                if (firstLine.size >= 2) { method = firstLine[0]; url = firstLine[1] }
            }
            for (line in lines) {
                if (line.lowercase().startsWith("host:")) host = line.substring(5).trim()
            }
        }

        if (type == "response" && headersHex.isNotEmpty()) {
            val headerText = hexToString(headersHex)
            val lines = headerText.split("\r\n")
            if (lines.isNotEmpty() && lines[0].startsWith("HTTP/")) {
                val parts = lines[0].split(" ")
                if (parts.size >= 2) status = parts[1].toIntOrNull() ?: 0
            }
            for (line in lines) {
                if (line.lowercase().startsWith("content-type:"))
                    contentType = line.substring(13).trim()
            }
        }

        if (type.startsWith("proxy_")) {
            id = (captureEntries.size + 1) * 1000 + 1
            val ptype = type.removePrefix("proxy_")
            return CaptureEntry(id, ptype, "", "", host, 0, "",
                proxyData.replace("\\\\n", "\n").replace("\\\\r", "\r"), "", proxyData)
        }

        if (id == 0) return null
        return CaptureEntry(id, type, method, url, host, status, contentType,
            hexToString(headersHex), bodyHex, "")
    }

    private fun hexToString(hex: String): String {
        if (hex.isEmpty()) return ""
        return try {
            val bytes = ByteArray(hex.length / 2)
            for (i in bytes.indices) bytes[i] = hex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
            String(bytes)
        } catch (_: Exception) { hex }
    }

    private fun refreshCaptureLog() {
        val sb = StringBuilder()
        val fmt = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault())
        val now = fmt.format(java.util.Date())

        for (entry in captureEntries.reversed().take(50)) {
            val icon = when (entry.type) {
                "https" -> "\uD83D\uDD12"
                "request" -> "\u2191"
                else -> "\u2193"
            }
            val status = if (entry.status > 0) " ${entry.status}" else ""
            val line = when {
                entry.type == "https" -> "$icon https://${entry.host}"
                else -> "$icon$status ${entry.host}"
            }
            sb.append("[$now] $line\n")
            if (entry.proxyData.isNotEmpty())
                sb.append("${entry.proxyData.take(500)}\n")
            else if (entry.headers.isNotEmpty())
                sb.append("${entry.headers.split("\r\n").take(5).joinToString("\n")}\n")
        }

        if (sb.isEmpty()) sb.append("No traffic captured. Start VPN and browse.\n")
        captureLog.text = sb.toString()
    }

    private fun appendLog(msg: String) {
        runOnUiThread {
            val ts = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault()).format(java.util.Date())
            trafficLog.append("[$ts] $msg\n")
        }
    }

    private fun installCACert() {
        HttpsCertManager.ensureInitialized(this)
        val certFile = HttpsCertManager.exportCAPEM(this)
        if (certFile == null || !certFile.exists()) {
            Toast.makeText(this, "Failed to export CA certificate", Toast.LENGTH_LONG).show()
            return
        }
        appendLog("CA cert exported to ${certFile.absolutePath}")

        // Also open file with a share/send intent for easy access
        try {
            val uri = androidx.core.content.FileProvider.getUriForFile(
                this, "$packageName.fileprovider", certFile)
            val shareIntent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                type = "application/x-x509-ca-cert"
                putExtra(android.content.Intent.EXTRA_STREAM, uri)
                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(android.content.Intent.createChooser(shareIntent, "Install CA cert via..."))
        } catch (_: Exception) {
            // Fallback: just open security settings
            try {
                startActivity(android.content.Intent(android.provider.Settings.ACTION_SECURITY_SETTINGS))
                Toast.makeText(this,
                    "Cert: ${certFile.absolutePath}\n" +
                    "Settings → Encryption & credentials → Install certificate → CA certificate",
                    Toast.LENGTH_LONG).show()
            } catch (_: Exception) {}
        }
    }

    private fun prepareAndStartVpn() {
        val intent = VpnService.prepare(this)
        if (intent != null) startActivityForResult(intent, VPN_REQUEST_CODE)
        else startVpnService()
    }

    private fun startVpnService() {
        val intent = Intent(this, VpnTestService::class.java)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O)
            startForegroundService(intent)
        else startService(intent)
        updateUI(true)
    }

    private fun stopVpn() {
        VpnTestService.activeService?.stopVpn()
        stopService(Intent(this, VpnTestService::class.java))
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
        if (requestCode == VPN_REQUEST_CODE && resultCode == Activity.RESULT_OK)
            startVpnService()
        else if (requestCode == VPN_REQUEST_CODE)
            Toast.makeText(this, "VPN permission denied", Toast.LENGTH_SHORT).show()
    }

    override fun onDestroy() {
        VpnTestService.listener = null
        VpnTestService.captureListener = null
        super.onDestroy()
    }
}
