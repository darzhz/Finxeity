package com.localexpense.tracker.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * An immutable captured message (notification or SMS).
 *
 * Only [status], [dismissedAt] and [parseVersion] may ever change; the original
 * payload is preserved so that removing a read can also remove everything it
 * produced.
 */
@Entity(
    tableName = "raw_events",
    indices = [
        Index(value = ["notification_key", "content_hash"], unique = true),
        Index(value = ["posted_at"]),
        Index(value = ["status"]),
        Index(value = ["package_name"]),
    ],
)
data class RawEventEntity(
    @PrimaryKey val id: String,
    val source: RawEventSource,
    @ColumnInfo(name = "package_name") val packageName: String?,
    val sender: String?,
    @ColumnInfo(name = "notification_key") val notificationKey: String,
    val title: String?,
    val text: String?,
    @ColumnInfo(name = "big_text") val bigText: String?,
    @ColumnInfo(name = "text_lines") val textLines: String?,
    @ColumnInfo(name = "posted_at") val postedAt: Long,
    @ColumnInfo(name = "content_hash") val contentHash: String,
    val status: RawEventStatus,
    @ColumnInfo(name = "dismissed_at") val dismissedAt: Long? = null,
    @ColumnInfo(name = "parse_version") val parseVersion: Int = 0,
    /**
     * Set when this event turned out to be a second copy of an earlier one. The
     * transaction stays with the original, so removing either side has a clear
     * meaning.
     */
    @ColumnInfo(name = "duplicate_of") val duplicateOf: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: Long,
)

@Entity(
    tableName = "transactions",
    indices = [
        Index(value = ["raw_event_id"]),
        Index(value = ["account_id"]),
        Index(value = ["merchant_id"]),
        Index(value = ["category_id"]),
        Index(value = ["reference_id"]),
        Index(value = ["occurred_at"]),
        Index(value = ["status"]),
    ],
)
data class TransactionEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "raw_event_id") val rawEventId: String?,
    @ColumnInfo(name = "account_id") val accountId: String?,
    @ColumnInfo(name = "amount_minor") val amountMinor: Long,
    val direction: TransactionDirection,
    val kind: TransactionKind,
    @ColumnInfo(name = "refund_of_transaction_id") val refundOfTransactionId: String? = null,
    @ColumnInfo(name = "merchant_id") val merchantId: String?,
    @ColumnInfo(name = "category_id") val categoryId: String?,
    @ColumnInfo(name = "reference_id") val referenceId: String? = null,
    @ColumnInfo(name = "occurred_at") val occurredAt: Long,
    val confidence: Float,
    val status: TransactionStatus,
    val source: TransactionSource,
    @ColumnInfo(name = "excluded_from_burn") val excludedFromBurn: Boolean = false,
    @ColumnInfo(name = "excluded_from_budget") val excludedFromBudget: Boolean = false,
    val note: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: Long,
)

@Entity(tableName = "accounts")
data class AccountEntity(
    @PrimaryKey val id: String,
    val name: String,
    @ColumnInfo(name = "last_digits") val lastDigits: String?,
    val type: AccountType,
    @ColumnInfo(name = "anchor_balance_minor") val anchorBalanceMinor: Long,
    @ColumnInfo(name = "anchor_at") val anchorAt: Long,
    val currency: String,
    val archived: Boolean = false,
    @ColumnInfo(name = "created_at") val createdAt: Long,
)

@Entity(
    tableName = "balance_checkpoints",
    indices = [Index(value = ["account_id"]), Index(value = ["observed_at"])],
)
data class BalanceCheckpointEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "account_id") val accountId: String,
    @ColumnInfo(name = "balance_minor") val balanceMinor: Long,
    @ColumnInfo(name = "observed_at") val observedAt: Long,
    @ColumnInfo(name = "raw_event_id") val rawEventId: String?,
)

@Entity(
    tableName = "merchants",
    indices = [Index(value = ["normalized_name"], unique = true)],
)
data class MerchantEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "normalized_name") val normalizedName: String,
    @ColumnInfo(name = "display_name") val displayName: String,
    @ColumnInfo(name = "default_category_id") val defaultCategoryId: String? = null,
)

@Entity(
    tableName = "merchant_aliases",
    indices = [Index(value = ["merchant_id", "alias"], unique = true)],
)
data class MerchantAliasEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "merchant_id") val merchantId: String,
    val alias: String,
)

@Entity(tableName = "categories", indices = [Index(value = ["name"], unique = true)])
data class CategoryEntity(
    @PrimaryKey val id: String,
    val name: String,
    val kind: CategoryKind,
    val color: String? = null,
    val icon: String? = null,
    @ColumnInfo(name = "is_system") val isSystem: Boolean = false,
    @ColumnInfo(name = "sort_order") val sortOrder: Int = 0,
)

@Entity(tableName = "rules", indices = [Index(value = ["type"])])
data class RuleEntity(
    @PrimaryKey val id: String,
    val type: RuleType,
    @ColumnInfo(name = "package_name") val packageName: String? = null,
    @ColumnInfo(name = "sender_pattern") val senderPattern: String? = null,
    @ColumnInfo(name = "template_pattern") val templatePattern: String? = null,
    @ColumnInfo(name = "merchant_contains") val merchantContains: String? = null,
    @ColumnInfo(name = "category_id") val categoryId: String? = null,
    val enabled: Boolean = true,
    val priority: Int = 0,
    @ColumnInfo(name = "created_at") val createdAt: Long,
)

@Entity(tableName = "corrections", indices = [Index(value = ["transaction_id"])])
data class CorrectionEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "transaction_id") val transactionId: String?,
    val field: String,
    @ColumnInfo(name = "old_value") val oldValue: String?,
    @ColumnInfo(name = "new_value") val newValue: String?,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "retracted_at") val retractedAt: Long? = null,
)

@Entity(tableName = "recurring")
data class RecurringEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "merchant_id") val merchantId: String?,
    @ColumnInfo(name = "typical_amount_minor") val typicalAmountMinor: Long,
    val cadence: Cadence,
    @ColumnInfo(name = "next_expected_at") val nextExpectedAt: Long?,
    @ColumnInfo(name = "last_seen_at") val lastSeenAt: Long?,
    val status: RecurringStatus,
    val note: String? = null,
)

@Entity(tableName = "budgets")
data class BudgetEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "category_id") val categoryId: String?,
    val period: BudgetPeriod,
    @ColumnInfo(name = "limit_minor") val limitMinor: Long,
    val rollover: Boolean = false,
    @ColumnInfo(name = "alert_thresholds") val alertThresholds: String = "50,80,100",
    @ColumnInfo(name = "start_day") val startDay: Int = 1,
    val enabled: Boolean = true,
)

/**
 * One day of spending, kept so the dashboard does not have to walk every
 * transaction to answer "how much did I spend lately".
 */
@Entity(
    tableName = "daily_summaries",
    primaryKeys = ["account_id", "day_start"],
    indices = [Index(value = ["day_start"])],
)
data class DailySummaryEntity(
    @ColumnInfo(name = "account_id") val accountId: String,
    @ColumnInfo(name = "day_start") val dayStart: Long,
    @ColumnInfo(name = "spend_minor") val spendMinor: Long,
    @ColumnInfo(name = "income_minor") val incomeMinor: Long,
    @ColumnInfo(name = "transfer_minor") val transferMinor: Long,
    @ColumnInfo(name = "transaction_count") val transactionCount: Int,
    @ColumnInfo(name = "computed_at") val computedAt: Long,
)

@Entity(tableName = "commitments", indices = [Index(value = ["due_at"]), Index(value = ["status"])])
data class CommitmentEntity(
    @PrimaryKey val id: String,
    val name: String,
    @ColumnInfo(name = "amount_minor") val amountMinor: Long,
    @ColumnInfo(name = "due_at") val dueAt: Long,
    val recurrence: Cadence = Cadence.NONE,
    @ColumnInfo(name = "account_id") val accountId: String? = null,
    @ColumnInfo(name = "category_id") val categoryId: String? = null,
    val status: CommitmentStatus = CommitmentStatus.PENDING,
    @ColumnInfo(name = "paid_transaction_id") val paidTransactionId: String? = null,
    val note: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: Long,
)

@Entity(tableName = "goals", indices = [Index(value = ["status"])])
data class GoalEntity(
    @PrimaryKey val id: String,
    val name: String,
    @ColumnInfo(name = "target_minor") val targetMinor: Long,
    @ColumnInfo(name = "saved_minor") val savedMinor: Long = 0,
    @ColumnInfo(name = "target_date") val targetDate: Long? = null,
    @ColumnInfo(name = "monthly_contribution_minor") val monthlyContributionMinor: Long = 0,
    val priority: Int = 0,
    val status: GoalStatus = GoalStatus.ACTIVE,
    @ColumnInfo(name = "created_at") val createdAt: Long,
)
