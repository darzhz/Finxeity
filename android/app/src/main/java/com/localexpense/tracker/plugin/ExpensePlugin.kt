package com.localexpense.tracker.plugin

import android.Manifest
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.getcapacitor.PermissionState
import com.localexpense.tracker.accounts.BalanceService
import com.localexpense.tracker.apps.InstalledApps
import com.localexpense.tracker.capture.CaptureEvents
import com.localexpense.tracker.capture.ExpenseNotificationListener
import com.localexpense.tracker.capture.ExtractedNotification
import com.localexpense.tracker.capture.NotificationExtractor
import com.localexpense.tracker.data.Repo
import com.localexpense.tracker.data.ForecastService
import com.localexpense.tracker.data.TrackerGraph
import com.localexpense.tracker.data.EventChange
import com.localexpense.tracker.data.TransactionPatch
import com.localexpense.tracker.data.entity.AccountType
import com.localexpense.tracker.data.entity.BudgetEntity
import com.localexpense.tracker.data.entity.CommitmentEntity
import com.localexpense.tracker.data.entity.CommitmentStatus
import com.localexpense.tracker.data.entity.GoalEntity
import com.localexpense.tracker.data.entity.GoalStatus
import com.localexpense.tracker.data.entity.RecurringStatus
import com.localexpense.tracker.data.entity.TransactionKind
import com.localexpense.tracker.settings.AppSettings
import com.localexpense.tracker.work.WorkScheduler
import com.localexpense.tracker.sms.SmsImporter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import org.json.JSONObject

@CapacitorPlugin(
    name = "LocalExpense",
    permissions = [
        Permission(alias = "sms", strings = [Manifest.permission.READ_SMS]),
    ],
)
class ExpensePlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private lateinit var repo: Repo
    private lateinit var settings: AppSettings

    override fun load() {
        TrackerGraph.init(context)
        repo = TrackerGraph.repo
        settings = TrackerGraph.settings
        CaptureEvents.sink = { eventName, data -> notifyListeners(eventName, data) }
        WorkScheduler.scheduleDaily(context)
    }

    override fun handleOnDestroy() {
        CaptureEvents.sink = null
        scope.cancel()
        super.handleOnDestroy()
    }

    // --- Onboarding -----------------------------------------------------------------

    @PluginMethod
    fun getOnboardingState(call: PluginCall) {
        scope.launch {
            call.resolve(JSObject().put("completed", settings.onboardingCompleted.first()))
        }
    }

    @PluginMethod
    fun setOnboardingComplete(call: PluginCall) {
        val completed = call.getBoolean("completed", true) ?: true
        scope.launch {
            settings.setOnboardingCompleted(completed)
            call.resolve()
        }
    }

    // --- Listener -------------------------------------------------------------------

    @PluginMethod
    fun getListenerStatus(call: PluginCall) {
        scope.launch {
            val accessGranted = isNotificationAccessGranted()
            val state = if (accessGranted) {
                settings.listenerState.first()
            } else {
                ExpenseNotificationListener.STATE_DISCONNECTED
            }
            call.resolve(
                JSObject().apply {
                    put("accessGranted", accessGranted)
                    put("state", state)
                    put("monitoredCount", settings.monitoredPackages.first().size)
                    put("lastEventAt", settings.lastEventAt.first())
                    put("activeNotifications", activeNotificationCount())
                },
            )
        }
    }

    @PluginMethod
    fun openNotificationSettings(call: PluginCall) {
        openSystemIntent(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS), call)
    }

    @PluginMethod
    fun openAppDetailsSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.fromParts("package", context.packageName, null)
        }
        openSystemIntent(intent, call)
    }

    // --- App picker -----------------------------------------------------------------

    @PluginMethod
    fun getCandidateApps(call: PluginCall) {
        scope.launch {
            val defaultSms = InstalledApps.defaultSmsPackage(context)
            val apps = JSArray()
            InstalledApps.launchableApps(context).forEach { app ->
                apps.put(
                    JSObject().apply {
                        put("packageName", app.packageName)
                        put("label", app.label)
                        put("suggested", app.isSuggestedFinance)
                        put("category", app.financeCategory ?: "")
                        put("isDefaultSms", app.packageName == defaultSms)
                    },
                )
            }
            call.resolve(JSObject().put("apps", apps).put("defaultSmsPackage", defaultSms ?: ""))
        }
    }

    @PluginMethod
    fun getMonitoredApps(call: PluginCall) {
        scope.launch {
            val array = JSArray()
            settings.monitoredPackages.first().forEach { array.put(it) }
            call.resolve(JSObject().put("packages", array))
        }
    }

    @PluginMethod
    fun setMonitoredApps(call: PluginCall) {
        val array = call.getArray("packages") ?: JSArray()
        val packages = (0 until array.length()).mapNotNull { array.getString(it) }.toSet()
        scope.launch {
            settings.setMonitoredPackages(packages)
            CaptureEvents.emit(
                CaptureEvents.DATA_CHANGED,
                JSObject().apply { put("scope", "monitored_apps") },
            )
            call.resolve(JSObject().put("count", packages.size))
        }
    }

    // --- Battery --------------------------------------------------------------------

    @PluginMethod
    fun isIgnoringBatteryOptimizations(call: PluginCall) {
        val power = context.getSystemService(PowerManager::class.java)
        val ignoring = power?.isIgnoringBatteryOptimizations(context.packageName) ?: false
        call.resolve(JSObject().put("ignoring", ignoring))
    }

    @PluginMethod
    fun requestIgnoreBatteryOptimizations(call: PluginCall) {
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
            data = Uri.fromParts("package", context.packageName, null)
        }
        openSystemIntent(intent, call)
    }

    // --- Accounts -------------------------------------------------------------------

    @PluginMethod
    fun listAccounts(call: PluginCall) {
        scope.launch {
            val array = JSArray()
            repo.listAccounts().forEach { array.put(it.toJSObject()) }
            call.resolve(JSObject().put("accounts", array))
        }
    }

    @PluginMethod
    fun setAccountBalance(call: PluginCall) {
        val name = call.getString("name") ?: run {
            call.reject("name is required")
            return
        }
        val balanceMinor = call.getDouble("balanceMinor")?.toLong() ?: 0L
        val type = call.getString("type")
            ?.let { runCatching { AccountType.valueOf(it) }.getOrNull() }
            ?: AccountType.BANK
        val currency = call.getString("currency") ?: AppSettings.DEFAULT_CURRENCY
        val anchorAt = call.getDouble("anchorAt")?.toLong() ?: System.currentTimeMillis()
        scope.launch {
            val account = repo.upsertAccount(
                id = call.getString("id"),
                name = name,
                lastDigits = call.getString("lastDigits"),
                type = type,
                balanceMinor = balanceMinor,
                anchorAt = anchorAt,
                currency = currency,
            )
            CaptureEvents.emit(
                CaptureEvents.DATA_CHANGED,
                JSObject().apply { put("scope", "accounts") },
            )
            call.resolve(JSObject().put("account", account.toJSObject()))
        }
    }

    @PluginMethod
    fun deleteAccount(call: PluginCall) {
        val id = call.getString("id") ?: run {
            call.reject("id is required")
            return
        }
        scope.launch {
            repo.deleteAccount(id)
            call.resolve()
        }
    }

    @PluginMethod
    fun detectAccounts(call: PluginCall) {
        scope.launch {
            val messages = activeNotifications().mapNotNull { NotificationExtractor.fromStatusBarNotification(it) }
            val proposals = JSArray()
            BalanceService.proposeAccounts(messages).forEach { proposal ->
                proposals.put(
                    JSObject().apply {
                        put("packageName", proposal.packageName)
                        put("name", InstalledApps.labelFor(context, proposal.packageName) ?: proposal.packageName)
                        put("lastDigits", proposal.lastDigits)
                        put("balanceMinor", proposal.balanceMinor ?: org.json.JSONObject.NULL)
                    },
                )
            }
            call.resolve(JSObject().put("proposals", proposals))
        }
    }

    // --- SMS backfill (sideload only) -----------------------------------------------

    @PluginMethod
    fun getSmsImportState(call: PluginCall) {
        scope.launch {
            call.resolve(
                JSObject().apply {
                    put("supported", SmsImporter.isSupported())
                    put("permissionGranted", getPermissionState("sms") == PermissionState.GRANTED)
                    put("lastImportAt", settings.lastImportAt.first())
                },
            )
        }
    }

    @PluginMethod
    fun importSms(call: PluginCall) {
        if (!SmsImporter.isSupported()) {
            call.reject("SMS import is not available in this build")
            return
        }
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            requestPermissionForAlias("sms", call, "smsPermissionCallback")
            return
        }
        performSmsImport(call)
    }

    @PermissionCallback
    fun smsPermissionCallback(call: PluginCall) {
        if (getPermissionState("sms") == PermissionState.GRANTED) {
            performSmsImport(call)
        } else {
            call.reject("READ_SMS permission denied")
        }
    }

    private fun performSmsImport(call: PluginCall) {
        val lookbackDays = call.getInt("lookbackDays") ?: 90
        scope.launch {
            val since = System.currentTimeMillis() - lookbackDays * 24L * 60L * 60L * 1000L
            val imported = SmsImporter.importRecent(context, repo, since)
            settings.setLastImportAt(System.currentTimeMillis())
            CaptureEvents.emit(
                CaptureEvents.DATA_CHANGED,
                JSObject().apply { put("scope", "raw_events") },
            )
            call.resolve(JSObject().put("imported", imported))
        }
    }

    // --- Raw events -----------------------------------------------------------------

    @PluginMethod
    fun listRawEvents(call: PluginCall) {
        val status = call.getString("status")
        val source = call.getString("source")
        val cursor = call.getObject("cursor")
        val limit = call.getInt("limit") ?: 50
        scope.launch {
            val events = repo.listRawEvents(
                status = status,
                source = source,
                cursorPostedAt = cursor?.getDouble("postedAt")?.toLong(),
                cursorId = cursor?.getString("id"),
                limit = limit,
            )
            val items = JSArray()
            val categories = repo.categories().associateBy { it.id }
            events.forEach { event ->
                val transaction = repo.transactionsForEvent(event.id).firstOrNull()
                val merchant = transaction?.merchantId?.let { repo.merchant(it) }
                items.put(
                    event.toJSObject().apply {
                        put(
                            "transaction",
                            transaction?.toJSObject(
                                merchantName = merchant?.displayName,
                                categoryName = transaction.categoryId?.let { categories[it]?.name },
                            ) ?: JSONObject.NULL,
                        )
                        put("parsed", event.parsedSummary())
                    },
                )
            }
            val nextCursor = if (events.size == limit) {
                events.last().let {
                    JSObject().put("postedAt", it.postedAt).put("id", it.id)
                }
            } else {
                null
            }
            call.resolve(
                JSObject().apply {
                    put("items", items)
                    if (nextCursor != null) put("nextCursor", nextCursor)
                },
            )
        }
    }

    @PluginMethod
    fun listAccountBalances(call: PluginCall) {
        scope.launch {
            val array = JSArray()
            repo.accountBalances().forEach { balance ->
                array.put(
                    balance.account.toJSObject().apply {
                        put("derivedBalanceMinor", balance.derivedBalanceMinor)
                    },
                )
            }
            call.resolve(JSObject().put("balances", array))
        }
    }

    // --- Transactions ---------------------------------------------------------------

    @PluginMethod
    fun listTransactions(call: PluginCall) {
        val cursor = call.getObject("cursor")
        val limit = call.getInt("limit") ?: 50
        scope.launch {
            val transactions = repo.listTransactions(
                status = call.getString("status"),
                direction = call.getString("direction"),
                categoryId = call.getString("categoryId"),
                from = call.getDouble("from")?.toLong(),
                to = call.getDouble("to")?.toLong(),
                cursorOccurredAt = cursor?.getDouble("occurredAt")?.toLong(),
                cursorId = cursor?.getString("id"),
                limit = limit,
            )
            val categories = repo.categories().associateBy { it.id }
            val items = JSArray()
            transactions.forEach { transaction ->
                val merchant = transaction.merchantId?.let { repo.merchant(it) }
                items.put(
                    transaction.toJSObject(
                        merchantName = merchant?.displayName,
                        categoryName = transaction.categoryId?.let { categories[it]?.name },
                    ),
                )
            }
            val nextCursor = if (transactions.size == limit) {
                transactions.last().let {
                    JSObject().put("occurredAt", it.occurredAt).put("id", it.id)
                }
            } else {
                null
            }
            call.resolve(
                JSObject().apply {
                    put("items", items)
                    if (nextCursor != null) put("nextCursor", nextCursor)
                },
            )
        }
    }

    @PluginMethod
    fun getIngestionStats(call: PluginCall) {
        scope.launch {
            call.resolve(
                JSObject().apply {
                    put("transactions", repo.countTransactions("ACTIVE"))
                    put("needsReview", repo.countRawEvents("NEEDS_REVIEW"))
                    put("ignored", repo.countRawEvents("IGNORED"))
                    put("pending", repo.countRawEvents("CAPTURED"))
                    put("dismissed", repo.countRawEvents("DISMISSED"))
                },
            )
        }
    }

    /** Runs the parser again over messages that were never interpreted. */
    @PluginMethod
    fun reparsePending(call: PluginCall) {
        scope.launch {
            val processed = repo.reparsePending()
            CaptureEvents.emit(
                CaptureEvents.DATA_CHANGED,
                JSObject().apply { put("scope", "raw_events") },
            )
            call.resolve(JSObject().put("processed", processed))
        }
    }

    /** Parses every stored message again, so new rules reach old transactions. */
    @PluginMethod
    fun reparseAll(call: PluginCall) {
        scope.launch {
            val processed = repo.reparsePending() + repo.reparseAll()
            CaptureEvents.emit(
                CaptureEvents.DATA_CHANGED,
                JSObject().apply { put("scope", "raw_events") },
            )
            CaptureEvents.emit(
                CaptureEvents.DATA_CHANGED,
                JSObject().apply { put("scope", "transactions") },
            )
            call.resolve(JSObject().put("processed", processed))
        }
    }

    @PluginMethod
    fun getDashboard(call: PluginCall) {
        val rangeDays = call.getInt("rangeDays") ?: 180
        scope.launch {
            call.resolve(repo.dashboard(rangeDays).toJSObject())
        }
    }

    // --- Editing and removal ---------------------------------------------------------

    @PluginMethod
    fun dismissEvent(call: PluginCall) {
        val id = call.getString("id")
        if (id == null) {
            call.reject("id is required")
            return
        }
        scope.launch {
            val change = repo.dismissEvent(id)
            emitChange(change, "raw_events")
            transactionsChanged()
            call.resolve(
                JSObject().apply {
                    put("dismissed", change is EventChange.Dismissed)
                    put(
                        "voidedTransactionIds",
                        JSArray().also { array ->
                            (change as? EventChange.Dismissed)
                                ?.voidedTransactionIds
                                ?.forEach { array.put(it) }
                        },
                    )
                },
            )
        }
    }

    @PluginMethod
    fun restoreEvent(call: PluginCall) {
        val id = call.getString("id")
        if (id == null) {
            call.reject("id is required")
            return
        }
        scope.launch {
            val change = repo.restoreEvent(id)
            emitChange(change, "raw_events")
            transactionsChanged()
            call.resolve(JSObject().put("restored", change is EventChange.Restored))
        }
    }

    @PluginMethod
    fun deleteRawEvent(call: PluginCall) {
        val id = call.getString("id")
        if (id == null) {
            call.reject("id is required")
            return
        }
        scope.launch {
            val change = repo.deleteRawEvent(id)
            emitChange(change, "raw_events")
            transactionsChanged()
            call.resolve(JSObject().put("deleted", change is EventChange.Dismissed))
        }
    }

    @PluginMethod
    fun createIgnoreRule(call: PluginCall) {
        val id = call.getString("id")
        if (id == null) {
            call.reject("id is required")
            return
        }
        scope.launch {
            val change = repo.createIgnoreRule(id)
            emitChange(change, "raw_events")
            transactionsChanged()
            call.resolve(
                JSObject().apply {
                    put("created", change is EventChange.RuleCreated)
                    put("ruleId", (change as? EventChange.RuleCreated)?.rule?.id)
                },
            )
        }
    }

    @PluginMethod
    fun promoteEvent(call: PluginCall) {
        val id = call.getString("id")
        if (id == null) {
            call.reject("id is required")
            return
        }
        val kind = call.getString("as")
            ?.let { runCatching { TransactionKind.valueOf(it) }.getOrNull() }
            ?: TransactionKind.SPEND
        scope.launch {
            val change = repo.promoteEvent(
                rawEventId = id,
                kind = kind,
                amountMinor = call.getDouble("amountMinor")?.toLong(),
                merchantName = call.getString("merchantName"),
                categoryId = call.getString("categoryId"),
            )
            emitChange(change, "raw_events")
            transactionsChanged()
            call.resolve(
                JSObject().apply {
                    put("promoted", change is EventChange.Promoted)
                    put(
                        "transaction",
                        (change as? EventChange.Promoted)?.transaction?.toJSObject() ?: JSONObject.NULL,
                    )
                },
            )
        }
    }

    @PluginMethod
    fun confirmEvent(call: PluginCall) {
        val id = call.getString("id")
        if (id == null) {
            call.reject("id is required")
            return
        }
        scope.launch {
            val change = repo.confirmEvent(
                rawEventId = id,
                amountMinor = call.getDouble("amountMinor")?.toLong(),
                merchantName = call.getString("merchantName"),
                categoryId = call.getString("categoryId"),
            )
            emitChange(change, "raw_events")
            transactionsChanged()
            call.resolve(
                JSObject().apply {
                    put("confirmed", change is EventChange.Promoted)
                    put(
                        "transaction",
                        (change as? EventChange.Promoted)?.transaction?.toJSObject() ?: JSONObject.NULL,
                    )
                },
            )
        }
    }

    @PluginMethod
    fun createManualTransaction(call: PluginCall) {
        val amountMinor = call.getDouble("amountMinor")?.toLong() ?: run { call.reject("amount required"); return }
        val direction = call.getString("direction")?.let { runCatching { com.localexpense.tracker.data.entity.TransactionDirection.valueOf(it) }.getOrNull() } ?: com.localexpense.tracker.data.entity.TransactionDirection.DEBIT
        val kind = call.getString("kind")?.let { runCatching { com.localexpense.tracker.data.entity.TransactionKind.valueOf(it) }.getOrNull() } ?: com.localexpense.tracker.data.entity.TransactionKind.SPEND
        scope.launch {
            val tx = repo.createManualTransaction(
                amountMinor = amountMinor,
                direction = direction,
                kind = kind,
                accountId = call.getString("accountId"),
                categoryId = call.getString("categoryId"),
                merchantName = call.getString("merchantName"),
                occurredAt = call.getDouble("occurredAt")?.toLong() ?: System.currentTimeMillis(),
                note = call.getString("note"),
            )
            val categories = repo.categories().associateBy { it.id }
            val merchant = tx.merchantId?.let { repo.merchant(it) }
            CaptureEvents.emit(CaptureEvents.DATA_CHANGED, JSObject().apply { put("scope", "transactions") })
            call.resolve(JSObject().put("transaction", tx.toJSObject(merchantName = merchant?.displayName, categoryName = tx.categoryId?.let { categories[it]?.name })))
        }
    }

    @PluginMethod
    fun correctTransaction(call: PluginCall) {
        val id = call.getString("id")
        if (id == null) {
            call.reject("id is required")
            return
        }
        val kind = call.getString("kind")
            ?.let { runCatching { TransactionKind.valueOf(it) }.getOrNull() }
        val patch = TransactionPatch(
            amountMinor = call.getDouble("amountMinor")?.toLong(),
            categoryId = call.getString("categoryId"),
            merchantName = call.getString("merchantName"),
            note = call.getString("note"),
            occurredAt = call.getDouble("occurredAt")?.toLong(),
            kind = kind,
        )
        scope.launch {
            val change = repo.correctTransaction(id, patch)
            emitChange(change, "transactions")
            transactionsChanged()
            call.resolve(
                JSObject().apply {
                    put("corrected", change is EventChange.Corrected)
                    put(
                        "transaction",
                        (change as? EventChange.Corrected)?.transaction?.toJSObject() ?: JSONObject.NULL,
                    )
                },
            )
        }
    }

    @PluginMethod
    fun listCategories(call: PluginCall) {
        scope.launch {
            val array = JSArray()
            repo.categories().forEach { category ->
                array.put(
                    JSObject().apply {
                        put("id", category.id)
                        put("name", category.name)
                        put("kind", category.kind.name)
                        putNullable("color", category.color)
                        putNullable("icon", category.icon)
                    },
                )
            }
            call.resolve(JSObject().put("categories", array))
        }
    }

    // --- Commitments ----------------------------------------------------------------

    @PluginMethod
    fun listCommitments(call: PluginCall) {
        scope.launch {
            val array = JSArray()
            repo.listCommitments().forEach { c ->
                array.put(
                    JSObject().apply {
                        put("id", c.id)
                        put("name", c.name)
                        put("amountMinor", c.amountMinor)
                        put("dueAt", c.dueAt)
                        put("recurrence", c.recurrence.name)
                        putNullable("accountId", c.accountId)
                        putNullable("categoryId", c.categoryId)
                        put("status", c.status.name)
                        putNullable("paidTransactionId", c.paidTransactionId)
                        putNullable("note", c.note)
                        put("createdAt", c.createdAt)
                    },
                )
            }
            call.resolve(JSObject().put("commitments", array))
        }
    }

    @PluginMethod
    fun upsertCommitment(call: PluginCall) {
        val name = call.getString("name") ?: run { call.reject("name required"); return }
        val amountMinor = call.getDouble("amountMinor")?.toLong() ?: run { call.reject("amount required"); return }
        val dueAt = call.getDouble("dueAt")?.toLong() ?: System.currentTimeMillis()
        val id = call.getString("id") ?: java.util.UUID.randomUUID().toString()
        val statusParam = call.getString("status")?.let { runCatching { CommitmentStatus.valueOf(it) }.getOrNull() }
        val recurrenceParam = call.getString("recurrence")?.let { runCatching { com.localexpense.tracker.data.entity.Cadence.valueOf(it) }.getOrNull() }
        scope.launch {
            val existing = repo.listCommitments().firstOrNull { it.id == id }
            val status = statusParam ?: existing?.status ?: CommitmentStatus.PENDING
            val recurrence = recurrenceParam ?: existing?.recurrence ?: com.localexpense.tracker.data.entity.Cadence.NONE
            val entity = CommitmentEntity(
                id = id,
                name = name,
                amountMinor = amountMinor,
                dueAt = dueAt,
                recurrence = recurrence,
                accountId = call.getString("accountId"),
                categoryId = call.getString("categoryId"),
                status = status,
                paidTransactionId = call.getString("paidTransactionId"),
                note = call.getString("note"),
                createdAt = existing?.createdAt ?: System.currentTimeMillis(),
            )
            repo.upsertCommitment(entity)
            CaptureEvents.emit(CaptureEvents.DATA_CHANGED, JSObject().apply { put("scope", "commitments") })
            call.resolve(JSObject().apply {
                put("id", entity.id); put("name", entity.name); put("amountMinor", entity.amountMinor)
                put("dueAt", entity.dueAt); put("recurrence", entity.recurrence.name)
                putNullable("accountId", entity.accountId); putNullable("categoryId", entity.categoryId)
                put("status", entity.status.name); putNullable("paidTransactionId", entity.paidTransactionId)
                putNullable("note", entity.note); put("createdAt", entity.createdAt)
            })
        }
    }

    @PluginMethod
    fun deleteCommitment(call: PluginCall) {
        val id = call.getString("id") ?: run { call.reject("id required"); return }
        scope.launch {
            repo.deleteCommitment(id)
            CaptureEvents.emit(CaptureEvents.DATA_CHANGED, JSObject().apply { put("scope", "commitments") })
            call.resolve()
        }
    }

    @PluginMethod
    fun setCommitmentStatus(call: PluginCall) {
        val id = call.getString("id") ?: run { call.reject("id required"); return }
        val status = call.getString("status")?.let { runCatching { CommitmentStatus.valueOf(it) }.getOrNull() } ?: run { call.reject("status required"); return }
        scope.launch {
            repo.setCommitmentStatus(id, status)
            CaptureEvents.emit(CaptureEvents.DATA_CHANGED, JSObject().apply { put("scope", "commitments") })
            call.resolve()
        }
    }

    // --- Goals ----------------------------------------------------------------------

    @PluginMethod
    fun listGoals(call: PluginCall) {
        scope.launch {
            val array = JSArray()
            repo.listGoals().forEach { g ->
                array.put(JSObject().apply {
                    put("id", g.id); put("name", g.name); put("targetMinor", g.targetMinor)
                    put("savedMinor", g.savedMinor); putNullable("targetDate", g.targetDate)
                    put("monthlyContributionMinor", g.monthlyContributionMinor); put("priority", g.priority)
                    put("status", g.status.name); put("createdAt", g.createdAt)
                })
            }
            call.resolve(JSObject().put("goals", array))
        }
    }

    @PluginMethod
    fun upsertGoal(call: PluginCall) {
        val name = call.getString("name") ?: run { call.reject("name required"); return }
        val targetMinor = call.getDouble("targetMinor")?.toLong() ?: run { call.reject("target required"); return }
        val id = call.getString("id") ?: java.util.UUID.randomUUID().toString()
        scope.launch {
            val entity = GoalEntity(
                id = id,
                name = name,
                targetMinor = targetMinor,
                savedMinor = call.getDouble("savedMinor")?.toLong() ?: 0L,
                targetDate = call.getDouble("targetDate")?.toLong(),
                monthlyContributionMinor = call.getDouble("monthlyContributionMinor")?.toLong() ?: 0L,
                priority = call.getInt("priority") ?: 0,
                status = call.getString("status")?.let { runCatching { GoalStatus.valueOf(it) }.getOrNull() } ?: GoalStatus.ACTIVE,
                createdAt = System.currentTimeMillis(),
            )
            repo.upsertGoal(entity)
            CaptureEvents.emit(CaptureEvents.DATA_CHANGED, JSObject().apply { put("scope", "goals") })
            call.resolve(JSObject().apply {
                put("id", entity.id); put("name", entity.name); put("targetMinor", entity.targetMinor)
                put("savedMinor", entity.savedMinor); putNullable("targetDate", entity.targetDate)
                put("monthlyContributionMinor", entity.monthlyContributionMinor); put("priority", entity.priority)
                put("status", entity.status.name); put("createdAt", entity.createdAt)
            })
        }
    }

    @PluginMethod
    fun deleteGoal(call: PluginCall) {
        val id = call.getString("id") ?: run { call.reject("id required"); return }
        scope.launch {
            repo.deleteGoal(id)
            CaptureEvents.emit(CaptureEvents.DATA_CHANGED, JSObject().apply { put("scope", "goals") })
            call.resolve()
        }
    }

    @PluginMethod
    fun setGoalStatus(call: PluginCall) {
        val id = call.getString("id") ?: run { call.reject("id required"); return }
        val status = call.getString("status")?.let { runCatching { GoalStatus.valueOf(it) }.getOrNull() } ?: run { call.reject("status required"); return }
        scope.launch {
            repo.setGoalStatus(id, status)
            CaptureEvents.emit(CaptureEvents.DATA_CHANGED, JSObject().apply { put("scope", "goals") })
            call.resolve()
        }
    }

    // --- Budgets --------------------------------------------------------------------

    @PluginMethod
    fun listBudgets(call: PluginCall) {
        scope.launch {
            val array = JSArray()
            repo.listBudgets().forEach { b ->
                array.put(JSObject().apply {
                    put("id", b.id); putNullable("categoryId", b.categoryId); put("period", b.period.name)
                    put("limitMinor", b.limitMinor); put("rollover", b.rollover)
                    put("alertThresholds", b.alertThresholds); put("startDay", b.startDay); put("enabled", b.enabled)
                })
            }
            call.resolve(JSObject().put("budgets", array))
        }
    }

    @PluginMethod
    fun upsertBudget(call: PluginCall) {
        val limitMinor = call.getDouble("limitMinor")?.toLong() ?: run { call.reject("limit required"); return }
        val id = call.getString("id") ?: java.util.UUID.randomUUID().toString()
        scope.launch {
            val entity = com.localexpense.tracker.data.entity.BudgetEntity(
                id = id,
                categoryId = call.getString("categoryId"),
                period = call.getString("period")?.let { runCatching { com.localexpense.tracker.data.entity.BudgetPeriod.valueOf(it) }.getOrNull() } ?: com.localexpense.tracker.data.entity.BudgetPeriod.MONTHLY,
                limitMinor = limitMinor,
                rollover = call.getBoolean("rollover") ?: false,
                alertThresholds = call.getString("alertThresholds") ?: "50,80,100",
                startDay = call.getInt("startDay") ?: 1,
                enabled = call.getBoolean("enabled") ?: true,
            )
            repo.upsertBudget(entity)
            CaptureEvents.emit(CaptureEvents.DATA_CHANGED, JSObject().apply { put("scope", "budgets") })
            call.resolve(JSObject().apply {
                put("id", entity.id); putNullable("categoryId", entity.categoryId); put("period", entity.period.name)
                put("limitMinor", entity.limitMinor); put("rollover", entity.rollover)
                put("alertThresholds", entity.alertThresholds); put("startDay", entity.startDay); put("enabled", entity.enabled)
            })
        }
    }

    @PluginMethod
    fun deleteBudget(call: PluginCall) {
        val id = call.getString("id") ?: run { call.reject("id required"); return }
        scope.launch {
            repo.deleteBudget(id)
            CaptureEvents.emit(CaptureEvents.DATA_CHANGED, JSObject().apply { put("scope", "budgets") })
            call.resolve()
        }
    }

    // --- Financial settings ---------------------------------------------------------

    @PluginMethod
    fun getForecast(call: PluginCall) {
        scope.launch {
            val dash = repo.dashboard(30)
            val forecast = ForecastService.build(
                totalBalanceMinor = dash.totalBalanceMinor,
                dailySpendMinor = dash.burn.dailyMinor,
                commitments = repo.listCommitments(),
                incomeDay = settings.incomeDay.first(),
                expectedIncomeMinor = settings.expectedIncomeMinor.first(),
                now = System.currentTimeMillis(),
            )
            val array = JSArray()
            forecast.points.forEach { p ->
                array.put(JSObject().apply {
                    put("dayStart", p.dayStart)
                    put("balanceMinor", p.balanceMinor)
                })
            }
            call.resolve(JSObject().apply {
                put("points", array)
                put("minBalanceMinor", forecast.minBalanceMinor)
                put("endBalanceMinor", forecast.endBalanceMinor)
            })
        }
    }

    @PluginMethod
    fun getFinancialSettings(call: PluginCall) {
        scope.launch {
            call.resolve(JSObject().apply {
                put("bufferMinor", settings.bufferMinor.first())
                put("incomeDay", settings.incomeDay.first())
                put("expectedIncomeMinor", settings.expectedIncomeMinor.first())
                val arr = JSArray(); settings.essentialCategories.first().forEach { arr.put(it) }
                put("essentialCategories", arr)
            })
        }
    }

    @PluginMethod
    fun setFinancialSettings(call: PluginCall) {
        scope.launch {
            call.getDouble("bufferMinor")?.toLong()?.let { settings.setBufferMinor(it) }
            call.getInt("incomeDay")?.let { settings.setIncomeDay(it) }
            call.getDouble("expectedIncomeMinor")?.toLong()?.let { settings.setExpectedIncomeMinor(it) }
            call.getArray("essentialCategories")?.let { arr ->
                val set = (0 until arr.length()).mapNotNull { arr.getString(it) }.toSet()
                settings.setEssentialCategories(set)
            }
            val out = JSObject().apply {
                put("bufferMinor", settings.bufferMinor.first())
                put("incomeDay", settings.incomeDay.first())
                put("expectedIncomeMinor", settings.expectedIncomeMinor.first())
                val arr = JSArray(); settings.essentialCategories.first().forEach { arr.put(it) }
                put("essentialCategories", arr)
            }
            CaptureEvents.emit(CaptureEvents.DATA_CHANGED, JSObject().apply { put("scope", "settings") })
            call.resolve(out)
        }
    }

    // --- Recurring -------------------------------------------------------------------

    @PluginMethod
    fun listRecurring(call: PluginCall) {
        scope.launch {
            val array = JSArray()
            repo.listRecurring().forEach { payment ->
                array.put(
                    JSObject().apply {
                        putNullable("merchantId", payment.merchantId)
                        put("name", payment.name)
                        put("amountMinor", payment.amountMinor)
                        put("cadence", payment.cadence.name)
                        putNullable("nextExpectedAt", payment.nextExpectedAt)
                        putNullable("lastSeenAt", payment.lastSeenAt)
                        putNullable("priceIncreaseMinor", payment.priceIncreaseMinor)
                        put("status", payment.status.name)
                        put("confirmed", payment.confirmed)
                    },
                )
            }
            call.resolve(JSObject().put("recurring", array))
        }
    }

    @PluginMethod
    fun setRecurringStatus(call: PluginCall) {
        val merchantId = call.getString("merchantId")
        if (merchantId == null) {
            call.reject("merchantId is required")
            return
        }
        val status = call.getString("status")
            ?.let { runCatching { RecurringStatus.valueOf(it) }.getOrNull() }
            ?: RecurringStatus.SUGGESTED
        scope.launch {
            val row = repo.setRecurringStatus(merchantId, status)
            CaptureEvents.emit(
                CaptureEvents.DATA_CHANGED,
                JSObject().apply { put("scope", "recurring") },
            )
            call.resolve(
                JSObject().apply {
                    put("status", row?.status?.name ?: status.name)
                },
            )
        }
    }

    // --- Rules -----------------------------------------------------------------------

    @PluginMethod
    fun listRules(call: PluginCall) {
        scope.launch {
            val array = JSArray()
            repo.listRules().forEach { rule ->
                array.put(
                    JSObject().apply {
                        put("id", rule.id)
                        put("type", rule.type.name)
                        putNullable("packageName", rule.packageName)
                        putNullable("senderPattern", rule.senderPattern)
                        putNullable("templatePattern", rule.templatePattern)
                        putNullable("merchantContains", rule.merchantContains)
                        putNullable("categoryId", rule.categoryId)
                        put("enabled", rule.enabled)
                        put("createdAt", rule.createdAt)
                    },
                )
            }
            call.resolve(JSObject().put("rules", array))
        }
    }

    @PluginMethod
    fun deleteRule(call: PluginCall) {
        val id = call.getString("id")
        if (id == null) {
            call.reject("id is required")
            return
        }
        scope.launch {
            repo.deleteRule(id)
            CaptureEvents.emit(
                CaptureEvents.DATA_CHANGED,
                JSObject().apply { put("scope", "rules") },
            )
            call.resolve()
        }
    }

    // --- Helpers --------------------------------------------------------------------

    /** Tells the UI that something changed, so it can refetch. */
    private fun emitChange(change: EventChange, scope: String) {
        val changed = when (change) {
            is EventChange.Dismissed -> true
            is EventChange.Restored -> true
            is EventChange.Promoted -> true
            is EventChange.Corrected -> true
            is EventChange.RuleCreated -> true
            is EventChange.Reprocessed -> true
            else -> false
        }
        if (!changed) return
        CaptureEvents.emit(
            CaptureEvents.DATA_CHANGED,
            JSObject().apply { put("scope", scope) },
        )
    }

    /**
     * The transactions changed, so the cached summaries are stale. The worker
     * rebuilds them in the background.
     */
    private suspend fun transactionsChanged() {
        repo.markTransactionsChanged()
        WorkScheduler.refreshNow(context)
    }

    private fun openSystemIntent(intent: Intent, call: PluginCall) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(intent) }
            .onSuccess { call.resolve() }
            .onFailure { call.reject("Unable to open settings") }
    }

    private fun isNotificationAccessGranted(): Boolean {
        val flat = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
        return flat?.split(':')?.any { it.contains(context.packageName) } == true
    }

    @Suppress("MissingPermission")
    private fun activeNotifications(): List<android.service.notification.StatusBarNotification> {
        if (!isNotificationAccessGranted()) return emptyList()
        return try {
            context.getSystemService(NotificationManager::class.java)
                ?.activeNotifications
                ?.toList()
                ?: emptyList()
        } catch (e: SecurityException) {
            emptyList()
        }
    }

    private fun activeNotificationCount(): Int = activeNotifications().size
}
