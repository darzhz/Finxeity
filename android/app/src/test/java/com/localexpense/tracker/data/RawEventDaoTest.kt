package com.localexpense.tracker.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.localexpense.tracker.data.dao.RawEventDao
import com.localexpense.tracker.data.entity.RawEventEntity
import com.localexpense.tracker.data.entity.RawEventSource
import com.localexpense.tracker.data.entity.RawEventStatus
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class RawEventDaoTest {

    private lateinit var database: AppDatabase
    private lateinit var dao: RawEventDao

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room
            .inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = database.rawEventDao()
    }

    @After
    fun tearDown() {
        database.close()
    }

    private fun event(
        id: String,
        key: String,
        hash: String,
        postedAt: Long,
        status: RawEventStatus = RawEventStatus.CAPTURED,
    ) = RawEventEntity(
        id = id,
        source = RawEventSource.NOTIFICATION,
        packageName = "com.phonepe.app",
        sender = null,
        notificationKey = key,
        title = "PhonePe",
        text = "Paid ₹450",
        bigText = null,
        textLines = null,
        postedAt = postedAt,
        contentHash = hash,
        status = status,
        createdAt = postedAt,
    )

    @Test
    fun `inserting the same key and hash is ignored`() = runTest {
        val rowId = dao.insert(event("1", "key", "hash", 1_000))
        assertTrue(rowId != -1L)

        val duplicate = dao.insert(event("2", "key", "hash", 1_000))
        assertEquals(-1L, duplicate)
        assertEquals(1, dao.count())
    }

    @Test
    fun `same key with new content is stored as a new event`() = runTest {
        dao.insert(event("1", "key", "hash-a", 1_000))
        dao.insert(event("2", "key", "hash-b", 1_001))
        assertEquals(2, dao.count())
    }

    @Test
    fun `list returns newest first`() = runTest {
        dao.insert(event("1", "k1", "h1", 1_000))
        dao.insert(event("2", "k2", "h2", 3_000))
        dao.insert(event("3", "k3", "h3", 2_000))

        val items = dao.list(null, null, 10)
        assertEquals(listOf("2", "3", "1"), items.map { it.id })
    }

    @Test
    fun `cursor pagination does not repeat rows`() = runTest {
        dao.insert(event("1", "k1", "h1", 1_000))
        dao.insert(event("2", "k2", "h2", 2_000))
        dao.insert(event("3", "k3", "h3", 3_000))

        val first = dao.list(null, null, 2)
        assertEquals(listOf("3", "2"), first.map { it.id })

        val cursor = first.last()
        val second = dao.listAfter(null, null, cursor.postedAt, cursor.id, 2)
        assertEquals(listOf("1"), second.map { it.id })
    }

    @Test
    fun `filters by status and source`() = runTest {
        dao.insert(event("1", "k1", "h1", 1_000, RawEventStatus.CAPTURED))
        dao.insert(event("2", "k2", "h2", 2_000, RawEventStatus.IGNORED))

        val captured = dao.list("CAPTURED", null, 10)
        assertEquals(listOf("1"), captured.map { it.id })

        val notifications = dao.list(null, "NOTIFICATION", 10)
        assertEquals(2, notifications.size)
        val sms = dao.list(null, "SMS", 10)
        assertTrue(sms.isEmpty())
    }

    @Test
    fun `updateStatus persists`() = runTest {
        dao.insert(event("1", "k1", "h1", 1_000))
        dao.updateStatus("1", RawEventStatus.DISMISSED, 5_000)
        val stored = dao.getById("1")
        assertEquals(RawEventStatus.DISMISSED, stored?.status)
        assertEquals(5_000L, stored?.dismissedAt)
    }
}
