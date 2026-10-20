package com.localexpense.tracker.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.localexpense.tracker.data.entity.GoalEntity
import com.localexpense.tracker.data.entity.GoalStatus

@Dao
interface GoalDao {
    @Query("SELECT * FROM goals ORDER BY priority DESC, created_at ASC")
    suspend fun list(): List<GoalEntity>

    @Query("SELECT * FROM goals WHERE id = :id")
    suspend fun getById(id: String): GoalEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(goal: GoalEntity)

    @Query("UPDATE goals SET status = :status WHERE id = :id")
    suspend fun updateStatus(id: String, status: GoalStatus)

    @Query("DELETE FROM goals WHERE id = :id")
    suspend fun deleteById(id: String)

    @Query("DELETE FROM goals")
    suspend fun deleteAll()
}
