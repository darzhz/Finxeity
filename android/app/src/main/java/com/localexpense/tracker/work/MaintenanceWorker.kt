package com.localexpense.tracker.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.localexpense.tracker.data.TrackerGraph
import java.util.concurrent.TimeUnit

/**
 * Rebuilds the cached daily summaries and refreshes the detected recurring
 * payments. It runs in the background so the dashboard never has to walk every
 * transaction to answer a question.
 */
class MaintenanceWorker(
    context: Context,
    parameters: WorkerParameters,
) : CoroutineWorker(context, parameters) {

    override suspend fun doWork(): Result {
        TrackerGraph.init(applicationContext)
        val repo = TrackerGraph.repo
        return try {
            repo.refreshSummaries()
            repo.refreshRecurring()
            Result.success()
        } catch (error: Exception) {
            Result.retry()
        }
    }
}

/**
 * When the background work runs.
 *
 * The daily job keeps the cache warm; the immediate job brings it up to date
 * after the user changes something.
 */
object WorkScheduler {

    private const val DAILY = "finxeity-maintenance-daily"
    private const val IMMEDIATE = "finxeity-maintenance-now"

    /** A daily sweep, so the cache is ready before the app is opened. */
    fun scheduleDaily(context: Context) {
        val request = PeriodicWorkRequestBuilder<MaintenanceWorker>(1, TimeUnit.DAYS).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            DAILY,
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }

    /** Bring the cache up to date now, because something changed. */
    fun refreshNow(context: Context) {
        val request = OneTimeWorkRequestBuilder<MaintenanceWorker>()
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            IMMEDIATE,
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }
}
