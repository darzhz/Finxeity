package com.localexpense.tracker.data

import com.localexpense.tracker.data.entity.TransactionDirection
import com.localexpense.tracker.data.entity.TransactionEntity
import com.localexpense.tracker.data.entity.TransactionKind
import com.localexpense.tracker.data.entity.TransactionSource
import com.localexpense.tracker.data.entity.TransactionStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

class SummaryServiceTest {

    private val day = 24L * 60 * 60 * 1000

    private fun at(year: Int, month: Int, dayOfMonth: Int): Long {
        val calendar = Calendar.getInstance()
        calendar.clear()
        calendar.set(year, month, dayOfMonth, 12, 0, 0)
        return calendar.timeInMillis
    }

    private val now = at(2026, Calendar.MARCH, 15)

    private fun transaction(
        id: String,
        amountMinor: Long,
        occurredAt: Long,
        direction: TransactionDirection = TransactionDirection.DEBIT,
        kind: TransactionKind = TransactionKind.SPEND,
        excludedFromBurn: Boolean = false,
    ) = TransactionEntity(
        id = id,
        rawEventId = "raw-$id",
        accountId = "account-1",
        amountMinor = amountMinor,
        direction = direction,
        kind = kind,
        refundOfTransactionId = null,
        merchantId = "m1",
        categoryId = "cat_food",
        referenceId = null,
        occurredAt = occurredAt,
        confidence = 0.95f,
        status = TransactionStatus.ACTIVE,
        source = TransactionSource.AUTO,
        excludedFromBurn = excludedFromBurn,
        excludedFromBudget = false,
        note = null,
        createdAt = occurredAt,
    )

    @Test
    fun `a day holds the spend, the income and the transfers apart`() {
        val summaries = SummaryService.compute(
            listOf(
                transaction("t1", 30_000, now - day),
                transaction("t2", 10_000, now - day, TransactionDirection.CREDIT, TransactionKind.INCOME),
                transaction("t3", 70_000, now - day, kind = TransactionKind.TRANSFER),
                transaction("t4", 90_000, now - day, excludedFromBurn = true),
            ),
            now,
        )

        assertEquals(1, summaries.size)
        val day = summaries.first()
        assertEquals(30_000L, day.spendMinor)
        assertEquals(10_000L, day.incomeMinor)
        assertEquals(70_000L, day.transferMinor)
        assertEquals(1, day.transactionCount)
    }

    @Test
    fun `the cached burn rate is the same as the computed one`() {
        val transactions = listOf(
            transaction("t1", 30_000, now),
            transaction("t2", 30_000, now - day),
            transaction("t3", 70_000, now - 2 * day, kind = TransactionKind.TRANSFER),
        )

        val summaries = SummaryService.compute(transactions, now)
        val cached = SummaryService.burnFromSummaries(summaries, 200_000, now)
        val computed = DashboardService.burnRate(transactions, 200_000, now)

        assertEquals(computed.dailyMinor, cached.dailyMinor)
        assertEquals(computed.monthlyMinor, cached.monthlyMinor)
        assertEquals(computed.spendMinor, cached.spendMinor)
        assertEquals(computed.runwayDays, cached.runwayDays)
        assertEquals(computed.daysCounted, cached.daysCounted)
    }

    @Test
    fun `the cached cashflow is the same as the computed one`() {
        val spend = listOf(
            transaction("t1", 30_000, at(2026, Calendar.FEBRUARY, 10)),
            transaction("t2", 20_000, at(2026, Calendar.MARCH, 3)),
            transaction("t3", 50_000, at(2026, Calendar.MARCH, 4), kind = TransactionKind.TRANSFER),
        )
        val income = listOf(
            transaction("t4", 80_000, at(2026, Calendar.FEBRUARY, 1), TransactionDirection.CREDIT, TransactionKind.INCOME),
        )

        val summaries = SummaryService.compute(spend + income, now)
        val cached = SummaryService.cashflowFromSummaries(summaries, now, 90)
        val computed = DashboardService.cashflow(spend, income, now, 90)

        assertEquals(computed.size, cached.size)
        computed.forEach { point ->
            val match = cached.first { it.periodStart == point.periodStart }
            assertEquals(point.spendMinor, match.spendMinor)
            assertEquals(point.incomeMinor, match.incomeMinor)
            assertEquals(point.netMinor, match.netMinor)
        }
    }

    @Test
    fun `a stale cache is not used`() {
        val summaries = SummaryService.compute(listOf(transaction("t1", 30_000, now)), now)

        val fresh = SummaryCache(summaries, fresh = true)
        val stale = SummaryCache(summaries, fresh = false)

        assertTrue(fresh.fresh)
        assertFalse(stale.fresh)
    }
}
