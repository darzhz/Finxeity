package com.localexpense.tracker.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.localexpense.tracker.data.entity.BalanceCheckpointEntity

@Dao
interface BalanceCheckpointDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(checkpoint: BalanceCheckpointEntity)

    @Query("SELECT * FROM balance_checkpoints WHERE account_id = :accountId ORDER BY observed_at DESC LIMIT 1")
    suspend fun latestForAccount(accountId: String): BalanceCheckpointEntity?

    @Query("SELECT * FROM balance_checkpoints WHERE raw_event_id = :rawEventId")
    suspend fun listByRawEvent(rawEventId: String): List<BalanceCheckpointEntity>

    @Query("DELETE FROM balance_checkpoints WHERE raw_event_id = :rawEventId")
    suspend fun deleteByRawEvent(rawEventId: String)
}
