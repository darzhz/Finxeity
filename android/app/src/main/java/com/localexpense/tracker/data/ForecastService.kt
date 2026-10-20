package com.localexpense.tracker.data

import com.localexpense.tracker.data.entity.CommitmentEntity
import com.localexpense.tracker.data.entity.CommitmentStatus
import java.util.Calendar

data class ForecastPoint(
    val dayStart: Long,
    val balanceMinor: Long,
)

data class Forecast(
    val points: List<ForecastPoint>,
    val minBalanceMinor: Long,
    val endBalanceMinor: Long,
)

object ForecastService {
    const val DAY_MS = 24L * 60 * 60 * 1000

    fun build(
        totalBalanceMinor: Long,
        dailySpendMinor: Long,
        commitments: List<CommitmentEntity>,
        incomeDay: Int,
        expectedIncomeMinor: Long,
        now: Long,
        days: Int = 31,
    ): Forecast {
        val points = mutableListOf<ForecastPoint>()
        var balance = totalBalanceMinor
        val horizon = if (incomeDay > 0) daysUntilIncome(now, incomeDay).coerceAtLeast(1) else days
        val cal = Calendar.getInstance()
        for (i in 0..horizon) {
            cal.timeInMillis = now + i * DAY_MS
            cal.set(Calendar.HOUR_OF_DAY, 0); cal.set(Calendar.MINUTE, 0); cal.set(Calendar.SECOND, 0); cal.set(Calendar.MILLISECOND, 0)
            val dayStart = cal.timeInMillis
            if (i > 0) {
                balance -= dailySpendMinor
                commitments.filter { it.status == CommitmentStatus.PENDING && isSameDay(it.dueAt, dayStart) }.forEach { balance -= it.amountMinor }
                if (incomeDay > 0 && cal.get(Calendar.DAY_OF_MONTH) == incomeDay) balance += expectedIncomeMinor
            }
            points += ForecastPoint(dayStart, balance)
        }
        val min = points.minOf { it.balanceMinor }
        return Forecast(points, min, points.last().balanceMinor)
    }

    private fun daysUntilIncome(now: Long, incomeDay: Int): Int {
        val cal = Calendar.getInstance()
        cal.timeInMillis = now
        cal.set(Calendar.DAY_OF_MONTH, incomeDay.coerceIn(1, 28))
        if (cal.timeInMillis <= now) cal.add(Calendar.MONTH, 1)
        return ((cal.timeInMillis - now) / DAY_MS).toInt().coerceIn(1, 62)
    }

    private fun isSameDay(a: Long, b: Long): Boolean {
        val ca = Calendar.getInstance().apply { timeInMillis = a }
        val cb = Calendar.getInstance().apply { timeInMillis = b }
        return ca.get(Calendar.YEAR) == cb.get(Calendar.YEAR) &&
            ca.get(Calendar.DAY_OF_YEAR) == cb.get(Calendar.DAY_OF_YEAR)
    }
}
