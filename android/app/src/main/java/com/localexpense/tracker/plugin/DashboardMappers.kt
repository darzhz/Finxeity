package com.localexpense.tracker.plugin

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.localexpense.tracker.data.AccountSummary
import com.localexpense.tracker.data.BurnSummary
import com.localexpense.tracker.data.CashflowPoint
import com.localexpense.tracker.data.CategoryShare
import com.localexpense.tracker.data.Dashboard
import com.localexpense.tracker.data.MerchantSummary
import com.localexpense.tracker.data.RecurringSummary
import com.localexpense.tracker.data.SafeToSpend
import com.localexpense.tracker.data.SavingsItem
import com.localexpense.tracker.data.SavingsPotential

/** The dashboard as the WebView sees it. */
fun Dashboard.toJSObject(): JSObject = JSObject().apply {
    put("totalBalanceMinor", totalBalanceMinor)
    put("accounts", JSArray().also { array -> accounts.forEach { array.put(it.toJSObject()) } })
    put("burn", burn.toJSObject())
    put("cashflow", JSArray().also { array -> cashflow.forEach { array.put(it.toJSObject()) } })
    put("categories", JSArray().also { array -> categories.forEach { array.put(it.toJSObject()) } })
    put("topMerchants", JSArray().also { array -> topMerchants.forEach { array.put(it.toJSObject()) } })
    put("recurring", JSArray().also { array -> recurring.forEach { array.put(it.toJSObject()) } })
    put("savings", savings.toJSObject())
    put("safeToSpend", safeToSpend?.toJSObject() ?: org.json.JSONObject.NULL)
    put("needsReview", needsReview)
    put("lastUpdatedAt", lastUpdatedAt)
}

fun AccountSummary.toJSObject(): JSObject = JSObject().apply {
    put("id", id)
    put("name", name)
    putNullable("lastDigits", lastDigits)
    put("derivedBalanceMinor", derivedBalanceMinor)
    put("anchorBalanceMinor", anchorBalanceMinor)
}

fun BurnSummary.toJSObject(): JSObject = JSObject().apply {
    put("dailyMinor", dailyMinor)
    put("monthlyMinor", monthlyMinor)
    put("runwayDays", runwayDays ?: org.json.JSONObject.NULL)
    put("runwayMonths", runwayMonths ?: org.json.JSONObject.NULL)
    put("spendMinor", spendMinor)
    put("daysCounted", daysCounted)
}

fun CashflowPoint.toJSObject(): JSObject = JSObject().apply {
    put("periodStart", periodStart)
    put("spendMinor", spendMinor)
    put("incomeMinor", incomeMinor)
    put("netMinor", netMinor)
}

fun CategoryShare.toJSObject(): JSObject = JSObject().apply {
    putNullable("categoryId", categoryId)
    put("name", name)
    put("spendMinor", spendMinor)
    put("share", share.toDouble())
    put("changeMinor", changeMinor ?: org.json.JSONObject.NULL)
}

fun MerchantSummary.toJSObject(): JSObject = JSObject().apply {
    putNullable("merchantId", merchantId)
    put("name", name)
    put("spendMinor", spendMinor)
    put("count", count)
}

fun RecurringSummary.toJSObject(): JSObject = JSObject().apply {
    putNullable("merchantId", merchantId)
    put("name", name)
    put("amountMinor", amountMinor)
    put("cadence", cadence.name)
    putNullable("nextExpectedAt", nextExpectedAt)
    putNullable("lastSeenAt", lastSeenAt)
    putNullable("priceIncreaseMinor", priceIncreaseMinor)
}

fun SavingsItem.toJSObject(): JSObject = JSObject().apply {
    put("source", source)
    put("detail", detail)
    put("amountMinor", amountMinor)
}

fun SavingsPotential.toJSObject(): JSObject = JSObject().apply {
    put("totalMinor", totalMinor)
    put("items", JSArray().also { array -> items.forEach { array.put(it.toJSObject()) } })
}

fun SafeToSpend.toJSObject(): JSObject = JSObject().apply {
    put("todayMinor", todayMinor)
    put("weekMinor", weekMinor)
    put("daysLeft", daysLeft)
    put("breakdown", JSArray().also { array -> breakdown.forEach { array.put(it.toJSObject()) } })
}
