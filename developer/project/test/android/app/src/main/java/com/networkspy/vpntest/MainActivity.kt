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

class MainActivity : Activity() {

    private val VPN_REQUEST_CODE = 42
    private lateinit var statusText: TextView
    private lateinit var logText: TextView
    private lateinit var startButton: Button
    private lateinit var stopButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 48, 32, 32)
        }

        statusText = TextView(this).apply {
            text = "VPN Status: Idle"
            textSize = 18f
            setPadding(0, 0, 0, 16)
        }
        layout.addView(statusText)

        startButton = Button(this).apply {
            text = "Start VPN"
            setOnClickListener { prepareAndStartVpn() }
        }
        layout.addView(startButton)

        stopButton = Button(this).apply {
            text = "Stop VPN"
            isEnabled = false
            setOnClickListener { stopVpn() }
        }
        layout.addView(stopButton)

        logText = TextView(this).apply {
            text = "Log output:\n"
            textSize = 12f
            setPadding(0, 24, 0, 0)
        }
        val scrollView = ScrollView(this).apply {
            addView(logText)
        }
        layout.addView(scrollView)

        setContentView(layout)
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
        appendLog("VPN starting...")
    }

    private fun stopVpn() {
        val intent = Intent(this, VpnTestService::class.java)
        stopService(intent)
        updateUI(false)
        appendLog("VPN stopped")
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

    private fun appendLog(msg: String) {
        runOnUiThread {
            val timestamp = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault())
                .format(java.util.Date())
            logText.append("[$timestamp] $msg\n")
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
}
