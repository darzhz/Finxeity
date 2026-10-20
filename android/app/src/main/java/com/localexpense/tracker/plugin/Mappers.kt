package com.localexpense.tracker.plugin

import com.getcapacitor.JSObject
import com.localexpense.tracker.data.entity.AccountEntity
import com.localexpense.tracker.data.entity.RawEventEntity
import com.localexpense.tracker.data.entity.TransactionEntity
import com.localexpense.tracker.parse.TransactionParser
import org.json.JSONObject

internal fun JSObject.putNullable(key: String, value: Any?) {
    put(key, value ?: JSONObject.NULL)
}

fun RawEventEntity.toJSObject(): JSObject = JSObject().apply {
    put("id", id)
    put("source", source.name)
    putNullable("packageName", packageName)
    putNullable("sender", sender)
    put("notificationKey", notificationKey)
    putNullable("title", title)
    putNullable("text", text)
    putNullable("bigText", bigText)
    putNullable("textLines", textLines)
    put("postedAt", postedAt)
    put("contentHash", contentHash)
    put("status", status.name)
    putNullable("dismissedAt", dismissedAt)
    put("parseVersion", parseVersion)
    putNullable("duplicateOf", duplicateOf)
    put("createdAt", createdAt)
}

fun TransactionEntity.toJSObject(
    merchantName: String? = null,
    categoryName: String? = null,
): JSObject = JSObject().apply {
    put("id", id)
    putNullable("rawEventId", rawEventId)
    putNullable("accountId", accountId)
    put("amountMinor", amountMinor)
    put("direction", direction.name)
    put("kind", kind.name)
    putNullable("merchantId", merchantId)
    putNullable("merchantName", merchantName)
    putNullable("categoryId", categoryId)
    putNullable("categoryName", categoryName)
    putNullable("referenceId", referenceId)
    put("occurredAt", occurredAt)
    put("confidence", confidence.toDouble())
    put("status", status.name)
    put("source", source.name)
    putNullable("note", note)
    put("createdAt", createdAt)
}

/**
 * The parse of a stored message, recomputed on the spot. The raw message is
 * the only thing stored, so this is how the UI shows what the parser thinks.
 */
fun RawEventEntity.parsedSummary(): JSObject {
    val parsed = TransactionParser.parse(
        packageName = packageName,
        sender = sender,
        title = title,
        body = bigText?.takeIf { it.isNotBlank() } ?: text,
    )
    return JSObject().apply {
        put("type", parsed.type.name)
        putNullable("amountMinor", parsed.amountMinor)
        putNullable("direction", parsed.direction?.name)
        putNullable("kind", parsed.kind?.name)
        putNullable("merchant", parsed.merchant)
        putNullable("accountDigits", parsed.accountDigits)
        putNullable("balanceMinor", parsed.balanceMinor)
        putNullable("referenceId", parsed.referenceId)
        put("confidence", parsed.confidence.toDouble())
    }
}

fun AccountEntity.toJSObject(): JSObject = JSObject().apply {
    put("id", id)
    put("name", name)
    putNullable("lastDigits", lastDigits)
    put("type", type.name)
    put("anchorBalanceMinor", anchorBalanceMinor)
    put("anchorAt", anchorAt)
    put("currency", currency)
    put("archived", archived)
    put("createdAt", createdAt)
}
