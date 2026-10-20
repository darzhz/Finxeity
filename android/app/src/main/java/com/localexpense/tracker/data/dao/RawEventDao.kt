package com.localexpense.tracker.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.localexpense.tracker.data.entity.RawEventEntity
import com.localexpense.tracker.data.entity.RawEventStatus

@Dao
interface RawEventDao {

    /**
     * Returns the new row id, or -1 when the (notification_key, content_hash)
     * unique index rejects the row because this exact message was already stored.
     */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(event: RawEventEntity): Long

    @Query("SELECT * FROM raw_events WHERE id = :id")
    suspend fun getById(id: String): RawEventEntity?

    @Query(
        """
        SELECT * FROM raw_events
        WHERE (:status IS NULL OR status = :status)
          AND (:source IS NULL OR source = :source)
        ORDER BY posted_at DESC, id DESC
        LIMIT :limit
        """,
    )
    suspend fun list(status: String?, source: String?, limit: Int): List<RawEventEntity>

    @Query(
        """
        SELECT * FROM raw_events
        WHERE (:status IS NULL OR status = :status)
          AND (:source IS NULL OR source = :source)
          AND (posted_at < :beforePostedAt OR (posted_at = :beforePostedAt AND id < :beforeId))
        ORDER BY posted_at DESC, id DESC
        LIMIT :limit
        """,
    )
    suspend fun listAfter(
        status: String?,
        source: String?,
        beforePostedAt: Long,
        beforeId: String,
        limit: Int,
    ): List<RawEventEntity>

    @Query("SELECT COUNT(*) FROM raw_events WHERE (:status IS NULL OR status = :status)")
    suspend fun count(status: String? = null): Int

    @Query("SELECT COUNT(*) FROM raw_events WHERE status = :status")
    suspend fun countByStatus(status: RawEventStatus): Int

    @Query("SELECT MAX(posted_at) FROM raw_events")
    suspend fun latestPostedAt(): Long?

    @Query("UPDATE raw_events SET status = :status, dismissed_at = :dismissedAt WHERE id = :id")
    suspend fun updateStatus(id: String, status: RawEventStatus, dismissedAt: Long?)

    @Query("SELECT * FROM raw_events WHERE status = :status ORDER BY posted_at ASC LIMIT :limit")
    suspend fun listByStatus(status: RawEventStatus, limit: Int): List<RawEventEntity>

    @Query("SELECT * FROM raw_events WHERE duplicate_of = :rawEventId")
    suspend fun listDuplicates(rawEventId: String): List<RawEventEntity>

    @Query(
        """
        UPDATE raw_events
        SET status = :status, parse_version = :parseVersion, duplicate_of = :duplicateOf
        WHERE id = :id
        """,
    )
    suspend fun updateParse(
        id: String,
        status: RawEventStatus,
        parseVersion: Int,
        duplicateOf: String?,
    )

    @Query("DELETE FROM raw_events WHERE id = :id")
    suspend fun deleteById(id: String)

    @Query("DELETE FROM raw_events")
    suspend fun deleteAll()
}
