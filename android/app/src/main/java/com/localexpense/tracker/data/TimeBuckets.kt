package com.localexpense.tracker.data

import java.util.Calendar

/**
 * Local day and month boundaries.
 *
 * The app buckets by the user's own calendar, not by UTC, so a transaction at
 * 11pm lands in the day the user thinks it did.
 */
object TimeBuckets {

    fun dayStart(timestamp: Long): Long {
        val calendar = Calendar.getInstance()
        calendar.timeInMillis = timestamp
        calendar.set(Calendar.HOUR_OF_DAY, 0)
        calendar.set(Calendar.MINUTE, 0)
        calendar.set(Calendar.SECOND, 0)
        calendar.set(Calendar.MILLISECOND, 0)
        return calendar.timeInMillis
    }

    fun monthStart(timestamp: Long): Long {
        val calendar = Calendar.getInstance()
        calendar.timeInMillis = timestamp
        calendar.set(Calendar.DAY_OF_MONTH, 1)
        calendar.set(Calendar.HOUR_OF_DAY, 0)
        calendar.set(Calendar.MINUTE, 0)
        calendar.set(Calendar.SECOND, 0)
        calendar.set(Calendar.MILLISECOND, 0)
        return calendar.timeInMillis
    }

    /** The month starts, oldest first, ending with the month of [now]. */
    fun monthBuckets(now: Long, months: Int): List<Long> {
        val calendar = Calendar.getInstance()
        calendar.timeInMillis = monthStart(now)
        calendar.set(Calendar.DAY_OF_MONTH, 1)
        val buckets = mutableListOf<Long>()
        repeat(months) {
            buckets += calendar.timeInMillis
            calendar.add(Calendar.MONTH, -1)
        }
        return buckets.reversed()
    }
}
