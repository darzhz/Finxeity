package com.localexpense.tracker.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.localexpense.tracker.data.entity.AccountEntity
import com.localexpense.tracker.data.entity.AccountType
import com.localexpense.tracker.data.entity.RawEventEntity
import com.localexpense.tracker.data.entity.RawEventSource
import com.localexpense.tracker.data.entity.RawEventStatus
import com.localexpense.tracker.data.entity.TransactionDirection
import com.localexpense.tracker.data.entity.TransactionStatus
import com.localexpense.tracker.parse.MessageType
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class IngestionPipelineTest {

    private lateinit var database: AppDatabase
    private lateinit var pipeline: IngestionPipeline

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room
            .inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        pipeline = IngestionPipeline(database)
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

    private suspend fun addAccount(lastDigits: String, name: String = "HDFC") =
        database.accountDao().upsert(
            AccountEntity(
                id = "account-$lastDigits",
                name = name,
                lastDigits = lastDigits,
                type = AccountType.BANK,
                anchorBalanceMinor = 1_000_000,
                anchorAt = 0,
                currency = "INR",
                archived = false,
                createdAt = 0,
            ),
        )

    @Test
    fun `a spend becomes a transaction`() = runTest {
        val event = store("e1", "Paid ₹450 to Swiggy")

        val outcome = pipeline.ingest(event)

        assertTrue(outcome is IngestionOutcome.Created)
        val transaction = (outcome as IngestionOutcome.Created).transaction
        assertEquals(45_000L, transaction.amountMinor)
        assertEquals(TransactionDirection.DEBIT, transaction.direction)
        assertEquals(TransactionStatus.ACTIVE, transaction.status)
        assertEquals(RawEventStatus.PARSED, database.rawEventDao().getById("e1")?.status)
    }

    @Test
    fun `an otp is ignored and never becomes a transaction`() = runTest {
        val event = store("e1", "Your OTP is 123456 for a payment of ₹900")

        val outcome = pipeline.ingest(event)

        assertEquals(MessageType.OTP, (outcome as IngestionOutcome.Ignored).type)
        assertEquals(0L, database.transactionDao().count().toLong())
        assertEquals(RawEventStatus.IGNORED, database.rawEventDao().getById("e1")?.status)
    }

    @Test
    fun `a low confidence parse waits for review`() = runTest {
        val event = store("e1", "Rs.999")

        val outcome = pipeline.ingest(event)

        assertTrue(outcome is IngestionOutcome.NeedsReview)
        assertEquals(0L, database.transactionDao().count().toLong())
        assertEquals(RawEventStatus.NEEDS_REVIEW, database.rawEventDao().getById("e1")?.status)
    }

    @Test
    fun `a credit becomes a credit transaction`() = runTest {
        val event = store("e1", "Rs.5,000 credited to A/c XX4821", packageName = "com.hdfc.bank")

        val outcome = pipeline.ingest(event)

        val transaction = (outcome as IngestionOutcome.Created).transaction
        assertEquals(500_000L, transaction.amountMinor)
        assertEquals(TransactionDirection.CREDIT, transaction.direction)
    }

    @Test
    fun `the same message twice collapses into one transaction`() = runTest {
        val first = store("e1", "Paid ₹450 to Swiggy", postedAt = 1_000)
        val second = store("e2", "Paid ₹450 to Swiggy", postedAt = 2_000)

        assertTrue(pipeline.ingest(first) is IngestionOutcome.Created)
        val outcome = pipeline.ingest(second)

        assertTrue(outcome is IngestionOutcome.Duplicate)
        assertEquals(1L, database.transactionDao().count().toLong())
        assertEquals("e1", database.rawEventDao().getById("e2")?.duplicateOf)
    }

    @Test
    fun `the same spend at another merchant is not a duplicate`() = runTest {
        val first = store("e1", "Paid ₹450 to Swiggy", postedAt = 1_000)
        val second = store("e2", "Paid ₹450 to Zomato", postedAt = 2_000)

        pipeline.ingest(first)
        pipeline.ingest(second)

        assertEquals(2L, database.transactionDao().count().toLong())
    }

    @Test
    fun `the same amount much later is not a duplicate`() = runTest {
        val first = store("e1", "Paid ₹450 to Swiggy", postedAt = 1_000)
        val later = 1_000L + 60 * 60 * 1000L
        val second = store("e2", "Paid ₹450 to Swiggy", postedAt = later)

        pipeline.ingest(first)
        pipeline.ingest(second)

        assertEquals(2L, database.transactionDao().count().toLong())
    }

    @Test
    fun `a transaction is linked to the account with the same digits`() = runTest {
        addAccount("4821")
        val event = store(
            "e1",
            "Rs.1,200.00 debited from A/c XX4821",
            packageName = "com.hdfc.bank",
        )

        val outcome = pipeline.ingest(event)

        assertEquals("account-4821", (outcome as IngestionOutcome.Created).transaction.accountId)
    }

    @Test
    fun `a balance in a message becomes a checkpoint`() = runTest {
        addAccount("4821")
        val event = store(
            "e1",
            "Rs.500 debited from A/c XX4821. Available balance Rs.9,500.00",
            packageName = "com.hdfc.bank",
        )

        pipeline.ingest(event)

        val checkpoint = database.balanceCheckpointDao().latestForAccount("account-4821")
        assertEquals(950_000L, checkpoint?.balanceMinor)
        assertEquals("e1", checkpoint?.rawEventId)
    }

    @Test
    fun `a message with no merchant keeps an empty merchant`() = runTest {
        val event = store(
            "e1",
            "Rs.500 debited from A/c XX4821",
            packageName = "com.hdfc.bank",
        )

        val outcome = pipeline.ingest(event)

        val transaction = (outcome as IngestionOutcome.Created).transaction
        assertNull(database.merchantDao().getById(transaction.merchantId ?: ""))
    }
}
