package com.localexpense.tracker.sms

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.Telephony
import androidx.core.content.ContextCompat
import com.localexpense.tracker.BuildConfig
import com.localexpense.tracker.capture.ExtractedNotification
import com.localexpense.tracker.data.Repo
import com.localexpense.tracker.data.entity.RawEventSource

/**
 * One-time SMS backfill, sideload flavor only. It ingests raw messages into the
 * same raw_events store as notifications; parsing is deferred.
 */
object SmsImporter {

    const val SMS_PACKAGE = "sms"

    fun isSupported(): Boolean = BuildConfig.SMS_IMPORT_ENABLED

    fun hasPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) ==
            PackageManager.PERMISSION_GRANTED

    /**
     * Reads the inbox since [sinceMillis] and stores any new messages.
     * @return number of newly stored raw events.
     */
    suspend fun importRecent(context: Context, repo: Repo, sinceMillis: Long, limit: Int = 500): Int {
        if (!isSupported() || !hasPermission(context)) return 0
        val projection = arrayOf(
            Telephony.Sms.ADDRESS,
            Telephony.Sms.BODY,
            Telephony.Sms.DATE,
        )
        var imported = 0
        val cursor = context.contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI,
            projection,
            "${Telephony.Sms.DATE} >= ?",
            arrayOf(sinceMillis.toString()),
            "${Telephony.Sms.DATE} DESC",
        ) ?: return 0

        cursor.use {
            val addressIndex = it.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
            val bodyIndex = it.getColumnIndexOrThrow(Telephony.Sms.BODY)
            val dateIndex = it.getColumnIndexOrThrow(Telephony.Sms.DATE)
            var processed = 0
            while (it.moveToNext() && processed < limit) {
                processed++
                val address = it.getString(addressIndex) ?: continue
                val body = it.getString(bodyIndex) ?: continue
                val date = it.getLong(dateIndex)
                val extracted = ExtractedNotification(
                    packageName = SMS_PACKAGE,
                    notificationKey = "sms:$address:$date",
                    title = address,
                    text = body,
                    bigText = null,
                    textLines = emptyList(),
                    postedAt = date,
                )
                val stored = repo.recordRawEvent(extracted, RawEventSource.SMS)
                if (stored != null) {
                    imported++
                    runCatching { repo.ingest(stored) }
                }
            }
        }
        return imported
    }
}
