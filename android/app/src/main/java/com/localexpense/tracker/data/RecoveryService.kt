package com.localexpense.tracker.data

data class RecoveryPlan(
    val shortfallMinor: Long,
    val weeklyReductionMinor: Long,
    val weeksToRecover: Int,
)

object RecoveryService {
    fun plan(shortfallMinor: Long, weeks: Int = 4): RecoveryPlan {
        val w = if (weeks <= 0) 1 else weeks
        val weekly = if (shortfallMinor <= 0) 0 else (shortfallMinor + w - 1) / w
        return RecoveryPlan(shortfallMinor, weekly, w)
    }
}
