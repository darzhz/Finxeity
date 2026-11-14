package com.localexpense.tracker.parse

/**
 * Interface for parsing a captured message into a structured interpretation.
 *
 * Two implementations exist:
 * - [TemplateParser]: deterministic regex-based parsing, high precision for known senders
 * - [MobileBertParser]: ML-based fallback for unknown/unmatched messages
 */
interface MessageParser {

    /** Unique identifier for this parser (e.g., "template", "model"). */
    val source: String

    /** Version of the model/ruleset (e.g., "2" for templates, "mobilebert-v1" for model). */
    val version: String

    /**
     * Parses one captured message.
     *
     * @param packageName the app package the message came from (null for SMS)
     * @param sender the SMS sender code (e.g., "VK-HDFCBK"), null for notifications
     * @param title the notification title
     * @param body the notification body text
     * @return a [ParsedMessage] with type, extracted fields, and confidence
     */
    fun parse(
        packageName: String?,
        sender: String?,
        title: String?,
        body: String?,
    ): ParsedMessage
}