package com.localexpense.tracker.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.localexpense.tracker.data.entity.DailySummaryEntity

@Dao
interface DailySummaryDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(summaries: List<DailySummaryEntity>)

    @Query("SELECT * FROM daily_summaries WHERE account_id = :accountId AND day_start = :dayStart")
    suspend fun get(accountId: String, dayStart: Long): DailySummaryEntity?

    @Query("SELECT * FROM daily_summaries WHERE day_start >= :from ORDER BY day_start ASC")
    suspend fun listSince(from: Long): List<DailySummaryEntity>

    @Query("SELECT * FROM daily_summaries ORDER BY day_start ASC")
    suspend fun listAll(): List<DailySummaryEntity>

    @Query("DELETE FROM daily_summaries")
    suspend fun deleteAll()
}
