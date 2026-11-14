package com.localexpense.tracker.capture

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.getcapacitor.JSObject
import com.localexpense.tracker.data.IngestionOutcome
import com.localexpense.tracker.data.TrackerGraph
import com.localexpense.tracker.data.entity.RawEventSource
import com.localexpense.tracker.plugin.toJSObject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * Reads notifications from allowlisted packages only, persists them verbatim and
 * nothing else. All interpretation happens later, off this path.
 */
class ExpenseNotificationListener : NotificationListenerService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile
    private var allowlist: Set<String> = emptySet()

    override fun onCreate() {
        super.onCreate()
        TrackerGraph.init(this)
        scope.launch {
            TrackerGraph.repo.monitoredPackagesFlow.collect { packages ->
                allowlist = packages
                // Newly allowlisted apps may already have notifications sitting
                // in the shade, so sweep the active ones every time the list changes.
                processActiveNotifications()
            }
        }
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        publishState(STATE_CONNECTED)
        scope.launch {
            allowlist = TrackerGraph.settings.monitoredPackages.first()
            processActiveNotifications()
        }
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        publishState(STATE_DISCONNECTED)
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        processSbn(sbn)
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun processSbn(sbn: StatusBarNotification?) {
        val notification = sbn ?: return
        val packageName = notification.packageName ?: return
        if (packageName == this.packageName) return
        scope.launch {
            if (packageName !in allowlist) {
                allowlist = TrackerGraph.settings.monitoredPackages.first()
            }
            if (packageName !in allowlist) return@launch

            val extracted = NotificationExtractor.fromStatusBarNotification(notification) ?: return@launch
            val saved = TrackerGraph.repo.recordRawEvent(extracted, RawEventSource.NOTIFICATION)
                ?: return@launch
            CaptureEvents.emit(
                CaptureEvents.RAW_EVENT_CAPTURED,
                JSObject().apply { put("event", saved.toJSObject()) },
            )
            val outcome = runCatching { TrackerGraph.repo.ingest(saved) }.getOrNull()
            if (outcome is IngestionOutcome.Created) {
                CaptureEvents.emit(
                    CaptureEvents.TRANSACTION_ADDED,
                    JSObject().apply { put("transaction", outcome.transaction.toJSObject()) },
                )
            }
            CaptureEvents.emit(
                CaptureEvents.DATA_CHANGED,
                JSObject().apply { put("scope", "raw_events") },
            )
        }
    }

    private fun processActiveNotifications() {
        val active = try {
            activeNotifications?.toList() ?: emptyList()
        } catch (e: Exception) {
            emptyList()
        }
        active.forEach { processSbn(it) }
    }

    private fun publishState(state: String) {
        CaptureEvents.emit(
            CaptureEvents.LISTENER_HEALTH_CHANGED,
            JSObject().apply { put("state", state) },
        )
        scope.launch {
            TrackerGraph.settings.setListenerState(state)
        }
    }

    companion object {
        const val STATE_CONNECTED = "CONNECTED"
        const val STATE_DISCONNECTED = "DISCONNECTED"
    }
}
