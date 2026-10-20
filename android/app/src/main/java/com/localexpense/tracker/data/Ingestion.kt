package com.localexpense.tracker.data

import androidx.room.withTransaction
import com.localexpense.tracker.data.entity.AccountEntity
import com.localexpense.tracker.data.entity.AccountType
import com.localexpense.tracker.data.entity.BalanceCheckpointEntity
import com.localexpense.tracker.data.entity.MerchantEntity
import com.localexpense.tracker.data.entity.RawEventEntity
import com.localexpense.tracker.data.entity.RawEventStatus
import com.localexpense.tracker.data.entity.RuleType
import com.localexpense.tracker.data.entity.TransactionEntity
import com.localexpense.tracker.data.entity.TransactionSource
import com.localexpense.tracker.data.entity.TransactionStatus
import com.localexpense.tracker.parse.MerchantNormalizer
import com.localexpense.tracker.parse.MessageType
import com.localexpense.tracker.parse.ParsedMessage
import com.localexpense.tracker.parse.TransactionParser
import java.util.UUID

/** What happened to one captured message. */
sealed interface IngestionOutcome {
    data class Created(val transaction: TransactionEntity) : IngestionOutcome

    data class NeedsReview(val parsed: ParsedMessage) : IngestionOutcome

    data class Ignored(val type: MessageType) : IngestionOutcome

    /** The message was a second copy of [originalRawEventId]. */
    data class Duplicate(val originalRawEventId: String) : IngestionOutcome

    object Skipped : IngestionOutcome
}

/**
 * Turns captured messages into transactions.
 *
 * The order matters: raw events are already stored, so this only ever adds
 * derived rows. A transaction is created only when the parse is confident
 * enough; anything shakier waits in the review queue.
 */
class IngestionPipeline(private val database: AppDatabase) {

    private val rawEventDao = database.rawEventDao()
    private val transactionDao = database.transactionDao()
    private val merchantDao = database.merchantDao()
    private val ruleDao = database.ruleDao()
    private val accountDao = database.accountDao()
    private val checkpointDao = database.balanceCheckpointDao()

    suspend fun ingest(event: RawEventEntity): IngestionOutcome {
        if (event.status != RawEventStatus.CAPTURED) return IngestionOutcome.Skipped

        val text = event.bigText?.takeIf { it.isNotBlank() }
            ?: event.text?.takeIf { it.isNotBlank() }
            ?: event.textLines
            ?: event.title
            ?: ""

        if (isIgnored(event, text)) {
            mark(event, RawEventStatus.IGNORED)
            return IngestionOutcome.Ignored(MessageType.OTHER)
        }

        val parsed = TransactionParser.parse(
            packageName = event.packageName,
            sender = event.sender,
            title = event.title,
            body = event.bigText?.takeIf { it.isNotBlank() } ?: event.text,
        )

        if (!parsed.isTransactionCandidate) {
            if (parsed.type == MessageType.BALANCE_ONLY) {
                storeCheckpoint(event, parsed)
            }
            mark(event, RawEventStatus.IGNORED)
            return IngestionOutcome.Ignored(parsed.type)
        }

        if (parsed.amountMinor == null) {
            mark(event, RawEventStatus.NEEDS_REVIEW)
            return IngestionOutcome.NeedsReview(parsed)
        }

        val duplicate = findDuplicate(parsed, event.postedAt)
        if (duplicate != null) {
            database.withTransaction {
                rawEventDao.updateParse(
                    id = event.id,
                    status = RawEventStatus.PARSED,
                    parseVersion = TransactionParser.PARSE_VERSION,
                    duplicateOf = duplicate.rawEventId,
                )
            }
            return IngestionOutcome.Duplicate(duplicate.rawEventId ?: event.id)
        }

        val merchant = resolveMerchant(parsed)
        val categoryId = categorize(event, parsed, merchant)
        val account = linkAccount(parsed)

        if (parsed.confidence < TransactionParser.CONFIDENCE_THRESHOLD) {
            mark(event, RawEventStatus.NEEDS_REVIEW)
            return IngestionOutcome.NeedsReview(parsed)
        }

        val transaction = TransactionEntity(
            id = UUID.randomUUID().toString(),
            rawEventId = event.id,
            accountId = account?.id,
            amountMinor = parsed.amountMinor,
            direction = parsed.direction
                ?: com.localexpense.tracker.data.entity.TransactionDirection.DEBIT,
            kind = parsed.kind
                ?: com.localexpense.tracker.data.entity.TransactionKind.SPEND,
            refundOfTransactionId = null,
            merchantId = merchant?.id,
            categoryId = categoryId,
            referenceId = parsed.referenceId,
            occurredAt = event.postedAt,
            confidence = parsed.confidence,
            status = TransactionStatus.ACTIVE,
            source = TransactionSource.AUTO,
            excludedFromBurn = false,
            excludedFromBudget = false,
            note = null,
            createdAt = System.currentTimeMillis(),
        )

        database.withTransaction {
            transactionDao.insert(transaction)
            rawEventDao.updateParse(
                id = event.id,
                status = RawEventStatus.PARSED,
                parseVersion = TransactionParser.PARSE_VERSION,
                duplicateOf = null,
            )
        }

        storeCheckpoint(event, parsed, account)
        return IngestionOutcome.Created(transaction)
    }

    private suspend fun mark(event: RawEventEntity, status: RawEventStatus) {
        database.withTransaction {
            rawEventDao.updateParse(
                id = event.id,
                status = status,
                parseVersion = TransactionParser.PARSE_VERSION,
                duplicateOf = event.duplicateOf,
            )
        }
    }

    /** True when a user rule says messages like this one are not interesting. */
    private suspend fun isIgnored(event: RawEventEntity, text: String): Boolean {
        val rules = ruleDao.listEnabled(RuleType.IGNORE.name)
        return rules.any { rule ->
            val hasConstraint = rule.packageName != null ||
                rule.senderPattern != null ||
                rule.templatePattern != null
            if (!hasConstraint) return@any false
            if (rule.packageName != null && rule.packageName != event.packageName) return@any false
            if (rule.senderPattern != null) {
                val sender = event.sender
                if (sender == null || !sender.contains(rule.senderPattern, ignoreCase = true)) {
                    return@any false
                }
            }
            if (rule.templatePattern != null) {
                val matches = runCatching {
                    Regex(rule.templatePattern, RegexOption.IGNORE_CASE).containsMatchIn(text)
                }.getOrDefault(false)
                if (!matches) return@any false
            }
            true
        }
    }

    /**
     * Finds the transaction this message repeats.
     *
     * A reference id is conclusive. Otherwise the same amount and direction
     * inside a short window is a duplicate when the merchant matches, or when
     * the messages arrived within seconds of each other.
     */
    private suspend fun findDuplicate(parsed: ParsedMessage, occurredAt: Long): TransactionEntity? {
        val amount = parsed.amountMinor ?: return null
        val direction = parsed.direction ?: return null

        parsed.referenceId?.let { reference ->
            transactionDao.findByReferenceId(reference)?.let { return it }
        }

        val candidates = transactionDao.findSimilar(
            amountMinor = amount,
            direction = direction.name,
            from = occurredAt - MERCHANT_WINDOW_MS,
            to = occurredAt + MERCHANT_WINDOW_MS,
        )
        for (candidate in candidates) {
            if (candidate.rawEventId == null) continue
            val candidateMerchant = candidate.merchantId?.let { merchantDao.getById(it) }
            val gap = kotlin.math.abs(candidate.occurredAt - occurredAt)
            val bothNamed = parsed.merchant != null && candidateMerchant != null
            if (bothNamed) {
                if (MerchantNormalizer.matches(parsed.merchant!!, candidateMerchant!!.displayName)) {
                    return candidate
                }
            } else if (gap <= ANONYMOUS_WINDOW_MS) {
                return candidate
            }
        }
        return null
    }

    /** Finds or creates the merchant row behind a parsed name. */
    private suspend fun resolveMerchant(parsed: ParsedMessage): MerchantEntity? =
        Merchants.resolve(merchantDao, parsed.merchant)

    /** User rules first, then the merchant dictionary. */
    private suspend fun categorize(
        event: RawEventEntity,
        parsed: ParsedMessage,
        merchant: MerchantEntity?,
    ): String? {
        val rules = ruleDao.listEnabled(RuleType.CATEGORY.name)
        for (rule in rules) {
            if (rule.packageName != null && rule.packageName != event.packageName) continue
            if (rule.merchantContains != null) {
                val name = merchant?.displayName ?: parsed.merchant
                if (name == null || !name.contains(rule.merchantContains, ignoreCase = true)) {
                    continue
                }
            }
            if (rule.senderPattern != null) {
                val sender = event.sender
                if (sender == null || !sender.contains(rule.senderPattern, ignoreCase = true)) {
                    continue
                }
            }
            return rule.categoryId
        }
        return merchant?.defaultCategoryId
    }

    /** Links a transaction to the account it belongs to, when we can tell. */
    private suspend fun linkAccount(parsed: ParsedMessage): AccountEntity? {
        if (parsed.wallet != null) {
            // The money moved through a wallet, not through a bank account, so
            // it must not move a bank balance. A tracked wallet can take it.
            return accountDao.list().firstOrNull { it.type == AccountType.WALLET }
        }
        return Accounts.link(accountDao, parsed.accountDigits)
    }

    /** Remembers a balance seen in a message so drift can be detected later. */
    private suspend fun storeCheckpoint(
        event: RawEventEntity,
        parsed: ParsedMessage,
        account: AccountEntity? = null,
    ) {
        val balance = parsed.balanceMinor ?: return
        if (parsed.wallet != null) return
        val resolved = account ?: linkAccount(parsed) ?: return
        checkpointDao.insert(
            BalanceCheckpointEntity(
                id = UUID.randomUUID().toString(),
                accountId = resolved.id,
                balanceMinor = balance,
                observedAt = event.postedAt,
                rawEventId = event.id,
            ),
        )
    }

    companion object {
        /** Two messages with the same merchant this close together are the same spend. */
        const val MERCHANT_WINDOW_MS = 5 * 60 * 1000L

        /** Without a merchant name only near simultaneous messages collapse. */
        const val ANONYMOUS_WINDOW_MS = 2 * 60 * 1000L
    }
}
