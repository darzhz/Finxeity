package com.localexpense.tracker.parse

import android.content.Context
import android.content.res.AssetManager
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.HashMap

/**
 * WordPiece tokenizer ported to Kotlin for on-device MobileBERT inference.
 *
 * This tokenizer:
 * - Loads vocab from assets/vocab.txt
 * - Performs WordPiece tokenization with ## continuation markers
 * - Tracks character offsets for each token to map spans back to original text
 * - Adds [CLS] and [SEP] special tokens
 * - Pads/truncates to max sequence length
 */
class WordPieceTokenizer(
    private val vocab: Map<String, Int>,
    private val unkToken: String = "[UNK]",
    private val clsToken: String = "[CLS]",
    private val sepToken: String = "[SEP]",
    private val padToken: String = "[PAD]",
    private val maxLength: Int = 128,
) {

    private val unkId = vocab[unkToken] ?: throw IllegalStateException("Vocab missing $unkToken")
    private val clsId = vocab[clsToken] ?: throw IllegalStateException("Vocab missing $clsToken")
    private val sepId = vocab[sepToken] ?: throw IllegalStateException("Vocab missing $sepToken")
    private val padId = vocab[padToken] ?: throw IllegalStateException("Vocab missing $padToken")

    companion object {
        /** Loads tokenizer from assets/vocab.txt */
        fun fromAssets(context: Context): WordPieceTokenizer {
            val assetManager = context.assets
            val vocab = loadVocab(assetManager)
            return WordPieceTokenizer(vocab)
        }

        private fun loadVocab(assets: AssetManager): Map<String, Int> {
            val inputStream = assets.open("vocab.txt")
            val reader = BufferedReader(InputStreamReader(inputStream))
            val vocab = HashMap<String, Int>()
            var index = 0
            reader.useLines { lines ->
                lines.forEach { line ->
                    val token = line.trim()
                    if (token.isNotEmpty()) {
                        vocab[token] = index
                        index++
                    }
                }
            }
            if (vocab.isEmpty()) {
                throw IllegalStateException("Vocab file is empty or failed to load")
            }
            return vocab
        }
    }

    /**
     * Encodes text for MobileBERT input.
     *
     * Input format: [CLS] package_name [SEP] title [SEP] body [SEP]
     * Returns tokenized input with character offsets for span mapping.
     */
    fun encode(
        packageName: String?,
        title: String?,
        body: String?,
    ): TokenizedInput {
        // Build combined text with special token markers
        val parts = mutableListOf<String>()
        val partRanges = mutableListOf<IntRange>() // character ranges in combined text

        // Package name (sender/app context)
        val pkg = packageName?.takeIf { it.isNotBlank() } ?: "unknown"
        parts.add(pkg)
        partRanges.add(0 until pkg.length)

        // Title
        val titleText = title?.takeIf { it.isNotBlank() } ?: ""
        val titleStart = parts.joinToString("").length + 1 // +1 for space
        parts.add(titleText)
        partRanges.add(titleStart until titleStart + titleText.length)

        // Body
        val bodyText = body?.takeIf { it.isNotBlank() } ?: ""
        val bodyStart = parts.joinToString("").length + 1
        parts.add(bodyText)
        partRanges.add(bodyStart until bodyStart + bodyText.length)

        val fullText = parts.joinToString(" ")

        // Tokenize with WordPiece
        val (tokens, tokenOffsets) = tokenizeWithOffsets(fullText)

        // Add special tokens: [CLS] tokens [SEP] tokens [SEP]
        val inputIds = mutableListOf<Int>()
        val attentionMask = mutableListOf<Int>()
        val offsets = mutableListOf<IntRange?>()

        // [CLS]
        inputIds.add(clsId)
        attentionMask.add(1)
        offsets.add(null)

        // First segment: package name + title
        var tokenIdx = 0
        while (tokenIdx < tokens.size) {
            val token = tokens[tokenIdx]
            val offset = tokenOffsets[tokenIdx]
            // Check if we've reached title end
            if (offset != null && offset.first >= partRanges[1].last) break
            val id = vocab[token] ?: unkId
            inputIds.add(id)
            attentionMask.add(1)
            offsets.add(offset)
            tokenIdx++
        }

        // [SEP] after first segment
        inputIds.add(sepId)
        attentionMask.add(1)
        offsets.add(null)

        // Second segment: body
        while (tokenIdx < tokens.size) {
            val token = tokens[tokenIdx]
            val offset = tokenOffsets[tokenIdx]
            val id = vocab[token] ?: unkId
            inputIds.add(id)
            attentionMask.add(1)
            offsets.add(offset)
            tokenIdx++
        }

        // [SEP] at end
        inputIds.add(sepId)
        attentionMask.add(1)
        offsets.add(null)

        // Truncate if too long
        if (inputIds.size > maxLength) {
            truncateToMax(inputIds)
            truncateToMax(attentionMask)
            truncateToMax(offsets)
        }

        // Pad if too short
        while (inputIds.size < maxLength) {
            inputIds.add(padId)
            attentionMask.add(0)
            offsets.add(null)
        }

        return TokenizedInput(
            inputIds = inputIds.toIntArray(),
            attentionMask = attentionMask.toIntArray(),
            offsets = offsets.toTypedArray(),
            originalText = fullText,
        )
    }

    /**
     * WordPiece tokenization with character offset tracking.
     *
     * Returns list of tokens and their character ranges in the original text.
     * Special tokens (## continuations) share the offset of their first piece.
     */
    private fun tokenizeWithOffsets(text: String): Pair<List<String>, List<IntRange?>> {
        val tokens = mutableListOf<String>()
        val offsets = mutableListOf<IntRange?>()

        // Split on whitespace first (basic tokenization)
        val basicTokens = splitOnWhitespaceWithOffsets(text)

        for ((basicToken, tokenRange) in basicTokens) {
            val wordPieces = wordPieceTokenize(basicToken)
            if (wordPieces.isEmpty()) {
                tokens.add(unkToken)
                offsets.add(tokenRange)
            } else {
                for (i in wordPieces.indices) {
                    tokens.add(wordPieces[i])
                    // First piece gets the actual offset, continuations get same offset start
                    if (i == 0) {
                        offsets.add(tokenRange)
                    } else {
                        // Continuation: map to the start of the original token
                        offsets.add(tokenRange.start until tokenRange.start)
                    }
                }
            }
        }

        return tokens to offsets
    }

    /** Splits text on whitespace while preserving character offsets. */
    private fun splitOnWhitespaceWithOffsets(text: String): List<Pair<String, IntRange>> {
        val result = mutableListOf<Pair<String, IntRange>>()
        var start = 0
        while (start < text.length) {
            // Skip whitespace
            while (start < text.length && text[start].isWhitespace()) start++
            if (start >= text.length) break
            var end = start
            while (end < text.length && !text[end].isWhitespace()) end++
            val token = text.substring(start, end)
            result.add(token to (start until end))
            start = end
        }
        return result
    }

    /**
     * WordPiece algorithm: greedily find longest matching subword.
     * Prefixes continuation pieces with ##.
     */
    private fun wordPieceTokenize(token: String): List<String> {
        if (token.isEmpty()) return emptyList()
        if (vocab.containsKey(token)) return listOf(token)

        val chars = token.toCharArray()
        val pieces = mutableListOf<String>()
        var start = 0

        while (start < chars.size) {
            var end = chars.size
            var found = false

            while (end > start) {
                val substr = String(chars, start, end - start)
                val candidate = if (start == 0) substr else "##$substr"
                if (vocab.containsKey(candidate)) {
                    pieces.add(candidate)
                    start = end
                    found = true
                    break
                }
                end--
            }

            if (!found) {
                // Unknown character - emit [UNK] for the rest
                pieces.add(unkToken)
                break
            }
        }

        return pieces
    }

    /** Truncates lists to maxLength. */
private fun truncateToMax(list: MutableList<*>) {
    if (list.size > maxLength) {
        list.subList(maxLength, list.size).clear()
    }
}

/** Vocabulary size */
    val vocabSize: Int = vocab.size
}

/** Result of tokenization with offsets for span mapping. */
data class TokenizedInput(
    val inputIds: IntArray,
    val attentionMask: IntArray,
    /** Character range in original text for each token, null for special tokens. */
    val offsets: Array<IntRange?>,
    val originalText: String,
)