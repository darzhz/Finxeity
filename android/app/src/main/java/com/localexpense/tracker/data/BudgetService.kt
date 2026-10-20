package com.localexpense.tracker.data

import com.localexpense.tracker.data.entity.BudgetEntity
import com.localexpense.tracker.data.entity.TransactionEntity
import com.localexpense.tracker.data.entity.TransactionDirection
import com.localexpense.tracker.data.entity.TransactionKind
import com.localexpense.tracker.data.entity.TransactionStatus

data class BudgetProgress(
    val budget: BudgetEntity,
    val spentMinor: Long,
    val remainingMinor: Long,
    val projectedOverspendMinor: Long,
)

object BudgetService {
    fun progress(
        budgets: List<BudgetEntity>,
        transactions: List<TransactionEntity>,
        now: Long,
    ): List<BudgetProgress> {
        val active = transactions.filter { it.status == TransactionStatus.ACTIVE && it.direction == TransactionDirection.DEBIT }
        return budgets.filter { it.enabled }.map { budget ->
            val spent = active
                .filter { budget.categoryId == null || it.categoryId == budget.categoryId }
                .sumOf { it.amountMinor }
            BudgetProgress(
                budget = budget,
                spentMinor = spent,
                remainingMinor = budget.limitMinor - spent,
                projectedOverspendMinor = if (spent > budget.limitMinor) spent - budget.limitMinor else 0,
            )
        }
    }
}
