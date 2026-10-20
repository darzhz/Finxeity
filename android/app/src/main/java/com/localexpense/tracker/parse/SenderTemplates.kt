package com.localexpense.tracker.parse

import com.localexpense.tracker.data.entity.TransactionDirection
import com.localexpense.tracker.data.entity.TransactionKind

/**
 * A pattern that recognises one notification shape.
 *
 * Named groups are optional; the parser understands `amount`, `merchant`,
 * `digits`, `balance` and `ref`.
 */
data class Template(
    val id: String,
    val pattern: Regex,
    val type: MessageType,
    val direction: TransactionDirection? = null,
    val kind: TransactionKind? = null,
    /**
     * Strong verbs ("debited", "credited") state what happened. Weak verbs
     * ("paid", "spent") are also used by offers, so they are discounted when the
     * message reads like an advertisement.
     */
    val strong: Boolean = true,
)

/**
 * Per-sender templates, tried before the generic ones.
 *
 * A template that matched a known sender is trusted slightly more than one that
 * matched a generic pattern, because the sender already implies the wording.
 */
object SenderTemplates {

    /** Amount fragment, reused in every pattern below. */
    private const val AMT =
        """(?:\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)"""

    private const val CURRENCY = """(?:rs\.?\s*|inr\s*|₹\s*)"""

    private const val MERCHANT = """[A-Za-z][A-Za-z0-9&'._-]*(?:\s+[A-Za-z0-9&'._-]+){0,3}"""

    /** UPI and wallet apps: "Paid ₹450 to Swiggy". */
    private val upiTemplates = listOf(
        Template(
            id = "upi.paid.to",
            pattern = Regex(
                """(?i)\bpaid\s+(?:you\s+)?$CURRENCY?(?<amount>$AMT)\s+(?:to|at|for)\s+(?<merchant>$MERCHANT)""",
            ),
            type = MessageType.SPEND,
            direction = TransactionDirection.DEBIT,
            strong = false,
        ),
        Template(
            id = "upi.paid",
            pattern = Regex("""(?i)\bpaid\s+(?:you\s+)?$CURRENCY?(?<amount>$AMT)\b"""),
            type = MessageType.SPEND,
            direction = TransactionDirection.DEBIT,
            strong = false,
        ),
    )

    /** Bank alerts: "Rs.500 debited from A/c XX4821". */
    private val bankTemplates = listOf(
        Template(
            id = "bank.debited.account",
            pattern = Regex(
                """(?i)(?:$CURRENCY)?(?<amount>$AMT)\s+(?:has\s+been\s+|was\s+)?debited\s+(?:from\s+)?(?:your\s+)?(?:a/c|acct|account)\s*(?:xx+)?\s*(?<digits>\d{4})""",
            ),
            type = MessageType.SPEND,
            direction = TransactionDirection.DEBIT,
        ),
        Template(
            id = "bank.credited.account",
            pattern = Regex(
                """(?i)(?:$CURRENCY)?(?<amount>$AMT)\s+(?:has\s+been\s+|was\s+)?credited\s+(?:to\s+)?(?:your\s+)?(?:a/c|acct|account)\s*(?:xx+)?\s*(?<digits>\d{4})""",
            ),
            type = MessageType.CREDIT,
            direction = TransactionDirection.CREDIT,
        ),
    )

    /** Package names that are known to send UPI style notifications. */
    private val upiPackages = setOf(
        "com.google.android.apps.nbu.paisa.user",
        "com.phonepe.app",
        "net.one97.paytm",
        "in.org.npci.upiapp",
        "com.samsung.android.spay",
        "com.google.android.apps.walletnfcrel",
        "com.dreamplug.androidapp",
    )

    /** Bank package names. */
    private val bankPackages = setOf(
        "com.sbi.lotusintouch",
        "com.icici.bank.imobile",
        "com.csam.icici.bank.imobile",
        "com.hdfc.bank",
        "com.hdfcbank.mobilebanking",
        "com.axis.mobile",
        "com.kotak.mahindra.mobilebanking",
        "com.msf.kbank.mobile",
    )

    /** Sender codes used by Indian banks in their SMS alerts. */
    private val senderBanks = listOf(
        "HDFC" to bankTemplates,
        "ICIC" to bankTemplates,
        "SBI" to bankTemplates,
        "AXIS" to bankTemplates,
        "KOTAK" to bankTemplates,
        "CANARA" to bankTemplates,
        "FEDERAL" to bankTemplates,
        "PNB" to bankTemplates,
        "BOI" to bankTemplates,
        "IDFC" to bankTemplates,
        "YES" to bankTemplates,
    )

    /**
     * Templates to try for a notification, most specific first. The generic
     * patterns always come last so that any sender is understood.
     */
    fun forPackage(packageName: String?): List<Template> {
        val specific = when (packageName) {
            in upiPackages -> upiTemplates
            in bankPackages -> bankTemplates
            else -> emptyList()
        }
        return specific + generic
    }

    /** Templates for an SMS sender code such as "VK-HDFCBK". */
    fun forSender(sender: String?): List<Template> {
        if (sender.isNullOrBlank()) return emptyList()
        val upper = sender.uppercase()
        val matched = senderBanks.firstOrNull { (code, _) -> upper.contains(code) } ?: return emptyList()
        return matched.second
    }

    /**
     * Patterns that apply to every sender. Strong verbs first: a bank alert that
     * says "debited" outranks an advertisement that says "pay".
     */
    val generic: List<Template> = listOf(
        Template(
            id = "spend.strong.currency",
            pattern = Regex(
                """(?i)$CURRENCY(?<amount>$AMT)\s*(?:has\s+been\s+|was\s+|is\s+)?(?:debited|deducted|debit)\b""",
            ),
            type = MessageType.SPEND,
            direction = TransactionDirection.DEBIT,
        ),
        Template(
            id = "spend.strong.plain",
            pattern = Regex(
                """(?i)\b(?:debited|deducted)\s*(?:of\s+)?(?:$CURRENCY)?(?<amount>$AMT)\b""",
            ),
            type = MessageType.SPEND,
            direction = TransactionDirection.DEBIT,
        ),
        Template(
            id = "credit.strong.currency",
            pattern = Regex(
                """(?i)$CURRENCY(?<amount>$AMT)\s*(?:has\s+been\s+|was\s+|is\s+)?(?:credited|received|deposited|refunded)\b""",
            ),
            type = MessageType.CREDIT,
            direction = TransactionDirection.CREDIT,
        ),
        Template(
            id = "credit.strong.plain",
            pattern = Regex(
                """(?i)\b(?:credited|received|deposited|refund(?:ed)?)\s*(?:of\s+)?(?:$CURRENCY)?(?<amount>$AMT)\b""",
            ),
            type = MessageType.CREDIT,
            direction = TransactionDirection.CREDIT,
        ),
        Template(
            id = "recharge.successful",
            pattern = Regex(
                """(?i)\brecharge\s+of\s+(?:$CURRENCY)?(?<amount>$AMT)\s+is\s+successful""",
            ),
            type = MessageType.SPEND,
            direction = TransactionDirection.DEBIT,
        ),
        Template(
            id = "wallet.topup",
            pattern = Regex(
                """(?i)(?:$CURRENCY)?(?<amount>$AMT)\s+(?:has\s+been\s+|was\s+)?(?:added|credited|topped\s*up|recharged)\s+(?:to\s+)?(?:your\s+)?(?:[A-Za-z0-9&'._-]+\s+){0,2}wallet""",
            ),
            type = MessageType.SPEND,
            direction = TransactionDirection.DEBIT,
        ),
        Template(
            id = "spend.weak.currency",
            pattern = Regex(
                """(?i)$CURRENCY(?<amount>$AMT)\s*(?:has\s+been\s+|was\s+)?(?:paid|spent|charged)\b""",
            ),
            type = MessageType.SPEND,
            direction = TransactionDirection.DEBIT,
            strong = false,
        ),
        Template(
            id = "spend.weak.plain",
            pattern = Regex(
                """(?i)\b(?:paid|payment\s+of|spent|charged)\s*(?:of\s+)?(?:$CURRENCY)?(?<amount>$AMT)\b""",
            ),
            type = MessageType.SPEND,
            direction = TransactionDirection.DEBIT,
            strong = false,
        ),
        Template(
            id = "credit.weak",
            pattern = Regex(
                """(?i)\b(?:credit|interest\s+credited)\s*(?:of\s+)?(?:$CURRENCY)?(?<amount>$AMT)\b""",
            ),
            type = MessageType.CREDIT,
            direction = TransactionDirection.CREDIT,
            strong = false,
        ),
        Template(
            id = "balance",
            pattern = Regex(
                """(?i)\b(?:avail(?:able)?\s+bal(?:ance)?|bal(?:ance)?)\b[^0-9₹]{0,16}(?:$CURRENCY)?(?<balance>$AMT)\b""",
            ),
            type = MessageType.BALANCE_ONLY,
        ),
    )
}
