package com.localexpense.tracker.data.entity

/** Where a raw event came from. */
enum class RawEventSource {
    NOTIFICATION,
    SMS,
}

/**
 * Lifecycle of a captured message. [CAPTURED] means "persisted verbatim, not yet
 * interpreted"; the parser (a later milestone) moves it to one of the others.
 */
enum class RawEventStatus {
    CAPTURED,
    PARSED,
    IGNORED,
    NEEDS_REVIEW,
    DISMISSED,
}

enum class TransactionDirection {
    DEBIT,
    CREDIT,
}

enum class TransactionKind {
    SPEND,
    INCOME,
    REFUND,
    TRANSFER,
}

enum class TransactionStatus {
    ACTIVE,
    VOIDED,
}

enum class TransactionSource {
    AUTO,
    MANUAL,
}

enum class AccountType {
    BANK,
    CARD,
    WALLET,
    CASH,
    OTHER,
}

enum class CategoryKind {
    EXPENSE,
    INCOME,
    TRANSFER,
}

enum class RuleType {
    IGNORE,
    CATEGORY,
}

enum class RecurringStatus {
    SUGGESTED,
    CONFIRMED,
    IGNORED,
}

enum class Cadence {
    NONE,
    WEEKLY,
    FORTNIGHTLY,
    MONTHLY,
    QUARTERLY,
    HALF_YEARLY,
    YEARLY,
    IRREGULAR,
}

enum class BudgetPeriod {
    WEEKLY,
    MONTHLY,
    QUARTERLY,
    YEARLY,
}

enum class ListenerState {
    UNKNOWN,
    DISCONNECTED,
    CONNECTED,
}


enum class CommitmentStatus {
    PENDING,
    PAID,
    OVERDUE,
    CANCELLED,
}

enum class GoalStatus {
    ACTIVE,
    PAUSED,
    COMPLETED,
}
