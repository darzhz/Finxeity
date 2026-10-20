package com.localexpense.tracker.data

import com.localexpense.tracker.data.entity.AccountEntity
import com.localexpense.tracker.data.entity.CommitmentEntity
import com.localexpense.tracker.data.entity.CommitmentStatus
import com.localexpense.tracker.data.entity.GoalEntity
import com.localexpense.tracker.data.entity.GoalStatus
import com.localexpense.tracker.data.entity.Cadence
import com.localexpense.tracker.data.entity.CategoryEntity
import com.localexpense.tracker.data.entity.DailySummaryEntity
import com.localexpense.tracker.data.entity.RecurringStatus
import com.localexpense.tracker.data.entity.TransactionDirection
import com.localexpense.tracker.data.entity.TransactionEntity
import com.localexpense.tracker.data.entity.TransactionKind
import com.localexpense.tracker.data.entity.TransactionStatus
import kotlin.math.max

/** The cached daily aggregates, and whether they are still true. */
data class SummaryCache(
    val summaries: List<DailySummaryEntity>,
    val fresh: Boolean,
)

/** Everything the dashboard shows, computed from the active transactions. */
data class Dashboard(
    val totalBalanceMinor: Long,
    val accounts: List<AccountSummary>,
    val burn: BurnSummary,
    val cashflow: List<CashflowPoint>,
    val categories: List<CategoryShare>,
    val topMerchants: List<MerchantSummary>,
    val recurring: List<RecurringSummary>,
    val savings: SavingsPotential,
    val safeToSpend: SafeToSpend?,
    val needsReview: Int,
    val lastUpdatedAt: Long,
)

data class AccountSummary(
    val id: String,
    val name: String,
    val lastDigits: String?,
    val derivedBalanceMinor: Long,
    val anchorBalanceMinor: Long,
)

data class BurnSummary(
    val dailyMinor: Long,
    val monthlyMinor: Long,
    val runwayDays: Long?,
    val runwayMonths: Long?,
    val spendMinor: Long,
    val daysCounted: Int,
)

data class CashflowPoint(
    val periodStart: Long,
    val spendMinor: Long,
    val incomeMinor: Long,
    val netMinor: Long,
)

data class CategoryShare(
    val categoryId: String?,
    val name: String,
    val spendMinor: Long,
    val share: Float,
    val changeMinor: Long?,
)

data class MerchantSummary(
    val merchantId: String?,
    val name: String,
    val spendMinor: Long,
    val count: Int,
)

data class RecurringSummary(
    val merchantId: String?,
    val name: String,
    val amountMinor: Long,
    val cadence: Cadence,
    val nextExpectedAt: Long?,
    val lastSeenAt: Long?,
    val priceIncreaseMinor: Long?,
    val status: RecurringStatus = RecurringStatus.SUGGESTED,
    val confirmed: Boolean = false,
)

/** One explainable contribution to the savings potential. */
data class SavingsItem(
    val source: String,
    val detail: String,
    val amountMinor: Long,
)

data class SavingsPotential(
    val totalMinor: Long,
    val items: List<SavingsItem>,
)

data class SafeToSpend(
    val todayMinor: Long,
    val weekMinor: Long,
    val daysLeft: Int,
    val breakdown: List<SavingsItem>,
)

/**
 * The numbers behind the dashboard.
 *
 * Everything here is derived from the active transactions, so a removal
 * immediately changes every figure. The functions are pure: the caller hands
 * over the rows and gets the numbers back.
 */
object DashboardService {

    const val DAY_MS = 24L * 60 * 60 * 1000

    /** The window the burn rate is measured over. */
    const val BURN_WINDOW_DAYS = 30

    fun build(
        transactions: List<TransactionEntity>,
        accounts: List<AccountEntity>,
        categories: List<CategoryEntity>,
        merchantNames: Map<String, String>,
        needsReview: Int,
        now: Long,
        rangeDays: Int = 180,
        ignoredRecurring: Set<String> = emptySet(),
        cache: SummaryCache? = null,
        commitments: List<CommitmentEntity> = emptyList(),
        goals: List<GoalEntity> = emptyList(),
        bufferMinor: Long = 0,
        incomeDay: Int = 0,
    ): Dashboard {
        val active = transactions.filter { it.status == TransactionStatus.ACTIVE }
        val spend = active.filter { it.direction == TransactionDirection.DEBIT }
        val income = active.filter { it.direction == TransactionDirection.CREDIT }

        val accountSummaries = accounts.map { account ->
            val own = active.filter { it.accountId == account.id }
            val delta = own
                .filter { it.occurredAt > account.anchorAt }
                .sumOf { if (it.direction == TransactionDirection.DEBIT) -it.amountMinor else it.amountMinor }
            AccountSummary(
                id = account.id,
                name = account.name,
                lastDigits = account.lastDigits,
                derivedBalanceMinor = account.anchorBalanceMinor + delta,
                anchorBalanceMinor = account.anchorBalanceMinor,
            )
        }
        val totalBalance = accountSummaries.sumOf { it.derivedBalanceMinor }

        val burn = if (cache != null && cache.fresh) {
            SummaryService.burnFromSummaries(cache.summaries, totalBalance, now)
        } else {
            burnRate(active, totalBalance, now)
        }
        val cashflow = if (cache != null && cache.fresh) {
            SummaryService.cashflowFromSummaries(cache.summaries, now, rangeDays)
        } else {
            cashflow(spend, income, now, rangeDays)
        }
        val categoryShares = categoryBreakdown(spend, categories, now)
        val merchants = topMerchants(spend, merchantNames)
        val recurring = RecurringService.detect(active, merchantNames)
        val visibleRecurring = recurring.filter { it.merchantId !in ignoredRecurring
        }
        val savings = savingsPotential(active, spend, categories, visibleRecurring, now)
        val safeToSpend = safeToSpend(totalBalance, visibleRecurring, now, commitments, goals, bufferMinor, incomeDay)

        return Dashboard(
            totalBalanceMinor = totalBalance,
            accounts = accountSummaries,
            burn = burn,
            cashflow = cashflow,
            categories = categoryShares,
            topMerchants = merchants,
            recurring = recurring,
            savings = savings,
            safeToSpend = safeToSpend,
            needsReview = needsReview,
            lastUpdatedAt = now,
        )
    }

    /**
     * Average daily spend over the trailing window, ignoring transfers between
     * own accounts and anything the user flagged as a one-off.
     */
    fun burnRate(
        active: List<TransactionEntity>,
        totalBalanceMinor: Long,
        now: Long,
    ): BurnSummary {
        val from = now - BURN_WINDOW_DAYS * DAY_MS
        val counted = active.filter { transaction ->
            transaction.occurredAt >= from &&
                transaction.direction == TransactionDirection.DEBIT &&
                transaction.kind != TransactionKind.TRANSFER &&
                !transaction.excludedFromBurn
        }
        val spend = counted.sumOf { it.amountMinor }
        val earliest = counted.minOfOrNull { it.occurredAt } ?: from
        val days = max(1, ((now - earliest) / DAY_MS).toInt() + 1)
        val daily = spend / days
        val runway = if (daily > 0) totalBalanceMinor / daily else null
        return BurnSummary(
            dailyMinor = daily,
            monthlyMinor = daily * 30,
            runwayDays = runway,
            runwayMonths = runway?.takeIf { it >= 30 }?.div(30),
            spendMinor = spend,
            daysCounted = days,
        )
    }

    /** Income against spend, month by month over the range. */
    fun cashflow(
        spend: List<TransactionEntity>,
        income: List<TransactionEntity>,
        now: Long,
        rangeDays: Int,
    ): List<CashflowPoint> {
        val from = now - rangeDays * DAY_MS
        val buckets = LinkedHashMap<Long, Bucket>()
        TimeBuckets.monthBuckets(now, monthsIn(rangeDays)).forEach { buckets[it] = Bucket() }

        spend.filter { it.occurredAt >= from && it.isBurnableSpend() }
            .forEach { transaction ->
                buckets[TimeBuckets.monthStart(transaction.occurredAt)]
                    ?.let { it.spend += transaction.amountMinor }
            }
        income.filter { it.occurredAt >= from && it.kind != TransactionKind.TRANSFER }
            .forEach { transaction ->
                buckets[TimeBuckets.monthStart(transaction.occurredAt)]
                    ?.let { it.income += transaction.amountMinor }
            }
        return buckets.map { (start, bucket) ->
            CashflowPoint(
                periodStart = start,
                spendMinor = bucket.spend,
                incomeMinor = bucket.income,
                netMinor = bucket.income - bucket.spend,
            )
        }
    }

    private fun TransactionEntity.isBurnableSpend(): Boolean =
        direction == TransactionDirection.DEBIT &&
            kind != TransactionKind.TRANSFER &&
            !excludedFromBurn

    private class Bucket(var spend: Long = 0, var income: Long = 0)

    private fun monthsIn(rangeDays: Int): Int = max(2, (rangeDays / 30) + 1)

    /**
     * Where the money went, with the change against the same month before.
     */
    fun categoryBreakdown(
        spend: List<TransactionEntity>,
        categories: List<CategoryEntity>,
        now: Long,
    ): List<CategoryShare> {
        val thisMonth = monthStart(now)
        val lastMonth = thisMonth - 31 * DAY_MS
        val total = spend.filter { it.occurredAt >= thisMonth }.sumOf { it.amountMinor }

        val current = spend.filter { it.occurredAt >= thisMonth }.groupBy { it.categoryId }
        val previous = spend.filter { it.occurredAt in lastMonth until thisMonth }.groupBy { it.categoryId }

        return current
            .map { (categoryId, transactions) ->
                val amount = transactions.sumOf { it.amountMinor }
                val before = previous[categoryId]?.sumOf { it.amountMinor } ?: 0L
                CategoryShare(
                    categoryId = categoryId,
                    name = categories.firstOrNull { it.id == categoryId }?.name ?: "Uncategorised",
                    spendMinor = amount,
                    share = if (total > 0) amount.toFloat() / total else 0f,
                    changeMinor = amount - before,
                )
            }
            .sortedByDescending { it.spendMinor }
    }

    /** Merchants ranked by amount; the count is there for the other ranking. */
    fun topMerchants(
        spend: List<TransactionEntity>,
        merchantNames: Map<String, String>,
        limit: Int = 10,
    ): List<MerchantSummary> {
        val grouped = spend.groupBy { it.merchantId }
        return grouped
            .map { (merchantId, transactions) ->
                MerchantSummary(
                    merchantId = merchantId,
                    name = merchantId?.let { merchantNames[it] } ?: "Unknown merchant",
                    spendMinor = transactions.sumOf { it.amountMinor },
                    count = transactions.size,
                )
            }
            .sortedByDescending { it.spendMinor }
            .take(limit)
    }

    /**
     * Money the user could keep instead of spending it.
     *
     * Every part says where it came from, so the number can be argued with.
     */
    fun savingsPotential(
        active: List<TransactionEntity>,
        spend: List<TransactionEntity>,
        categories: List<CategoryEntity>,
        recurring: List<RecurringSummary>,
        now: Long,
    ): SavingsPotential {
        val items = mutableListOf<SavingsItem>()

        // (a) discretionary categories above the user's own trailing median.
        val thisMonth = monthStart(now)
        val pastMonths = TimeBuckets.monthBuckets(now, 4).filter { it < thisMonth }
        val byCategoryMonth = spend
            .filter { it.occurredAt >= pastMonths.first() }
            .groupBy { Pair(it.categoryId, monthStart(it.occurredAt)) }
        spend.filter { it.occurredAt >= thisMonth }
            .groupBy { it.categoryId }
            .forEach { (categoryId, transactions) ->
                val name = categories.firstOrNull { it.id == categoryId }?.name ?: "Uncategorised"
                val current = transactions.sumOf { it.amountMinor }
                val history = pastMonths.mapNotNull { byCategoryMonth[Pair(categoryId, it)] }
                    .map { month -> month.sumOf { it.amountMinor } }
                    .filter { it > 0 }
                if (history.size >= 2) {
                    val median = median(history)
                    if (current > median) {
                        items += SavingsItem(
                            source = "Category",
                            detail = "$name is above your usual",
                            amountMinor = current - median,
                        )
                    }
                }
            }

        // (b) recurring payments that went up, and ones that look duplicated.
        recurring.forEach { payment ->
            payment.priceIncreaseMinor?.let { increase ->
                items += SavingsItem(
                    source = "Subscription",
                    detail = "${payment.name} went up",
                    amountMinor = increase,
                )
            }
        }
        RecurringService.duplicates(recurring).forEach { (first, second) ->
            items += SavingsItem(
                source = "Duplicate",
                detail = "${first.name} and ${second.name} look like the same payment",
                amountMinor = first.amountMinor,
            )
        }

        // (c) fees and charges.
        val feesCategory = categories.firstOrNull { it.name.equals("Fees & Charges", true) }
        feesCategory?.let { fee ->
            val fees = spend.filter { it.categoryId == fee.id }.sumOf { it.amountMinor }
            if (fees > 0) {
                items += SavingsItem(
                    source = "Fees",
                    detail = "Fees and charges",
                    amountMinor = fees,
                )
            }
        }

        return SavingsPotential(
            totalMinor = items.sumOf { it.amountMinor },
            items = items.sortedByDescending { it.amountMinor },
        )
    }

    /**
     * What the user can spend today without touching the money that is
     * promised to upcoming bills. Shown only when there is something to say.
     */
    fun safeToSpend(
        totalBalanceMinor: Long,
        recurring: List<RecurringSummary>,
        now: Long,
        commitments: List<CommitmentEntity> = emptyList(),
        goals: List<GoalEntity> = emptyList(),
        bufferMinor: Long = 0,
        incomeDay: Int = 0,
    ): SafeToSpend? {
        if (totalBalanceMinor <= 0) return null
        val horizon = if (incomeDay > 0) nextIncomeDate(now, incomeDay) else monthStart(now) + 31 * DAY_MS
        val daysLeft = max(1, ((horizon - now) / DAY_MS).toInt())
        val dueCommitments = commitments
            .filter { it.status == CommitmentStatus.PENDING && it.dueAt in now..horizon }
            .sumOf { it.amountMinor }
        val dueRecurring = recurring
            .filter { it.nextExpectedAt != null && it.nextExpectedAt in now..horizon }
            .sumOf { it.amountMinor }
        val due = dueCommitments + dueRecurring
        val plannedSavings = goals.filter { it.status == GoalStatus.ACTIVE }.sumOf { it.monthlyContributionMinor }
        val breakdown = mutableListOf<SavingsItem>()
        breakdown += SavingsItem("Balance", "Money in your accounts", totalBalanceMinor)
        if (due > 0) breakdown += SavingsItem("Committed", "Bills due before the horizon", -due)
        if (plannedSavings > 0) breakdown += SavingsItem("Goals", "Planned savings", -plannedSavings)
        if (bufferMinor > 0) breakdown += SavingsItem("Buffer", "Emergency reserve", -bufferMinor)
        val free = totalBalanceMinor - due - plannedSavings - bufferMinor
        return SafeToSpend(
            todayMinor = if (free > 0) free / daysLeft else 0,
            weekMinor = if (free > 0) free / minOf(daysLeft, 7) else 0,
            daysLeft = daysLeft,
            breakdown = breakdown,
        )
    }

    private fun nextIncomeDate(now: Long, incomeDay: Int): Long {
        val cal = java.util.Calendar.getInstance()
        cal.timeInMillis = now
        cal.set(java.util.Calendar.DAY_OF_MONTH, incomeDay.coerceIn(1, 28))
        if (cal.timeInMillis <= now) cal.add(java.util.Calendar.MONTH, 1)
        return cal.timeInMillis
    }

    internal fun monthStart(timestamp: Long): Long = TimeBuckets.monthStart(timestamp)

    internal fun median(values: List<Long>): Long {
        if (values.isEmpty()) return 0
        val sorted = values.sorted()
        val middle = sorted.size / 2
        return if (sorted.size % 2 == 1) sorted[middle]
        else (sorted[middle - 1] + sorted[middle]) / 2
    }
}
