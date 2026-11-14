package com.localexpense.tracker.parse

import android.content.Context
import com.localexpense.tracker.data.entity.TransactionDirection
import com.localexpense.tracker.data.entity.TransactionKind

/**
 * Facade for parsing messages. Uses [ParserChain] which combines templates + MobileBERT.
 *
 * The parser is pure: it takes strings and returns a [ParsedMessage]. It knows
 * nothing about the database, which is what makes the fixture corpus in the
 * unit tests meaningful.
 */
object TransactionParser {

    /** Bumped whenever the parsing rules change, so old events can be reparsed. */
    const val PARSE_VERSION = 2

    /** Parses at or above this confidence become transactions on their own. */
    const val CONFIDENCE_THRESHOLD = 0.85f

    @Volatile
    private var parserChain: ParserChain? = null

    /**
     * Initializes the parser chain with MobileBERT support.
     * Call once at app startup (e.g., in TrackerGraph.init).
     */
    fun initialize(context: Context) {
        parserChain = ParserChain(context)
    }

    /** Returns true if MobileBERT model is loaded and ready. */
    fun isModelReady(): Boolean = parserChain?.isModelReady() == true

    /**
     * Parses one captured message.
     *
     * @param packageName the app the message came from, used to pick templates.
     * @param sender the sender code for SMS, empty for notifications.
     * @param title the notification title.
     * @param body the notification body.
     */
    fun parse(
        packageName: String?,
        sender: String?,
        title: String?,
        body: String?,
    ): ParsedMessage {
        return parserChain?.parse(packageName, sender, title, body)
            ?: TemplateParser().parse(packageName, sender, title, body)
    }

    /** Shuts down parser resources (for testing). */
    fun shutdown() {
        parserChain?.shutdown()
        parserChain = null
    }
}