package com.localexpense.tracker.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.localexpense.tracker.data.entity.RawEventEntity
import com.localexpense.tracker.data.entity.RawEventSource
import com.localexpense.tracker.data.entity.RawEventStatus
import com.localexpense.tracker.data.entity.RecurringStatus
import com.localexpense.tracker.data.entity.RuleType
import com.localexpense.tracker.data.entity.TransactionDirection
import com.localexpense.tracker.data.entity.TransactionEntity
import com.localexpense.tracker.data.entity.TransactionKind
import com.localexpense.tracker.data.entity.TransactionSource
import com.localexpense.tracker.data.entity.TransactionStatus
import com.localexpense.tracker.settings.AppSettings
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class RepoTest {

    private lateinit var database: AppDatabase
    private lateinit var repo: Repo
    private lateinit var lifecycle: EventLifecycle

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room
            .inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        repo = Repo(database, AppSettings(context))
        lifecycle = EventLifecycle(database)
    }

    @After
    fun tearDown() {
        database.close()
    }

    private fun transaction(
        id: String,
        merchantId: String,
        amountMinor: Long,
        occurredAt: Long,
    ) = TransactionEntity(
        id = id,
        rawEventId = null,
        accountId = null,
        amountMinor = amountMinor,
        direction = TransactionDirection.DEBIT,
        kind = TransactionKind.SPEND,
        refundOfTransactionId = null,
        merchantId = merchantId,
        categoryId = null,
        referenceId = null,
        occurredAt = occurredAt,
        confidence = 0.95f,
        status = TransactionStatus.ACTIVE,
        source = TransactionSource.AUTO,
        excludedFromBurn = false,
        excludedFromBudget = false,
        note = null,
        createdAt = occurredAt,
    )

    @Test
    fun `rules can be listed and deleted`() = runTest {
        val event = RawEventEntity(
            id = "e1",
            source = RawEventSource.NOTIFICATION,
            packageName = "com.phonepe.app",
            sender = null,
            notificationKey = "key-1",
            title = "PhonePe",
            text = "Paid ₹450 to Swiggy",
            bigText = null,
            textLines = null,
            postedAt = 1_000,
            contentHash = "hash-1",
            status = RawEventStatus.CAPTURED,
            createdAt = 1_000,
        )
        database.rawEventDao().insert(event)

        val created = lifecycle.createIgnoreRule("e1")
        assertTrue(created is EventChange.RuleCreated)

        val rules = repo.listRules()
        assertEquals(1, rules.size)
        assertEquals(RuleType.IGNORE, rules.first().type)

        repo.deleteRule(rules.first().id)
        assertEquals(0, repo.listRules().size)
    }

    @Test
    fun `a recurring payment the user ignored is left out`() = runTest {
        val now = System.currentTimeMillis()
        val day = 24L * 60 * 60 * 1000
        listOf(
            transaction("t1", "m1", 50_000, now - 62 * day),
            transaction("t2", "m1", 50_000, now - 32 * day),
            transaction("t3", "m1", 50_000, now - 2 * day),
        ).forEach { database.transactionDao().insert(it) }
        database.merchantDao().upsert(
            com.localexpense.tracker.data.entity.MerchantEntity(
                id = "m1",
                normalizedName = "netflix",
                displayName = "Netflix",
                defaultCategoryId = null,
            ),
        )

        val detected = repo.listRecurring()
        assertEquals(1, detected.size)
        assertEquals("Netflix", detected.first().name)

        repo.setRecurringStatus("m1", RecurringStatus.IGNORED)

        assertEquals(0, repo.listRecurring().size)
    }

    @Test
    fun `a confirmed recurring payment is reported as confirmed`() = runTest {
        val now = System.currentTimeMillis()
        val day = 24L * 60 * 60 * 1000
        listOf(
            transaction("t1", "m1", 50_000, now - 62 * day),
            transaction("t2", "m1", 50_000, now - 32 * day),
            transaction("t3", "m1", 50_000, now - 2 * day),
        ).forEach { database.transactionDao().insert(it) }
        database.merchantDao().upsert(
            com.localexpense.tracker.data.entity.MerchantEntity(
                id = "m1",
                normalizedName = "netflix",
                displayName = "Netflix",
                defaultCategoryId = null,
            ),
        )

        repo.setRecurringStatus("m1", RecurringStatus.CONFIRMED)

        val recurring = repo.listRecurring()
        assertEquals(1, recurring.size)
        assertEquals(RecurringStatus.CONFIRMED, recurring.first().status)
        assertNotNull(recurring.first().nextExpectedAt)
    }
}
