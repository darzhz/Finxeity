package com.localexpense.tracker.data

import com.localexpense.tracker.data.entity.AccountEntity
import com.localexpense.tracker.data.entity.AccountType
import com.localexpense.tracker.data.entity.Cadence
import com.localexpense.tracker.data.entity.CategoryEntity
import com.localexpense.tracker.data.entity.CategoryKind
import com.localexpense.tracker.data.entity.TransactionDirection
import com.localexpense.tracker.data.entity.TransactionEntity
import com.localexpense.tracker.data.entity.TransactionKind
import com.localexpense.tracker.data.entity.TransactionSource
import com.localexpense.tracker.data.entity.TransactionStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

class DashboardServiceTest {

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
        categoryId: String? = null,
        merchantId: String? = null,
        accountId: String? = "account-1",
        excludedFromBurn: Boolean = false,
        status: TransactionStatus = TransactionStatus.ACTIVE,
    ) = TransactionEntity(
        id = id,
        rawEventId = "raw-$id",
        accountId = accountId,
        amountMinor = amountMinor,
        direction = direction,
        kind = kind,
        refundOfTransactionId = null,
        merchantId = merchantId,
        categoryId = categoryId,
        referenceId = null,
        occurredAt = occurredAt,
        confidence = 0.95f,
        status = status,
        source = TransactionSource.AUTO,
        excludedFromBurn = excludedFromBurn,
        excludedFromBudget = false,
        note = null,
        createdAt = occurredAt,
    )

    private fun account(
        id: String = "account-1",
        anchorMinor: Long = 100_000,
        anchorAt: Long = 0,
    ) = AccountEntity(
        id = id,
        name = "HDFC",
        lastDigits = "4821",
        type = AccountType.BANK,
        anchorBalanceMinor = anchorMinor,
        anchorAt = anchorAt,
        currency = "INR",
        archived = false,
        createdAt = 0,
    )

    private fun category(id: String, name: String) = CategoryEntity(
        id = id,
        name = name,
        kind = CategoryKind.EXPENSE,
        color = null,
        icon = null,
        isSystem = true,
        sortOrder = 0,
    )

    @Test
    fun `burn rate is the average daily spend over the window`() {
        val active = listOf(
            transaction("t1", 30_000, now),
            transaction("t2", 30_000, now - day),
        )

        val burn = DashboardService.burnRate(active, totalBalanceMinor = 200_000, now = now)

        assertEquals(60_000L, burn.spendMinor)
        // Two days of spending, so the daily rate is the whole amount over them.
        assertEquals(30_000L, burn.dailyMinor)
        assertEquals(2, burn.daysCounted)
        assertEquals(6L, burn.runwayDays)
    }

    @Test
    fun `burn rate leaves out transfers and flagged one offs`() {
        val active = listOf(
            transaction("t1", 30_000, now - day),
            transaction(
                "t2",
                50_000,
                now - day,
                kind = TransactionKind.TRANSFER,
            ),
            transaction("t3", 90_000, now - day, excludedFromBurn = true),
        )

        val burn = DashboardService.burnRate(active, totalBalanceMinor = 200_000, now = now)

        assertEquals(30_000L, burn.spendMinor)
    }

    @Test
    fun `runway is the balance divided by the daily burn`() {
        val active = listOf(transaction("t1", 30_000, now))

        val burn = DashboardService.burnRate(active, totalBalanceMinor = 300_000, now = now)

        assertEquals(30_000L, burn.dailyMinor)
        assertEquals(10L, burn.runwayDays)
        assertNull(burn.runwayMonths)
    }

    @Test
    fun `no spending means no runway figure`() {
        val burn = DashboardService.burnRate(emptyList(), totalBalanceMinor = 300_000, now = now)
        assertNull(burn.runwayDays)
        assertEquals(0L, burn.dailyMinor)
    }

    @Test
    fun `cashflow nets income against spend month by month`() {
        val spend = listOf(
            transaction("t1", 10_000, at(2026, Calendar.FEBRUARY, 10)),
            transaction("t2", 20_000, at(2026, Calendar.MARCH, 3)),
        )
        val income = listOf(
            transaction("t3", 50_000, at(2026, Calendar.FEBRUARY, 1), TransactionDirection.CREDIT, TransactionKind.INCOME),
        )

        val points = DashboardService.cashflow(spend, income, now, 90)

        val february = points.first { it.periodStart == DashboardService.monthStart(at(2026, Calendar.FEBRUARY, 1)) }
        assertEquals(10_000L, february.spendMinor)
        assertEquals(50_000L, february.incomeMinor)
        assertEquals(40_000L, february.netMinor)

        val march = points.first { it.periodStart == DashboardService.monthStart(at(2026, Calendar.MARCH, 1)) }
        assertEquals(20_000L, march.spendMinor)
        assertEquals(-20_000L, march.netMinor)
    }

    @Test
    fun `category breakdown shows the share and the change against last month`() {
        val categories = listOf(category("cat_food", "Food"), category("cat_fees", "Fees & Charges"))
        val spend = listOf(
            transaction("t1", 30_000, at(2026, Calendar.MARCH, 3), categoryId = "cat_food"),
            transaction("t2", 10_000, at(2026, Calendar.MARCH, 4), categoryId = "cat_fees"),
            transaction("t3", 20_000, at(2026, Calendar.FEBRUARY, 10), categoryId = "cat_food"),
        )

        val shares = DashboardService.categoryBreakdown(spend, categories, now)

        val food = shares.first { it.categoryId == "cat_food" }
        assertEquals(30_000L, food.spendMinor)
        assertEquals(0.75f, food.share, 0.001f)
        assertEquals(10_000L, food.changeMinor)

        val fees = shares.first { it.categoryId == "cat_fees" }
        assertEquals(10_000L, fees.changeMinor)
    }

    @Test
    fun `top merchants are ranked by what they cost`() {
        val spend = listOf(
            transaction("t1", 30_000, now - day, merchantId = "m1"),
            transaction("t2", 10_000, now - day, merchantId = "m2"),
            transaction("t3", 20_000, now - day, merchantId = "m1"),
        )

        val merchants = DashboardService.topMerchants(spend, mapOf("m1" to "Swiggy", "m2" to "Amazon"))

        assertEquals("Swiggy", merchants.first().name)
        assertEquals(50_000L, merchants.first().spendMinor)
        assertEquals(2, merchants.first().count)
        assertEquals("Amazon", merchants.last().name)
    }

    @Test
    fun `a monthly payment is detected as recurring`() {
        val transactions = listOf(
            transaction("t1", 50_000, at(2026, Calendar.JANUARY, 5), merchantId = "m1"),
            transaction("t2", 50_000, at(2026, Calendar.FEBRUARY, 5), merchantId = "m1"),
            transaction("t3", 50_000, at(2026, Calendar.MARCH, 5), merchantId = "m1"),
        )

        val recurring = RecurringService.detect(transactions, mapOf("m1" to "Netflix"))

        assertEquals(1, recurring.size)
        assertEquals("Netflix", recurring.first().name)
        assertEquals(Cadence.MONTHLY, recurring.first().cadence)
        assertEquals(50_000L, recurring.first().amountMinor)
        assertNotNull(recurring.first().nextExpectedAt)
    }

    @Test
    fun `one off spending is not recurring`() {
        val transactions = listOf(
            transaction("t1", 50_000, at(2026, Calendar.JANUARY, 5), merchantId = "m1"),
            transaction("t2", 50_000, at(2026, Calendar.JANUARY, 9), merchantId = "m1"),
            transaction("t3", 50_000, at(2026, Calendar.MARCH, 20), merchantId = "m1"),
        )

        val recurring = RecurringService.detect(transactions, mapOf("m1" to "Random"))

        assertTrue(recurring.isEmpty())
    }

    @Test
    fun `a price rise is reported`() {
        val transactions = listOf(
            transaction("t1", 50_000, at(2026, Calendar.JANUARY, 5), merchantId = "m1"),
            transaction("t2", 50_000, at(2026, Calendar.FEBRUARY, 5), merchantId = "m1"),
            transaction("t3", 60_000, at(2026, Calendar.MARCH, 5), merchantId = "m1"),
        )

        val recurring = RecurringService.detect(transactions, mapOf("m1" to "Netflix"))

        assertEquals(10_000L, recurring.first().priceIncreaseMinor)
    }

    @Test
    fun `savings potential names where each part comes from`() {
        val categories = listOf(category("cat_food", "Food"), category("cat_fees", "Fees & Charges"))
        val spend = listOf(
            transaction("t1", 40_000, at(2026, Calendar.JANUARY, 5), categoryId = "cat_food"),
            transaction("t2", 40_000, at(2026, Calendar.FEBRUARY, 5), categoryId = "cat_food"),
            transaction("t3", 60_000, at(2026, Calendar.MARCH, 5), categoryId = "cat_food"),
            transaction("t4", 5_000, at(2026, Calendar.MARCH, 6), categoryId = "cat_fees"),
        )

        val savings = DashboardService.savingsPotential(
            active = spend,
            spend = spend,
            categories = categories,
            recurring = emptyList(),
            now = now,
        )

        assertEquals(25_000L, savings.totalMinor)
        val sources = savings.items.map { it.source }
        assertTrue(sources.contains("Category"))
        assertTrue(sources.contains("Fees"))
    }

    @Test
    fun `safe to spend leaves the committed bills alone`() {
        val recurring = listOf(
            RecurringSummary(
                merchantId = "m1",
                name = "Rent",
                amountMinor = 20_000,
                cadence = Cadence.MONTHLY,
                nextExpectedAt = now + 5 * day,
                lastSeenAt = now - 25 * day,
                priceIncreaseMinor = null,
            ),
        )

        val safe = DashboardService.safeToSpend(100_000, recurring, now)

        assertNotNull(safe)
        val balance = safe!!.breakdown.first { it.source == "Balance" }
        val committed = safe.breakdown.first { it.source == "Committed" }
        assertEquals(100_000L, balance.amountMinor)
        assertEquals(-20_000L, committed.amountMinor)
        assertEquals((100_000L - 20_000L) / safe.daysLeft, safe.todayMinor)
        assertTrue(safe.daysLeft > 0)
    }

    @Test
    fun `safe to spend is hidden when there is no money`() {
        assertNull(DashboardService.safeToSpend(0, emptyList(), now))
    }

    @Test
    fun `the balance is the anchor plus everything spent since`() {
        val dashboard = DashboardService.build(
            transactions = listOf(
                transaction("t1", 30_000, now - day, accountId = "account-1"),
                transaction("t2", 10_000, now - day, direction = TransactionDirection.CREDIT, kind = TransactionKind.INCOME, accountId = "account-1"),
            ),
            accounts = listOf(account(anchorMinor = 100_000, anchorAt = 0)),
            categories = emptyList(),
            merchantNames = emptyMap(),
            needsReview = 0,
            now = now,
        )

        assertEquals(80_000L, dashboard.totalBalanceMinor)
        assertEquals(80_000L, dashboard.accounts.first().derivedBalanceMinor)
    }

    @Test
    fun `a voided transaction does not move the balance`() {
        val dashboard = DashboardService.build(
            transactions = listOf(
                transaction(
                    "t1",
                    30_000,
                    now - day,
                    status = TransactionStatus.VOIDED,
                ),
            ),
            accounts = listOf(account(anchorMinor = 100_000, anchorAt = 0)),
            categories = emptyList(),
            merchantNames = emptyMap(),
            needsReview = 0,
            now = now,
        )

        assertEquals(100_000L, dashboard.totalBalanceMinor)
    }
}
