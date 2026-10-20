import type { PluginListenerHandle } from '@capacitor/core'
import type {
  Account,
  AccountProposal,
  CandidateApp,
  Commitment,
  Goal,
  Budget,
  FinancialSettings,
  Category,
  Dashboard,
  IngestionStats,
  ListenerStatus,
  LocalExpensePlugin,
  RawEvent,
  RawEventPage,
  RawEventStatus,
  RecurringSummary,
  Rule,
  SetAccountPayload,
  SmsImportState,
  Transaction,
  TransactionPage,
} from './plugin'

const now = Date.now()

const sampleApps: CandidateApp[] = [
  { packageName: 'com.whatsapp', label: 'WhatsApp', suggested: false, category: '', isDefaultSms: false },
  { packageName: 'com.google.android.apps.nbu.paisa.user', label: 'Google Pay', suggested: true, category: 'upi', isDefaultSms: false },
  { packageName: 'com.phonepe.app', label: 'PhonePe', suggested: true, category: 'upi', isDefaultSms: false },
  { packageName: 'com.android.mms', label: 'Messages', suggested: false, category: '', isDefaultSms: true },
]

const sampleProposals: AccountProposal[] = [
  { packageName: 'com.google.android.apps.nbu.paisa.user', name: 'Google Pay', lastDigits: '4821', balanceMinor: 2543000 },
]

const categories: Category[] = [
  { id: 'cat_food', name: 'Food', kind: 'EXPENSE', color: '#f97316', icon: null },
  { id: 'cat_groceries', name: 'Groceries', kind: 'EXPENSE', color: '#84cc16', icon: null },
  { id: 'cat_transport', name: 'Transport', kind: 'EXPENSE', color: '#0ea5e9', icon: null },
  { id: 'cat_bills', name: 'Bills & Utilities', kind: 'EXPENSE', color: '#a855f7', icon: null },
  { id: 'cat_shopping', name: 'Shopping', kind: 'EXPENSE', color: '#ec4899', icon: null },
  { id: 'cat_health', name: 'Health', kind: 'EXPENSE', color: '#ef4444', icon: null },
  { id: 'cat_entertainment', name: 'Entertainment', kind: 'EXPENSE', color: '#eab308', icon: null },
  { id: 'cat_fees', name: 'Fees & Charges', kind: 'EXPENSE', color: '#64748b', icon: null },
  { id: 'cat_income', name: 'Income', kind: 'INCOME', color: '#22c55e', icon: null },
  { id: 'cat_transfers', name: 'Transfers', kind: 'TRANSFER', color: '#14b8a6', icon: null },
  { id: 'cat_uncategorized', name: 'Uncategorized', kind: 'EXPENSE', color: '#94a3b8', icon: null },
]

let seeded = 0

function seedEvent(overrides: Partial<RawEvent>): RawEvent {
  seeded += 1
  return {
    id: `mock-${seeded}`,
    source: 'NOTIFICATION',
    packageName: 'com.phonepe.app',
    sender: null,
    notificationKey: `mock-key-${seeded}`,
    title: 'PhonePe',
    text: 'Paid ₹450 to Swiggy',
    bigText: null,
    textLines: null,
    postedAt: now - seeded * 60_000,
    contentHash: `hash-${seeded}`,
    status: 'CAPTURED' as RawEventStatus,
    dismissedAt: null,
    parseVersion: 0,
    duplicateOf: null,
    createdAt: now - seeded * 60_000,
    transaction: null,
    parsed: null,
    ...overrides,
  }
}

function seedTransaction(overrides: Partial<Transaction>): Transaction {
  seeded += 1
  return {
    id: `tx-${seeded}`,
    rawEventId: null,
    accountId: null,
    amountMinor: 0,
    direction: 'DEBIT',
    kind: 'SPEND',
    merchantId: null,
    merchantName: null,
    categoryId: null,
    categoryName: null,
    referenceId: null,
    occurredAt: now - seeded * 60_000,
    confidence: 0.95,
    status: 'ACTIVE',
    source: 'AUTO',
    note: null,
    createdAt: now - seeded * 60_000,
    ...overrides,
  }
}

interface MockState {
  onboardingCompleted: boolean
  monitored: string[]
  accounts: Account[]
  events: RawEvent[]
  transactions: Transaction[]
  rules: Rule[]
  commitments: Commitment[]
  goals: Goal[]
  budgets: Budget[]
  financialSettings: FinancialSettings
}

function createState(): MockState {
  const events: RawEvent[] = [
    seedEvent({
      title: 'PhonePe',
      text: 'Paid ₹450 to Swiggy',
      postedAt: now - 60_000,
      status: 'PARSED',
    }),
    seedEvent({
      title: 'HDFC Bank',
      text: 'Rs.1,200.00 debited from A/c XX4821',
      postedAt: now - 3_600_000,
      status: 'PARSED',
    }),
    seedEvent({
      source: 'SMS',
      packageName: 'sms',
      sender: 'VK-HDFCBK',
      title: 'VK-HDFCBK',
      text: 'Your account is credited with Rs 5,000',
      postedAt: now - 86_400_000,
      status: 'PARSED',
    }),
    seedEvent({
      title: 'HDFC Bank',
      text: '123456 is your OTP for the transaction of Rs.5,000',
      postedAt: now - 90_000_000,
      status: 'IGNORED',
    }),
    seedEvent({
      title: 'PhonePe',
      text: 'Get ₹100 cashback on your next UPI transaction',
      postedAt: now - 120_000_000,
      status: 'IGNORED',
    }),
  ]
  const transactions: Transaction[] = [
    seedTransaction({ amountMinor: 45_000, merchantName: 'Swiggy', occurredAt: now - 60_000 }),
    seedTransaction({ amountMinor: 120_000, occurredAt: now - 3_600_000 }),
    seedTransaction({
      amountMinor: 500_000,
      direction: 'CREDIT',
      kind: 'INCOME',
      occurredAt: now - 86_400_000,
    }),
  ]
  events[0].transaction = transactions[0]
  events[1].transaction = transactions[1]
  events[2].transaction = transactions[2]
  events[0].parsed = {
    type: 'SPEND',
    amountMinor: 45_000,
    direction: 'DEBIT',
    kind: 'SPEND',
    merchant: 'Swiggy',
    accountDigits: null,
    balanceMinor: null,
    referenceId: null,
    confidence: 0.97,
  }
  events[1].parsed = {
    type: 'SPEND',
    amountMinor: 120_000,
    direction: 'DEBIT',
    kind: 'SPEND',
    merchant: null,
    accountDigits: '4821',
    balanceMinor: null,
    referenceId: null,
    confidence: 0.95,
  }

  return {
    onboardingCompleted: false,
    monitored: ['com.phonepe.app'],
    accounts: [],
    events,
    transactions,
    rules: [],
    commitments: [],
    goals: [],
    budgets: [],
    financialSettings: { bufferMinor: 0, incomeDay: 0, expectedIncomeMinor: 0, essentialCategories: [] },
  }
}

export type MockPlugin = LocalExpensePlugin & {
  emit: (name: string, data: unknown) => void
  reset: () => void
}

let activeMock: MockPlugin | null = null

/** Puts the mock back to its starting state, so tests do not leak into each other. */
export function resetMockPlugin() {
  activeMock?.reset()
}

export function createMockPlugin(): MockPlugin {
  let state = createState()
  const listeners = new Map<string, Set<(data: never) => void>>()

  function emit(name: string, data: unknown) {
    listeners.get(name)?.forEach((cb) => (cb as (d: unknown) => void)(data))
  }

  function addListener(name: string, cb: (data: never) => void): Promise<PluginListenerHandle> {
    const set = listeners.get(name) ?? new Set()
    set.add(cb)
    listeners.set(name, set)
    return Promise.resolve({
      remove: async () => {
        set.delete(cb)
      },
    })
  }

  const plugin: MockPlugin = {
    async getOnboardingState() {
      return { completed: state.onboardingCompleted }
    },
    async setOnboardingComplete({ completed }) {
      state.onboardingCompleted = completed
    },
    async getListenerStatus(): Promise<ListenerStatus> {
      return {
        accessGranted: true,
        state: 'CONNECTED',
        monitoredCount: state.monitored.length,
        lastEventAt: state.events[0]?.postedAt ?? 0,
        activeNotifications: 3,
      }
    },
    async openNotificationSettings() {},
    async openAppDetailsSettings() {},
    async getCandidateApps() {
      return { apps: sampleApps, defaultSmsPackage: 'com.android.mms' }
    },
    async getMonitoredApps() {
      return { packages: [...state.monitored] }
    },
    async setMonitoredApps({ packages }) {
      state.monitored = [...packages]
      return { count: packages.length }
    },
    async isIgnoringBatteryOptimizations() {
      return { ignoring: false }
    },
    async requestIgnoreBatteryOptimizations() {},
    async listAccounts() {
      return { accounts: [...state.accounts] }
    },
    async listAccountBalances() {
      return {
        balances: state.accounts.map((account) => ({
          ...account,
          derivedBalanceMinor: account.anchorBalanceMinor,
        })),
      }
    },
    async getDashboard(): Promise<Dashboard> {
      const spend = state.transactions.filter((t) => t.status === 'ACTIVE')
      const totalSpend = spend.reduce((sum, t) => sum + t.amountMinor, 0)
      const month = 30 * 24 * 60 * 60 * 1000
      return {
        totalBalanceMinor: state.accounts.reduce(
          (sum, account) => sum + account.anchorBalanceMinor,
          0,
        ),
        accounts: state.accounts.map((account) => ({
          id: account.id,
          name: account.name,
          lastDigits: account.lastDigits,
          derivedBalanceMinor: account.anchorBalanceMinor,
          anchorBalanceMinor: account.anchorBalanceMinor,
        })),
        burn: {
          dailyMinor: Math.round(totalSpend / 30),
          monthlyMinor: totalSpend,
          runwayDays: totalSpend > 0 ? 120 : null,
          runwayMonths: null,
          spendMinor: totalSpend,
          daysCounted: 30,
        },
        cashflow: [0, 1, 2, 3, 4, 5].map((index) => ({
          periodStart: now - (5 - index) * month,
          spendMinor: Math.round(totalSpend / 6),
          incomeMinor: Math.round(totalSpend / 3),
          netMinor: Math.round(totalSpend / 6),
        })),
        categories: categories.slice(0, 5).map((category, index) => ({
          categoryId: category.id,
          name: category.name,
          spendMinor: Math.round(totalSpend / (5 - index)),
          share: 1 / (5 - index),
          changeMinor: index === 0 ? 5000 : null,
        })),
        topMerchants: spend
          .filter((t) => t.merchantName)
          .slice(0, 5)
          .map((t) => ({
            merchantId: t.merchantId,
            name: t.merchantName ?? 'Unknown merchant',
            spendMinor: t.amountMinor,
            count: 1,
          })),
        recurring: [
          {
            merchantId: 'mock-1',
            name: 'Netflix',
            amountMinor: 65_000,
            cadence: 'MONTHLY',
            nextExpectedAt: now + 12 * 24 * 60 * 60 * 1000,
            lastSeenAt: now - 18 * 24 * 60 * 60 * 1000,
            priceIncreaseMinor: 5_000,
            status: 'SUGGESTED',
            confirmed: false,
          },
        ],
        savings: {
          totalMinor: 12_000,
          items: [
            {
              source: 'Subscription',
              detail: 'Netflix went up',
              amountMinor: 5_000,
            },
            { source: 'Fees', detail: 'Fees and charges', amountMinor: 7_000 },
          ],
        },
        safeToSpend: {
          todayMinor: 70_000,
          weekMinor: 35_000,
          daysLeft: 16,
          breakdown: [
            { source: 'Balance', detail: 'Money in your accounts', amountMinor: 135_000 },
            { source: 'Committed', detail: 'Bills due before month end', amountMinor: -65_000 },
          ],
        },
        needsReview: state.events.filter((e) => e.status === 'NEEDS_REVIEW').length,
        lastUpdatedAt: now,
      }
    },
    async setAccountBalance(payload: SetAccountPayload) {
      const existing = state.accounts.find((a) => a.id === payload.id)
      const account: Account = {
        id: existing?.id ?? payload.id ?? `account-${state.accounts.length + 1}`,
        name: payload.name,
        lastDigits: payload.lastDigits ?? null,
        type: payload.type ?? 'BANK',
        anchorBalanceMinor: payload.balanceMinor,
        anchorAt: payload.anchorAt ?? Date.now(),
        currency: payload.currency ?? 'INR',
        archived: false,
        createdAt: existing?.createdAt ?? Date.now(),
      }
      const index = state.accounts.findIndex((a) => a.id === account.id)
      if (index >= 0) {
        state.accounts[index] = account
      } else {
        state.accounts.push(account)
      }
      return { account }
    },
    async deleteAccount({ id }) {
      const index = state.accounts.findIndex((a) => a.id === id)
      if (index >= 0) state.accounts.splice(index, 1)
    },
    async detectAccounts() {
      return { proposals: sampleProposals }
    },
    async getSmsImportState(): Promise<SmsImportState> {
      return { supported: true, permissionGranted: true, lastImportAt: 0 }
    },
    async importSms() {
      return { imported: 0 }
    },
    async listRawEvents({ status, source, cursor, limit = 50 } = {}): Promise<RawEventPage> {
      const filtered = state.events
        .filter((e) => !status || e.status === status)
        .filter((e) => !source || e.source === source)
        .filter((e) => !cursor || e.postedAt < cursor.postedAt || (e.postedAt === cursor.postedAt && e.id < cursor.id))
        .sort((a, b) => b.postedAt - a.postedAt || b.id.localeCompare(a.id))
      const items = filtered.slice(0, limit)
      const nextCursor =
        items.length === limit
          ? { postedAt: items[items.length - 1].postedAt, id: items[items.length - 1].id }
          : undefined
      return { items, nextCursor }
    },
    async listTransactions({
      status,
      direction,
      categoryId,
      from,
      to,
      cursor,
      limit = 50,
    } = {}): Promise<TransactionPage> {
      const filtered = state.transactions
        .filter((t) => !status || t.status === status)
        .filter((t) => !direction || t.direction === direction)
        .filter((t) => !categoryId || t.categoryId === categoryId)
        .filter((t) => from == null || t.occurredAt >= from)
        .filter((t) => to == null || t.occurredAt <= to)
        .filter(
          (t) =>
            !cursor ||
            t.occurredAt < cursor.occurredAt ||
            (t.occurredAt === cursor.occurredAt && t.id < cursor.id),
        )
        .sort((a, b) => b.occurredAt - a.occurredAt || b.id.localeCompare(a.id))
      const items = filtered.slice(0, limit)
      const nextCursor =
        items.length === limit
          ? { occurredAt: items[items.length - 1].occurredAt, id: items[items.length - 1].id }
          : undefined
      return { items, nextCursor }
    },
    async getIngestionStats(): Promise<IngestionStats> {
      return {
        transactions: state.transactions.filter((t) => t.status === 'ACTIVE').length,
        needsReview: state.events.filter((e) => e.status === 'NEEDS_REVIEW').length,
        ignored: state.events.filter((e) => e.status === 'IGNORED').length,
        pending: state.events.filter((e) => e.status === 'CAPTURED').length,
        dismissed: state.events.filter((e) => e.status === 'DISMISSED').length,
      }
    },
    async reparsePending() {
      const pending = state.events.filter((e) => e.status === 'CAPTURED')
      return { processed: pending.length }
    },
    async reparseAll() {
      return { processed: state.events.length }
    },
    async listCategories() {
      return { categories }
    },
    async listRules() {
      return { rules: state.rules }
    },
    async listRecurring(): Promise<{ recurring: RecurringSummary[] }> {
      return {
        recurring: [
          {
            merchantId: 'mock-1',
            name: 'Netflix',
            amountMinor: 65_000,
            cadence: 'MONTHLY',
            nextExpectedAt: now + 12 * 24 * 60 * 60 * 1000,
            lastSeenAt: now - 18 * 24 * 60 * 60 * 1000,
            priceIncreaseMinor: 5_000,
            status: 'SUGGESTED',
            confirmed: false,
          },
        ],
      }
    },
    async setRecurringStatus({ status }) {
      return { status }
    },
    async deleteRule({ id }) {
      state.rules = state.rules.filter((rule) => rule.id !== id)
    },
    async dismissEvent({ id }) {
      const event = state.events.find((e) => e.id === id)
      if (!event) return { dismissed: false, voidedTransactionIds: [] }
      const transaction = event.transaction
      if (transaction) {
        transaction.status = 'VOIDED'
        state.transactions = state.transactions.filter((t) => t.id !== transaction.id)
      }
      event.transaction = null
      event.status = 'DISMISSED'
      event.dismissedAt = Date.now()
      return {
        dismissed: true,
        voidedTransactionIds: transaction ? [transaction.id] : [],
      }
    },
    async restoreEvent({ id }) {
      const event = state.events.find((e) => e.id === id)
      if (!event) return { restored: false }
      event.status = 'PARSED'
      event.dismissedAt = null
      return { restored: true }
    },
    async deleteRawEvent({ id }) {
      const index = state.events.findIndex((e) => e.id === id)
      if (index < 0) return { deleted: false }
      state.events.splice(index, 1)
      return { deleted: true }
    },
    async createIgnoreRule({ id }) {
      const event = state.events.find((e) => e.id === id)
      if (!event) return { created: false }
      const rule: Rule = {
        id: `rule-${event.id}`,
        type: 'IGNORE',
        packageName: event.packageName,
        senderPattern: event.sender,
        templatePattern: (event.text ?? '').replace(/\d+/g, '[\\d,.]+'),
        merchantContains: null,
        categoryId: null,
        enabled: true,
        createdAt: Date.now(),
      }
      state.rules = [rule, ...state.rules]
      return { created: true, ruleId: rule.id }
    },
    async promoteEvent({ id, as, amountMinor, merchantName, categoryId }) {
      const event = state.events.find((e) => e.id === id)
      if (!event) return { promoted: false, transaction: null }
      const transaction = seedTransaction({
        rawEventId: event.id,
        amountMinor: amountMinor ?? 0,
        direction: as === 'INCOME' ? 'CREDIT' : 'DEBIT',
        kind: as,
        merchantName: merchantName ?? null,
        categoryId: categoryId ?? null,
        occurredAt: event.postedAt,
        source: 'MANUAL',
      })
      state.transactions.push(transaction)
      event.transaction = transaction
      event.status = 'PARSED'
      return { promoted: true, transaction }
    },
    async confirmEvent({ id, amountMinor, merchantName, categoryId }) {
      const event = state.events.find((e) => e.id === id)
      if (!event) return { confirmed: false, transaction: null }
      const transaction = seedTransaction({
        rawEventId: event.id,
        amountMinor: amountMinor ?? 0,
        merchantName: merchantName ?? null,
        categoryId: categoryId ?? null,
        occurredAt: event.postedAt,
        source: 'MANUAL',
      })
      state.transactions.push(transaction)
      event.transaction = transaction
      event.status = 'PARSED'
      return { confirmed: true, transaction }
    },
    async createManualTransaction(options) {
      const transaction = seedTransaction({
        rawEventId: null,
        amountMinor: options.amountMinor,
        direction: options.direction ?? 'DEBIT',
        kind: options.kind ?? 'SPEND',
        accountId: options.accountId ?? null,
        categoryId: options.categoryId ?? null,
        merchantName: options.merchantName ?? null,
        occurredAt: options.occurredAt ?? Date.now(),
        source: 'MANUAL',
        note: options.note ?? null,
      })
      state.transactions.push(transaction)
      return { transaction }
    },
    async correctTransaction({ id, ...patch }) {
      const transaction = state.transactions.find((t) => t.id === id)
      if (!transaction) return { corrected: false, transaction: null }
      if (patch.amountMinor !== undefined) transaction.amountMinor = patch.amountMinor
      if (patch.categoryId !== undefined) {
        transaction.categoryId = patch.categoryId
        transaction.categoryName =
          categories.find((c) => c.id === patch.categoryId)?.name ?? null
      }
      if (patch.merchantName !== undefined) transaction.merchantName = patch.merchantName
      if (patch.note !== undefined) transaction.note = patch.note
      if (patch.occurredAt !== undefined) transaction.occurredAt = patch.occurredAt
      if (patch.kind !== undefined) transaction.kind = patch.kind
      return { corrected: true, transaction }
    },
    async listCommitments() { return { commitments: state.commitments } },
    async upsertCommitment(options) {
      const commitment: Commitment = {
        id: options.id ?? `commitment-${Date.now()}`,
        name: options.name,
        amountMinor: options.amountMinor,
        dueAt: options.dueAt,
        recurrence: options.recurrence ?? 'NONE',
        accountId: options.accountId ?? null,
        categoryId: options.categoryId ?? null,
        status: options.status ?? 'PENDING',
        paidTransactionId: options.paidTransactionId ?? null,
        note: options.note ?? null,
        createdAt: options.createdAt ?? Date.now(),
      }
      const idx = state.commitments.findIndex((c) => c.id === commitment.id)
      if (idx >= 0) state.commitments[idx] = commitment
      else state.commitments.push(commitment)
      return { commitment }
    },
    async deleteCommitment({ id }) { state.commitments = state.commitments.filter((c) => c.id !== id) },
    async setCommitmentStatus({ id, status }) {
      const c = state.commitments.find((x) => x.id === id)
      if (c) c.status = status
    },
    async listGoals() { return { goals: state.goals } },
    async upsertGoal(options) {
      const goal: Goal = {
        id: options.id ?? `goal-${Date.now()}`,
        name: options.name,
        targetMinor: options.targetMinor,
        savedMinor: options.savedMinor ?? 0,
        targetDate: options.targetDate ?? null,
        monthlyContributionMinor: options.monthlyContributionMinor ?? 0,
        priority: options.priority ?? 0,
        status: options.status ?? 'ACTIVE',
        createdAt: options.createdAt ?? Date.now(),
      }
      const idx = state.goals.findIndex((g) => g.id === goal.id)
      if (idx >= 0) state.goals[idx] = goal
      else state.goals.push(goal)
      return { goal }
    },
    async deleteGoal({ id }) { state.goals = state.goals.filter((g) => g.id !== id) },
    async setGoalStatus({ id, status }) {
      const g = state.goals.find((x) => x.id === id)
      if (g) g.status = status
    },
    async listBudgets() { return { budgets: state.budgets } },
    async upsertBudget(options) {
      const budget: Budget = {
        id: options.id ?? `budget-${Date.now()}`,
        categoryId: options.categoryId ?? null,
        period: options.period ?? 'MONTHLY',
        limitMinor: options.limitMinor,
        rollover: options.rollover ?? false,
        alertThresholds: options.alertThresholds ?? '50,80,100',
        startDay: options.startDay ?? 1,
        enabled: options.enabled ?? true,
      }
      const idx = state.budgets.findIndex((b) => b.id === budget.id)
      if (idx >= 0) state.budgets[idx] = budget
      else state.budgets.push(budget)
      return { budget }
    },
    async deleteBudget({ id }) { state.budgets = state.budgets.filter((b) => b.id !== id) },
    async getForecast() {
      return { points: [], minBalanceMinor: 0, endBalanceMinor: 0 }
    },
    async getFinancialSettings() { return { ...state.financialSettings, essentialCategories: [...state.financialSettings.essentialCategories] } },
    async setFinancialSettings(options) {
      if (options.bufferMinor !== undefined) state.financialSettings.bufferMinor = options.bufferMinor
      if (options.incomeDay !== undefined) state.financialSettings.incomeDay = options.incomeDay
      if (options.expectedIncomeMinor !== undefined) state.financialSettings.expectedIncomeMinor = options.expectedIncomeMinor
      if (options.essentialCategories !== undefined) state.financialSettings.essentialCategories = [...options.essentialCategories]
      return { ...state.financialSettings, essentialCategories: [...state.financialSettings.essentialCategories] }
    },
    addListener: addListener as LocalExpensePlugin['addListener'],
    async removeAllListeners() {
      listeners.clear()
    },
    // Exposed for dev affordances; not part of the native contract.
    emit,
    reset() {
      state = createState()
    },
  }

  activeMock = plugin
  return plugin
}
