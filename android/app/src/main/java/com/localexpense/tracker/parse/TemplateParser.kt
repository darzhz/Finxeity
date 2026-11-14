package com.localexpense.tracker.parse

import com.localexpense.tracker.data.entity.TransactionDirection
import com.localexpense.tracker.data.entity.TransactionKind

/**
 * Template-based parser using sender/package-specific regex patterns.
 *
 * This is the deterministic, high-precision parser that runs first.
 * It implements [MessageParser] so it can be swapped or chained with ML parsers.
 */
class TemplateParser : MessageParser {

    override val source: String = "template"
    override val version: String = TransactionParser.PARSE_VERSION.toString()

    companion object {
        private const val AMT =
            """(?:\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)"""

        private const val MERCHANT = """[A-Za-z][A-Za-z0-9&'._/-]*(?:\s+[A-Za-z0-9&'._/-]+){0,3}"""
    }

    private val otpPattern = Regex(
        """(?i)\b(?:otp|one[\s-]?time\s+password|verification\s+code|security\s+code|auth\s?code)\b""",
    )

    private val promoPattern = Regex(
        """(?i)\b(?:offers?|discount|cashback|win\s+(?:a|up\s+to)?|free\s+\w+|sale|off|coupon|rewards?|bonus|limited\s+(?:period|time|offer)|exclusive|deal|flat\s+\d+\s*%|\d+\s*%\s*off|scratch\s+card|lucky\s+draw|loan|emi|pre-?approved|instant\s+cash|quick\s+cash|best\s+deal|act\s+fast|apply\s+now|check\s+emi|t&c|voucher|lowest\s+rates|loan\s+(?:amount|rates?|offer)|card\s+offer|business\s+loan|expired|expiring|recharge\s+(?:now|with)|earn\s+upto|rewarded|cashless\s+treatment)\b""",
    )

    private val balancePattern = Regex(
        """(?i)\b(?:avail(?:able)?\s+bal(?:ance)?|bal(?:ance)?)\b[^0-9₹]{0,16}(?:(?:rs\.?|inr)\s*|₹\s*)?(?<balance>${AMT})\b""",
    )

    private val accountDigitsPattern = Regex(
        """(?i)(?:a/c|acct|account|card|xx+|ending(?:\s+with)?|last)\D{0,8}(\d{4})(?!\d)""",
    )

    private val referencePattern = Regex(
        """(?i)\b(?:utr|txn|transaction|rr|ref(?:erence)?)\s*(?:id|no\.?|number)?\D{0,4}([a-z0-9]{6,})""",
    )

    private val vpaPattern = Regex(
        """(?i)\b([a-z][a-z0-9._-]{1,30})@([a-z][a-z0-9._-]{1,20})\b""",
    )

    private val merchantPattern = Regex(
        """(?i)\b(?:towards|to|at|for)\s+(?<merchant>${MERCHANT})""",
    )

    private val callToActionWords = setOf(
        "click", "tap", "here", "link", "apply", "emi", "top-up", "topup", "download",
        "visit", "browse", "http", "https", "www", "now",
    )

    private val bareAmountPattern = Regex(
        """(?i)(?:(?:rs\.?|inr)\s*|₹\s*)(?<amount>${AMT})\b""",
    )

    private val transferPattern = Regex(
        """(?i)\b(?:self\s*transfer|transferred\s+to\s+your\s+own|to\s+your\s+own\s+account|internal\s+transfer|own\s+account|own\s+a/c)\b""",
    )

    private val cardPaymentPattern = Regex(
        """(?i)\b(?:payment|paid|transferred|remitted)\b.{0,80}?\btowards\s+your\s+(?:credit\s+card|debit\s+card|loan|emi|card)\b""",
    )

    private val walletTopUpPattern = Regex(
        """(?i)\b(?:added|credited|topped\s*up|top-up|deposited|recharged)\b.{0,40}?\bwallet\b""",
    )

    private val walletPaymentPattern = Regex(
        """(?i)\bvia\s+[a-z0-9 .&'_-]{1,30}?\bwallet\b""",
    )

    private val refundPattern = Regex("""(?i)\brefund""")

    private val incomePattern = Regex(
        """(?i)\b(?:salary|salary\s+credit|interest\s+credit|interest\s+amount|dividend|interest\s+credited)\b""",
    )

    override fun parse(
        packageName: String?,
        sender: String?,
        title: String?,
        body: String?,
    ): ParsedMessage {
        val text = (body?.takeIf { it.isNotBlank() } ?: title ?: "").trim()
        if (text.isEmpty()) return ParsedMessage.ignored(MessageType.OTHER, source = source, version = version)

        if (otpPattern.containsMatchIn(text)) {
            return ParsedMessage.ignored(MessageType.OTP, confidence = 0.99f, source = source, version = version)
        }

        val templates = SenderTemplates.forSender(sender) + SenderTemplates.forPackage(packageName)
        val match = templates.firstNotNullOfOrNull { template ->
            template.pattern.find(text)?.let { template to it }
        }

        if (match == null) {
            if (promoPattern.containsMatchIn(text)) {
                return ParsedMessage.ignored(MessageType.PROMO, confidence = 0.9f, source = source, version = version)
            }
            val bare = bareAmountPattern.find(text)
            val amount = bare?.groups?.get("amount")?.value?.let(AmountParser::parseToMinor)
            if (amount != null) {
                val wallet = walletName(text)
                val transfer = walletTopUpPattern.containsMatchIn(text) ||
                    cardPaymentPattern.containsMatchIn(text)
                return ParsedMessage(
                    type = MessageType.SPEND,
                    amountMinor = amount,
                    direction = TransactionDirection.DEBIT,
                    kind = if (transfer) TransactionKind.TRANSFER else TransactionKind.SPEND,
                    confidence = 0.6f,
                    templateId = "generic.bare.amount",
                    wallet = wallet,
                    source = source,
                    version = version,
                )
            }
            return ParsedMessage.ignored(MessageType.OTHER, confidence = 0.9f, source = source, version = version)
        }

        val (template, regexMatch) = match
        val amountText = regexMatch.groupOrNull("amount")?.value
        val amountMinor = amountText?.let(AmountParser::parseToMinor)
        val amountIndex = regexMatch.groupOrNull("amount")?.range?.first

        val promoIndex = promoPattern.find(text)?.range?.first
        val promoLeads = promoIndex != null && (amountIndex == null || promoIndex < amountIndex)
        if (promoLeads && !template.strong) {
            return ParsedMessage.ignored(MessageType.PROMO, confidence = 0.9f, source = source, version = version)
        }

        val cardPayment = cardPaymentPattern.containsMatchIn(text)
        val walletTopUp = walletTopUpPattern.containsMatchIn(text)
        val wallet = walletName(text)

        val merchant = if (cardPayment || walletTopUp) {
            null
        } else {
            regexMatch.groupOrNull("merchant")?.value?.let(MerchantNormalizer::display)
                ?: extractMerchant(text)
        }
        val digits = regexMatch.groupOrNull("digits")?.value
            ?: accountDigitsPattern.find(text)?.groupValues?.getOrNull(1)
        val balanceMinor = if (wallet != null) {
            null
        } else {
            balancePattern.find(text)
                ?.groups?.get("balance")?.value
                ?.let(AmountParser::parseToMinor)
                ?.takeIf { it != amountMinor }
        }
        val referenceId = referencePattern.find(text)?.groupValues?.getOrNull(1)

        val direction = if (cardPayment || walletTopUp) {
            TransactionDirection.DEBIT
        } else {
            template.direction
        }
        val kind = if (!template.type.isTransactionType()) {
            null
        } else {
            when {
                cardPayment || walletTopUp -> TransactionKind.TRANSFER
                transferPattern.containsMatchIn(text) -> TransactionKind.TRANSFER
                direction == TransactionDirection.CREDIT && refundPattern.containsMatchIn(text) ->
                    TransactionKind.REFUND
                direction == TransactionDirection.CREDIT && incomePattern.containsMatchIn(text) ->
                    TransactionKind.INCOME
                direction == TransactionDirection.CREDIT -> TransactionKind.INCOME
                else -> TransactionKind.SPEND
            }
        }

        val confidence = confidence(
            template = template,
            matchedText = regexMatch.value,
            hasAmount = amountMinor != null,
            hasMerchant = !merchant.isNullOrEmpty(),
            hasDigits = !digits.isNullOrEmpty(),
            hasReference = !referenceId.isNullOrEmpty(),
            ambiguous = countAmounts(text) > 1,
        )

        return ParsedMessage(
            type = template.type,
            amountMinor = amountMinor,
            direction = direction,
            kind = kind,
            merchant = merchant?.takeIf { it.isNotEmpty() },
            accountDigits = digits,
            balanceMinor = balanceMinor,
            referenceId = referenceId,
            confidence = confidence,
            templateId = template.id,
            wallet = wallet,
            source = source,
            version = version,
        )
    }

    private fun extractMerchant(text: String): String? {
        vpaPattern.find(text)?.let { match ->
            val handle = match.groupValues[1]
            if (handle.any { it.isDigit() }) return@let
            return MerchantNormalizer.display(handle).takeIf { it.isNotEmpty() }
        }
        for (match in merchantPattern.findAll(text)) {
            val candidate = match.groupOrNull("merchant")?.value ?: continue
            if (looksLikeCallToAction(candidate)) continue
            val extracted = MerchantNormalizer.extract(candidate)
            if (extracted.isNotEmpty()) return extracted
        }
        return null
    }

    private fun looksLikeCallToAction(candidate: String): Boolean {
        val lower = candidate.lowercase()
        if (lower.contains("http") || lower.contains("www.") || lower.contains("://")) return true
        return lower
            .split(Regex("""\s+"""))
            .map { it.trim('.', ',', '-', ':', ';', '|', '"', '\'') }
            .any { it in callToActionWords }
    }

    private fun walletName(text: String): String? {
        val match = walletPaymentPattern.find(text) ?: walletTopUpPattern.find(text)
        return match?.value?.trim()
    }

    private fun countAmounts(text: String): Int {
        val matches = Regex("""(?i)(?:(?:rs\.?|inr)\s*|₹\s*)${AMT}\b""").findAll(text)
        return matches
            .map { AmountParser.parseToMinor(it.value) }
            .filterNotNull()
            .distinct()
            .toList()
            .size
    }

    private fun confidence(
        template: Template,
        matchedText: String,
        hasAmount: Boolean,
        hasMerchant: Boolean,
        hasDigits: Boolean,
        hasReference: Boolean,
        ambiguous: Boolean,
    ): Float {
        if (!hasAmount) return 0.3f
        val hasCurrency = AmountParser.hasCurrencyMarker(matchedText)
        var score = when {
            template.strong && hasCurrency -> 0.93f
            template.strong -> 0.86f
            hasCurrency -> 0.90f
            else -> 0.84f
        }
        if (hasMerchant) score += 0.04f
        if (hasDigits) score += 0.02f
        if (hasReference) score += 0.02f
        if (ambiguous) score -= 0.10f
        return score.coerceIn(0f, 1f)
    }
}

/** A named group that may not exist in the pattern that matched. */
private fun MatchResult.groupOrNull(name: String): MatchGroup? =
    runCatching { groups[name] }.getOrNull()