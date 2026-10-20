package com.localexpense.tracker.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.localexpense.tracker.data.entity.RuleEntity

@Dao
interface RuleDao {

    @Query(
        """
        SELECT * FROM rules
        WHERE enabled = 1 AND (:type IS NULL OR type = :type)
        ORDER BY priority DESC, created_at ASC
        """,
    )
    suspend fun listEnabled(type: String?): List<RuleEntity>

    @Query("SELECT * FROM rules WHERE id = :id")
    suspend fun getById(id: String): RuleEntity?

    @Query("SELECT * FROM rules ORDER BY created_at DESC")
    suspend fun listAll(): List<RuleEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(rule: RuleEntity)

    @Query("DELETE FROM rules WHERE id = :id")
    suspend fun deleteById(id: String)
}
