package com.localexpense.tracker.capture

import android.app.Notification
import android.os.Bundle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class NotificationExtractorTest {

    private fun extras(
        title: String? = null,
        text: String? = null,
        bigText: String? = null,
        lines: Array<CharSequence>? = null,
    ) = Bundle().apply {
        title?.let { putCharSequence(Notification.EXTRA_TITLE, it) }
        text?.let { putCharSequence(Notification.EXTRA_TEXT, it) }
        bigText?.let { putCharSequence(Notification.EXTRA_BIG_TEXT, it) }
        lines?.let { putCharSequenceArray(Notification.EXTRA_TEXT_LINES, it) }
    }

    @Test
    fun `extracts title and text`() {
        val extracted = NotificationExtractor.fromExtras(
            packageName = "com.hdfc.bank",
            notificationKey = "key-1",
            postedAt = 1_000,
            extras = extras(title = "HDFC Bank", text = "Rs.500 debited"),
        )
        assertEquals("HDFC Bank", extracted?.title)
        assertEquals("Rs.500 debited", extracted?.text)
        assertEquals("HDFC Bank · Rs.500 debited", extracted?.preview)
    }

    @Test
    fun `prefers big text for the body`() {
        val extracted = NotificationExtractor.fromExtras(
            packageName = "com.phonepe.app",
            notificationKey = "key-2",
            postedAt = 2_000,
            extras = extras(title = "PhonePe", text = "short", bigText = "Paid ₹450 to Swiggy"),
        )
        assertEquals("Paid ₹450 to Swiggy", extracted?.body)
    }

    @Test
    fun `falls back to text lines`() {
        val extracted = NotificationExtractor.fromExtras(
            packageName = "com.phonepe.app",
            notificationKey = "key-3",
            postedAt = 3_000,
            extras = extras(title = "Title", lines = arrayOf("line one", "line two")),
        )
        assertEquals("line one line two", extracted?.body)
    }

    @Test
    fun `returns null when there is nothing readable`() {
        val extracted = NotificationExtractor.fromExtras(
            packageName = "com.phonepe.app",
            notificationKey = "key-4",
            postedAt = 4_000,
            extras = Bundle(),
        )
        assertNull(extracted)
    }

    @Test
    fun `hash is stable for identical content`() {
        val first = NotificationExtractor.contentHash(
            packageName = "com.phonepe.app",
            notificationKey = "key",
            title = "PhonePe",
            text = "Paid ₹450",
            bigText = null,
            textLines = emptyList(),
        )
        val second = NotificationExtractor.contentHash(
            packageName = "com.phonepe.app",
            notificationKey = "key",
            title = "PhonePe",
            text = "Paid ₹450",
            bigText = null,
            textLines = emptyList(),
        )
        assertEquals(first, second)
    }

    @Test
    fun `hash changes when content changes`() {
        val first = NotificationExtractor.contentHash("pkg", "key", "t", "one", null, emptyList())
        val second = NotificationExtractor.contentHash("pkg", "key", "t", "two", null, emptyList())
        assertNotEquals(first, second)
    }

    @Test
    fun `hash changes when the key changes`() {
        val first = NotificationExtractor.contentHash("pkg", "key-1", "t", "one", null, emptyList())
        val second = NotificationExtractor.contentHash("pkg", "key-2", "t", "one", null, emptyList())
        assertNotEquals(first, second)
    }

    @Test
    fun `sha256 is lowercase hex`() {
        val hash = NotificationExtractor.sha256("hello")
        assertEquals(64, hash.length)
        assertTrue(hash.all { it in "0123456789abcdef" })
    }
}
