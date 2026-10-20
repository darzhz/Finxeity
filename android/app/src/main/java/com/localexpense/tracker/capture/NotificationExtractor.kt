package com.localexpense.tracker.capture

import android.app.Notification
import android.os.Build
import android.os.Bundle
import android.service.notification.StatusBarNotification
import java.security.MessageDigest

/**
 * The verbatim content of one notification, before any interpretation.
 */
data class ExtractedNotification(
    val packageName: String,
    val notificationKey: String,
    val title: String?,
    val text: String?,
    val bigText: String?,
    val textLines: List<String>,
    val postedAt: Long,
) {
    /** Best available body text, most specific field first. */
    val body: String?
        get() = bigText?.takeIf { it.isNotBlank() }
            ?: text?.takeIf { it.isNotBlank() }
            ?: textLines.joinToString(" ").takeIf { it.isNotBlank() }

    val preview: String
        get() = listOfNotNull(title?.takeIf { it.isNotBlank() }, body)
            .joinToString(" · ")
}

/**
 * Turns platform notification objects into [ExtractedNotification]s and stable
 * content hashes. Deliberately free of Android service wiring so it is unit-testable.
 */
object NotificationExtractor {

    private const val HASH_VERSION = "v1"

    fun fromStatusBarNotification(sbn: StatusBarNotification): ExtractedNotification? {
        val packageName = sbn.packageName ?: return null
        val notification = sbn.notification ?: return null
        val extras = notification.extras ?: return null
        return fromExtras(
            packageName = packageName,
            notificationKey = sbn.key ?: "$packageName:${sbn.id}",
            postedAt = sbn.postTime,
            extras = extras,
        )
    }

    fun fromExtras(
        packageName: String,
        notificationKey: String,
        postedAt: Long,
        extras: Bundle,
    ): ExtractedNotification? {
        val title = extras.charSequence(Notification.EXTRA_TITLE)
            ?: extras.charSequence(Notification.EXTRA_CONVERSATION_TITLE)
        val text = extras.charSequence(Notification.EXTRA_TEXT)
        val bigText = extras.charSequence(Notification.EXTRA_BIG_TEXT)
        val lines = extras.charSequenceList(Notification.EXTRA_TEXT_LINES)
            .ifEmpty { messagingLines(extras) }

        val extracted = ExtractedNotification(
            packageName = packageName,
            notificationKey = notificationKey,
            title = title,
            text = text,
            bigText = bigText,
            textLines = lines,
            postedAt = postedAt,
        )
        return if (extracted.preview.isBlank()) null else extracted
    }

    fun contentHash(extracted: ExtractedNotification): String = contentHash(
        packageName = extracted.packageName,
        notificationKey = extracted.notificationKey,
        title = extracted.title,
        text = extracted.text,
        bigText = extracted.bigText,
        textLines = extracted.textLines,
    )

    /**
     * Stable across processes and app restarts. The key is included so that two
     * apps posting identical text are not collapsed into one event.
     */
    fun contentHash(
        packageName: String,
        notificationKey: String,
        title: String?,
        text: String?,
        bigText: String?,
        textLines: List<String>,
    ): String {
        val canonical = buildString {
            append(HASH_VERSION).append('\u0000')
            append(packageName).append('\u0000')
            append(notificationKey).append('\u0000')
            append(title.orEmpty().trim()).append('\u0000')
            append(text.orEmpty().trim()).append('\u0000')
            append(bigText.orEmpty().trim()).append('\u0000')
            append(textLines.joinToString("\u0001") { it.trim() })
        }
        return sha256(canonical)
    }

    fun sha256(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    private fun messagingLines(extras: Bundle): List<String> {
        val messages = extras.parcelableArray(Notification.EXTRA_MESSAGES) ?: return emptyList()
        return messages.mapNotNull { item ->
            val bundle = item as? Bundle ?: return@mapNotNull null
            val text = bundle.charSequence("text") ?: bundle.charSequence("android.text")
            text?.takeIf { it.isNotBlank() }
        }
    }

    private fun Bundle.charSequence(key: String): String? {
        val value = getCharSequence(key) ?: return null
        return value.toString().takeIf { it.isNotBlank() }
    }

    private fun Bundle.charSequenceList(key: String): List<String> {
        val value = getCharSequenceArray(key) ?: return emptyList()
        return value.mapNotNull { it?.toString()?.takeIf { line -> line.isNotBlank() } }
    }

    @Suppress("DEPRECATION")
    private fun Bundle.parcelableArray(key: String): Array<out android.os.Parcelable>? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getParcelableArray(key, android.os.Parcelable::class.java)
        } else {
            getParcelableArray(key)
        }
    }
}
