package com.localexpense.tracker.accounts

import com.localexpense.tracker.capture.ExtractedNotification
import com.localexpense.tracker.data.entity.AccountEntity
import com.localexpense.tracker.data.entity.TransactionDirection
import com.localexpense.tracker.data.entity.TransactionStatus
import com.localexpense.tracker.parse.AmountParser

/** Minimal transaction view needed to derive a balance. */
data class BalanceInput(
    val occurredAt: Long,
    val amountMinor: Long,
    val direction: TransactionDirection,
    val status: TransactionStatus,
)

/** A balance row detected in a notification, not yet confirmed by the user. */
data class ProposedAccount(
    val packageName: String,
    val lastDigits: String,
    val balanceMinor: Long?,
    val sourceText: String,
)

/** An account together with the balance derived from its transactions. */
data class AccountBalance(
    val account: AccountEntity,
    val derivedBalanceMinor: Long,
)

object BalanceService {

    /**
     * Derived balance = anchor + signed sum of active transactions after the anchor.
     * This is the single rule that makes removals propagate to every balance view.
     */
    fun derivedBalance(
        anchorBalanceMinor: Long,
        anchorAt: Long,
        transactions: List<BalanceInput>,
    ): Long {
        val delta = transactions
            .asSequence()
            .filter { it.status == TransactionStatus.ACTIVE }
            .filter { it.occurredAt > anchorAt }
            .sumOf { tx ->
                when (tx.direction) {
                    TransactionDirection.DEBIT -> -tx.amountMinor
                    TransactionDirection.CREDIT -> tx.amountMinor
                }
            }
        return anchorBalanceMinor + delta
    }

    private val accountDigitsRegex = Regex(
        "(?i)(?:a/c|acct|account|card|xx+|ending(?:\\s+with)?|last)\\D{0,8}(\\d{4})(?!\\d)",
    )

    private val balanceRegex = Regex(
        "(?i)(?:bal(?:ance)?|avail(?:able)?)\\D{0,12}?(?:rs\\.?|inr|₹)?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)",
    )

    /**
     * Best-effort detection of an account and current balance from messages that
     * happen to be visible at onboarding time. Always confirmed by the user.
     */
    fun proposeAccounts(messages: List<ExtractedNotification>): List<ProposedAccount> {
        return messages.mapNotNull { message ->
            val haystack = buildString {
                message.title?.let { append(it).append(' ') }
                message.body?.let { append(it).append(' ') }
            }.trim()
            val digits = accountDigitsRegex.find(haystack)?.groupValues?.get(1) ?: return@mapNotNull null
            val balance = balanceRegex.find(haystack)?.groupValues?.get(1)?.let(::parseAmountMinor)
            ProposedAccount(
                packageName = message.packageName,
                lastDigits = digits,
                balanceMinor = balance,
                sourceText = haystack,
            )
        }.distinctBy { it.packageName to it.lastDigits }
    }

    /** Parses "1,234.50", "1234", "₹1,23,456.00" into paise. */
    fun parseAmountMinor(raw: String): Long? = AmountParser.parseToMinor(raw)
}
