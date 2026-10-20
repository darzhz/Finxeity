package com.localexpense.tracker.data

import com.localexpense.tracker.data.entity.Cadence
import com.localexpense.tracker.data.entity.TransactionDirection
import com.localexpense.tracker.data.entity.TransactionEntity
import com.localexpense.tracker.data.entity.TransactionStatus
import kotlin.math.abs
import kotlin.math.roundToLong

/**
 * Finds the payments that come round again and again.
 *
 * A merchant counts as recurring when it shows up often enough, at roughly the
 * same interval, for roughly the same amount. That is deliberately simple:
 * the app has no idea what a subscription is, only what it sees.
 */
object RecurringService {

    private const val DAY_MS = 24L * 60 * 60 * 1000

    /** How many payments a merchant needs before the pattern is believable. */
    const val MIN_OCCURRENCES = 3

    /** How far an interval may sit from the average and still count. */
    private const val TOLERANCE = 0.35

    /** A price change below this is noise, not a price rise. */
    private const val PRICE_CHANGE_THRESHOLD = 0.05

    fun detect(
        active: List<TransactionEntity>,
        merchantNames: Map<String, String>,
        now: Long = System.currentTimeMillis(),
    ): List<RecurringSummary> {
        val spend = active.filter {
            it.status == TransactionStatus.ACTIVE &&
                it.direction == TransactionDirection.DEBIT &&
                it.merchantId != null
        }
        return spend
            .groupBy { it.merchantId!! }
            .mapNotNull { (merchantId, transactions) ->
                detectOne(merchantId, transactions, merchantNames[merchantId] ?: "Unknown merchant")
            }
            .sortedBy { it.nextExpectedAt ?: Long.MAX_VALUE }
    }

    private fun detectOne(
        merchantId: String,
        transactions: List<TransactionEntity>,
        name: String,
    ): RecurringSummary? {
        if (transactions.size < MIN_OCCURRENCES) return null
        val sorted = transactions.sortedBy { it.occurredAt }
        val intervals = sorted.zipWithNext { first, second ->
            (second.occurredAt - first.occurredAt) / DAY_MS
        }.filter { it > 0 }
        if (intervals.size < MIN_OCCURRENCES - 1) return null

        val average = intervals.average()
        val regular = intervals.count { abs(it - average) <= average * TOLERANCE }
        if (regular < intervals.size - 1) return null

        val cadence = cadenceFor(average) ?: return null
        val amounts = sorted.map { it.amountMinor }
        val typical = DashboardService.median(amounts.takeLast(3))
        // What you pay now against what you used to pay.
        val recent = amounts.last()
        val earlier = DashboardService.median(amounts.dropLast(1))
        val increase = if (earlier > 0 && recent > earlier) {
            val difference = recent - earlier
            if (difference.toDouble() / earlier >= PRICE_CHANGE_THRESHOLD) difference else null
        } else {
            null
        }

        val last = sorted.last()
        val next = last.occurredAt + (average * DAY_MS).roundToLong()

        return RecurringSummary(
            merchantId = merchantId,
            name = name,
            amountMinor = typical,
            cadence = cadence,
            nextExpectedAt = next,
            lastSeenAt = last.occurredAt,
            priceIncreaseMinor = increase,
        )
    }

    /**
     * Two recurring payments of the same size landing on the same day are
     * usually one payment counted twice, or a second subscription nobody
     * remembered.
     */
    fun duplicates(recurring: List<RecurringSummary>): List<Pair<RecurringSummary, RecurringSummary>> {
        val pairs = mutableListOf<Pair<RecurringSummary, RecurringSummary>>()
        recurring.forEachIndexed { index, first ->
            recurring.drop(index + 1).forEach { second ->
                if (first.amountMinor == second.amountMinor &&
                    first.cadence == second.cadence &&
                    first.nextExpectedAt != null &&
                    second.nextExpectedAt != null &&
                    abs(first.nextExpectedAt - second.nextExpectedAt) <= 2 * DAY_MS
                ) {
                    pairs += first to second
                }
            }
        }
        return pairs
    }

    private fun cadenceFor(averageDays: Double): Cadence? = when {
        averageDays < 4 -> null
        averageDays < 10 -> Cadence.WEEKLY
        averageDays < 20 -> Cadence.FORTNIGHTLY
        averageDays < 48 -> Cadence.MONTHLY
        averageDays < 130 -> Cadence.QUARTERLY
        averageDays < 220 -> Cadence.HALF_YEARLY
        averageDays < 420 -> Cadence.YEARLY
        else -> null
    }
}
