package com.localexpense.tracker.settings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.settingsDataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

/**
 * Small, non-relational preferences. Transactional data lives in Room; anything
 * scalar that is not queried relationally lives here.
 */
class AppSettings(private val context: Context) {

    private object Keys {
        val monitoredPackages = stringSetPreferencesKey("monitored_packages")
        val onboardingCompleted = booleanPreferencesKey("onboarding_completed")
        val currency = stringPreferencesKey("currency")
        val locale = stringPreferencesKey("locale")
        val retention = stringPreferencesKey("raw_retention")
        val batteryPromptDismissed = booleanPreferencesKey("battery_prompt_dismissed")
        val listenerState = stringPreferencesKey("listener_state")
        val lastEventAt = longPreferencesKey("last_event_at")
        val lastImportAt = longPreferencesKey("last_import_at")
        val summariesComputedAt = longPreferencesKey("summaries_computed_at")
        val lastTransactionChangeAt = longPreferencesKey("last_transaction_change_at")
        val bufferMinor = longPreferencesKey("buffer_minor")
        val incomeDay = longPreferencesKey("income_day")
        val expectedIncomeMinor = longPreferencesKey("expected_income_minor")
        val essentialCategories = stringSetPreferencesKey("essential_categories")
    }

    val monitoredPackages: Flow<Set<String>> =
        context.settingsDataStore.data.map { it[Keys.monitoredPackages] ?: emptySet() }

    val onboardingCompleted: Flow<Boolean> =
        context.settingsDataStore.data.map { it[Keys.onboardingCompleted] ?: false }

    val currency: Flow<String> =
        context.settingsDataStore.data.map { it[Keys.currency] ?: DEFAULT_CURRENCY }

    val locale: Flow<String> =
        context.settingsDataStore.data.map { it[Keys.locale] ?: DEFAULT_LOCALE }

    /** Retention policy for raw text. Only KEEP is supported in v1. */
    val retention: Flow<String> =
        context.settingsDataStore.data.map { it[Keys.retention] ?: RETENTION_KEEP }

    val batteryPromptDismissed: Flow<Boolean> =
        context.settingsDataStore.data.map { it[Keys.batteryPromptDismissed] ?: false }

    val listenerState: Flow<String> =
        context.settingsDataStore.data.map { it[Keys.listenerState] ?: "UNKNOWN" }

    val lastEventAt: Flow<Long> =
        context.settingsDataStore.data.map { it[Keys.lastEventAt] ?: 0L }

    val lastImportAt: Flow<Long> =
        context.settingsDataStore.data.map { it[Keys.lastImportAt] ?: 0L }

    /** When the daily summaries were last rebuilt. */
    val summariesComputedAt: Flow<Long> =
        context.settingsDataStore.data.map { it[Keys.summariesComputedAt] ?: 0L }

    /** When a transaction last changed, which makes the summaries stale. */
    val lastTransactionChangeAt: Flow<Long> =
        context.settingsDataStore.data.map { it[Keys.lastTransactionChangeAt] ?: 0L }

    val bufferMinor: Flow<Long> =
        context.settingsDataStore.data.map { it[Keys.bufferMinor] ?: 0L }

    val incomeDay: Flow<Int> =
        context.settingsDataStore.data.map { (it[Keys.incomeDay] ?: 0L).toInt() }

    val expectedIncomeMinor: Flow<Long> =
        context.settingsDataStore.data.map { it[Keys.expectedIncomeMinor] ?: 0L }

    val essentialCategories: Flow<Set<String>> =
        context.settingsDataStore.data.map { it[Keys.essentialCategories] ?: emptySet() }

    suspend fun setMonitoredPackages(packages: Set<String>) {
        context.settingsDataStore.edit { it[Keys.monitoredPackages] = packages }
    }

    suspend fun setOnboardingCompleted(completed: Boolean) {
        context.settingsDataStore.edit { it[Keys.onboardingCompleted] = completed }
    }

    suspend fun setCurrency(currency: String) {
        context.settingsDataStore.edit { it[Keys.currency] = currency }
    }

    suspend fun setRetention(retention: String) {
        context.settingsDataStore.edit { it[Keys.retention] = retention }
    }

    suspend fun setBatteryPromptDismissed(dismissed: Boolean) {
        context.settingsDataStore.edit { it[Keys.batteryPromptDismissed] = dismissed }
    }

    suspend fun setListenerState(state: String) {
        context.settingsDataStore.edit { it[Keys.listenerState] = state }
    }

    suspend fun setLastEventAt(timestamp: Long) {
        context.settingsDataStore.edit { it[Keys.lastEventAt] = timestamp }
    }

    suspend fun setLastImportAt(timestamp: Long) {
        context.settingsDataStore.edit { it[Keys.lastImportAt] = timestamp }
    }

    suspend fun setSummariesComputedAt(timestamp: Long) {
        context.settingsDataStore.edit { it[Keys.summariesComputedAt] = timestamp }
    }

    suspend fun setLastTransactionChangeAt(timestamp: Long) {
        context.settingsDataStore.edit { it[Keys.lastTransactionChangeAt] = timestamp }
    }

    suspend fun setBufferMinor(value: Long) {
        context.settingsDataStore.edit { it[Keys.bufferMinor] = value }
    }

    suspend fun setIncomeDay(value: Int) {
        context.settingsDataStore.edit { it[Keys.incomeDay] = value.toLong() }
    }

    suspend fun setExpectedIncomeMinor(value: Long) {
        context.settingsDataStore.edit { it[Keys.expectedIncomeMinor] = value }
    }

    suspend fun setEssentialCategories(value: Set<String>) {
        context.settingsDataStore.edit { it[Keys.essentialCategories] = value }
    }

    companion object {
        const val DEFAULT_CURRENCY = "INR"
        const val DEFAULT_LOCALE = "en-IN"
        const val RETENTION_KEEP = "KEEP"
    }
}
