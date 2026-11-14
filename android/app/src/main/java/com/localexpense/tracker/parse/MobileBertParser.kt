package com.localexpense.tracker.parse

import android.content.Context
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleObserver
import androidx.lifecycle.OnLifecycleEvent
import com.localexpense.tracker.data.entity.TransactionDirection
import com.localexpense.tracker.data.entity.TransactionKind
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtException
import ai.onnxruntime.OrtSession
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.nio.FloatBuffer
import java.nio.LongBuffer

/**
 * MobileBERT parser for message classification and named entity recognition.
 *
 * Runs on a background thread via CoroutineScope. Uses a singleton ONNX session.
 * Two-head model:
 * - Head 1: Sequence classification (6 classes: SPEND, CREDIT, BALANCE_ONLY, OTP, PROMO, OTHER)
 * - Head 2: Token classification (BIO tags for: amount, merchant, account_digits, balance, reference, date, due_date)
 */
class MobileBertParser(
    private val context: Context,
    private val tokenizer: WordPieceTokenizer,
) : MessageParser, LifecycleObserver {

    override val source: String = "model"
    override val version: String = "mobilebert-v1"

    // Model configuration
    private val MODEL_ASSET = "mobilebert_int8.onnx"
    private val MAX_SEQ_LENGTH = 128

    // Message type mapping (must match model training)
    private val MESSAGE_TYPES = arrayOf(
        "SPEND", "CREDIT", "BALANCE_ONLY", "OTP", "PROMO", "OTHER"
    )

    // NER label mapping (BIO scheme)
    private val NER_LABELS = arrayOf(
        "O",                    // 0: Outside
        "B-AMOUNT", "I-AMOUNT", // 1,2: Amount
        "B-MERCHANT", "I-MERCHANT", // 3,4: Merchant
        "B-ACCOUNT", "I-ACCOUNT", // 5,6: Account digits
        "B-BALANCE", "I-BALANCE", // 7,8: Balance
        "B-REFERENCE", "I-REFERENCE", // 9,10: Reference ID
        "B-DATE", "I-DATE",     // 11,12: Date
        "B-DUE_DATE", "I-DUE_DATE", // 13,14: Due date
    )

    // ONNX session (lazy loaded on background thread)
    @Volatile
    private var session: OrtSession? = null
    private val initJob = SupervisorJob()
    private val initScope = CoroutineScope(initJob + Dispatchers.IO)
    private var initError: Throwable? = null

    /** Initializes the ONNX session asynchronously. Call before first parse. */
    fun initialize() {
        initScope.launch {
            try {
                val env = OrtEnvironment.getEnvironment()
                val modelPath = extractModelToCache(context, MODEL_ASSET)
                val sessionOptions = OrtSession.SessionOptions()
                sessionOptions.addConfigEntry("session.use_nnapi", "0") // Use CPU
                sessionOptions.addConfigEntry("session.intra_op_num_threads", "1")
                session = env.createSession(modelPath, sessionOptions)
            } catch (e: Exception) {
                initError = e
            }
        }
    }

    /** Extracts model asset to cache directory for ONNX Runtime to read. */
    private fun extractModelToCache(context: Context, assetName: String): String {
        val cacheFile = context.cacheDir.resolve(assetName)
        if (!cacheFile.exists()) {
            context.assets.open(assetName).use { input ->
                cacheFile.outputStream().use { output ->
                    input.copyTo(output)
                }
            }
        }
        return cacheFile.absolutePath
    }

    /** Ensures session is initialized, throws if initialization failed. */
    private fun ensureSession(): OrtSession {
        // For non-suspend context, we block until session is ready
        // In practice, initialize() is called at startup so session should be ready
        var attempts = 0
        while (session == null && initError == null && attempts < 100) {
            Thread.sleep(10)
            attempts++
        }
        if (initError != null) throw initError!!
        return session!!
    }

    override fun parse(
        packageName: String?,
        sender: String?,
        title: String?,
        body: String?,
    ): ParsedMessage {
        val ortSession = ensureSession()

        // Build input text: "package_name title body"
        val inputText = buildInputText(packageName, sender, title, body)
        if (inputText.isBlank()) {
            return ParsedMessage.ignored(MessageType.OTHER, source = source, version = version)
        }

        // Tokenize
        val tokenized = tokenizer.encode(packageName, title, body)

        // Prepare ONNX inputs
        val inputIdsBuffer = LongBuffer.allocate(MAX_SEQ_LENGTH)
        tokenized.inputIds.forEachIndexed { i, v -> inputIdsBuffer.put(i, v.toLong()) }
        inputIdsBuffer.rewind()

        val attentionMaskBuffer = LongBuffer.allocate(MAX_SEQ_LENGTH)
        tokenized.attentionMask.forEachIndexed { i, v -> attentionMaskBuffer.put(i, v.toLong()) }
        attentionMaskBuffer.rewind()

        val env = OrtEnvironment.getEnvironment()
        val inputIds = OnnxTensor.createTensor(
            env,
            inputIdsBuffer,
            longArrayOf(1, MAX_SEQ_LENGTH.toLong()),
        )
        val attentionMask = OnnxTensor.createTensor(
            env,
            attentionMaskBuffer,
            longArrayOf(1, MAX_SEQ_LENGTH.toLong()),
        )

        // Run inference
        val inputNames = ortSession.inputNames
        val outputNames = ortSession.outputNames

        val inputs = mapOf(
            inputNames.first() to inputIds,
            inputNames.elementAt(1) to attentionMask,
        )

        val outputs = ortSession.run(inputs)

        // Parse outputs
        val classificationLogits = outputs[outputNames.first()] as OnnxTensor
        val nerLogits = outputs[outputNames.elementAt(1)] as OnnxTensor

        val parsed = processOutputs(
            classificationLogits,
            nerLogits,
            tokenized,
            inputText,
        )

        // Close tensors to free native memory
        inputIds.close()
        attentionMask.close()
        outputs.forEach { (_, value) -> value.close() }

        return parsed
    }

    /** Builds input text with package context prefix. */
    private fun buildInputText(
        packageName: String?,
        sender: String?,
        title: String?,
        body: String?,
    ): String {
        val parts = mutableListOf<String>()
        val pkg = packageName?.takeIf { it.isNotBlank() } ?: sender ?: "unknown"
        parts.add(pkg)
        title?.takeIf { it.isNotBlank() }?.let { parts.add(it) }
        body?.takeIf { it.isNotBlank() }?.let { parts.add(it) }
        return parts.joinToString(" ")
    }

    /** Processes model outputs into ParsedMessage. */
    private fun processOutputs(
        classificationLogits: OnnxTensor,
        nerLogits: OnnxTensor,
        tokenized: TokenizedInput,
        originalText: String,
    ): ParsedMessage {
        // Head 1: Sequence classification
        val classProbs = softmax(classificationLogits.floatBuffer)
        val classIdx = classProbs.indices.maxByOrNull { classProbs[it] } ?: 5 // OTHER
        val confidence = classProbs[classIdx]
        val messageType = MessageType.valueOf(MESSAGE_TYPES[classIdx])

        // Head 2: NER token classification
        val nerProbs = nerLogits.floatBuffer
        val seqLen = tokenized.inputIds.size
        val numLabels = NER_LABELS.size

        val predictedLabels = IntArray(seqLen)
        for (i in 0 until seqLen) {
            var bestIdx = 0
            var bestProb = Float.NEGATIVE_INFINITY
            val offset = i * numLabels
            for (j in 0 until numLabels) {
                val prob = nerProbs[offset + j]
                if (prob > bestProb) {
                    bestProb = prob
                    bestIdx = j
                }
            }
            predictedLabels[i] = bestIdx
        }

        // Extract entities from BIO tags using character offsets
        val entities = extractEntitiesFromBio(
            predictedLabels,
            tokenized.offsets,
            originalText,
        )

        // Map to ParsedMessage fields
        return buildParsedMessage(
            messageType,
            confidence,
            entities,
            originalText,
        )
    }

    /** Softmax for classification logits. */
    private fun softmax(buffer: FloatBuffer): FloatArray {
        val arr = FloatArray(buffer.remaining())
        buffer.get(arr)
        val max = arr.maxOrNull() ?: 0f
        var expSum = 0.0
        for (v in arr) {
            expSum += kotlin.math.exp(v - max)
        }
        return arr.map { (kotlin.math.exp(it - max) / expSum).toFloat() }.toFloatArray()
    }

    /** Extracts entity spans from BIO tags using character offsets. */
    private fun extractEntitiesFromBio(
        labels: IntArray,
        offsets: Array<IntRange?>,
        text: String,
    ): Map<String, String> {
        val entities = mutableMapOf<String, StringBuilder>()
        var currentEntity: String? = null
        var currentBuilder: StringBuilder? = null
        var entityStart = -1

        for (i in labels.indices) {
            val labelIdx = labels[i]
            val label = if (labelIdx < NER_LABELS.size) NER_LABELS[labelIdx] else "O"
            val offset = offsets[i]

            val isBegin = label.startsWith("B-")
            val isInside = label.startsWith("I-")
            val entityType = if (isBegin || isInside) label.substring(2) else null

            if (isBegin) {
                // Save previous entity
                if (currentEntity != null && currentBuilder != null && currentBuilder.isNotEmpty()) {
                    entities[currentEntity] = currentBuilder
                }
                // Start new entity
                currentEntity = entityType
                currentBuilder = StringBuilder()
                entityStart = offset?.first ?: i
            } else if (isInside && currentEntity == entityType) {
                // Continue current entity
            } else {
                // End current entity
                if (currentEntity != null && currentBuilder != null && currentBuilder.isNotEmpty()) {
                    entities[currentEntity] = currentBuilder
                }
                currentEntity = null
                currentBuilder = null
            }

            // Add character to current entity if we have valid offset
            if (currentBuilder != null && offset != null && offset.first >= 0 && offset.last <= text.length) {
                val spanText = text.substring(offset.first, offset.last)
                // Skip ## continuation markers in reconstruction
                if (!spanText.startsWith("##")) {
                    currentBuilder.append(spanText)
                }
            }
        }

        // Don't forget last entity
        if (currentEntity != null && currentBuilder != null && currentBuilder.isNotEmpty()) {
            entities[currentEntity] = currentBuilder
        }

        return entities.mapValues { it.value.toString().trim() }
    }

    /** Builds final ParsedMessage from extracted entities. */
    private fun buildParsedMessage(
        messageType: MessageType,
        confidence: Float,
        entities: Map<String, String>,
        originalText: String,
    ): ParsedMessage {
        val amountMinor = entities["AMOUNT"]?.let { AmountParser.parseToMinor(it) }
        val balanceMinor = entities["BALANCE"]?.let { AmountParser.parseToMinor(it) }
        val merchant = entities["MERCHANT"]?.takeIf { it.isNotEmpty() }
        val accountDigits = entities["ACCOUNT"]?.takeIf { it.isNotEmpty() }
        val referenceId = entities["REFERENCE"]?.takeIf { it.isNotEmpty() }

        // Determine direction and kind from message type
        val (direction, kind) = when (messageType) {
            MessageType.SPEND -> TransactionDirection.DEBIT to TransactionKind.SPEND
            MessageType.CREDIT -> TransactionDirection.CREDIT to TransactionKind.INCOME
            else -> null to null
        }

        // Check for transfer patterns
        val isTransfer = originalText.contains("transfer", ignoreCase = true) ||
            originalText.contains("wallet", ignoreCase = true) ||
            originalText.contains("card", ignoreCase = true)

        return ParsedMessage(
            type = messageType,
            amountMinor = amountMinor,
            direction = direction,
            kind = if (isTransfer) TransactionKind.TRANSFER else kind,
            merchant = merchant,
            accountDigits = accountDigits,
            balanceMinor = balanceMinor?.takeIf { amountMinor == null || it != amountMinor },
            referenceId = referenceId,
            confidence = confidence,
            templateId = "mobilebert",
            source = source,
            version = version,
        )
    }

    /** Called when the hosting component (e.g., Application) is destroyed. */
    @OnLifecycleEvent(Lifecycle.Event.ON_DESTROY)
    fun onDestroy() {
        initJob.cancel()
        session?.close()
        session = null
    }

    companion object {
        const val MODEL_VERSION = "mobilebert-v1"
    }
}