package com.localexpense.tracker.parse

/**
 * Turns a written amount into integer paise.
 *
 * Handles both Indian and Western digit grouping ("1,23,456.78", "1,234.56")
 * and the currency markers Indian banks use ("Rs.", "INR", "₹").
 */
object AmountParser {

    /**
     * A number with optional thousands separators and up to two decimals.
     * The grouped alternative requires at least one separator so that a plain
     * "1234567" is never truncated to "123".
     */
    val NUMBER_PATTERN: Regex =
        Regex("""\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?""")

    /** Currency markers that make an amount unambiguous. */
    private val currencyMarkerPattern = Regex("""(?:₹|\brs\b\.?|\binr\b)""", RegexOption.IGNORE_CASE)

    /**
     * Parses "1,234.50", "1234", "₹1,23,456.00" into paise. Returns null when the
     * text does not hold exactly one number.
     */
    fun parseToMinor(raw: String): Long? {
        val cleaned = raw.filter { it.isDigit() || it == '.' }.trim()
        if (cleaned.isEmpty() || cleaned.count { it == '.' } > 1) return null
        val parts = cleaned.split('.')
        val rupees = parts.getOrNull(0)?.toLongOrNull() ?: return null
        val paise = when {
            parts.size == 1 -> 0L
            else -> parts[1].padEnd(2, '0').take(2).toLongOrNull() ?: return null
        }
        if (rupees < 0) return null
        return rupees * 100 + paise
    }

    /** True when the text carries an explicit currency marker. */
    fun hasCurrencyMarker(text: String): Boolean = currencyMarkerPattern.containsMatchIn(text)
}
