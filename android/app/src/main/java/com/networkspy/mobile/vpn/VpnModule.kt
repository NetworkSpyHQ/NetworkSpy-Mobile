package com.networkspy.mobile.vpn

import android.app.Activity
import android.content.Intent
import android.net.VpnService
import android.util.Log
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

class VpnModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "VpnModule"
        private const val VPN_REQUEST_CODE = 42
        private var instance: VpnModule? = null
        private var pendingPromise: Promise? = null

        private const val DEBUG = true

        private fun log(msg: String) {
            if (DEBUG) Log.d("VpnModule", msg)
        }

        fun emitStatus(status: String) {
            val map = Arguments.createMap().apply { putString("status", status) }
            instance?.sendEvent("VpnStatus", map)
        }

        fun emitTraffic(payload: String) {
            val map = Arguments.createMap().apply { putString("payload", payload) }
            instance?.sendEvent("TrafficCapture", map)
        }

        fun emitError(message: String) {
            val map = Arguments.createMap().apply { putString("message", message) }
            instance?.sendEvent("VpnError", map)
        }
    }

    private val activityEventListener: ActivityEventListener = object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
            if (requestCode == VPN_REQUEST_CODE) {
                val p = pendingPromise
                pendingPromise = null
                if (resultCode == Activity.RESULT_OK) {
                    p?.resolve(true)
                } else {
                    p?.resolve(false)
                }
            }
        }
    }

    init {
        instance = this
        reactContext.addActivityEventListener(activityEventListener)
    }

    override fun getName(): String = NAME

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    @ReactMethod
    fun prepareVpn(promise: Promise) {
        val intent = VpnService.prepare(reactApplicationContext)
        if (intent != null) {
            pendingPromise = promise
            try {
                reactApplicationContext.currentActivity?.startActivityForResult(intent, VPN_REQUEST_CODE)
            } catch (e: Exception) {
                pendingPromise = null
                promise.reject("VPN_PREPARE_ERROR", "Failed to start VPN permission activity: ${e.message}")
            }
        } else {
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun startVpn() {
        log("startVpn called from JS")
        CaptureVpnService.start(reactApplicationContext)
    }

    @ReactMethod
    fun stopVpn() {
        log("stopVpn called from JS")
        CaptureVpnService.stop(reactApplicationContext)
    }

    @ReactMethod
    fun isVpnRunning(promise: Promise) {
        promise.resolve(CaptureVpnService.isRunning)
    }

    @ReactMethod
    fun addListener(eventName: String) {
    }

    @ReactMethod
    fun removeListeners(count: Int) {
    }
}
