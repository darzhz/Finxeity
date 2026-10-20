package com.localexpense.tracker.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.localexpense.tracker.data.entity.RecurringEntity
import com.localexpense.tracker.data.entity.RecurringStatus

@Dao
interface RecurringDao {

    @Query("SELECT * FROM recurring ORDER BY next_expected_at ASC")
    suspend fun list(): List<RecurringEntity>

    @Query("SELECT * FROM recurring WHERE id = :id")
    suspend fun getById(id: String): RecurringEntity?

    @Query("SELECT * FROM recurring WHERE merchant_id = :merchantId")
    suspend fun getByMerchant(merchantId: String): RecurringEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(recurring: RecurringEntity)

    @Query("UPDATE recurring SET status = :status WHERE id = :id")
    suspend fun updateStatus(id: String, status: RecurringStatus)

    @Query("DELETE FROM recurring")
    suspend fun deleteAll()
}
