import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { createMockPlugin } from './plugin-mock'

export type RawEventStatus =
  | 'CAPTURED'
  | 'PARSED'
  | 'IGNORED'
  | 'NEEDS_REVIEW'
  | 'DISMISSED'

export type RawEventSource = 'NOTIFICATION' | 'SMS'

export type AccountType = 'BANK' | 'CARD' | 'WALLET' | 'CASH' | 'OTHER'

export interface RawEvent {
  id: string
  source: RawEventSource
  packageName: string | null
  sender: string | null
  notificationKey: string
  title: string | null
  text: string | null
  bigText: string | null
  textLines: string | null
  postedAt: number
  contentHash: string
  status: RawEventStatus
  dismissedAt: number | null
  parseVersion: number
  duplicateOf: string | null
  createdAt: number
  /** The transaction this message became, when it became one. */
  transaction: Transaction | null
  /** What the parser makes of the message, recomputed on demand. */
  parsed: ParsedSummary | null
}

export type TransactionDirection = 'DEBIT' | 'CREDIT'

export type TransactionKind = 'SPEND' | 'INCOME' | 'REFUND' | 'TRANSFER'

export type TransactionStatus = 'ACTIVE' | 'VOIDED'

export type TransactionSource = 'AUTO' | 'MANUAL'

export interface Transaction {
  id: string
  rawEventId: string | null
  accountId: string | null
  amountMinor: number
  direction: TransactionDirection
  kind: TransactionKind
  merchantId: string | null
  merchantName: string | null
  categoryId: string | null
  categoryName: string | null
  referenceId: string | null
  occurredAt: number
  confidence: number
  status: TransactionStatus
  source: TransactionSource
  note: string | null
  createdAt: number
}

export interface TransactionPage {
  items: Transaction[]
  nextCursor?: { occurredAt: number; id: string }
}

export interface IngestionStats {
  transactions: number
  needsReview: number
  ignored: number
  pending: number
  dismissed: number
}

export type CategoryKind = 'EXPENSE' | 'INCOME' | 'TRANSFER'

export interface Category {
  id: string
  name: string
  kind: CategoryKind
  color: string | null
  icon: string | null
}

export interface Rule {
  id: string
  type: 'IGNORE' | 'CATEGORY'
  packageName: string | null
  senderPattern: string | null
  templatePattern: string | null
  merchantContains: string | null
  categoryId: string | null
  enabled: boolean
  createdAt: number
}

export interface TransactionPatch {
  amountMinor?: number
  categoryId?: string
  merchantName?: string
  note?: string
  occurredAt?: number
  kind?: TransactionKind
}

/** What the parser made of a stored message. */
export interface ParsedSummary {
  type: string
  amountMinor: number | null
  direction: TransactionDirection | null
  kind: TransactionKind | null
  merchant: string | null
  accountDigits: string | null
  balanceMinor: number | null
  referenceId: string | null
  confidence: number
}

export interface Account {
  id: string
  name: string
  lastDigits: string | null
  type: AccountType
  anchorBalanceMinor: number
  anchorAt: number
  currency: string
  archived: boolean
  createdAt: number
}

export interface AccountBalance extends Account {
  derivedBalanceMinor: number
}

export interface AccountSummary {
  id: string
  name: string
  lastDigits: string | null
  derivedBalanceMinor: number
  anchorBalanceMinor: number
}

export interface BurnSummary {
  dailyMinor: number
  monthlyMinor: number
  runwayDays: number | null
  runwayMonths: number | null
  spendMinor: number
  daysCounted: number
}

export interface CashflowPoint {
  periodStart: number
  spendMinor: number
  incomeMinor: number
  netMinor: number
}

export interface CategoryShare {
  categoryId: string | null
  name: string
  spendMinor: number
  share: number
  changeMinor: number | null
}

export interface MerchantSummary {
  merchantId: string | null
  name: string
  spendMinor: number
  count: number
}

export interface RecurringSummary {
  merchantId: string | null
  name: string
  amountMinor: number
  cadence: string
  nextExpectedAt: number | null
  lastSeenAt: number | null
  priceIncreaseMinor: number | null
  status: 'SUGGESTED' | 'CONFIRMED' | 'IGNORED'
  confirmed: boolean
}

export interface SavingsItem {
  source: string
  detail: string
  amountMinor: number
}

export interface SavingsPotential {
  totalMinor: number
  items: SavingsItem[]
}

export interface SafeToSpend {
  todayMinor: number
  weekMinor: number
  daysLeft: number
  breakdown: SavingsItem[]
}

export interface Dashboard {
  totalBalanceMinor: number
  accounts: AccountSummary[]
  burn: BurnSummary
  cashflow: CashflowPoint[]
  categories: CategoryShare[]
  topMerchants: MerchantSummary[]
  recurring: RecurringSummary[]
  savings: SavingsPotential
  safeToSpend: SafeToSpend | null
  needsReview: number
  lastUpdatedAt: number
}

export interface CandidateApp {
  packageName: string
  label: string
  suggested: boolean
  category: string
  isDefaultSms: boolean
}

export interface ListenerStatus {
  accessGranted: boolean
  state: 'UNKNOWN' | 'CONNECTED' | 'DISCONNECTED'
  monitoredCount: number
  lastEventAt: number
  activeNotifications: number
}

export interface AccountProposal {
  packageName: string
  name: string
  lastDigits: string
  balanceMinor: number | null
}

export interface SmsImportState {
  supported: boolean
  permissionGranted: boolean
  lastImportAt: number
}

export interface RawEventPage {
  items: RawEvent[]
  nextCursor?: { postedAt: number; id: string }
}

export interface SetAccountPayload {
  id?: string
  name: string
  lastDigits?: string | null
  type?: AccountType
  balanceMinor: number
  anchorAt?: number
  currency?: string
}

export interface Commitment {
  id: string
  name: string
  amountMinor: number
  dueAt: number
  recurrence: string
  accountId: string | null
  categoryId: string | null
  status: 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED'
  paidTransactionId: string | null
  note: string | null
  createdAt: number
}

export interface Goal {
  id: string
  name: string
  targetMinor: number
  savedMinor: number
  targetDate: number | null
  monthlyContributionMinor: number
  priority: number
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED'
  createdAt: number
}

export interface Budget {
  id: string
  categoryId: string | null
  period: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY'
  limitMinor: number
  rollover: boolean
  alertThresholds: string
  startDay: number
  enabled: boolean
}

export interface FinancialSettings {
  bufferMinor: number
  incomeDay: number
  expectedIncomeMinor: number
  essentialCategories: string[]
}

export interface ForecastPoint {
  dayStart: number
  balanceMinor: number
}

export interface Forecast {
  points: ForecastPoint[]
  minBalanceMinor: number
  endBalanceMinor: number
}

export interface LocalExpensePlugin {
  getOnboardingState(): Promise<{ completed: boolean }>
  setOnboardingComplete(options: { completed: boolean }): Promise<void>

  getListenerStatus(): Promise<ListenerStatus>
  openNotificationSettings(): Promise<void>
  openAppDetailsSettings(): Promise<void>

  getCandidateApps(): Promise<{ apps: CandidateApp[]; defaultSmsPackage: string }>
  getMonitoredApps(): Promise<{ packages: string[] }>
  setMonitoredApps(options: { packages: string[] }): Promise<{ count: number }>

  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>
  requestIgnoreBatteryOptimizations(): Promise<void>

  listAccounts(): Promise<{ accounts: Account[] }>
  listAccountBalances(): Promise<{ balances: AccountBalance[] }>

  /** Every number the dashboard shows, derived from the active transactions. */
  getDashboard(options?: { rangeDays?: number }): Promise<Dashboard>
  setAccountBalance(options: SetAccountPayload): Promise<{ account: Account }>
  deleteAccount(options: { id: string }): Promise<void>
  detectAccounts(): Promise<{ proposals: AccountProposal[] }>

  getSmsImportState(): Promise<SmsImportState>
  importSms(options?: { lookbackDays?: number }): Promise<{ imported: number }>

  listRawEvents(options?: {
    status?: RawEventStatus | null
    source?: RawEventSource | null
    cursor?: { postedAt: number; id: string } | null
    limit?: number
  }): Promise<RawEventPage>

  listTransactions(options?: {
    status?: TransactionStatus | null
    direction?: TransactionDirection | null
    categoryId?: string | null
    from?: number | null
    to?: number | null
    cursor?: { occurredAt: number; id: string } | null
    limit?: number
  }): Promise<TransactionPage>

  getIngestionStats(): Promise<IngestionStats>

  reparsePending(): Promise<{ processed: number }>

  /** Parses every stored message again, so new rules reach old transactions. */
  reparseAll(): Promise<{ processed: number }>

  listCategories(): Promise<{ categories: Category[] }>

  /** The ignore and categorization rules the user has written. */
  listRules(): Promise<{ rules: Rule[] }>

  deleteRule(options: { id: string }): Promise<void>

  /** The payments that come round again, with the user's verdict on each. */
  listRecurring(): Promise<{ recurring: RecurringSummary[] }>

  setRecurringStatus(options: {
    merchantId: string
    status: 'SUGGESTED' | 'CONFIRMED' | 'IGNORED'
  }): Promise<{ status: string }>
  /** Removes a read and undoes everything it caused. */
  dismissEvent(options: { id: string }): Promise<{
    dismissed: boolean
    voidedTransactionIds: string[]
  }>

  /** Undoes a removal. */
  restoreEvent(options: { id: string }): Promise<{ restored: boolean }>

  /** Hard deletes a message and everything that came from it. */
  deleteRawEvent(options: { id: string }): Promise<{ deleted: boolean }>

  /** Stops messages like this one from becoming transactions. */
  createIgnoreRule(options: { id: string }): Promise<{ created: boolean; ruleId?: string }>

  /** Turns a message the parser skipped into a transaction by hand. */
  promoteEvent(options: {
    id: string
    as: TransactionKind
    amountMinor?: number
    merchantName?: string
    categoryId?: string
  }): Promise<{ promoted: boolean; transaction: Transaction | null }>

  /** Confirms a message that waited in the review queue. */
  confirmEvent(options: {
    id: string
    amountMinor?: number
    merchantName?: string
    categoryId?: string
  }): Promise<{ confirmed: boolean; transaction: Transaction | null }>

  /** Applies a user correction to a transaction. */
  correctTransaction(
    options: { id: string } & TransactionPatch,
  ): Promise<{ corrected: boolean; transaction: Transaction | null }>

  createManualTransaction(options: {
    amountMinor: number
    direction?: TransactionDirection
    kind?: TransactionKind
    accountId?: string | null
    categoryId?: string | null
    merchantName?: string | null
    occurredAt?: number
    note?: string | null
  }): Promise<{ transaction: Transaction }>

  listCommitments(): Promise<{ commitments: Commitment[] }>
  upsertCommitment(options: Partial<Commitment> & { name: string; amountMinor: number; dueAt: number }): Promise<{ commitment: Commitment }>
  deleteCommitment(options: { id: string }): Promise<void>
  setCommitmentStatus(options: { id: string; status: Commitment['status'] }): Promise<void>

  listGoals(): Promise<{ goals: Goal[] }>
  upsertGoal(options: Partial<Goal> & { name: string; targetMinor: number }): Promise<{ goal: Goal }>
  deleteGoal(options: { id: string }): Promise<void>
  setGoalStatus(options: { id: string; status: Goal['status'] }): Promise<void>

  listBudgets(): Promise<{ budgets: Budget[] }>
  upsertBudget(options: Partial<Budget> & { limitMinor: number }): Promise<{ budget: Budget }>
  deleteBudget(options: { id: string }): Promise<void>

  getFinancialSettings(): Promise<FinancialSettings>
  setFinancialSettings(options: Partial<FinancialSettings>): Promise<FinancialSettings>

  getForecast(): Promise<Forecast>

  addListener(
    eventName: 'rawEventCaptured',
    listener: (data: { event: RawEvent }) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'transactionAdded',
    listener: (data: { transaction: Transaction }) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'listenerHealthChanged',
    listener: (data: { state: string }) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'dataChanged',
    listener: (data: { scope: string }) => void,
  ): Promise<PluginListenerHandle>
  removeAllListeners(): Promise<void>
}

const nativePlugin = registerPlugin<LocalExpensePlugin>('LocalExpense')

export const LocalExpense: LocalExpensePlugin = Capacitor.isNativePlatform()
  ? nativePlugin
  : createMockPlugin()

export const isNative = Capacitor.isNativePlatform()
