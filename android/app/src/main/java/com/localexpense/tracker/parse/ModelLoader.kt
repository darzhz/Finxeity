package com.localexpense.tracker.parse

import android.content.Context

/**
 * Loads and manages ML model assets.
 */
object ModelLoader {

    private const val MODEL_FILENAME = "mobilebert_int8.onnx"
    private const val VOCAB_FILENAME = "vocab.txt"

    /** Returns the path to the extracted model file in cache. */
    fun getModelPath(context: Context): String {
        val cacheFile = context.cacheDir.resolve(MODEL_FILENAME)
        if (!cacheFile.exists()) {
            context.assets.open(MODEL_FILENAME).use { input ->
                cacheFile.outputStream().use { output ->
                    input.copyTo(output)
                }
            }
        }
        return cacheFile.absolutePath
    }

    /** Checks if model assets exist. */
    fun isModelAvailable(context: Context): Boolean {
        return try {
            context.assets.open(MODEL_FILENAME).use { it.close() }
            context.assets.open(VOCAB_FILENAME).use { it.close() }
            true
        } catch (e: Exception) {
            false
        }
    }

    /** Creates WordPieceTokenizer from assets. */
    fun createTokenizer(context: Context): WordPieceTokenizer =
        WordPieceTokenizer.fromAssets(context)
}