package com.localexpense.tracker.capture

import com.getcapacitor.JSObject

/**
 * One-way channel from the capture pipeline to the WebView plugin. The sink is
 * null whenever no plugin is loaded, which is normal when the app process is
 * running only to receive a notification; the DB write still happens.
 */
object CaptureEvents {

    const val RAW_EVENT_CAPTURED = "rawEventCaptured"
    const val LISTENER_HEALTH_CHANGED = "listenerHealthChanged"
    const val DATA_CHANGED = "dataChanged"
    const val TRANSACTION_ADDED = "transactionAdded"

    @Volatile
    var sink: ((String, JSObject) -> Unit)? = null

    fun emit(event: String, data: JSObject) {
        sink?.invoke(event, data)
    }
}
