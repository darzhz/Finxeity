package com.localexpense.tracker.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.localexpense.tracker.data.entity.CorrectionEntity

@Dao
interface CorrectionDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(correction: CorrectionEntity)

    @Query("SELECT * FROM corrections WHERE transaction_id = :transactionId")
    suspend fun listByTransaction(transactionId: String): List<CorrectionEntity>

    @Query("SELECT * FROM corrections WHERE retracted_at IS NULL")
    suspend fun listActive(): List<CorrectionEntity>

    @Query("UPDATE corrections SET retracted_at = :retractedAt WHERE transaction_id = :transactionId")
    suspend fun retractByTransaction(transactionId: String, retractedAt: Long)

    @Query("UPDATE corrections SET retracted_at = NULL WHERE transaction_id = :transactionId")
    suspend fun unretractByTransaction(transactionId: String)

    @Query("DELETE FROM corrections WHERE transaction_id = :transactionId")
    suspend fun deleteByTransaction(transactionId: String)
}
