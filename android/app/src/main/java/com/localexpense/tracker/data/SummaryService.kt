package com.localexpense.tracker.data

import com.localexpense.tracker.data.entity.DailySummaryEntity
import com.localexpense.tracker.data.entity.TransactionDirection
import com.localexpense.tracker.data.entity.TransactionEntity
import com.localexpense.tracker.data.entity.TransactionKind
import com.localexpense.tracker.data.entity.TransactionStatus

/**
 * The cached daily aggregates the dashboard reads instead of walking every
 * transaction.
 *
 * The cache is only used when it is newer than the last change to the
 * transactions, so a stale cache can never show a wrong number.
 */
object SummaryService {

    const val DAY_MS = 24L * 60 * 60 * 1000

    /**
     * One row per account and day.
     *
     * The spend is the money that actually went out: transfers between own
     * accounts and one-off items the user flagged are left out, the same way
     * the burn rate leaves them out.
     */
    fun compute(
        transactions: List<TransactionEntity>,
        now: Long,
    ): List<DailySummaryEntity> {
        val computedAt = now
        val rows = transactions
            .filter { it.status == TransactionStatus.ACTIVE }
            .groupBy { Pair(it.accountId ?: "none", TimeBuckets.dayStart(it.occurredAt)) }

        return rows.map { (key, entries) ->
            val (accountId, dayStart) = key
            val spend = entries.filter { it.isBurnableSpend() }
            val income = entries.filter {
                it.direction == TransactionDirection.CREDIT && it.kind != TransactionKind.TRANSFER
            }
            val transfers = entries.filter { it.kind == TransactionKind.TRANSFER }
            DailySummaryEntity(
                accountId = accountId,
                dayStart = dayStart,
                spendMinor = spend.sumOf { it.amountMinor },
                incomeMinor = income.sumOf { it.amountMinor },
                transferMinor = transfers.sumOf { it.amountMinor },
                transactionCount = spend.size,
                computedAt = computedAt,
            )
        }
    }

    private fun TransactionEntity.isBurnableSpend(): Boolean =
        direction == TransactionDirection.DEBIT &&
            kind != TransactionKind.TRANSFER &&
            !excludedFromBurn

    /**
     * The burn rate from the cached days. It has to agree with the version
     * computed from the transactions, or the cache is not worth having.
     */
    fun burnFromSummaries(
        summaries: List<DailySummaryEntity>,
        totalBalanceMinor: Long,
        now: Long,
        windowDays: Int = DashboardService.BURN_WINDOW_DAYS,
    ): BurnSummary {
        val from = now - windowDays * DAY_MS
        val inWindow = summaries.filter { it.dayStart >= from && it.dayStart <= now }
        val spend = inWindow.sumOf { it.spendMinor }
        val earliest = inWindow.filter { it.transactionCount > 0 }.minOfOrNull { it.dayStart }
            ?: inWindow.minOfOrNull { it.dayStart }
            ?: from
        val days = maxOf(1, ((now - earliest) / DAY_MS).toInt() + 1)
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

    /** The cashflow from the cached days. */
    fun cashflowFromSummaries(
        summaries: List<DailySummaryEntity>,
        now: Long,
        rangeDays: Int,
    ): List<CashflowPoint> {
        val from = now - rangeDays * DAY_MS
        val buckets = LinkedHashMap<Long, Pair<Long, Long>>()
        TimeBuckets.monthBuckets(now, maxOf(2, rangeDays / 30 + 1)).forEach { buckets[it] = 0L to 0L }
        summaries.filter { it.dayStart >= from }.forEach { summary ->
            val key = TimeBuckets.monthStart(summary.dayStart)
            val current = buckets[key] ?: return@forEach
            buckets[key] = (current.first + summary.spendMinor) to (current.second + summary.incomeMinor)
        }
        return buckets.map { (start, values) ->
            CashflowPoint(
                periodStart = start,
                spendMinor = values.first,
                incomeMinor = values.second,
                netMinor = values.second - values.first,
            )
        }
    }
}
