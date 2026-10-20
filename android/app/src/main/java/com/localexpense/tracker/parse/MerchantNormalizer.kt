package com.localexpense.tracker.parse

/**
 * Cleans up a merchant name pulled out of free text and produces a stable key so
 * that "SWIGGY", "Swiggy" and "Swiggy Order" group together.
 */
object MerchantNormalizer {

    /** Words that describe the transaction rather than the merchant. */
    private val noiseWords = setOf(
        "a", "an", "and", "at", "auth", "bank", "by", "card", "charged", "cheque",
        "credit", "credited", "date", "dated", "debit", "debited", "deducted", "deposit",
        "deposited", "for", "from", "has", "have", "id", "imps", "in", "is", "lte", "no",
        "number", "of", "on", "or", "paid", "payment", "purchase", "ref", "reference",
        "rr", "rtgs", "spend", "spent", "the", "to", "transaction", "txn", "txnid",
        "upi", "utr", "wallet", "was", "with", "your", "a/c", "ac", "account", "mandate",
        "towards", "via", "remaining", "balance", "ending", "card", "limit", "available",
    )

    /** Legal-form tokens that carry no meaning for grouping. */
    private val legalSuffixes = setOf("pvt", "ltd", "private", "limited", "llp", "inc")

    /**
     * Lowercase key for grouping. Returns an empty string when nothing usable is
     * left, so callers can treat "" as "no merchant".
     */
    fun normalize(raw: String): String {
        val cleaned = raw.lowercase()
            .replace(Regex("[^a-z0-9@\\s]"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
        if (cleaned.isEmpty()) return ""
        val words = cleaned.split(' ')
            .filter { it.isNotEmpty() }
            .filterNot { it in noiseWords }
            .filterNot { it in legalSuffixes }
            .filterNot { it.all { char -> char.isDigit() } }
            .filterNot { it.length == 1 }
        return words.joinToString(" ")
    }

    /**
     * The name to show in the UI: original casing, without trailing punctuation or
     * a dangling separator.
     */
    fun display(raw: String): String {
        val cleaned = raw
            .replace(Regex("\\s+"), " ")
            .trim()
            .trim('.', ',', '-', ':', ';', '|')
            .trim()
        if (cleaned.isEmpty()) return ""
        val words = cleaned.split(' ').filter { it.isNotEmpty() }
        val first = words.first().lowercase().trim('.', ',', '-', ':', ';', '|')
        // "to your account" and "at the mall" are not merchants.
        if (first in noiseWords || first.all { it.isDigit() }) return ""
        val kept = words.takeWhile { word ->
            val bare = word.lowercase().trim('.', ',', '-', ':', ';', '|')
            bare !in noiseWords && bare.isNotEmpty() && !bare.all { it.isDigit() }
        }
        if (kept.isEmpty()) return ""
        val joined = kept.joinToString(" ").trim().trim('.', ',', '-', ':', ';', '|').trim()
        if (joined.isEmpty()) return ""
        return if (joined.none { it.isUpperCase() }) {
            joined.replaceFirstChar { it.uppercaseChar() }
        } else {
            joined
        }
    }

    /**
     * Pulls a merchant name out of a candidate phrase.
     *
     * Unlike [display] this skips the words that only describe the transaction
     * ("UPI mandate towards JioHotstar" gives "JioHotstar"), because the
     * interesting word is often further along. It also stops at the end of a
     * sentence, so "BIG BAZAAR. Available balance" does not become a merchant
     * called "BIG BAZAAR Available".
     */
    fun extract(candidate: String): String {
        val raw = candidate.split(Regex("""\s+""")).filter { it.isNotEmpty() }
        val words = raw.map { it.trim('.', ',', '-', ':', ';', '|', '"', '\'') }
            .filter { it.isNotEmpty() }

        val start = words.indexOfFirst { word ->
            word.lowercase() !in noiseWords && word.length > 1 && !looksLikeNumber(word)
        }
        if (start < 0) return ""

        val kept = mutableListOf<String>()
        for (index in start until words.size) {
            val word = words[index]
            if (word.lowercase() in noiseWords) break
            if (looksLikeNumber(word)) break
            // "your PhonePe wallet" names a wallet, not a merchant.
            if (words.getOrNull(index + 1)?.lowercase() == "wallet") break
            kept += word
            if (raw[index].endsWith('.')) break
        }
        if (kept.isEmpty()) return ""
        val joined = kept.joinToString(" ").trim()
        return if (joined.none { it.isUpperCase() }) {
            joined.replaceFirstChar { it.uppercaseChar() }
        } else {
            joined
        }
    }

    /**
     * True for anything that is a number rather than a name: an amount, a date,
     * a phone number or a masked account number. Merchants are words.
     */
    private fun looksLikeNumber(word: String): Boolean =
        word.any { it.isDigit() } ||
            Regex("""^(?:rs\.?|inr)[\d,.]*$""", RegexOption.IGNORE_CASE).matches(word)

    /**
     * Whether two merchant names refer to the same merchant. One may carry
     * extra words ("swiggy order" vs "swiggy") because banks and payment apps
     * word the same merchant differently.
     */
    fun matches(first: String, second: String): Boolean {
        val left = normalize(first)
        val right = normalize(second)
        if (left.isEmpty() || right.isEmpty()) return false
        if (left == right) return true
        if (left.length < 3 || right.length < 3) return false
        return left.contains(right) || right.contains(left)
    }
}
