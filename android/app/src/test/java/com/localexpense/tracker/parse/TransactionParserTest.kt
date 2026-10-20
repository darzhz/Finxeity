package com.localexpense.tracker.parse

import com.localexpense.tracker.data.entity.TransactionDirection
import com.localexpense.tracker.data.entity.TransactionKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TransactionParserTest {

    private fun parse(
        body: String,
        packageName: String? = null,
        sender: String? = null,
        title: String? = null,
    ) = TransactionParser.parse(packageName, sender, title, body)

    @Test
    fun `upi payment to a merchant is a spend`() {
        val parsed = parse("Paid ₹450 to Swiggy", packageName = "com.phonepe.app")
        assertEquals(MessageType.SPEND, parsed.type)
        assertEquals(45_000L, parsed.amountMinor)
        assertEquals(TransactionDirection.DEBIT, parsed.direction)
        assertEquals("Swiggy", parsed.merchant)
        assertTrue(parsed.confidence >= TransactionParser.CONFIDENCE_THRESHOLD)
    }

    @Test
    fun `bank debit is a spend and keeps the account digits`() {
        val parsed = parse(
            "Rs.1,200.00 debited from A/c XX4821",
            packageName = "com.hdfc.bank",
        )
        assertEquals(MessageType.SPEND, parsed.type)
        assertEquals(120_000L, parsed.amountMinor)
        assertEquals(TransactionDirection.DEBIT, parsed.direction)
        assertEquals("4821", parsed.accountDigits)
        assertTrue(parsed.confidence >= TransactionParser.CONFIDENCE_THRESHOLD)
    }

    @Test
    fun `bank credit is income`() {
        val parsed = parse(
            "Rs.5,000.00 credited to A/c XX4821",
            packageName = "com.hdfc.bank",
        )
        assertEquals(MessageType.CREDIT, parsed.type)
        assertEquals(500_000L, parsed.amountMinor)
        assertEquals(TransactionDirection.CREDIT, parsed.direction)
        assertEquals(TransactionKind.INCOME, parsed.kind)
    }

    @Test
    fun `refund is a credit of kind refund`() {
        val parsed = parse("₹450 refunded to your account", packageName = "com.phonepe.app")
        assertEquals(MessageType.CREDIT, parsed.type)
        assertEquals(TransactionKind.REFUND, parsed.kind)
    }

    @Test
    fun `otp messages are ignored`() {
        val parsed = parse("Your OTP is 123456 for the payment of ₹900")
        assertEquals(MessageType.OTP, parsed.type)
        assertNull(parsed.amountMinor)
    }

    @Test
    fun `offers are ignored`() {
        val parsed = parse("Get ₹100 cashback on your next UPI transaction")
        assertEquals(MessageType.PROMO, parsed.type)
        assertNull(parsed.amountMinor)
    }

    @Test
    fun `balance only messages are ignored`() {
        val parsed = parse("Available balance Rs.9,500.00", packageName = "com.hdfc.bank")
        assertEquals(MessageType.BALANCE_ONLY, parsed.type)
        assertEquals(950_000L, parsed.balanceMinor)
    }

    @Test
    fun `balance is extracted from a debit message`() {
        val parsed = parse(
            "Rs.500 debited from A/c XX4821. Available balance Rs.9,500.00",
            packageName = "com.hdfc.bank",
        )
        assertEquals(MessageType.SPEND, parsed.type)
        assertEquals(50_000L, parsed.amountMinor)
        assertEquals(950_000L, parsed.balanceMinor)
    }

    @Test
    fun `merchant is taken from a virtual payment address`() {
        val parsed = parse("Paid ₹450 to swiggy@paytm", packageName = "com.phonepe.app")
        assertEquals("Swiggy", parsed.merchant)
        assertEquals(45_000L, parsed.amountMinor)
    }

    @Test
    fun `merchant is not read from ordinary words`() {
        val parsed = parse("₹500 debited to your account", packageName = "com.hdfc.bank")
        assertNull(parsed.merchant)
    }

    @Test
    fun `a bare amount goes to review instead of becoming a transaction`() {
        val parsed = parse("₹999")
        assertEquals(MessageType.SPEND, parsed.type)
        assertEquals(99_900L, parsed.amountMinor)
        assertTrue(parsed.confidence < TransactionParser.CONFIDENCE_THRESHOLD)
    }

    @Test
    fun `an unknown message is ignored`() {
        val parsed = parse("Your monthly statement is ready")
        assertEquals(MessageType.OTHER, parsed.type)
        assertNull(parsed.amountMinor)
    }

    @Test
    fun `two different amounts lower the confidence`() {
        val single = parse("₹500 debited from A/c XX4821", packageName = "com.hdfc.bank")
        val ambiguous = parse("₹500 debited and ₹200 credited", packageName = "com.hdfc.bank")
        assertTrue(ambiguous.confidence < single.confidence)
    }

    @Test
    fun `reference id is captured`() {
        val parsed = parse(
            "₹450 debited to Swiggy. UPI ref no 412345678901",
            packageName = "com.phonepe.app",
        )
        assertEquals("412345678901", parsed.referenceId)
    }

    @Test
    fun `an sms sender code selects the bank templates`() {
        val parsed = parse(
            "Rs.1,200.00 debited from A/c XX4821",
            sender = "VK-HDFCBK",
            title = "VK-HDFCBK",
        )
        assertEquals(MessageType.SPEND, parsed.type)
        assertEquals("4821", parsed.accountDigits)
        assertEquals(120_000L, parsed.amountMinor)
    }

    @Test
    fun `a self transfer is not a spend`() {
        val parsed = parse(
            "₹5,000 debited to your own account",
            packageName = "com.hdfc.bank",
        )
        assertEquals(TransactionKind.TRANSFER, parsed.kind)
    }
}
