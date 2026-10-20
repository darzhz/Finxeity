package com.localexpense.tracker.data

import com.localexpense.tracker.data.dao.MerchantDao
import com.localexpense.tracker.data.entity.MerchantAliasEntity
import com.localexpense.tracker.data.entity.MerchantEntity
import com.localexpense.tracker.parse.MerchantNormalizer
import java.util.UUID

/**
 * Merchant lookup shared by ingestion and editing, so the same name always
 * lands on the same row.
 */
object Merchants {

    suspend fun resolve(dao: MerchantDao, display: String?): MerchantEntity? {
        val name = display?.takeIf { it.isNotBlank() } ?: return null
        val normalized = MerchantNormalizer.normalize(name)
        if (normalized.isEmpty()) return null

        val existing = dao.getByNormalizedName(normalized)
            ?: dao.listAll().firstOrNull { MerchantNormalizer.matches(it.normalizedName, normalized) }
        if (existing != null) {
            if (existing.normalizedName != normalized) {
                dao.upsertAlias(
                    MerchantAliasEntity(
                        id = UUID.randomUUID().toString(),
                        merchantId = existing.id,
                        alias = normalized,
                    ),
                )
            }
            return existing
        }

        val merchant = MerchantEntity(
            id = UUID.randomUUID().toString(),
            normalizedName = normalized,
            displayName = name,
            defaultCategoryId = null,
        )
        dao.upsert(merchant)
        return merchant
    }
}
