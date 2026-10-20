package com.localexpense.tracker.data

import android.content.Context
import androidx.room.Room
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/**
 * The database is versioned, so a broken migration would break every install
 * that already has data. This builds a real database of an older version, lets
 * Room migrate it and checks that the old rows survive.
 */
@RunWith(RobolectricTestRunner::class)
class MigrationTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val databaseName = "migration-test.db"

    @Before
    fun setUp() {
        context.deleteDatabase(databaseName)
    }

    @After
    fun tearDown() {
        context.deleteDatabase(databaseName)
    }

    /** Creates the schema of the given version from the exported schema file. */
    private fun createSchema(version: Int) {
        val schema = JSONObject(
            File("schemas/com.localexpense.tracker.data.AppDatabase/$version.json").readText(),
        )
        val entities = schema.getJSONObject("database").getJSONArray("entities")
        val helper = FrameworkSQLiteOpenHelperFactory().create(
            SupportSQLiteOpenHelper.Configuration.builder(context)
                .name(databaseName)
                .callback(
                    object : SupportSQLiteOpenHelper.Callback(version) {
                        override fun onCreate(db: SupportSQLiteDatabase) {
                            for (index in 0 until entities.length()) {
                                val entity = entities.getJSONObject(index)
                                val table = entity.getString("tableName")
                                db.execSQL(
                                    entity.getString("createSql")
                                        .replace("\${TABLE_NAME}", table),
                                )
                                val indices = entity.optJSONArray("indices")
                                    ?: org.json.JSONArray()
                                for (i in 0 until indices.length()) {
                                    db.execSQL(
                                        indices.getJSONObject(i).getString("createSql")
                                            .replace("\${TABLE_NAME}", table),
                                    )
                                }
                            }
                        }

                        override fun onUpgrade(
                            db: SupportSQLiteDatabase,
                            oldVersion: Int,
                            newVersion: Int,
                        ) = Unit
                    },
                )
                .build(),
        )
        helper.writableDatabase.use { db ->
            db.execSQL(
                """
                INSERT INTO raw_events (
                    id, source, package_name, sender, notification_key, title, text,
                    big_text, text_lines, posted_at, content_hash, status, dismissed_at,
                    parse_version, created_at
                ) VALUES (
                    'e1', 'NOTIFICATION', 'com.phonepe.app', NULL, 'key-1', 'PhonePe',
                    'Paid 450', NULL, NULL, 1000, 'hash-1', 'CAPTURED', NULL, 0, 1000
                )
                """.trimIndent(),
            )
            db.execSQL(
                    """
                    INSERT INTO transactions (
                        id, raw_event_id, account_id, amount_minor, direction, kind,
                        refund_of_transaction_id, merchant_id, category_id, occurred_at,
                        confidence, status, source, excluded_from_burn, excluded_from_budget,
                        note, created_at
                    ) VALUES (
                        't1', 'e1', NULL, 45000, 'DEBIT', 'SPEND', NULL, NULL, NULL, 1000,
                        0.95, 'ACTIVE', 'AUTO', 0, 0, NULL, 1000
                    )
                    """.trimIndent(),
                )
        }
        helper.close()
    }

    @Test
    fun `an existing v1 database migrates and keeps its rows`() = runTest {
        createSchema(1)

        val database = Room
            .databaseBuilder(context, AppDatabase::class.java, databaseName)
            .addMigrations(AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3, AppDatabase.MIGRATION_3_4)
            .build()

        val events = database.rawEventDao().list(null, null, 10)
        assertEquals(1, events.size)
        assertEquals("e1", events.first().id)
        assertNull(events.first().duplicateOf)

        val transactions = database.transactionDao().list("ACTIVE", null, null, null, null, 10)
        assertEquals(1, transactions.size)
        assertNull(transactions.first().referenceId)

        database.close()
    }

    @Test
    fun `an existing v2 database gains the summary cache`() = runTest {
        createSchema(2)

        val database = Room
            .databaseBuilder(context, AppDatabase::class.java, databaseName)
            .addMigrations(AppDatabase.MIGRATION_2_3, AppDatabase.MIGRATION_3_4)
            .build()

        val events = database.rawEventDao().list(null, null, 10)
        assertEquals(1, events.size)

        val summaries = database.dailySummaryDao().listAll()
        assertTrue(summaries.isEmpty())

        database.close()
    }
}
