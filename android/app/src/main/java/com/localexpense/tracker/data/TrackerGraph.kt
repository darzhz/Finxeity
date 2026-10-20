package com.localexpense.tracker.data

import android.content.Context
import com.localexpense.tracker.settings.AppSettings

/**
 * Process-wide wiring for the native core. Initialised from any entry point
 * (plugin, listener service) with an application context.
 */
object TrackerGraph {

    @Volatile
    private var appContext: Context? = null

    fun init(context: Context) {
        if (appContext == null) {
            appContext = context.applicationContext
        }
    }

    private fun requireContext(): Context =
        appContext ?: error("TrackerGraph.init must be called before use")

    val database: AppDatabase
        get() = AppDatabase.get(requireContext())

    val settings: AppSettings
        get() = AppSettings(requireContext())

    val repo: Repo by lazy { Repo(database, settings) }
}
