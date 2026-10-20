package com.localexpense.tracker.parse

import com.localexpense.tracker.data.entity.TransactionDirection
import com.localexpense.tracker.data.entity.TransactionKind

/** What kind of message a captured text turned out to be. */
enum class MessageType {
    SPEND,
    CREDIT,
    BALANCE_ONLY,
    OTP,
    PROMO,
    OTHER;

    /** Only spends and credits can become transactions. */
    fun isTransactionType(): Boolean = this == SPEND || this == CREDIT
}

/**
 * The interpretation of one captured message.
 *
 * Every field is optional on purpose: a partial parse is still useful, it just
 * carries a lower confidence and ends up in the review queue instead of becoming
 * a transaction.
 */
data class ParsedMessage(
    val type: MessageType,
    val amountMinor: Long? = null,
    val direction: TransactionDirection? = null,
    val kind: TransactionKind? = null,
    val merchant: String? = null,
    val accountDigits: String? = null,
    val balanceMinor: Long? = null,
    val referenceId: String? = null,
    val confidence: Float = 0f,
    val templateId: String? = null,
    /** Set when the money moved through a wallet rather than a bank account. */
    val wallet: String? = null,
) {
    val isTransactionCandidate: Boolean
        get() = type == MessageType.SPEND || type == MessageType.CREDIT

    /** A candidate only counts as a transaction when we also know the amount. */
    val isComplete: Boolean
        get() = isTransactionCandidate && amountMinor != null && amountMinor > 0

    companion object {
        fun ignored(type: MessageType, confidence: Float = 0.95f) =
            ParsedMessage(type = type, confidence = confidence)
    }
}
