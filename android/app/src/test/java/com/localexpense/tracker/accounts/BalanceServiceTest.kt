package com.localexpense.tracker.accounts

import com.localexpense.tracker.capture.ExtractedNotification
import com.localexpense.tracker.data.entity.TransactionDirection
import com.localexpense.tracker.data.entity.TransactionStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BalanceServiceTest {

    private fun tx(
        at: Long,
        amount: Long,
        direction: TransactionDirection,
        status: TransactionStatus = TransactionStatus.ACTIVE,
    ) = BalanceInput(at, amount, direction, status)

    @Test
    fun `derived balance ignores transactions before the anchor`() {
        val balance = BalanceService.derivedBalance(
            anchorBalanceMinor = 100_000,
            anchorAt = 1_000,
            transactions = listOf(
                tx(at = 500, amount = 9_999, direction = TransactionDirection.DEBIT),
                tx(at = 2_000, amount = 5_000, direction = TransactionDirection.DEBIT),
            ),
        )
        assertEquals(95_000, balance)
    }

    @Test
    fun `derived balance applies debits and credits with sign`() {
        val balance = BalanceService.derivedBalance(
            anchorBalanceMinor = 100_000,
            anchorAt = 0,
            transactions = listOf(
                tx(at = 10, amount = 20_000, direction = TransactionDirection.DEBIT),
                tx(at = 20, amount = 7_500, direction = TransactionDirection.CREDIT),
            ),
        )
        assertEquals(87_500, balance)
    }

    @Test
    fun `voided transactions are excluded`() {
        val balance = BalanceService.derivedBalance(
            anchorBalanceMinor = 50_000,
            anchorAt = 0,
            transactions = listOf(
                tx(at = 10, amount = 10_000, direction = TransactionDirection.DEBIT, status = TransactionStatus.VOIDED),
                tx(at = 20, amount = 1_000, direction = TransactionDirection.DEBIT),
            ),
        )
        assertEquals(49_000, balance)
    }

    @Test
    fun `parse amount handles grouping and decimals`() {
        assertEquals(123_450L, BalanceService.parseAmountMinor("1,234.50") ?: -1L)
        assertEquals(123_400L, BalanceService.parseAmountMinor("₹1,234") ?: -1L)
        assertEquals(5L, BalanceService.parseAmountMinor("0.05") ?: -1L)
        assertNull(BalanceService.parseAmountMinor("not-a-number"))
    }

    @Test
    fun `propose accounts extracts digits and balance`() {
        val message = ExtractedNotification(
            packageName = "com.hdfc.bank",
            notificationKey = "k",
            title = "HDFC Bank",
            text = "Rs.1,200.00 debited from A/c XX4821. Available balance Rs.25,430.00",
            bigText = null,
            textLines = emptyList(),
            postedAt = 0,
        )
        val proposals = BalanceService.proposeAccounts(listOf(message))
        assertEquals(1, proposals.size)
        assertEquals("4821", proposals[0].lastDigits)
        assertEquals(2_543_000L, proposals[0].balanceMinor ?: -1L)
    }

    @Test
    fun `propose accounts ignores messages without digits`() {
        val message = ExtractedNotification(
            packageName = "com.whatsapp",
            notificationKey = "k",
            title = "Alice",
            text = "Hello there",
            bigText = null,
            textLines = emptyList(),
            postedAt = 0,
        )
        assertTrue(BalanceService.proposeAccounts(listOf(message)).isEmpty())
    }
}
