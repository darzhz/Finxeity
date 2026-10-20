package com.localexpense.tracker.parse

/**
 * Turns a message into a shape that matches similar messages, so one ignore
 * rule can catch the next one.
 *
 * "Rs.500 debited from A/c XX4821" becomes
 * "Rs\.[\d,.]+ debited from A/c XX[\d,.]+".
 */
object MessageTemplate {

    private val numberRun = Regex("""\d+(?:[.,]\d+)*""")

    private const val PLACEHOLDER = """[\d,.]+"""

    /** Characters that mean something in a regular expression. */
    private val metacharacters = setOf(
        '\\', '.', '[', ']', '{', '}', '(', ')', '*', '+', '-', '?', '^', '$', '|',
    )

    fun derive(text: String): String {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return ""
        val escaped = escapeLiteral(trimmed)
        return numberRun.replace(escaped) { PLACEHOLDER }
    }

    /**
     * Escapes the regular expression metacharacters one by one. `Regex.escape`
     * cannot be used here because it quotes the whole string, which would make
     * the placeholders literal.
     */
    private fun escapeLiteral(text: String): String = buildString {
        for (character in text) {
            if (character in metacharacters) append('\\')
            append(character)
        }
    }
}
