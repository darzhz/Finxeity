package com.localexpense.tracker.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.localexpense.tracker.data.entity.MerchantAliasEntity
import com.localexpense.tracker.data.entity.MerchantEntity

@Dao
interface MerchantDao {

    @Query("SELECT * FROM merchants WHERE normalized_name = :normalizedName")
    suspend fun getByNormalizedName(normalizedName: String): MerchantEntity?

    @Query("SELECT * FROM merchants WHERE id = :id")
    suspend fun getById(id: String): MerchantEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(merchant: MerchantEntity)

    @Query("SELECT * FROM merchants ORDER BY display_name ASC")
    suspend fun listAll(): List<MerchantEntity>

    @Query("SELECT * FROM merchant_aliases WHERE alias = :alias")
    suspend fun findAlias(alias: String): MerchantAliasEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAlias(alias: MerchantAliasEntity)

    @Query("DELETE FROM merchant_aliases WHERE merchant_id = :merchantId")
    suspend fun deleteAliases(merchantId: String)
}
