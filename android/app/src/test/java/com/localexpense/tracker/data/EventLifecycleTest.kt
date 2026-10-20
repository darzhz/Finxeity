package com.localexpense.tracker.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.localexpense.tracker.data.entity.AccountEntity
import com.localexpense.tracker.data.entity.AccountType
import com.localexpense.tracker.data.entity.RawEventEntity
import com.localexpense.tracker.data.entity.RawEventSource
import com.localexpense.tracker.data.entity.RawEventStatus
import com.localexpense.tracker.data.entity.TransactionEntity
import com.localexpense.tracker.data.entity.TransactionKind
import com.localexpense.tracker.data.entity.TransactionStatus
import com.localexpense.tracker.parse.MessageTemplate
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class EventLifecycleTest {

    private lateinit var database: AppDatabase
    private lateinit var ingestion: IngestionPipeline
    private lateinit var lifecycle: EventLifecycle

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room
            .inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        ingestion = IngestionPipeline(database)
        lifecycle = EventLifecycle(database)
    }

    @After
    fun tearDown() {
        database.close()
    }

    private suspend fun store(
        id: String,
        body: String,
        packageName: String = "com.phonepe.app",
        sender: String? = null,
        postedAt: Long = 1_000,
    ): RawEventEntity {
        val event = RawEventEntity(
            id = id,
            source = if (sender == null) RawEventSource.NOTIFICATION else RawEventSource.SMS,
            packageName = packageName,
            sender = sender,
            notificationKey = "key-$id",
            title = sender ?: "Test app",
            text = body,
            bigText = null,
            textLines = null,
            postedAt = postedAt,
            contentHash = "hash-$id",
            status = RawEventStatus.CAPTURED,
            createdAt = postedAt,
        )
        database.rawEventDao().insert(event)
        return event
    }

    private suspend fun addAccount(lastDigits: String) =
        database.accountDao().upsert(
            AccountEntity(
                id = "account-$lastDigits",
                name = "HDFC",
                lastDigits = lastDigits,
                type = AccountType.BANK,
                anchorBalanceMinor = 1_000_000,
                anchorAt = 0,
                currency = "INR",
                archived = false,
                createdAt = 0,
            ),
        )

    private suspend fun transactionFor(eventId: String): TransactionEntity? =
        database.transactionDao().listByRawEvent(eventId).firstOrNull()

    @Test
    fun `removing a read voids the transaction it made`() = runTest {
        val event = store("e1", "Paid ₹450 to Swiggy")
        ingestion.ingest(event)
        assertNotNull(transactionFor("e1"))

        lifecycle.dismiss("e1")

        assertEquals(TransactionStatus.VOIDED, transactionFor("e1")?.status)
        assertEquals(RawEventStatus.DISMISSED, database.rawEventDao().getById("e1")?.status)
    }

    @Test
    fun `removing a read retracts the corrections made on it`() = runTest {
        val event = store("e1", "Paid ₹450 to Swiggy")
        ingestion.ingest(event)
        val transaction = transactionFor("e1")!!
        lifecycle.correct(
            transaction.id,
            TransactionPatch(categoryId = "cat_food"),
        )

        lifecycle.dismiss("e1")

        val corrections = database.correctionDao().listByTransaction(transaction.id)
        assertTrue(corrections.isNotEmpty())
        assertTrue(corrections.all { it.retractedAt != null })
    }

    @Test
    fun `restoring a read returns the app to the state before the removal`() = runTest {
        addAccount("4821")
        val event = store(
            "e1",
            "Rs.1,200.00 debited from A/c XX4821",
            packageName = "com.hdfc.bank",
        )
        ingestion.ingest(event)
        val before = transactionFor("e1")!!
        val checkpointBefore = database.balanceCheckpointDao().latestForAccount("account-4821")

        lifecycle.dismiss("e1")
        lifecycle.restore("e1")

        val after = transactionFor("e1")!!
        assertEquals(before.amountMinor, after.amountMinor)
        assertEquals(before.direction, after.direction)
        assertEquals(before.kind, after.kind)
        assertEquals(before.status, after.status)
        assertEquals(before.confidence, after.confidence)
        assertEquals(before.occurredAt, after.occurredAt)
        assertEquals(before.accountId, after.accountId)
        assertEquals(before.source, after.source)
        assertEquals(RawEventStatus.PARSED, database.rawEventDao().getById("e1")?.status)
        assertEquals(
            checkpointBefore?.balanceMinor,
            database.balanceCheckpointDao().latestForAccount("account-4821")?.balanceMinor,
        )
    }

    @Test
    fun `restoring a read brings back the corrections`() = runTest {
        val event = store("e1", "Paid ₹450 to Swiggy")
        ingestion.ingest(event)
        val transaction = transactionFor("e1")!!
        lifecycle.correct(transaction.id, TransactionPatch(categoryId = "cat_food"))

        lifecycle.dismiss("e1")
        lifecycle.restore("e1")

        val corrections = database.correctionDao().listByTransaction(transaction.id)
        assertTrue(corrections.isNotEmpty())
        assertTrue(corrections.all { it.retractedAt == null })
    }

    @Test
    fun `removing a read drops the balance checkpoint it produced`() = runTest {
        addAccount("4821")
        val event = store(
            "e1",
            "Rs.500 debited from A/c XX4821. Available balance Rs.9,500.00",
            packageName = "com.hdfc.bank",
        )
        ingestion.ingest(event)
        assertNotNull(database.balanceCheckpointDao().latestForAccount("account-4821"))

        lifecycle.dismiss("e1")

        assertNull(database.balanceCheckpointDao().latestForAccount("account-4821"))
    }

    @Test
    fun `removing a duplicate leaves the original transaction alone`() = runTest {
        val first = store("e1", "Paid ₹450 to Swiggy", postedAt = 1_000)
        val second = store("e2", "Paid ₹450 to Swiggy", postedAt = 2_000)
        ingestion.ingest(first)
        ingestion.ingest(second)
        assertEquals("e1", database.rawEventDao().getById("e2")?.duplicateOf)

        lifecycle.dismiss("e2")

        assertEquals(TransactionStatus.ACTIVE, transactionFor("e1")?.status)
        assertEquals(RawEventStatus.DISMISSED, database.rawEventDao().getById("e2")?.status)
    }

    @Test
    fun `removing the original also removes its duplicates`() = runTest {
        val first = store("e1", "Paid ₹450 to Swiggy", postedAt = 1_000)
        val second = store("e2", "Paid ₹450 to Swiggy", postedAt = 2_000)
        ingestion.ingest(first)
        ingestion.ingest(second)

        lifecycle.dismiss("e1")

        assertEquals(RawEventStatus.DISMISSED, database.rawEventDao().getById("e1")?.status)
        assertEquals(RawEventStatus.DISMISSED, database.rawEventDao().getById("e2")?.status)
        assertEquals(TransactionStatus.VOIDED, transactionFor("e1")?.status)
    }

    @Test
    fun `an ignore rule stops similar messages from becoming transactions`() = runTest {
        val event = store("e1", "Paid ₹450 to Swiggy", postedAt = 1_000)
        ingestion.ingest(event)
        lifecycle.createIgnoreRule("e1")

        val later = store("e2", "Paid ₹980 to Swiggy", postedAt = 60_000)
        val outcome = ingestion.ingest(later)

        assertTrue(outcome is IngestionOutcome.Ignored)
        assertEquals(1L, database.transactionDao().count().toLong())
        assertEquals(RawEventStatus.IGNORED, database.rawEventDao().getById("e2")?.status)
    }

    @Test
    fun `an ignore rule leaves other messages alone`() = runTest {
        val event = store("e1", "Paid ₹450 to Swiggy", postedAt = 1_000)
        ingestion.ingest(event)
        lifecycle.createIgnoreRule("e1")

        val other = store("e2", "Paid ₹980 to Zomato", postedAt = 60_000)
        ingestion.ingest(other)

        assertEquals(2L, database.transactionDao().count().toLong())
    }

    @Test
    fun `a message template matches a similar message`() {
        val pattern = MessageTemplate.derive("Rs.500 debited from A/c XX4821")
        val regex = Regex(pattern, RegexOption.IGNORE_CASE)
        assertTrue(regex.containsMatchIn("Rs.900 debited from A/c XX4821"))
        assertTrue(regex.containsMatchIn("Rs.1,200.50 debited from A/c XX1234"))
        assertTrue(!regex.containsMatchIn("Rs.900 credited to A/c XX4821"))
    }

    @Test
    fun `promoting a message creates a transaction by hand`() = runTest {
        val event = store("e1", "Get ₹100 cashback on your next order")
        ingestion.ingest(event)
        assertNull(transactionFor("e1"))

        val change = lifecycle.promote(
            rawEventId = "e1",
            kind = TransactionKind.INCOME,
            amountMinor = 10_000,
            merchantName = "Promo",
            categoryId = null,
        )

        assertTrue(change is EventChange.Promoted)
        val transaction = (change as EventChange.Promoted).transaction
        assertEquals(10_000L, transaction.amountMinor)
        assertEquals(TransactionStatus.ACTIVE, transaction.status)
        assertEquals(RawEventStatus.PARSED, database.rawEventDao().getById("e1")?.status)
    }

    @Test
    fun `confirming a message from the review queue creates a transaction`() = runTest {
        val event = store("e1", "Rs.999")
        ingestion.ingest(event)
        assertEquals(RawEventStatus.NEEDS_REVIEW, database.rawEventDao().getById("e1")?.status)

        val change = lifecycle.confirm("e1", amountMinor = 99_900, merchantName = null, categoryId = null)

        assertTrue(change is EventChange.Promoted)
        assertEquals(99_900L, (change as EventChange.Promoted).transaction.amountMinor)
        assertEquals(RawEventStatus.PARSED, database.rawEventDao().getById("e1")?.status)
    }

    @Test
    fun `correcting a transaction records what changed`() = runTest {
        val event = store("e1", "Paid ₹450 to Swiggy")
        ingestion.ingest(event)
        val transaction = transactionFor("e1")!!

        val change = lifecycle.correct(
            transaction.id,
            TransactionPatch(amountMinor = 500_00, categoryId = "cat_food", note = "team lunch"),
        )

        assertTrue(change is EventChange.Corrected)
        val corrected = (change as EventChange.Corrected).transaction
        assertEquals(500_00L, corrected.amountMinor)
        assertEquals("cat_food", corrected.categoryId)
        assertEquals("team lunch", corrected.note)

        val corrections = database.correctionDao().listByTransaction(transaction.id)
        assertEquals(3, corrections.size)
        assertTrue(corrections.any { it.field == "amount" })
        assertTrue(corrections.any { it.field == "category" })
        assertTrue(corrections.any { it.field == "note" })
    }

    @Test
    fun `deleting a message permanently removes it`() = runTest {
        val event = store("e1", "Paid ₹450 to Swiggy")
        ingestion.ingest(event)

        lifecycle.deletePermanently("e1")

        assertNull(database.rawEventDao().getById("e1"))
        assertEquals(0L, database.transactionDao().count().toLong())
    }
}
