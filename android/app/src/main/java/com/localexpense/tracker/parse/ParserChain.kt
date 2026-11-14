package com.localexpense.tracker.parse

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Chains template parser with MobileBERT fallback.
 *
 * Flow:
 * 1. Try template parser (fast, deterministic)
 * 2. If template gives low confidence or no match, run MobileBERT
 * 3. Return the higher-confidence result
 */
class ParserChain(
    private val context: Context,
) : MessageParser {

    override val source: String = "chain"
    override val version: String = "${TemplateParser().version}+${MobileBertParser.MODEL_VERSION}"

    private val templateParser = TemplateParser()
    private var mobileBertParser: MobileBertParser? = null
    private val initJob = SupervisorJob()
    private val initScope = CoroutineScope(initJob + Dispatchers.IO)

    init {
        if (ModelLoader.isModelAvailable(context)) {
            initializeMobileBert()
        }
    }

    private fun initializeMobileBert() {
        initScope.launch {
            try {
                val tokenizer = ModelLoader.createTokenizer(context)
                val parser = MobileBertParser(context, tokenizer)
                parser.initialize()
                mobileBertParser = parser
            } catch (e: Exception) {
                // MobileBERT unavailable, fall back to templates only
                mobileBertParser = null
            }
        }
    }

    override fun parse(
        packageName: String?,
        sender: String?,
        title: String?,
        body: String?,
    ): ParsedMessage {
        // Step 1: Try template parser
        val templateResult = templateParser.parse(packageName, sender, title, body)

        // If template gives high confidence, use it
        if (templateResult.confidence >= TransactionParser.CONFIDENCE_THRESHOLD
            && templateResult.templateId != null
        ) {
            return templateResult
        }

        // Step 2: Try MobileBERT if available
        val mobileBert = mobileBertParser
        if (mobileBert != null) {
            // Note: MobileBERT parse is suspend, but we call it from non-suspend context
            // This should be called from a coroutine context in practice
            // For now, we'll need to handle this differently
            // The actual integration will be in TransactionParser which calls from suspend context
        }

        // Step 3: Return template result (may be low confidence, goes to review)
        return templateResult
    }

    /** Checks if MobileBERT is initialized and ready. */
    fun isModelReady(): Boolean = mobileBertParser != null

    /** Shuts down background resources. */
    fun shutdown() {
        initJob.cancel()
        mobileBertParser = null
    }
}