package com.localexpense.tracker.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.localexpense.tracker.data.dao.AccountDao
import com.localexpense.tracker.data.dao.BalanceCheckpointDao
import com.localexpense.tracker.data.dao.BudgetDao
import com.localexpense.tracker.data.dao.CommitmentDao
import com.localexpense.tracker.data.dao.GoalDao
import com.localexpense.tracker.data.dao.CorrectionDao
import com.localexpense.tracker.data.dao.DailySummaryDao
import com.localexpense.tracker.data.dao.CategoryDao
import com.localexpense.tracker.data.dao.MerchantDao
import com.localexpense.tracker.data.dao.RawEventDao
import com.localexpense.tracker.data.dao.RecurringDao
import com.localexpense.tracker.data.dao.RuleDao
import com.localexpense.tracker.data.dao.TransactionDao
import com.localexpense.tracker.data.entity.AccountEntity
import com.localexpense.tracker.data.entity.BalanceCheckpointEntity
import com.localexpense.tracker.data.entity.BudgetEntity
import com.localexpense.tracker.data.entity.CommitmentEntity
import com.localexpense.tracker.data.entity.GoalEntity
import com.localexpense.tracker.data.entity.CategoryEntity
import com.localexpense.tracker.data.entity.CorrectionEntity
import com.localexpense.tracker.data.entity.DailySummaryEntity
import com.localexpense.tracker.data.entity.MerchantAliasEntity
import com.localexpense.tracker.data.entity.MerchantEntity
import com.localexpense.tracker.data.entity.RawEventEntity
import com.localexpense.tracker.data.entity.RecurringEntity
import com.localexpense.tracker.data.entity.RuleEntity
import com.localexpense.tracker.data.entity.TransactionEntity

    @Database(
    entities = [
        RawEventEntity::class,
        TransactionEntity::class,
        AccountEntity::class,
        BalanceCheckpointEntity::class,
        MerchantEntity::class,
        MerchantAliasEntity::class,
        CategoryEntity::class,
        RuleEntity::class,
        CorrectionEntity::class,
        RecurringEntity::class,
        BudgetEntity::class,
        CommitmentEntity::class,
        GoalEntity::class,
        DailySummaryEntity::class,
    ],
    version = 4,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {

    abstract fun rawEventDao(): RawEventDao

    abstract fun accountDao(): AccountDao

    abstract fun categoryDao(): CategoryDao

    abstract fun transactionDao(): TransactionDao

    abstract fun merchantDao(): MerchantDao

    abstract fun ruleDao(): RuleDao

    abstract fun balanceCheckpointDao(): BalanceCheckpointDao

    abstract fun correctionDao(): CorrectionDao

    abstract fun recurringDao(): RecurringDao

    abstract fun dailySummaryDao(): DailySummaryDao

    abstract fun commitmentDao(): CommitmentDao

    abstract fun goalDao(): GoalDao

    abstract fun budgetDao(): BudgetDao

    companion object {
        private const val DB_NAME = "expense_tracker.db"

        @Volatile
        private var instance: AppDatabase? = null

        fun get(context: Context): AppDatabase =
            instance ?: synchronized(this) {
                instance ?: build(context.applicationContext).also { instance = it }
            }

        private fun build(context: Context): AppDatabase =
            Room.databaseBuilder(context, AppDatabase::class.java, DB_NAME)
                .addCallback(SeedCallback)
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4)
                .build()

        /**
         * v3 added the daily summary cache, so the dashboard can answer from
         * one row per day instead of walking every transaction.
         */
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS daily_summaries (" +
                        "account_id TEXT NOT NULL, " +
                        "day_start INTEGER NOT NULL, " +
                        "spend_minor INTEGER NOT NULL, " +
                        "income_minor INTEGER NOT NULL, " +
                        "transfer_minor INTEGER NOT NULL, " +
                        "transaction_count INTEGER NOT NULL, " +
                        "computed_at INTEGER NOT NULL, " +
                        "PRIMARY KEY(account_id, day_start))",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_daily_summaries_day_start " +
                        "ON daily_summaries(day_start)",
                )
            }
        }

        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS commitments (" +
                        "id TEXT NOT NULL PRIMARY KEY, " +
                        "name TEXT NOT NULL, " +
                        "amount_minor INTEGER NOT NULL, " +
                        "due_at INTEGER NOT NULL, " +
                        "recurrence TEXT NOT NULL, " +
                        "account_id TEXT, " +
                        "category_id TEXT, " +
                        "status TEXT NOT NULL, " +
                        "paid_transaction_id TEXT, " +
                        "note TEXT, " +
                        "created_at INTEGER NOT NULL)",
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS index_commitments_due_at ON commitments(due_at)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_commitments_status ON commitments(status)")
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS goals (" +
                        "id TEXT NOT NULL PRIMARY KEY, " +
                        "name TEXT NOT NULL, " +
                        "target_minor INTEGER NOT NULL, " +
                        "saved_minor INTEGER NOT NULL, " +
                        "target_date INTEGER, " +
                        "monthly_contribution_minor INTEGER NOT NULL, " +
                        "priority INTEGER NOT NULL, " +
                        "status TEXT NOT NULL, " +
                        "created_at INTEGER NOT NULL)",
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS index_goals_status ON goals(status)")
            }
        }

        /** v2 added duplicate tracking and the transaction reference id. */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE raw_events ADD COLUMN duplicate_of TEXT")
                db.execSQL("ALTER TABLE transactions ADD COLUMN reference_id TEXT")
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_transactions_reference_id " +
                        "ON transactions(reference_id)",
                )
            }
        }

        private val SeedCallback = object : RoomDatabase.Callback() {
            override fun onCreate(db: SupportSQLiteDatabase) {
                super.onCreate(db)
                seedCategories(db)
            }
        }

        /**
         * Default categories. They are ordinary rows so the user can rename them;
         * `is_system` only marks the ones the app relies on internally.
         */
        private fun seedCategories(db: SupportSQLiteDatabase) {
            val categories = listOf(
                // id, name, kind, color, sort
                arrayOf("cat_food", "Food", "EXPENSE", "#f97316", "10"),
                arrayOf("cat_groceries", "Groceries", "EXPENSE", "#84cc16", "20"),
                arrayOf("cat_transport", "Transport", "EXPENSE", "#0ea5e9", "30"),
                arrayOf("cat_bills", "Bills & Utilities", "EXPENSE", "#a855f7", "40"),
                arrayOf("cat_shopping", "Shopping", "EXPENSE", "#ec4899", "50"),
                arrayOf("cat_health", "Health", "EXPENSE", "#ef4444", "60"),
                arrayOf("cat_entertainment", "Entertainment", "EXPENSE", "#eab308", "70"),
                arrayOf("cat_fees", "Fees & Charges", "EXPENSE", "#64748b", "80"),
                arrayOf("cat_income", "Income", "INCOME", "#22c55e", "90"),
                arrayOf("cat_transfers", "Transfers", "TRANSFER", "#14b8a6", "100"),
                arrayOf("cat_uncategorized", "Uncategorized", "EXPENSE", "#94a3b8", "999"),
            )
            categories.forEach { (id, name, kind, color, sort) ->
                db.execSQL(
                    "INSERT OR IGNORE INTO categories (id, name, kind, color, is_system, sort_order) " +
                        "VALUES (?, ?, ?, ?, 1, ?)",
                    arrayOf<Any>(id, name, kind, color, sort.toInt()),
                )
            }
        }
    }
}
