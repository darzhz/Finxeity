package com.localexpense.tracker.data

import com.localexpense.tracker.accounts.AccountBalance
import com.localexpense.tracker.accounts.BalanceInput
import com.localexpense.tracker.accounts.BalanceService
import com.localexpense.tracker.capture.ExtractedNotification
import com.localexpense.tracker.capture.NotificationExtractor
import com.localexpense.tracker.data.entity.AccountEntity
import com.localexpense.tracker.data.entity.BudgetEntity
import com.localexpense.tracker.data.entity.CommitmentEntity
import com.localexpense.tracker.data.entity.GoalEntity
import com.localexpense.tracker.data.entity.AccountType
import com.localexpense.tracker.data.entity.Cadence
import com.localexpense.tracker.data.entity.MerchantEntity
import com.localexpense.tracker.data.entity.RawEventEntity
import com.localexpense.tracker.data.entity.RawEventSource
import com.localexpense.tracker.data.entity.RawEventStatus
import com.localexpense.tracker.data.entity.RecurringEntity
import com.localexpense.tracker.data.entity.RecurringStatus
import com.localexpense.tracker.data.entity.RuleEntity
import com.localexpense.tracker.data.entity.TransactionEntity
import com.localexpense.tracker.data.entity.TransactionKind
import com.localexpense.tracker.settings.AppSettings
import kotlinx.coroutines.flow.first
import java.util.UUID

/**
 * The only write path into the native core. Keeps the plugin and the listener
 * from reaching into DAOs directly.
 */
class Repo(
    private val database: AppDatabase,
    private val settings: AppSettings,
) {

    private val ingestion = IngestionPipeline(database)

    private val lifecycle = EventLifecycle(database)

    /** Live allowlist, consumed by the notification listener. */
    val monitoredPackagesFlow: kotlinx.coroutines.flow.Flow<Set<String>> =
        settings.monitoredPackages

    /**
     * Persists a captured message verbatim. Returns null when an identical
     * message (same notification key and content hash) already exists.
     */
    suspend fun recordRawEvent(
        extracted: ExtractedNotification,
        source: RawEventSource,
    ): RawEventEntity? {
        val hash = NotificationExtractor.contentHash(extracted)
        val entity = RawEventEntity(
            id = UUID.randomUUID().toString(),
            source = source,
            packageName = extracted.packageName,
            sender = if (source == RawEventSource.SMS) extracted.title else null,
            notificationKey = extracted.notificationKey,
            title = extracted.title,
            text = extracted.text,
            bigText = extracted.bigText,
            textLines = extracted.textLines.takeIf { it.isNotEmpty() }?.joinToString("\n"),
            postedAt = extracted.postedAt,
            contentHash = hash,
            status = RawEventStatus.CAPTURED,
            createdAt = System.currentTimeMillis(),
        )
        val rowId = database.rawEventDao().insert(entity)
        if (rowId == -1L) return null
        settings.setLastEventAt(extracted.postedAt)
        return entity
    }

    /** Interprets a stored message and turns it into a transaction if it is one. */
    suspend fun ingest(event: RawEventEntity): IngestionOutcome {
        val outcome = ingestion.ingest(event)
        if (outcome is IngestionOutcome.Created) {
            markTransactionsChanged()
        }
        return outcome
    }

    /** Stored messages that have not been interpreted yet. */
    suspend fun pendingRawEvents(limit: Int = 200): List<RawEventEntity> =
        database.rawEventDao().listByStatus(RawEventStatus.CAPTURED, limit)

    /**
     * Runs the parser again over messages that were never interpreted and over
     * the ones that waited for review. Used after the parsing rules change.
     */
    suspend fun reparsePending(limit: Int = 500): Int {
        val pending = database.rawEventDao().listByStatus(RawEventStatus.CAPTURED, limit)
        val waiting = database.rawEventDao().listByStatus(RawEventStatus.NEEDS_REVIEW, limit)
        (pending + waiting).forEach { reprocess(it) }
        return pending.size + waiting.size
    }

    /**
     * Parses one message again from scratch. The transaction it made is
     * replaced, but the corrections the user made on it are carried over.
     */
    suspend fun reprocess(event: RawEventEntity): EventChange {
        val corrections = lifecycle.correctionsFor(event.id)
        lifecycle.clearTransaction(event.id)
        val outcome = ingestion.ingest(
            event.copy(
                status = RawEventStatus.CAPTURED,
                dismissedAt = null,
                duplicateOf = null,
            ),
        )
        if (outcome is IngestionOutcome.Created) {
            val patch = TransactionPatch(
                amountMinor = corrections["amount"]?.toLongOrNull(),
                categoryId = corrections["category"],
                merchantName = lifecycle.merchantName(corrections["merchant"]),
                note = corrections["note"],
            )
            if (patch.amountMinor != null ||
                patch.categoryId != null ||
                patch.merchantName != null ||
                patch.note != null
            ) {
                lifecycle.correct(outcome.transaction.id, patch)
            }
        }
        return when (outcome) {
            is IngestionOutcome.Created -> EventChange.Reprocessed(outcome.transaction)
            else -> EventChange.Reprocessed(null)
        }
    }

    /**
     * Parses every stored message again, so a change in the rules reaches the
     * transactions that were already created.
     */
    suspend fun reparseAll(limit: Int = 2000): Int {
        val events = database.rawEventDao().listByStatus(RawEventStatus.PARSED, limit)
        events.forEach { reprocess(it) }
        return events.size
    }

    suspend fun listRawEvents(
        status: String?,
        source: String?,
        cursorPostedAt: Long?,
        cursorId: String?,
        limit: Int,
    ): List<RawEventEntity> =
        if (cursorPostedAt == null || cursorId == null) {
            database.rawEventDao().list(status, source, limit)
        } else {
            database.rawEventDao().listAfter(status, source, cursorPostedAt, cursorId, limit)
        }

    suspend fun countRawEvents(status: String? = null): Int =
        database.rawEventDao().count(status)

    // --- Transactions -------------------------------------------------------------

    suspend fun listTransactions(
        status: String?,
        direction: String?,
        categoryId: String?,
        from: Long?,
        to: Long?,
        cursorOccurredAt: Long?,
        cursorId: String?,
        limit: Int,
    ): List<TransactionEntity> =
        if (cursorOccurredAt == null || cursorId == null) {
            database.transactionDao().list(status, direction, categoryId, from, to, limit)
        } else {
            database.transactionDao().listAfter(
                status, direction, categoryId, from, to, cursorOccurredAt, cursorId, limit,
            )
        }

    suspend fun countTransactions(status: String? = null): Int =
        database.transactionDao().count(status)

    suspend fun transaction(id: String): TransactionEntity? =
        database.transactionDao().getById(id)

    suspend fun merchant(id: String): MerchantEntity? =
        database.merchantDao().getById(id)

    suspend fun merchantByName(normalizedName: String): MerchantEntity? =
        database.merchantDao().getByNormalizedName(normalizedName)

    suspend fun rawEvent(id: String): RawEventEntity? =
        database.rawEventDao().getById(id)

    suspend fun transactionsForEvent(rawEventId: String): List<TransactionEntity> =
        database.transactionDao().listByRawEvent(rawEventId)

    suspend fun latestEventAt(): Long? = database.rawEventDao().latestPostedAt()

    suspend fun monitoredPackages(): Set<String> = settings.monitoredPackages.first()

    suspend fun setMonitoredPackages(packages: Set<String>) {
        settings.setMonitoredPackages(packages)
    }

    // --- Manual transactions ---------------------------------------------------------

    suspend fun createManualTransaction(
        amountMinor: Long,
        direction: com.localexpense.tracker.data.entity.TransactionDirection,
        kind: com.localexpense.tracker.data.entity.TransactionKind,
        accountId: String?,
        categoryId: String?,
        merchantName: String?,
        occurredAt: Long,
        note: String?,
    ): com.localexpense.tracker.data.entity.TransactionEntity {
        val merchantId = merchantName?.let { name ->
            val normalized = name.trim().lowercase()
            database.merchantDao().getByNormalizedName(normalized)?.id
                ?: run {
                    val id = java.util.UUID.randomUUID().toString()
                    database.merchantDao().upsert(
                        com.localexpense.tracker.data.entity.MerchantEntity(
                            id = id,
                            normalizedName = normalized,
                            displayName = name.trim(),
                        ),
                    )
                    id
                }
        }
        val entity = com.localexpense.tracker.data.entity.TransactionEntity(
            id = java.util.UUID.randomUUID().toString(),
            rawEventId = null,
            accountId = accountId,
            amountMinor = amountMinor,
            direction = direction,
            kind = kind,
            merchantId = merchantId,
            categoryId = categoryId,
            occurredAt = occurredAt,
            confidence = 1f,
            status = com.localexpense.tracker.data.entity.TransactionStatus.ACTIVE,
            source = com.localexpense.tracker.data.entity.TransactionSource.MANUAL,
            note = note,
            createdAt = System.currentTimeMillis(),
        )
        database.transactionDao().insert(entity)
        markTransactionsChanged()
        return entity
    }

    // --- Accounts -----------------------------------------------------------------

    suspend fun listAccounts(): List<AccountEntity> = database.accountDao().list()

    /**
     * Every account with the balance derived from its active transactions.
     * This is the number the dashboard shows; the anchor alone would ignore
     * everything that happened since onboarding.
     */
    suspend fun accountBalances(): List<AccountBalance> =
        database.accountDao().list().map { account ->
            val transactions = database.transactionDao()
                .listActiveForAccount(account.id, account.anchorAt)
            val inputs = transactions.map {
                BalanceInput(it.occurredAt, it.amountMinor, it.direction, it.status)
            }
            AccountBalance(
                account = account,
                derivedBalanceMinor = BalanceService.derivedBalance(
                    anchorBalanceMinor = account.anchorBalanceMinor,
                    anchorAt = account.anchorAt,
                    transactions = inputs,
                ),
            )
        }

    suspend fun upsertAccount(
        id: String?,
        name: String,
        lastDigits: String?,
        type: AccountType,
        balanceMinor: Long,
        anchorAt: Long,
        currency: String,
    ): AccountEntity {
        val existing = id?.let { database.accountDao().getById(it) }
        val entity = AccountEntity(
            id = existing?.id ?: id ?: UUID.randomUUID().toString(),
            name = name,
            lastDigits = lastDigits,
            type = type,
            anchorBalanceMinor = balanceMinor,
            anchorAt = anchorAt,
            currency = currency,
            archived = false,
            createdAt = existing?.createdAt ?: System.currentTimeMillis(),
        )
        database.accountDao().upsert(entity)
        return entity
    }

    suspend fun deleteAccount(id: String) = database.accountDao().deleteById(id)

    suspend fun accountCount(): Int = database.accountDao().count()

    suspend fun categories() = database.categoryDao().list()

    // --- Rules -----------------------------------------------------------------------

    suspend fun listRules(): List<RuleEntity> = database.ruleDao().listAll()

    suspend fun deleteRule(id: String) = database.ruleDao().deleteById(id)

    // --- Recurring -------------------------------------------------------------------

    /**
     * The payments that come round again, with the user's own verdict on each
     * one. A payment the user ignored stays out of the way.
     */
    suspend fun listRecurring(): List<RecurringSummary> {
        val active = database.transactionDao().listActive()
        val merchantNames = database.merchantDao().listAll()
            .associate { it.id to it.displayName }
        val detected = RecurringService.detect(active, merchantNames)
        val stored = database.recurringDao().list().associateBy { it.id }
        val ignored = stored.values
            .filter { it.status == RecurringStatus.IGNORED }
            .map { it.id }
            .toSet()

        val merged = detected.map { summary ->
            val row = stored[summary.merchantId]
            summary.copy(
                status = row?.status ?: RecurringStatus.SUGGESTED,
                confirmed = row?.status == RecurringStatus.CONFIRMED,
            )
        }
        val known = merged.map { it.merchantId }.toSet()
        val extra = stored.values
            .filter { it.id !in known && it.status != RecurringStatus.IGNORED }
            .map { row ->
                RecurringSummary(
                    merchantId = row.merchantId,
                    name = row.merchantId?.let { merchantNames[it] } ?: "Unknown merchant",
                    amountMinor = row.typicalAmountMinor,
                    cadence = row.cadence,
                    nextExpectedAt = row.nextExpectedAt,
                    lastSeenAt = row.lastSeenAt,
                    priceIncreaseMinor = null,
                    status = row.status,
                    confirmed = row.status == RecurringStatus.CONFIRMED,
                )
            }
        return (merged + extra)
            .filter { it.merchantId !in ignored }
            .sortedBy { it.nextExpectedAt ?: Long.MAX_VALUE }
    }

    /** Remembers what the user decided about a recurring payment. */
    suspend fun setRecurringStatus(
        merchantId: String,
        status: RecurringStatus,
    ): RecurringEntity? {
        val existing = database.recurringDao().getByMerchant(merchantId)
        val row = existing ?: RecurringEntity(
            id = merchantId,
            merchantId = merchantId,
            typicalAmountMinor = 0,
            cadence = Cadence.MONTHLY,
            nextExpectedAt = null,
            lastSeenAt = null,
            status = status,
            note = null,
        )
        database.recurringDao().upsert(row.copy(status = status))
        return database.recurringDao().getById(row.id)
    }

    // --- Editing and removal ---------------------------------------------------------

    suspend fun dismissEvent(rawEventId: String): EventChange = lifecycle.dismiss(rawEventId)

    suspend fun restoreEvent(rawEventId: String): EventChange = lifecycle.restore(rawEventId)

    suspend fun deleteRawEvent(rawEventId: String): EventChange =
        lifecycle.deletePermanently(rawEventId)

    suspend fun createIgnoreRule(rawEventId: String): EventChange =
        lifecycle.createIgnoreRule(rawEventId)

    suspend fun promoteEvent(
        rawEventId: String,
        kind: TransactionKind,
        amountMinor: Long?,
        merchantName: String?,
        categoryId: String?,
    ): EventChange = lifecycle.promote(rawEventId, kind, amountMinor, merchantName, categoryId)

    suspend fun confirmEvent(
        rawEventId: String,
        amountMinor: Long?,
        merchantName: String?,
        categoryId: String?,
    ): EventChange = lifecycle.confirm(rawEventId, amountMinor, merchantName, categoryId)

    suspend fun correctTransaction(
        transactionId: String,
        patch: TransactionPatch,
    ): EventChange = lifecycle.correct(transactionId, patch)

    // --- Commitments -----------------------------------------------------------------

    suspend fun listCommitments(): List<CommitmentEntity> = database.commitmentDao().list()

    suspend fun upsertCommitment(commitment: CommitmentEntity) =
        database.commitmentDao().upsert(commitment)

    suspend fun deleteCommitment(id: String) = database.commitmentDao().deleteById(id)

    suspend fun setCommitmentStatus(id: String, status: com.localexpense.tracker.data.entity.CommitmentStatus) =
        database.commitmentDao().updateStatus(id, status)

    // --- Goals -----------------------------------------------------------------------

    suspend fun listGoals(): List<GoalEntity> = database.goalDao().list()

    suspend fun upsertGoal(goal: GoalEntity) = database.goalDao().upsert(goal)

    suspend fun deleteGoal(id: String) = database.goalDao().deleteById(id)

    suspend fun setGoalStatus(id: String, status: com.localexpense.tracker.data.entity.GoalStatus) =
        database.goalDao().updateStatus(id, status)

    // --- Budgets ---------------------------------------------------------------------

    suspend fun listBudgets(): List<BudgetEntity> = database.budgetDao().list()

    suspend fun upsertBudget(budget: BudgetEntity) = database.budgetDao().upsert(budget)

    suspend fun deleteBudget(id: String) = database.budgetDao().deleteById(id)

    // --- Dashboard -------------------------------------------------------------------

    /**
     * Every number the dashboard shows, derived from the active transactions.
     */
    suspend fun dashboard(rangeDays: Int = 180): Dashboard {
        val active = database.transactionDao().listActive()
        val merchantNames = database.merchantDao().listAll()
            .associate { it.id to it.displayName }
        val ignored = database.recurringDao().list()
            .filter { it.status == RecurringStatus.IGNORED }
            .map { it.id }
            .toSet()
        return DashboardService.build(
            transactions = active,
            accounts = database.accountDao().list(),
            categories = database.categoryDao().list(),
            merchantNames = merchantNames,
            needsReview = database.rawEventDao().count("NEEDS_REVIEW"),
            now = System.currentTimeMillis(),
            rangeDays = rangeDays,
            ignoredRecurring = ignored,
            cache = summaryCache(),
            commitments = database.commitmentDao().list(),
            goals = database.goalDao().list(),
            bufferMinor = settings.bufferMinor.first(),
            incomeDay = settings.incomeDay.first(),
        )
    }

    /**
     * The cached daily aggregates, and whether they still match the
     * transactions. A stale cache is simply not used.
     */
    suspend fun summaryCache(): SummaryCache {
        val computedAt = settings.summariesComputedAt.first()
        val changedAt = settings.lastTransactionChangeAt.first()
        val summaries = database.dailySummaryDao().listAll()
        return SummaryCache(
            summaries = summaries,
            fresh = computedAt > 0 && computedAt >= changedAt && summaries.isNotEmpty(),
        )
    }

    /** Rebuilds the daily summaries from the active transactions. */
    suspend fun refreshSummaries(): Int {
        val now = System.currentTimeMillis()
        val summaries = SummaryService.compute(database.transactionDao().listActive(), now)
        database.dailySummaryDao().deleteAll()
        database.dailySummaryDao().insertAll(summaries)
        settings.setSummariesComputedAt(now)
        return summaries.size
    }

    /** Remembers the detected recurring payments, keeping the user's verdict. */
    suspend fun refreshRecurring(): Int {
        val active = database.transactionDao().listActive()
        val merchantNames = database.merchantDao().listAll()
            .associate { it.id to it.displayName }
        val detected = RecurringService.detect(active, merchantNames)
        val stored = database.recurringDao().list().associateBy { it.id }
        detected.forEach { summary ->
            val merchantId = summary.merchantId ?: return@forEach
            val existing = stored[merchantId]
            database.recurringDao().upsert(
                RecurringEntity(
                    id = merchantId,
                    merchantId = merchantId,
                    typicalAmountMinor = summary.amountMinor,
                    cadence = summary.cadence,
                    nextExpectedAt = summary.nextExpectedAt,
                    lastSeenAt = summary.lastSeenAt,
                    status = existing?.status ?: RecurringStatus.SUGGESTED,
                    note = existing?.note,
                ),
            )
        }
        return detected.size
    }

    /**
     * Called whenever a transaction changes, so the cache is known to be stale
     * until the worker has run again.
     */
    suspend fun markTransactionsChanged() {
        settings.setLastTransactionChangeAt(System.currentTimeMillis())
    }
}
