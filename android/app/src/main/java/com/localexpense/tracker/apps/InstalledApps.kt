package com.localexpense.tracker.apps

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.provider.Telephony
import org.json.JSONObject

data class InstalledApp(
    val packageName: String,
    val label: String,
    val isSuggestedFinance: Boolean,
    val financeCategory: String?,
)

data class FinanceSuggestion(
    val packageName: String,
    val name: String,
    val category: String,
)

object InstalledApps {

    private const val ASSET_NAME = "finance_packages.json"

    fun launchableApps(context: Context): List<InstalledApp> {
        val pm = context.packageManager
        val intent = Intent(Intent.ACTION_MAIN, null).apply {
            addCategory(Intent.CATEGORY_LAUNCHER)
        }
        val resolved: List<ResolveInfo> = pm.queryIntentActivities(intent, 0)
        val suggestions = suggestionsByPackage(context)
        return resolved
            .mapNotNull { it.activityInfo?.applicationInfo }
            .distinctBy { it.packageName }
            .filter { it.packageName != context.packageName }
            .map { info ->
                val suggestion = suggestions[info.packageName]
                InstalledApp(
                    packageName = info.packageName,
                    label = info.loadLabel(pm).toString(),
                    isSuggestedFinance = suggestion != null,
                    financeCategory = suggestion?.category,
                )
            }
            .sortedBy { it.label.lowercase() }
    }

    fun defaultSmsPackage(context: Context): String? =
        Telephony.Sms.getDefaultSmsPackage(context)

    fun labelFor(context: Context, packageName: String): String? {
        val pm = context.packageManager
        return try {
            pm.getApplicationLabel(pm.getApplicationInfo(packageName, 0)).toString()
        } catch (e: PackageManager.NameNotFoundException) {
            null
        }
    }

    fun financeSuggestions(context: Context): List<FinanceSuggestion> =
        suggestionsByPackage(context).values.toList()

    private fun suggestionsByPackage(context: Context): Map<String, FinanceSuggestion> {
        val json = try {
            context.assets.open(ASSET_NAME).bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            return emptyMap()
        }
        return try {
            val array = JSONObject(json).getJSONArray("packages")
            buildMap {
                for (i in 0 until array.length()) {
                    val item = array.getJSONObject(i)
                    val pkg = item.getString("package")
                    put(
                        pkg,
                        FinanceSuggestion(
                            packageName = pkg,
                            name = item.optString("name", pkg),
                            category = item.optString("category", "other"),
                        ),
                    )
                }
            }
        } catch (e: Exception) {
            emptyMap()
        }
    }
}
