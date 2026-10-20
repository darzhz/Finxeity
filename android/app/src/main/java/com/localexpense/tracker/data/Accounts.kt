package com.localexpense.tracker.data

import com.localexpense.tracker.data.dao.AccountDao
import com.localexpense.tracker.data.entity.AccountEntity
import com.localexpense.tracker.data.entity.AccountType

/**
 * Links a message to the account it belongs to, when the digits give it away.
 */
object Accounts {

    suspend fun link(dao: AccountDao, digits: String?): AccountEntity? {
        val accounts = dao.list().filter { !it.archived }
        if (accounts.isEmpty()) return null
        if (digits != null) {
            accounts.firstOrNull { it.lastDigits == digits }?.let { return it }
        }
        // With a single known account there is nothing else it could be.
        return accounts.singleOrNull()
    }

    /**
     * A message about a wallet says nothing about the bank account, so it only
     * links to a tracked wallet.
     */
    suspend fun link(dao: AccountDao, digits: String?, wallet: String?): AccountEntity? {
        if (wallet != null) {
            return dao.list().firstOrNull { !it.archived && it.type == AccountType.WALLET }
        }
        return link(dao, digits)
    }
}
