package com.localexpense.tracker.data

import com.localexpense.tracker.data.entity.TransactionEntity
import com.localexpense.tracker.data.entity.TransactionDirection
import com.localexpense.tracker.data.entity.TransactionKind
import com.localexpense.tracker.data.entity.TransactionStatus

data class SpendingPace(
    val currentMinor: Long,
    val typicalMinor: Long,
    val projectedMonthEndMinor: Long,
)

object SpendingPaceService {
    fun compute(transactions: List<TransactionEntity>, now: Long): SpendingPace {
        val active = transactions.filter { it.status == TransactionStatus.ACTIVE && it.direction == TransactionDirection.DEBIT && it.kind != TransactionKind.TRANSFER }
        val monthStart = DashboardService.monthStart(now)
        val current = active.filter { it.occurredAt >= monthStart }.sumOf { it.amountMinor }
        val dayOfMonth = java.util.Calendar.getInstance().apply { timeInMillis = now }.get(java.util.Calendar.DAY_OF_MONTH).coerceAtLeast(1)
        val daysInMonth = 30
        val projected = current.toLong() * daysInMonth / dayOfMonth
        return SpendingPace(current, current, projected)
    }
}
