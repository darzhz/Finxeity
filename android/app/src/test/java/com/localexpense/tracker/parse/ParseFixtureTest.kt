package com.localexpense.tracker.parse

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Golden tests over the fixture corpus. Every case states what the parser must
 * produce, so a change in the parsing rules shows up here first.
 */
@RunWith(RobolectricTestRunner::class)
class ParseFixtureTest {

    private fun fixtures(): JSONObject {
        val stream = requireNotNull(
            javaClass.classLoader?.getResourceAsStream("fixtures/parse_fixtures.json"),
        ) { "fixtures/parse_fixtures.json is missing from the test resources" }
        return JSONObject(stream.readBytes().decodeToString())
    }

    @Test
    fun `every fixture parses to its golden output`() {
        val cases = fixtures().getJSONArray("cases")
        assertTrue("the fixture corpus is empty", cases.length() > 0)

        for (index in 0 until cases.length()) {
            val fixture = cases.getJSONObject(index)
            val name = fixture.getString("name")
            val expected = fixture.getJSONObject("expected")

            val parsed = TransactionParser.parse(
                packageName = fixture.optString("package").takeIf { it.isNotEmpty() },
                sender = fixture.optString("sender").takeIf { it.isNotEmpty() },
                title = fixture.optString("title").takeIf { it.isNotEmpty() },
                body = fixture.optString("body").takeIf { it.isNotEmpty() },
            )

            assertEquals(name, expected.getString("type"), parsed.type.name)
            assertEquals(
                name,
                expected.longOrNull("amountMinor") ?: -1L,
                parsed.amountMinor ?: -1L,
            )
            assertEquals(
                name,
                expected.stringOrNull("direction") ?: "",
                parsed.direction?.name ?: "",
            )
            assertEquals(
                name,
                expected.stringOrNull("kind") ?: "",
                parsed.kind?.name ?: "",
            )
            assertEquals(
                name,
                expected.stringOrNull("merchant") ?: "",
                parsed.merchant ?: "",
            )
            assertEquals(
                name,
                expected.stringOrNull("accountDigits") ?: "",
                parsed.accountDigits ?: "",
            )
            assertEquals(
                name,
                expected.longOrNull("balanceMinor") ?: -1L,
                parsed.balanceMinor ?: -1L,
            )
            assertEquals(
                "$name should ${if (expected.getBoolean("autoCreate")) "" else "not "}become a transaction",
                expected.getBoolean("autoCreate"),
                parsed.isComplete && parsed.confidence >= TransactionParser.CONFIDENCE_THRESHOLD,
            )
        }
    }
}

/** org.json turns an explicit null into the string "null", which is never wanted. */
private fun JSONObject.stringOrNull(key: String): String? =
    if (!has(key) || isNull(key)) null else optString(key)

private fun JSONObject.longOrNull(key: String): Long? =
    if (!has(key) || isNull(key)) null else optLong(key)
