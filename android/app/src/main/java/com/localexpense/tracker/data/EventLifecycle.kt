package com.localexpense.tracker.data

import androidx.room.withTransaction
import com.localexpense.tracker.data.entity.BalanceCheckpointEntity
import com.localexpense.tracker.data.entity.CorrectionEntity
import com.localexpense.tracker.data.entity.RawEventEntity
import com.localexpense.tracker.data.entity.RawEventStatus
import com.localexpense.tracker.data.entity.RuleEntity
import com.localexpense.tracker.data.entity.RuleType
import com.localexpense.tracker.data.entity.TransactionDirection
import com.localexpense.tracker.data.entity.TransactionEntity
import com.localexpense.tracker.data.entity.TransactionKind
import com.localexpense.tracker.data.entity.TransactionSource
import com.localexpense.tracker.data.entity.TransactionStatus
import com.localexpense.tracker.parse.MessageTemplate
import com.localexpense.tracker.parse.ParsedMessage
import com.localexpense.tracker.parse.TransactionParser
import java.util.UUID

/** What a change to a captured message produced. */
sealed interface EventChange {
    data class Dismissed(val voidedTransactionIds: List<String>) : EventChange

    data class Restored(val transaction: TransactionEntity?) : EventChange

    data class Promoted(val transaction: TransactionEntity) : EventChange

    data class Corrected(val transaction: TransactionEntity) : EventChange

    data class RuleCreated(val rule: RuleEntity) : EventChange

    data class Reprocessed(val transaction: TransactionEntity?) : EventChange

    object NotFound : EventChange

    object Unchanged : EventChange
}

/** The values a user may change on a transaction. */
data class TransactionPatch(
    val amountMinor: Long? = null,
    val categoryId: String? = null,
    val merchantName: String? = null,
    val note: String? = null,
    val occurredAt: Long? = null,
    val kind: TransactionKind? = null,
)

/**
 * Everything the user can do to a captured message after the fact.
 *
 * The raw message is never touched. Removing, restoring and promoting all
 * rebuild the derived state from the message that was stored, so a restore
 * returns the app to exactly where it was.
 */
class EventLifecycle(private val database: AppDatabase) {

    private val rawEventDao = database.rawEventDao()
    private val transactionDao = database.transactionDao()
    private val merchantDao = database.merchantDao()
    private val ruleDao = database.ruleDao()
    private val accountDao = database.accountDao()
    private val checkpointDao = database.balanceCheckpointDao()
    private val correctionDao = database.correctionDao()

    /**
     * Removes a read and undoes everything it caused: the transaction is
     * voided, the corrections the user made on it are retracted so the
     * classifier does not learn from it, and the balance checkpoints it
     * produced are dropped.
     */
    suspend fun dismiss(rawEventId: String): EventChange {
        val event = rawEventDao.getById(rawEventId) ?: return EventChange.NotFound
        if (event.status == RawEventStatus.DISMISSED) return EventChange.Unchanged

        return database.withTransaction {
            val now = System.currentTimeMillis()
            val voided = transactionDao.listByRawEvent(rawEventId)
                .filter { it.status == TransactionStatus.ACTIVE }
            if (voided.isNotEmpty()) {
                transactionDao.voidByRawEvent(rawEventId)
                voided.forEach { correctionDao.retractByTransaction(it.id, now) }
            }
            checkpointDao.deleteByRawEvent(rawEventId)
            rawEventDao.updateStatus(rawEventId, RawEventStatus.DISMISSED, now)
            dismissDuplicates(rawEventId, now)
            EventChange.Dismissed(voided.map { it.id })
        }
    }

    /**
     * Undoes a removal. The message is parsed again, the transaction it made is
     * reactivated and the checkpoints are restored.
     */
    suspend fun restore(rawEventId: String): EventChange {
        val event = rawEventDao.getById(rawEventId) ?: return EventChange.NotFound
        if (event.status != RawEventStatus.DISMISSED) return EventChange.Unchanged

        return database.withTransaction {
            val transactions = transactionDao.listByRawEvent(rawEventId)
            transactions.forEach { transaction ->
                transactionDao.restoreById(transaction.id)
                correctionDao.unretractByTransaction(transaction.id)
            }
            restoreDuplicates(rawEventId)

            val parsed = reparse(event)
            val status = statusFor(parsed, transactions.isNotEmpty())
            rawEventDao.updateParse(
                id = rawEventId,
                status = status,
                parseVersion = TransactionParser.PARSE_VERSION,
                duplicateOf = event.duplicateOf,
            )
            storeCheckpoint(event, parsed)
            EventChange.Restored(transactions.firstOrNull())
        }
    }

    /**
     * Turns a message the parser skipped into a transaction by hand.
     */
    suspend fun promote(
        rawEventId: String,
        kind: TransactionKind,
        amountMinor: Long?,
        merchantName: String?,
        categoryId: String?,
    ): EventChange {
        val event = rawEventDao.getById(rawEventId) ?: return EventChange.NotFound
        val parsed = reparse(event)
        val amount = amountMinor ?: parsed.amountMinor
        if (amount == null || amount <= 0) return EventChange.Unchanged

        val direction = when (kind) {
            TransactionKind.INCOME, TransactionKind.REFUND -> TransactionDirection.CREDIT
            else -> TransactionDirection.DEBIT
        }
        val merchant = Merchants.resolve(merchantDao, merchantName ?: parsed.merchant)
        val account = Accounts.link(accountDao, parsed.accountDigits, parsed.wallet)

        val transaction = TransactionEntity(
            id = UUID.randomUUID().toString(),
            rawEventId = event.id,
            accountId = account?.id,
            amountMinor = amount,
            direction = direction,
            kind = kind,
            refundOfTransactionId = null,
            merchantId = merchant?.id,
            categoryId = categoryId,
            referenceId = parsed.referenceId,
            occurredAt = event.postedAt,
            confidence = 1f,
            status = TransactionStatus.ACTIVE,
            source = TransactionSource.MANUAL,
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
                duplicateOf = event.duplicateOf,
            )
        }
        return EventChange.Promoted(transaction)
    }

    /**
     * Confirms a message that waited in the review queue.
     */
    suspend fun confirm(
        rawEventId: String,
        amountMinor: Long?,
        merchantName: String?,
        categoryId: String?,
    ): EventChange {
        val event = rawEventDao.getById(rawEventId) ?: return EventChange.NotFound
        val parsed = reparse(event)
        val kind = parsed.kind ?: TransactionKind.SPEND
        val amount = amountMinor ?: parsed.amountMinor
        if (amount == null || amount <= 0) return EventChange.Unchanged

        val direction = parsed.direction
            ?: if (kind == TransactionKind.INCOME || kind == TransactionKind.REFUND) {
                TransactionDirection.CREDIT
            } else {
                TransactionDirection.DEBIT
            }
        val merchant = Merchants.resolve(merchantDao, merchantName ?: parsed.merchant)
        val account = Accounts.link(accountDao, parsed.accountDigits, parsed.wallet)

        val transaction = TransactionEntity(
            id = UUID.randomUUID().toString(),
            rawEventId = event.id,
            accountId = account?.id,
            amountMinor = amount,
            direction = direction,
            kind = kind,
            refundOfTransactionId = null,
            merchantId = merchant?.id,
            categoryId = categoryId,
            referenceId = parsed.referenceId,
            occurredAt = event.postedAt,
            confidence = parsed.confidence.coerceAtLeast(TransactionParser.CONFIDENCE_THRESHOLD),
            status = TransactionStatus.ACTIVE,
            source = TransactionSource.MANUAL,
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
                duplicateOf = event.duplicateOf,
            )
        }
        return EventChange.Promoted(transaction)
    }

    /**
     * Applies a user correction to a transaction and remembers what changed, so
     * the classifier can learn from it later.
     */
    suspend fun correct(transactionId: String, patch: TransactionPatch): EventChange {
        val existing = transactionDao.getById(transactionId) ?: return EventChange.NotFound

        val merchant = if (patch.merchantName != null) {
            Merchants.resolve(merchantDao, patch.merchantName)
        } else {
            existing.merchantId?.let { merchantDao.getById(it) }
        }

        return database.withTransaction {
            val now = System.currentTimeMillis()
            if (patch.amountMinor != null && patch.amountMinor != existing.amountMinor) {
                record(transactionId, "amount", existing.amountMinor.toString(), patch.amountMinor.toString(), now)
                transactionDao.updateAmount(transactionId, patch.amountMinor)
            }
            if (patch.categoryId != null && patch.categoryId != existing.categoryId) {
                record(transactionId, "category", existing.categoryId, patch.categoryId, now)
                transactionDao.updateCategory(transactionId, patch.categoryId)
            }
            if (patch.merchantName != null && merchant?.id != existing.merchantId) {
                record(transactionId, "merchant", existing.merchantId, merchant?.id, now)
                transactionDao.updateMerchant(transactionId, merchant?.id)
            }
            if (patch.note != null && patch.note != existing.note) {
                record(transactionId, "note", existing.note, patch.note, now)
                transactionDao.updateNote(transactionId, patch.note)
            }
            if (patch.occurredAt != null && patch.occurredAt != existing.occurredAt) {
                record(transactionId, "occurredAt", existing.occurredAt.toString(), patch.occurredAt.toString(), now)
                transactionDao.updateOccurredAt(transactionId, patch.occurredAt)
            }
            if (patch.kind != null && patch.kind != existing.kind) {
                record(transactionId, "kind", existing.kind.name, patch.kind.name, now)
                transactionDao.updateKind(transactionId, patch.kind.name)
            }
            EventChange.Corrected(transactionDao.getById(transactionId) ?: existing)
        }
    }

    /**
     * Writes a rule so that messages like this one stop becoming transactions.
     */
    suspend fun createIgnoreRule(rawEventId: String): EventChange {
        val event = rawEventDao.getById(rawEventId) ?: return EventChange.NotFound
        val text = event.bigText?.takeIf { it.isNotBlank() }
            ?: event.text?.takeIf { it.isNotBlank() }
            ?: event.textLines
            ?: event.title
            ?: ""
        val pattern = MessageTemplate.derive(text)
        if (pattern.isEmpty()) return EventChange.Unchanged

        val rule = RuleEntity(
            id = UUID.randomUUID().toString(),
            type = RuleType.IGNORE,
            packageName = event.packageName,
            senderPattern = event.sender,
            templatePattern = pattern,
            merchantContains = null,
            categoryId = null,
            enabled = true,
            priority = 100,
            createdAt = System.currentTimeMillis(),
        )
        ruleDao.upsert(rule)
        return EventChange.RuleCreated(rule)
    }

    /**
     * What the user changed on the transaction of a message, so a reparse can
     * carry those choices over to the new transaction.
     */
    suspend fun correctionsFor(rawEventId: String): Map<String, String?> {
        val transactions = transactionDao.listByRawEvent(rawEventId)
        return transactions
            .flatMap { correctionDao.listByTransaction(it.id) }
            .associate { it.field to it.newValue }
    }

    /** The name behind a merchant id, used when a correction is carried over. */
    suspend fun merchantName(merchantId: String?): String? =
        merchantId?.let { merchantDao.getById(it)?.displayName }

    /**
     * Drops the transaction a message made, so the message can be parsed again
     * from scratch.
     */
    suspend fun clearTransaction(rawEventId: String) {
        database.withTransaction {
            transactionDao.voidByRawEvent(rawEventId)
            checkpointDao.deleteByRawEvent(rawEventId)
            rawEventDao.updateStatus(rawEventId, RawEventStatus.CAPTURED, null)
        }
    }

    /** Hard deletes a message and everything that came from it. */
    suspend fun deletePermanently(rawEventId: String): EventChange {
        val event = rawEventDao.getById(rawEventId) ?: return EventChange.NotFound
        database.withTransaction {
            transactionDao.listByRawEvent(rawEventId).forEach { transaction ->
                correctionDao.deleteByTransaction(transaction.id)
            }
            transactionDao.deleteByRawEvent(rawEventId)
            checkpointDao.deleteByRawEvent(rawEventId)
            rawEventDao.listDuplicates(rawEventId).forEach { duplicate ->
                checkpointDao.deleteByRawEvent(duplicate.id)
                rawEventDao.deleteById(duplicate.id)
            }
            rawEventDao.deleteById(rawEventId)
        }
        return EventChange.Dismissed(emptyList())
    }

    private suspend fun record(
        transactionId: String,
        field: String,
        oldValue: String?,
        newValue: String?,
        now: Long,
    ) {
        correctionDao.insert(
            CorrectionEntity(
                id = UUID.randomUUID().toString(),
                transactionId = transactionId,
                field = field,
                oldValue = oldValue,
                newValue = newValue,
                createdAt = now,
                retractedAt = null,
            ),
        )
    }

    private suspend fun dismissDuplicates(rawEventId: String, now: Long) {
        rawEventDao.listDuplicates(rawEventId).forEach { duplicate ->
            checkpointDao.deleteByRawEvent(duplicate.id)
            rawEventDao.updateStatus(duplicate.id, RawEventStatus.DISMISSED, now)
        }
    }

    private suspend fun restoreDuplicates(rawEventId: String) {
        rawEventDao.listDuplicates(rawEventId).forEach { duplicate ->
            rawEventDao.updateStatus(duplicate.id, RawEventStatus.PARSED, null)
        }
    }

    private fun reparse(event: RawEventEntity): ParsedMessage = TransactionParser.parse(
        packageName = event.packageName,
        sender = event.sender,
        title = event.title,
        body = event.bigText?.takeIf { it.isNotBlank() } ?: event.text,
    )

    private fun statusFor(parsed: ParsedMessage, hasTransaction: Boolean): RawEventStatus = when {
        hasTransaction -> RawEventStatus.PARSED
        parsed.isTransactionCandidate -> RawEventStatus.NEEDS_REVIEW
        else -> RawEventStatus.IGNORED
    }

    private suspend fun storeCheckpoint(event: RawEventEntity, parsed: ParsedMessage) {
        val balance = parsed.balanceMinor ?: return
        val account = Accounts.link(accountDao, parsed.accountDigits, parsed.wallet) ?: return
        checkpointDao.insert(
            BalanceCheckpointEntity(
                id = UUID.randomUUID().toString(),
                accountId = account.id,
                balanceMinor = balance,
                observedAt = event.postedAt,
                rawEventId = event.id,
            ),
        )
    }
}
