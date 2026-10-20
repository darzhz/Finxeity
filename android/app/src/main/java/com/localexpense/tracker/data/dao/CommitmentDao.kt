package com.localexpense.tracker.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.localexpense.tracker.data.entity.CommitmentEntity
import com.localexpense.tracker.data.entity.CommitmentStatus

@Dao
interface CommitmentDao {
    @Query("SELECT * FROM commitments ORDER BY due_at ASC")
    suspend fun list(): List<CommitmentEntity>

    @Query("SELECT * FROM commitments WHERE id = :id")
    suspend fun getById(id: String): CommitmentEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(commitment: CommitmentEntity)

    @Query("UPDATE commitments SET status = :status WHERE id = :id")
    suspend fun updateStatus(id: String, status: CommitmentStatus)

    @Query("DELETE FROM commitments WHERE id = :id")
    suspend fun deleteById(id: String)

    @Query("DELETE FROM commitments")
    suspend fun deleteAll()
}
