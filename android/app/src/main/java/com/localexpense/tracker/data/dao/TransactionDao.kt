package com.localexpense.tracker.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.localexpense.tracker.data.entity.TransactionEntity

@Dao
interface TransactionDao {

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(transaction: TransactionEntity): Long

    @Query("SELECT * FROM transactions WHERE id = :id")
    suspend fun getById(id: String): TransactionEntity?

    @Query("SELECT * FROM transactions WHERE raw_event_id = :rawEventId")
    suspend fun listByRawEvent(rawEventId: String): List<TransactionEntity>

    @Query(
        """
        SELECT * FROM transactions
        WHERE (:status IS NULL OR status = :status)
          AND (:direction IS NULL OR direction = :direction)
          AND (:categoryId IS NULL OR category_id = :categoryId)
          AND (:from IS NULL OR occurred_at >= :from)
          AND (:to IS NULL OR occurred_at <= :to)
        ORDER BY occurred_at DESC, id DESC
        LIMIT :limit
        """,
    )
    suspend fun list(
        status: String?,
        direction: String?,
        categoryId: String?,
        from: Long?,
        to: Long?,
        limit: Int,
    ): List<TransactionEntity>

    @Query(
        """
        SELECT * FROM transactions
        WHERE (:status IS NULL OR status = :status)
          AND (:direction IS NULL OR direction = :direction)
          AND (:categoryId IS NULL OR category_id = :categoryId)
          AND (:from IS NULL OR occurred_at >= :from)
          AND (:to IS NULL OR occurred_at <= :to)
          AND (occurred_at < :beforeOccurredAt
               OR (occurred_at = :beforeOccurredAt AND id < :beforeId))
        ORDER BY occurred_at DESC, id DESC
        LIMIT :limit
        """,
    )
    suspend fun listAfter(
        status: String?,
        direction: String?,
        categoryId: String?,
        from: Long?,
        to: Long?,
        beforeOccurredAt: Long,
        beforeId: String,
        limit: Int,
    ): List<TransactionEntity>

    @Query("SELECT * FROM transactions WHERE status = 'ACTIVE' ORDER BY occurred_at DESC")
    suspend fun listActive(): List<TransactionEntity>

    @Query("SELECT COUNT(*) FROM transactions WHERE (:status IS NULL OR status = :status)")
    suspend fun count(status: String? = null): Int

    /**
     * Candidates for cross source dedupe: same amount and direction inside a
     * time window.
     */
    @Query(
        """
        SELECT * FROM transactions
        WHERE status = 'ACTIVE'
          AND amount_minor = :amountMinor
          AND direction = :direction
          AND occurred_at BETWEEN :from AND :to
        """,
    )
    suspend fun findSimilar(
        amountMinor: Long,
        direction: String,
        from: Long,
        to: Long,
    ): List<TransactionEntity>

    @Query("SELECT * FROM transactions WHERE status = 'ACTIVE' AND reference_id = :referenceId LIMIT 1")
    suspend fun findByReferenceId(referenceId: String): TransactionEntity?

    @Query(
        """
        SELECT * FROM transactions
        WHERE account_id = :accountId AND status = 'ACTIVE' AND occurred_at > :since
        ORDER BY occurred_at ASC
        """,
    )
    suspend fun listActiveForAccount(accountId: String, since: Long): List<TransactionEntity>

    @Query("UPDATE transactions SET status = 'VOIDED' WHERE raw_event_id = :rawEventId AND status = 'ACTIVE'")
    suspend fun voidByRawEvent(rawEventId: String): Int

    @Query("DELETE FROM transactions WHERE raw_event_id = :rawEventId")
    suspend fun deleteByRawEvent(rawEventId: String): Int

    @Query("UPDATE transactions SET status = 'ACTIVE' WHERE id = :id AND status = 'VOIDED'")
    suspend fun restoreById(id: String): Int

    @Query("UPDATE transactions SET category_id = :categoryId WHERE id = :id")
    suspend fun updateCategory(id: String, categoryId: String?)

    @Query("UPDATE transactions SET amount_minor = :amountMinor WHERE id = :id")
    suspend fun updateAmount(id: String, amountMinor: Long)

    @Query("UPDATE transactions SET merchant_id = :merchantId WHERE id = :id")
    suspend fun updateMerchant(id: String, merchantId: String?)

    @Query("UPDATE transactions SET occurred_at = :occurredAt WHERE id = :id")
    suspend fun updateOccurredAt(id: String, occurredAt: Long)

    @Query("UPDATE transactions SET kind = :kind WHERE id = :id")
    suspend fun updateKind(id: String, kind: String)

    @Query("UPDATE transactions SET note = :note WHERE id = :id")
    suspend fun updateNote(id: String, note: String?)
}
