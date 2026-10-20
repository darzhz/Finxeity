package com.localexpense.tracker.data

data class WhatIfResult(
    val newTotalBalanceMinor: Long,
    val newSafeToSpendTodayMinor: Long?,
)

object WhatIfService {
    fun apply(
        dashboard: Dashboard,
        extraExpenseMinor: Long,
        commitments: List<com.localexpense.tracker.data.entity.CommitmentEntity> = emptyList(),
        goals: List<com.localexpense.tracker.data.entity.GoalEntity> = emptyList(),
        bufferMinor: Long = 0,
        incomeDay: Int = 0,
        now: Long,
    ): WhatIfResult {
        val newBalance = dashboard.totalBalanceMinor - extraExpenseMinor
        val safe = DashboardService.safeToSpend(
            totalBalanceMinor = newBalance,
            recurring = dashboard.recurring,
            now = now,
            commitments = commitments,
            goals = goals,
            bufferMinor = bufferMinor,
            incomeDay = incomeDay,
        )
        return WhatIfResult(newBalance, safe?.todayMinor)
    }
}
