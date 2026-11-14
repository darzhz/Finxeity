import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  BatteryCharging,
  BellRing,
  Check,
  CheckCircle2,
  CreditCard,
  Info,
  Landmark,
  Layers,
  Lock,
  Plus,
  Radar,
  RefreshCw,
  Repeat,
  Sparkles,
  Target,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { AppPicker } from '@/components/app-picker'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LocalExpense } from '@/lib/plugin'
import type { Account, AccountType, Category, Commitment, FinancialSettings, Goal, RecurringSummary } from '@/lib/plugin'
import { formatMinor, parseMajorToMinor } from '@/lib/money'
import { queryKeys } from '@/lib/query'

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

const STEPS = [
  { id: 'privacy', title: 'Private by design', short: 'Privacy' },
  { id: 'access', title: 'Let Finxeity listen', short: 'Access' },
  { id: 'accounts', title: 'Where your money lives', short: 'Accounts' },
  { id: 'categories', title: 'What counts as essential', short: 'Buckets' },
  { id: 'recurring', title: 'Things that repeat', short: 'Recurring' },
  { id: 'fixed', title: 'Fixed monthly costs', short: 'Fixed' },
  { id: 'goals', title: 'Goals and buffer', short: 'Goals' },
  { id: 'ready', title: 'Your calm number', short: 'Ready' },
] as const
type Step = (typeof STEPS)[number]['id']

interface AccountDraft {
  key: string
  id?: string
  name: string
  lastDigits: string
  balanceInput: string
  type: AccountType
  sourceTexts?: string[]
  detected?: boolean
}

const ACCOUNT_TYPES: { type: AccountType; label: string; icon: typeof Landmark }[] = [
  { type: 'BANK', label: 'Bank', icon: Landmark },
  { type: 'CARD', label: 'Card', icon: CreditCard },
  { type: 'WALLET', label: 'Wallet', icon: Wallet },
  { type: 'CASH', label: 'Cash', icon: Banknote },
  { type: 'OTHER', label: 'Other', icon: Layers },
]

const QUICK_ACCOUNTS: { name: string; type: AccountType }[] = [
  { name: 'HDFC Bank', type: 'BANK' },
  { name: 'ICICI Bank', type: 'BANK' },
  { name: 'SBI', type: 'BANK' },
  { name: 'Axis Bank', type: 'BANK' },
  { name: 'Kotak', type: 'BANK' },
  { name: 'Cash in hand', type: 'CASH' },
]

const CONFETTI_COLORS = ['#818cf8', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#38bdf8']

function monthlyFactor(cadence: string): number {
  switch (cadence.toUpperCase()) {
    case 'WEEKLY':
      return 52 / 12
    case 'QUARTERLY':
      return 1 / 3
    case 'YEARLY':
    case 'ANNUAL':
      return 1 / 12
    default:
      return 1
  }
}

function daysUntilIncome(incomeDay: number): number {
  if (!incomeDay || incomeDay < 1 || incomeDay > 31) return 30
  const now = new Date()
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), incomeDay)
  const target =
    thisMonth.getTime() > now.getTime() ? thisMonth : new Date(now.getFullYear(), now.getMonth() + 1, incomeDay)
  return Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 86_400_000))
}

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

function useCountUp(target: number, duration = 900) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setValue(target)
      return
    }
    let raf = 0
    const start = performance.now()
    const from = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(from + (target - from) * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return value
}

function Ring({ pct, size = 52, stroke = 5 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} className="-rotate-90 shrink-0" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-surface-raised" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c - (Math.min(100, pct) / 100) * c}
        className="stroke-calm-indigo-light transition-[stroke-dashoffset] duration-700"
      />
    </svg>
  )
}

function StepHeading({
  icon: Icon,
  title,
  subtitle,
  aside,
}: {
  icon: typeof Landmark
  title: string
  subtitle: string
  aside?: ReactNode
}) {
  return (
    <div className="flex items-start gap-3.5">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-indigo-500/25 bg-gradient-to-br from-indigo-600/25 to-violet-500/10 text-calm-indigo-light shadow-sm shadow-indigo-500/10">
        <Icon size={22} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <h1 className="font-headline text-[24px] font-bold leading-tight tracking-tight text-text-primary">{title}</h1>
          {aside}
        </div>
        <p className="mt-1 text-[14px] leading-relaxed text-text-secondary">{subtitle}</p>
      </div>
    </div>
  )
}

function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border-subtle bg-surface-card p-4 ${className}`}>{children}</div>
  )
}

function Field({
  label,
  prefix,
  className = '',
  ...props
}: { label: string; prefix?: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-[12px] text-text-secondary">{label}</Label>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-text-muted">
            {prefix}
          </span>
        )}
        <Input {...props} className={`h-11 tabular-nums ${prefix ? 'pl-7' : ''}`} />
      </div>
    </div>
  )
}

function StatusChip({ ok, okText, noText }: { ok: boolean; okText: string; noText: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        ok
          ? 'border-calm-emerald/30 bg-calm-emerald/10 text-calm-emerald'
          : 'border-border-subtle bg-surface-raised text-text-muted'
      }`}
    >
      {ok ? <Check size={11} /> : <span className="size-1.5 rounded-full bg-text-muted" />}
      {ok ? okText : noText}
    </span>
  )
}

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        duration: 2.2 + Math.random() * 1.6,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 6 + Math.random() * 6,
        drift: (Math.random() - 0.5) * 120,
        round: i % 3 === 0,
      })),
    [],
  )
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden>
      {pieces.map((p) => (
        <span
          key={p.id}
          className="fx-confetti absolute top-0 block"
          style={
            {
              left: `${p.left}%`,
              width: p.size,
              height: p.round ? p.size : p.size * 0.5,
              borderRadius: p.round ? 999 : 2,
              background: p.color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              '--drift': `${p.drift}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

type OnboardingInitial = {
  initialApps: string[]
  initialDrafts: AccountDraft[]
  initialCategories: string[]
  initialBuffer: string
  initialIncomeDay: string
  initialExpectedIncome: string
}

function draftsFromAccounts(accounts: Account[]): AccountDraft[] {
  return accounts.map((account) => ({
    key: account.id,
    id: account.id,
    name: account.name,
    lastDigits: account.lastDigits ?? '',
    balanceInput: (account.anchorBalanceMinor / 100).toString(),
    type: account.type,
  }))
}

function essentialCategoryIds(financial: FinancialSettings, categories: Category[]) {
  if (financial.essentialCategories.length > 0) return financial.essentialCategories
  return categories.slice(0, 6).map((category) => category.id)
}

export function OnboardingPage() {
  const accountsQuery = useQuery({ queryKey: queryKeys.accounts, queryFn: () => LocalExpense.listAccounts() })
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: () => LocalExpense.listCategories() })
  const financialQuery = useQuery({ queryKey: ['financialSettings'], queryFn: () => LocalExpense.getFinancialSettings() })
  const candidateAppsQuery = useQuery({ queryKey: queryKeys.candidateApps, queryFn: () => LocalExpense.getCandidateApps() })

  if (!accountsQuery.data || !categoriesQuery.data || !financialQuery.data) {
    return (
      <div className="flex h-dvh items-center justify-center bg-surface-canvas text-sm text-text-muted">
        Loading your setup…
      </div>
    )
  }

  const defaultSms = candidateAppsQuery.data?.defaultSmsPackage
  const financial = financialQuery.data

  return (
    <OnboardingFlow
      initialApps={defaultSms ? [defaultSms] : []}
      initialDrafts={draftsFromAccounts(accountsQuery.data.accounts)}
      initialCategories={essentialCategoryIds(financial, categoriesQuery.data.categories)}
      initialBuffer={financial.bufferMinor ? (financial.bufferMinor / 100).toString() : ''}
      initialIncomeDay={financial.incomeDay ? String(financial.incomeDay) : ''}
      initialExpectedIncome={financial.expectedIncomeMinor ? (financial.expectedIncomeMinor / 100).toString() : ''}
    />
  )
}

function OnboardingFlow(initial: OnboardingInitial) {
  const form = useOnboardingFormState(initial)
  const data = useOnboardingQueries(form)
  const actions = useOnboardingMutations(form)
  const nav = useOnboardingNavigation(form, data, actions)
  return <OnboardingView form={form} data={data} actions={actions} nav={nav} />
}

function useOnboardingFormState(initial: OnboardingInitial) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [maxReached, setMaxReached] = useState(0)
  const [direction, setDirection] = useState<'fwd' | 'back'>('fwd')
  const [selectedApps, setSelectedApps] = useState<string[]>(() => initial.initialApps)
  const [drafts, setDrafts] = useState<AccountDraft[]>(() => initial.initialDrafts)
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(() => new Set(initial.initialCategories))
  const [commitmentName, setCommitmentName] = useState('')
  const [commitmentAmount, setCommitmentAmount] = useState('')
  const [commitmentDue, setCommitmentDue] = useState('')
  const [goalName, setGoalName] = useState('')
  const [goalTarget, setGoalTarget] = useState('')
  const [goalSaved, setGoalSaved] = useState('')
  const [bufferInput, setBufferInput] = useState(() => initial.initialBuffer)
  const [incomeDay, setIncomeDay] = useState(() => initial.initialIncomeDay)
  const [expectedIncome, setExpectedIncome] = useState(() => initial.initialExpectedIncome)
  const [savingsRate, setSavingsRate] = useState(20)
  const [infoDraftKey, setInfoDraftKey] = useState<string | null>(null)
  const [detectedCount, setDetectedCount] = useState<number | null>(null)
  const [showConfetti, setShowConfetti] = useState(false)
  const [finishing, setFinishing] = useState(false)

  const updateDraft = (key: string, patch: Partial<AccountDraft>) => {
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)))
  }

  const addQuickAccount = (name: string, type: AccountType) => {
    setDrafts((current) =>
      current.some((draft) => draft.name === name)
        ? current
        : [...current, { key: `quick-${name}`, name, lastDigits: '', balanceInput: '', type }],
    )
  }

  return {
    scrollRef,
    stepIndex,
    setStepIndex,
    maxReached,
    setMaxReached,
    direction,
    setDirection,
    selectedApps,
    setSelectedApps,
    drafts,
    setDrafts,
    selectedCategories,
    setSelectedCategories,
    commitmentName,
    setCommitmentName,
    commitmentAmount,
    setCommitmentAmount,
    commitmentDue,
    setCommitmentDue,
    goalName,
    setGoalName,
    goalTarget,
    setGoalTarget,
    goalSaved,
    setGoalSaved,
    bufferInput,
    setBufferInput,
    incomeDay,
    setIncomeDay,
    expectedIncome,
    setExpectedIncome,
    savingsRate,
    setSavingsRate,
    infoDraftKey,
    setInfoDraftKey,
    detectedCount,
    setDetectedCount,
    showConfetti,
    setShowConfetti,
    finishing,
    setFinishing,
    updateDraft,
    addQuickAccount,
  }
}

function useOnboardingQueries(form: ReturnType<typeof useOnboardingFormState>) {
  const { drafts, infoDraftKey } = form

  const accountsQuery = useQuery({ queryKey: queryKeys.accounts, queryFn: () => LocalExpense.listAccounts() })
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: () => LocalExpense.listCategories() })
  const recurringQuery = useQuery({ queryKey: queryKeys.recurring, queryFn: () => LocalExpense.listRecurring() })
  const commitmentsQuery = useQuery({ queryKey: ['commitments'], queryFn: () => LocalExpense.listCommitments() })
  const goalsQuery = useQuery({ queryKey: ['goals'], queryFn: () => LocalExpense.listGoals() })
  const listenerQuery = useQuery({ queryKey: queryKeys.listener, queryFn: () => LocalExpense.getListenerStatus() })
  const batteryQuery = useQuery({
    queryKey: queryKeys.battery,
    queryFn: () => LocalExpense.isIgnoringBatteryOptimizations(),
  })


  const totalBalance = useMemo(
    () => drafts.reduce((sum, draft) => sum + (parseMajorToMinor(draft.balanceInput) ?? 0), 0),
    [drafts],
  )
  const namedDrafts = drafts.filter((draft) => draft.name.trim())
  const commitments = useMemo(() => commitmentsQuery.data?.commitments ?? [], [commitmentsQuery.data])
  const fixedTotal = useMemo(() => commitments.reduce((sum, commitment) => sum + commitment.amountMinor, 0), [commitments])
  const goals = goalsQuery.data?.goals ?? []
  const recurring = useMemo(() => recurringQuery.data?.recurring ?? [], [recurringQuery.data])
  const recurringMonthly = useMemo(
    () => recurring.reduce((sum, payment) => sum + payment.amountMinor * monthlyFactor(String(payment.cadence)), 0),
    [recurring],
  )
  const confirmedRecurringMonthly = useMemo(
    () =>
      recurring
        .filter((payment) => payment.confirmed)
        .reduce((sum, payment) => sum + payment.amountMinor * monthlyFactor(String(payment.cadence)), 0),
    [recurring],
  )
  const granted = listenerQuery.data?.accessGranted ?? false
  const ignoring = batteryQuery.data?.ignoring ?? false

  const calm = useMemo(() => {
    const buffer = parseMajorToMinor(form.bufferInput) ?? 0
    const income = parseMajorToMinor(form.expectedIncome) ?? 0
    const saving = Math.round(income * (form.savingsRate / 100))
    const days = daysUntilIncome(Number(form.incomeDay) || 0)
    const spendable = totalBalance - buffer - fixedTotal - Math.round(confirmedRecurringMonthly) - saving
    return { days, saving, spendable, perDay: Math.max(0, Math.round(spendable / days)) }
  }, [form.bufferInput, form.expectedIncome, form.savingsRate, form.incomeDay, totalBalance, fixedTotal, confirmedRecurringMonthly])

  const availableCategories = (categoriesQuery.data?.categories ?? []).filter((category) => category.kind === 'EXPENSE')
  const infoDraft = drafts.find((draft) => draft.key === infoDraftKey)

  return {
    accountsQuery,
    categoriesQuery,
    recurringQuery,
    commitmentsQuery,
    goalsQuery,
    listenerQuery,
    batteryQuery,
    totalBalance,
    namedDrafts,
    commitments,
    fixedTotal,
    goals,
    recurring,
    recurringMonthly,
    confirmedRecurringMonthly,
    granted,
    ignoring,
    calm,
    availableCategories,
    infoDraft,
    selectedCategoryCount: form.selectedCategories.size,
  }
}

function proposalType(proposal: { type?: string | null }): AccountType {
  return proposal.type === 'CARD' || proposal.type === 'CASH' || proposal.type === 'WALLET' || proposal.type === 'OTHER'
    ? proposal.type
    : 'BANK'
}

function mergeDetectedDrafts(
  current: AccountDraft[],
  proposals: { name: string; lastDigits: string; balanceMinor?: number | null; packageName?: string; type?: string | null; sourceTexts?: string[] }[],
) {
  const additions = proposals
    .filter((proposal) => !current.some((draft) => draft.lastDigits === proposal.lastDigits && draft.name === proposal.name))
    .map((proposal) => ({
      key: `proposal-${proposal.packageName}-${proposal.lastDigits}`,
      name: proposal.name,
      lastDigits: proposal.lastDigits,
      balanceInput: proposal.balanceMinor != null ? (proposal.balanceMinor / 100).toString() : '',
      type: proposalType(proposal),
      sourceTexts: proposal.sourceTexts,
      detected: true,
    }))
  return [...current, ...additions]
}

function useOnboardingMutations(form: ReturnType<typeof useOnboardingFormState>) {
  const client = useQueryClient()
  const {
    drafts,
    setDrafts,
    selectedApps,
    setSelectedApps,
    setDetectedCount,
    selectedCategories,
    commitmentName,
    commitmentAmount,
    commitmentDue,
    setCommitmentName,
    setCommitmentAmount,
    setCommitmentDue,
    goalName,
    goalTarget,
    goalSaved,
    setGoalName,
    setGoalTarget,
    setGoalSaved,
    bufferInput,
    incomeDay,
    expectedIncome,
  } = form

  const saveApps = useMutation({
    mutationFn: (packages: string[]) => LocalExpense.setMonitoredApps({ packages }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.monitoredApps })
      void client.invalidateQueries({ queryKey: queryKeys.candidateApps })
    },
  })

  const detect = useMutation({
    mutationFn: async () => {
      try {
        await LocalExpense.importSms({ lookbackDays: 90 })
      } catch {
        // SMS import is optional (play builds); detection still runs on stored messages.
      }
      return LocalExpense.detectAccounts()
    },
    onSuccess: ({ proposals }) => {
      setDrafts((current) => mergeDetectedDrafts(current, proposals))
      setDetectedCount(proposals.length)
      void client.invalidateQueries({ queryKey: ['rawEvents'] })
      void client.invalidateQueries({ queryKey: queryKeys.smsImport })
      if (proposals.length === 0) toast.info('No accounts found in your recent alerts')
    },
    onError: () => toast.error('Could not scan alerts. You can add accounts by hand.'),
  })

  const saveBalances = useMutation({
    mutationFn: async () => {
      const valid = drafts.filter((draft) => draft.name.trim())
      await Promise.all(
        valid.map((draft) =>
          LocalExpense.setAccountBalance({
            id: draft.id,
            name: draft.name.trim(),
            lastDigits: draft.lastDigits.trim() || null,
            type: draft.type,
            balanceMinor: parseMajorToMinor(draft.balanceInput) ?? 0,
          }),
        ),
      )
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.accounts })
      void client.invalidateQueries({ queryKey: queryKeys.balances })
      void client.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })

  const saveCategories = useMutation({
    mutationFn: () => LocalExpense.setFinancialSettings({ essentialCategories: Array.from(selectedCategories) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['financialSettings'] })
      void client.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })

  const setStatus = useMutation({
    mutationFn: (payload: { merchantId: string; status: 'SUGGESTED' | 'CONFIRMED' | 'IGNORED' }) =>
      LocalExpense.setRecurringStatus(payload),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.recurring })
      void client.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })

  const addCommitment = useMutation({
    mutationFn: () =>
      LocalExpense.upsertCommitment({
        name: commitmentName.trim(),
        amountMinor: parseMajorToMinor(commitmentAmount) ?? 0,
        dueAt: commitmentDue ? new Date(commitmentDue).getTime() : Date.now(),
        recurrence: 'MONTHLY',
      }),
    onSuccess: () => {
      setCommitmentName('')
      setCommitmentAmount('')
      setCommitmentDue('')
      void client.invalidateQueries({ queryKey: ['commitments'] })
      toast.success('Fixed cost added')
    },
  })

  const removeCommitment = useMutation({
    mutationFn: (id: string) => LocalExpense.deleteCommitment({ id }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['commitments'] }),
  })

  const addGoal = useMutation({
    mutationFn: () =>
      LocalExpense.upsertGoal({
        name: goalName.trim(),
        targetMinor: parseMajorToMinor(goalTarget) ?? 0,
        savedMinor: parseMajorToMinor(goalSaved) ?? 0,
      }),
    onSuccess: () => {
      setGoalName('')
      setGoalTarget('')
      setGoalSaved('')
      void client.invalidateQueries({ queryKey: ['goals'] })
      toast.success('Goal added')
    },
  })

  const removeGoal = useMutation({
    mutationFn: (id: string) => LocalExpense.deleteGoal({ id }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['goals'] }),
  })

  const saveFinancial = useMutation({
    mutationFn: () =>
      LocalExpense.setFinancialSettings({
        bufferMinor: parseMajorToMinor(bufferInput) ?? 0,
        incomeDay: Number(incomeDay) || 0,
        expectedIncomeMinor: parseMajorToMinor(expectedIncome) ?? 0,
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['financialSettings'] }),
  })

  return {
    saveApps,
    detect,
    saveBalances,
    saveCategories,
    setStatus,
    addCommitment,
    removeCommitment,
    addGoal,
    removeGoal,
    saveFinancial,
    selectedApps,
    setSelectedApps,
  }
}

function labelFor(step: Step, granted: boolean, hasNamedDrafts: boolean, fixedTotal: number) {
  switch (step) {
    case 'privacy':
      return 'Start setup'
    case 'access':
      return granted ? 'Continue' : 'Continue without access'
    case 'accounts':
      return hasNamedDrafts ? 'Save and continue' : 'Skip for now'
    case 'categories':
      return 'Save and continue'
    case 'recurring':
      return 'Continue'
    case 'fixed':
      return fixedTotal > 0 ? 'Continue' : 'Skip for now'
    case 'goals':
      return 'Save and review'
    case 'ready':
      return 'Open my dashboard'
  }
}

async function runPrimaryStep(
  step: Step,
  handlers: {
    hasApps: boolean
    hasNamedDrafts: boolean
    saveApps: () => Promise<unknown>
    saveBalances: () => Promise<unknown>
    saveCategories: () => Promise<unknown>
    saveFinancial: () => Promise<unknown>
    finish: () => Promise<void>
    next: () => void
  },
) {
  try {
    switch (step) {
      case 'accounts':
        if (handlers.hasApps) await handlers.saveApps()
        await handlers.saveBalances()
        if (handlers.hasNamedDrafts) toast.success('Accounts saved')
        break
      case 'categories':
        await handlers.saveCategories()
        break
      case 'goals':
        await handlers.saveFinancial()
        break
      case 'ready':
        await handlers.finish()
        return
    }
    handlers.next()
  } catch {
    toast.error('Could not save. Check your entries and try again.')
  }
}

function useOnboardingNavigation(
  form: ReturnType<typeof useOnboardingFormState>,
  data: ReturnType<typeof useOnboardingQueries>,
  actions: ReturnType<typeof useOnboardingMutations>,
) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const step: Step = STEPS[form.stepIndex].id

  useEffect(() => {
    form.scrollRef.current?.scrollTo({ top: 0 })
  }, [form.stepIndex, form.scrollRef])

  useEffect(() => {
    if (step !== 'ready') return
    form.setShowConfetti(true)
    const id = window.setTimeout(() => form.setShowConfetti(false), 4200)
    return () => window.clearTimeout(id)
  }, [step, form.setShowConfetti])

  const goTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= STEPS.length) return
      form.setDirection(index >= form.stepIndex ? 'fwd' : 'back')
      form.setStepIndex(index)
      form.setMaxReached((current) => Math.max(current, index))
    },
    [form.stepIndex, form.setDirection, form.setMaxReached, form.setStepIndex],
  )
  const next = () => goTo(form.stepIndex + 1)
  const back = () => goTo(form.stepIndex - 1)

  const finish = async () => {
    form.setFinishing(true)
    try {
      await LocalExpense.setOnboardingComplete({ completed: true })
      await client.invalidateQueries({ queryKey: queryKeys.onboarding })
      navigate('/dashboard', { replace: true })
    } catch {
      toast.error('Could not finish setup. Try again.')
      form.setFinishing(false)
    }
  }

  const onPrimary = () =>
    runPrimaryStep(step, {
      hasApps: data.selectedCategoryCount >= 0 && form.selectedApps.length > 0,
      hasNamedDrafts: data.namedDrafts.length > 0,
      saveApps: () => actions.saveApps.mutateAsync(form.selectedApps),
      saveBalances: () => actions.saveBalances.mutateAsync(),
      saveCategories: () => actions.saveCategories.mutateAsync(),
      saveFinancial: () => actions.saveFinancial.mutateAsync(),
      finish,
      next,
    })

  const busy =
    actions.saveApps.isPending ||
    actions.saveBalances.isPending ||
    actions.saveCategories.isPending ||
    actions.saveFinancial.isPending ||
    form.finishing

  return {
    step,
    goTo,
    next,
    back,
    onPrimary,
    busy,
    primaryLabel: labelFor(step, data.granted, data.namedDrafts.length > 0, data.fixedTotal),
    finish,
    animatedPerDay: useCountUp(step === 'ready' ? data.calm.perDay : 0),
    animatedTotal: useCountUp(step === 'ready' ? data.totalBalance : 0),
  }
}

function OnboardingView({
  form,
  data,
  actions,
  nav,
}: {
  form: ReturnType<typeof useOnboardingFormState>
  data: ReturnType<typeof useOnboardingQueries>
  actions: ReturnType<typeof useOnboardingMutations>
  nav: ReturnType<typeof useOnboardingNavigation>
}) {
  const { stepIndex, maxReached, showConfetti, infoDraftKey, setInfoDraftKey } = form
  const { infoDraft } = data
  const { step, goTo, back, onPrimary, busy, primaryLabel } = nav

  return (
    <div className="relative flex h-dvh flex-col bg-surface-canvas text-text-primary">
      <style>{`
        @keyframes fx-step-fwd { from { opacity: 0; transform: translateX(28px) } to { opacity: 1; transform: none } }
        @keyframes fx-step-back { from { opacity: 0; transform: translateX(-28px) } to { opacity: 1; transform: none } }
        @keyframes fx-spin { to { transform: rotate(360deg) } }
        @keyframes fx-spin-rev { to { transform: rotate(-360deg) } }
        @keyframes fx-breathe { 0%,100% { transform: scale(1); opacity: .55 } 50% { transform: scale(1.08); opacity: 1 } }
        @keyframes fx-confetti {
          0% { transform: translate3d(0,-20px,0) rotate(0); opacity: 1 }
          100% { transform: translate3d(var(--drift),105vh,0) rotate(720deg); opacity: .9 }
        }
        @keyframes fx-pop { 0% { transform: scale(.6); opacity: 0 } 70% { transform: scale(1.08) } 100% { transform: scale(1); opacity: 1 } }
        .fx-step-fwd { animation: fx-step-fwd .32s cubic-bezier(.2,.8,.2,1) both }
        .fx-step-back { animation: fx-step-back .32s cubic-bezier(.2,.8,.2,1) both }
        .fx-orbit-a { animation: fx-spin 26s linear infinite }
        .fx-orbit-b { animation: fx-spin-rev 38s linear infinite }
        .fx-orbit-c { animation: fx-spin 60s linear infinite }
        .fx-breathe { animation: fx-breathe 3.6s ease-in-out infinite }
        .fx-confetti { animation-name: fx-confetti; animation-timing-function: cubic-bezier(.3,.6,.4,1); animation-fill-mode: both }
        .fx-pop { animation: fx-pop .4s cubic-bezier(.2,.9,.3,1.2) both }
        @media (prefers-reduced-motion: reduce) {
          .fx-step-fwd,.fx-step-back,.fx-orbit-a,.fx-orbit-b,.fx-orbit-c,.fx-breathe,.fx-confetti,.fx-pop { animation: none !important }
        }
      `}</style>

      {showConfetti && <Confetti />}

      <OnboardingHeader stepIndex={stepIndex} maxReached={maxReached} goTo={goTo} />

      <OnboardingSteps form={form} data={data} actions={actions} nav={nav} />

      {/* ------------------------------ footer ------------------------------ */}
      <footer className="shrink-0 border-t border-border-subtle bg-surface-canvas/90 px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-md items-center gap-3">
          {stepIndex > 0 && (
            <button
              type="button"
              onClick={back}
              disabled={busy}
              aria-label="Back"
              className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border-subtle bg-surface-card text-text-secondary transition-colors hover:bg-surface-raised hover:text-text-primary"
            >
              <ArrowLeft size={19} />
            </button>
          )}
          <button
            type="button"
            onClick={() => void onPrimary()}
            disabled={busy}
            className={`flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-calm-indigo to-indigo-600 font-headline text-[15px] font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all hover:from-indigo-500 hover:to-indigo-600 active:scale-[0.98] disabled:opacity-70 ${
              step === 'ready' ? 'h-14 text-[16px]' : ''
            }`}
          >
            {busy ? (
              <>
                <RefreshCw size={17} className="animate-spin" />
                <span>{step === 'ready' ? 'Opening…' : 'Saving…'}</span>
              </>
            ) : (
              <>
                {step === 'ready' && <Sparkles size={18} />}
                <span>{primaryLabel}</span>
                {step !== 'ready' && <ArrowRight size={18} />}
              </>
            )}
          </button>
        </div>
      </footer>

      {/* -------------------------- detection details ------------------------- */}
      <Dialog open={infoDraftKey !== null} onOpenChange={(open) => !open && setInfoDraftKey(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Why we found this account</DialogTitle>
            <DialogDescription>These alerts mention it. They are read on your phone only.</DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {(infoDraft?.sourceTexts ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No alerts to show.</p>
            ) : (
              infoDraft?.sourceTexts?.map((text, index) => (
                <div key={text} className={`flex ${index % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                  <div className="max-w-[85%] rounded-2xl border border-border-subtle bg-surface-raised px-3 py-2 text-xs text-text-primary">
                    {text}
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
function OnboardingHeader({
  stepIndex,
  maxReached,
  goTo,
}: {
  stepIndex: number
  maxReached: number
  goTo: (index: number) => void
}) {
  return (
    <>
      {/* ------------------------------ header ------------------------------ */}
      <header className="shrink-0 px-5 pt-[calc(1rem+env(safe-area-inset-top))] pb-3">
        <div className="mx-auto flex w-full max-w-md items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl border border-indigo-500/25 bg-gradient-to-tr from-indigo-600/35 to-violet-500/20 text-calm-indigo-light">
              <Lock size={17} />
            </div>
            <div className="min-w-0 leading-none">
              <div className="font-headline text-[18px] font-bold tracking-tight">Finxeity</div>
              <div className="mt-1 truncate text-[11px] text-text-muted">Calm, private money clarity</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-border-subtle bg-surface-card px-2.5 py-1">
            <span className="size-1.5 animate-pulse rounded-full bg-calm-emerald" />
            <span className="whitespace-nowrap text-[11px] text-text-secondary">On-device</span>
          </div>
        </div>

        {/* segmented progress: visited segments are tappable */}
        <nav className="mx-auto mt-4 w-full max-w-md" aria-label="Setup progress">
          <ol className="flex gap-1.5">
            {STEPS.map((s, i) => {
              const reachable = i <= maxReached
              return (
                <li key={s.id} className="flex-1">
                  <button
                    type="button"
                    disabled={!reachable}
                    onClick={() => goTo(i)}
                    aria-label={`${s.short}${i === stepIndex ? ' (current)' : ''}`}
                    aria-current={i === stepIndex ? 'step' : undefined}
                    className="group block w-full py-1.5 disabled:cursor-default"
                  >
                    <span
                      className={`block h-1.5 rounded-full transition-all duration-300 ${
                        i === stepIndex
                          ? 'bg-gradient-to-r from-calm-indigo to-calm-indigo-light shadow-[0_0_10px_rgba(129,140,248,.55)]'
                          : i < stepIndex
                            ? 'bg-calm-indigo/70 group-hover:bg-calm-indigo'
                            : reachable
                              ? 'bg-calm-indigo/35'
                              : 'bg-surface-raised'
                      }`}
                    />
                  </button>
                </li>
              )
            })}
          </ol>
          <p className="mt-1 text-[12px] text-text-muted">
            Step {stepIndex + 1} of {STEPS.length} · {STEPS[stepIndex].short}
          </p>
        </nav>
      </header>
    </>
  )
}

function OnboardingSteps({
  form,
  data,
  actions,
  nav,
}: {
  form: ReturnType<typeof useOnboardingFormState>
  data: ReturnType<typeof useOnboardingQueries>
  actions: ReturnType<typeof useOnboardingMutations>
  nav: ReturnType<typeof useOnboardingNavigation>
}) {
  const {
    scrollRef,
    direction,
    selectedApps,
    setSelectedApps,
    drafts,
    setDrafts,
    selectedCategories,
    setSelectedCategories,
    commitmentName,
    setCommitmentName,
    commitmentAmount,
    setCommitmentAmount,
    commitmentDue,
    setCommitmentDue,
    goalName,
    setGoalName,
    goalTarget,
    setGoalTarget,
    goalSaved,
    setGoalSaved,
    bufferInput,
    setBufferInput,
    incomeDay,
    setIncomeDay,
    expectedIncome,
    setExpectedIncome,
    savingsRate,
    setSavingsRate,
    setInfoDraftKey,
    detectedCount,
    updateDraft,
    addQuickAccount,
  } = form
  const {
    accountsQuery,
    listenerQuery,
    totalBalance,
    namedDrafts,
    commitments,
    fixedTotal,
    goals,
    recurring,
    recurringMonthly,
    confirmedRecurringMonthly,
    granted,
    ignoring,
    calm,
    availableCategories,
  } = data
  const { detect, setStatus, addCommitment, removeCommitment, addGoal, removeGoal } = actions
  const { step, goTo, animatedPerDay, animatedTotal } = nav
  const refetchListener = listenerQuery.refetch

  return (
    <>
      {/* ------------------------------ content ------------------------------ */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 pt-2 pb-8">
        <div
          key={step}
          className={`mx-auto flex w-full min-w-0 max-w-md flex-col gap-5 ${direction === 'fwd' ? 'fx-step-fwd' : 'fx-step-back'}`}
        >
          {step === 'privacy' && <PrivacyStep />}

          {step === 'access' && (
            <AccessStep granted={granted} ignoring={ignoring} listenerFetching={listenerQuery.isFetching} onRefetch={() => void refetchListener()} />
          )}

          {step === 'accounts' && (
            <AccountsStep
              drafts={drafts}
              totalBalance={totalBalance}
              selectedApps={selectedApps}
              detectedCount={detectedCount}
              detectPending={detect.isPending}
              onAppsChange={setSelectedApps}
              onDetect={() => detect.mutate()}
              onUpdateDraft={updateDraft}
              onAddQuickAccount={addQuickAccount}
              onRemoveDraft={(key) => setDrafts((current) => current.filter((draft) => draft.key !== key))}
              onAddDraft={() =>
                setDrafts((current) => [
                  ...current,
                  { key: `manual-${Date.now()}`, name: '', lastDigits: '', balanceInput: '', type: 'BANK' },
                ])
              }
              onInfoDraft={setInfoDraftKey}
            />
          )}

          {step === 'categories' && (
            <CategoriesStep
              categories={availableCategories}
              selected={selectedCategories}
              onSelectAll={() => setSelectedCategories(new Set(availableCategories.map((category) => category.id)))}
              onClear={() => setSelectedCategories(new Set())}
              onToggle={(id) =>
                setSelectedCategories((current) => {
                  const nextSet = new Set(current)
                  if (nextSet.has(id)) nextSet.delete(id)
                  else nextSet.add(id)
                  return nextSet
                })
              }
            />
          )}

          {step === 'recurring' && (
            <RecurringStep
              recurring={recurring}
              recurringMonthly={recurringMonthly}
              confirmedRecurringMonthly={confirmedRecurringMonthly}
              statusPending={setStatus.isPending}
              onToggle={(id, confirmed) => setStatus.mutate({ merchantId: id, status: confirmed ? 'SUGGESTED' : 'CONFIRMED' })}
            />
          )}

          {step === 'fixed' && (
            <FixedStep
              commitments={commitments}
              fixedTotal={fixedTotal}
              commitmentName={commitmentName}
              commitmentAmount={commitmentAmount}
              commitmentDue={commitmentDue}
              addPending={addCommitment.isPending}
              onName={setCommitmentName}
              onAmount={setCommitmentAmount}
              onDue={setCommitmentDue}
              onAdd={() => addCommitment.mutate()}
              onRemove={(id) => removeCommitment.mutate(id)}
            />
          )}

          {step === 'goals' && (
            <GoalsStep
              goals={goals}
              goalName={goalName}
              goalTarget={goalTarget}
              goalSaved={goalSaved}
              bufferInput={bufferInput}
              incomeDay={incomeDay}
              expectedIncome={expectedIncome}
              savingsRate={savingsRate}
              addPending={addGoal.isPending}
              onName={setGoalName}
              onTarget={setGoalTarget}
              onSaved={setGoalSaved}
              onBuffer={setBufferInput}
              onIncomeDay={setIncomeDay}
              onExpectedIncome={setExpectedIncome}
              onSavingsRate={setSavingsRate}
              onAdd={() => addGoal.mutate()}
              onRemove={(id) => removeGoal.mutate(id)}
            />
          )}

          {step === 'ready' && (
            <ReadyStep
              calm={calm}
              animatedPerDay={animatedPerDay}
              animatedTotal={animatedTotal}
              namedDraftsCount={namedDrafts.length}
              existingAccountCount={accountsQuery.data?.accounts.length ?? 0}
              fixedTotal={fixedTotal}
              commitmentCount={commitments.length}
              selectedCategoryCount={selectedCategories.size}
              goalCount={goals.length}
              granted={granted}
              ignoring={ignoring}
              onEdit={goTo}
              onFixAccess={() => goTo(1)}
              onRequestBattery={() => LocalExpense.requestIgnoreBatteryOptimizations()}
            />
          )}
        </div>
      </div>
    </>
  )
}


/* ------------------------------------------------------------------ */
/* Step views                                                          */
/* ------------------------------------------------------------------ */

function PrivacyStep() {
  return (
    <>

            <>
              <div className="relative flex h-60 items-center justify-center overflow-hidden rounded-3xl border border-border-subtle bg-surface-card">
                <div className="pointer-events-none absolute -left-10 -top-10 size-44 rounded-full bg-calm-indigo/20 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-12 -right-8 size-48 rounded-full bg-calm-violet/20 blur-3xl" />

                <div className="fx-orbit-c absolute size-[220px] rounded-full border border-dashed border-indigo-400/20" />
                <div className="fx-orbit-b absolute size-[160px] rounded-full border border-indigo-400/25">
                  <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-calm-violet shadow-[0_0_10px_#a78bfa]" />
                </div>
                <div className="fx-orbit-a absolute size-[110px] rounded-full border border-indigo-400/35">
                  <span className="absolute -bottom-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-calm-emerald shadow-[0_0_10px_#34d399]" />
                </div>
                <div className="fx-breathe absolute size-[84px] rounded-full bg-calm-indigo/20 blur-xl" />
                <div className="relative flex size-[72px] items-center justify-center rounded-2xl border border-indigo-400/30 bg-gradient-to-b from-surface-raised to-surface-card shadow-lg shadow-indigo-950/50">
                  <Lock className="text-calm-indigo-light" size={32} />
                </div>
              </div>

              <div className="space-y-2">
                <h1 className="font-headline text-[30px] font-bold leading-[1.1] tracking-tight">
                  Your money stays on your phone.
                </h1>
                <p className="text-[15px] leading-relaxed text-text-secondary">
                  Finxeity reads your bank alerts on this device and turns them into a daily number you can trust. No
                  accounts to link, no cloud copy.
                </p>
              </div>

              <div className="flex flex-col gap-2.5">
                {[
                  {
                    icon: Lock,
                    title: 'Encrypted on-device vault',
                    desc: 'Everything is stored locally with AES-256 and unlocked with your phone’s own security.',
                  },
                  {
                    icon: BellRing,
                    title: 'Reads only the apps you pick',
                    desc: 'You choose which bank and payment apps Finxeity can see. You can change this any time.',
                  },
                  {
                    icon: CheckCircle2,
                    title: 'No ads, no trackers',
                    desc: 'No telemetry and no profiling. Your numbers are never uploaded.',
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="flex items-start gap-3.5 rounded-2xl border border-border-subtle bg-surface-card p-4"
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border-subtle bg-surface-raised text-calm-indigo-light">
                      <item.icon size={19} />
                    </div>
                    <div>
                      <h2 className="font-headline text-[15px] font-semibold">{item.title}</h2>
                      <p className="mt-0.5 text-[13px] leading-normal text-text-muted">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
    </>
  )
}

function AccessStep({
  granted,
  ignoring,
  listenerFetching,
  onRefetch,
}: {
  granted: boolean
  ignoring: boolean
  listenerFetching: boolean
  onRefetch: () => void
}) {
  return (
    <>

            <>
              <StepHeading
                icon={BellRing}
                title="Let Finxeity listen"
                subtitle="Two quick permissions so it can read alerts and keep working in the background."
              />

              <Panel className="space-y-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-headline text-[15px] font-semibold">Notification access</h2>
                    <p className="mt-0.5 text-[13px] text-text-muted">Only the apps you choose later are read.</p>
                  </div>
                  <StatusChip ok={granted} okText="Granted" noText="Not yet" />
                </div>

                {granted ? (
                  <Alert>
                    <CheckCircle2 className="size-4" />
                    <AlertTitle>You’re all set</AlertTitle>
                    <AlertDescription>Finxeity is listening for new alerts.</AlertDescription>
                  </Alert>
                ) : (
                  <>
                    <p className="text-[13px] text-text-secondary">
                      Open the settings page, find <strong>Finxeity</strong> and switch it on. This screen updates by
                      itself when you come back.
                    </p>
                    <div className="grid grid-cols-[1fr_auto] gap-2.5">
                      <Button className="h-11" onClick={() => LocalExpense.openNotificationSettings()}>
                        Open notification access
                      </Button>
                      <Button
                        variant="outline"
                        className="h-11 w-11 px-0"
                        aria-label="Check again"
                        onClick={() => void onRefetch()}
                        disabled={listenerFetching}
                      >
                        <RefreshCw className={`size-4 ${listenerFetching ? 'animate-spin' : ''}`} />
                      </Button>
                    </div>
                  </>
                )}

                {!granted && (
                  <Collapsible>
                    <CollapsibleTrigger className="w-full rounded-xl border border-border-subtle bg-surface-canvas px-3.5 py-2.5 text-left text-[13px] font-medium text-text-secondary transition-colors hover:text-text-primary">
                      Toggle is greyed out? (Android 13 and above)
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="space-y-2 px-1 pt-3 text-[13px] text-text-secondary">
                        <ol className="list-decimal space-y-1 pl-5">
                          <li>Open App info for Finxeity.</li>
                          <li>Tap the ⋮ menu in the top-right corner.</li>
                          <li>Choose “Allow restricted settings”.</li>
                          <li>Come back and turn on notification access.</li>
                        </ol>
                        <Button variant="link" className="h-auto px-0" onClick={() => LocalExpense.openAppDetailsSettings()}>
                          Open App info
                        </Button>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </Panel>

              <Panel className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <BatteryCharging className="mt-0.5 size-5 text-calm-indigo-light" />
                    <div>
                      <h2 className="font-headline text-[15px] font-semibold">Keep tracking reliable</h2>
                      <p className="mt-0.5 text-[13px] text-text-muted">
                        Stops Android from pausing Finxeity and missing alerts.
                      </p>
                    </div>
                  </div>
                  <StatusChip ok={ignoring} okText="Exempt" noText="Optional" />
                </div>
                {!ignoring && (
                  <Button
                    variant="outline"
                    className="h-11 w-full"
                    onClick={() => LocalExpense.requestIgnoreBatteryOptimizations()}
                  >
                    Exempt from battery optimization
                  </Button>
                )}
              </Panel>
            </>
    </>
  )
}

function AccountsStep({
  drafts,
  totalBalance,
  selectedApps,
  detectedCount,
  detectPending,
  onAppsChange,
  onDetect,
  onUpdateDraft,
  onAddQuickAccount,
  onRemoveDraft,
  onAddDraft,
  onInfoDraft,
}: {
  drafts: AccountDraft[]
  totalBalance: number
  selectedApps: string[]
  detectedCount: number | null
  detectPending: boolean
  onAppsChange: (apps: string[]) => void
  onDetect: () => void
  onUpdateDraft: (key: string, patch: Partial<AccountDraft>) => void
  onAddQuickAccount: (name: string, type: AccountType) => void
  onRemoveDraft: (key: string) => void
  onAddDraft: () => void
  onInfoDraft: (key: string) => void
}) {
  return (
    <>

            <>
              <StepHeading
                icon={Landmark}
                title="Where your money lives"
                subtitle="Add what you hold today. This is your starting point, and it adjusts as alerts arrive."
              />

              <Panel className="relative space-y-3 overflow-hidden">
                <div className="pointer-events-none absolute -right-8 -top-8 size-28 rounded-full bg-calm-indigo/15 blur-2xl" />
                <div className="relative flex items-center gap-2.5">
                  <Radar className="size-5 text-calm-indigo-light" />
                  <h2 className="font-headline text-[15px] font-semibold">Find accounts from bank alerts</h2>
                </div>
                <p className="relative text-[13px] text-text-muted">
                  Scans the last 90 days of alerts on this phone and pre-fills names and balances. Nothing leaves your
                  device.
                </p>
                <Button
                  className="relative h-11 w-full"
                  variant="secondary"
                  onClick={() => onDetect()}
                  disabled={detectPending}
                >
                  <Sparkles className={`size-4 ${detectPending ? 'animate-pulse' : ''}`} />
                  {detectPending ? 'Scanning alerts…' : detectedCount === null ? 'Scan my alerts' : 'Scan again'}
                </Button>
                {detectedCount !== null && detectedCount > 0 && (
                  <p className="relative flex items-center gap-1.5 text-[12px] text-calm-emerald">
                    <CheckCircle2 className="size-3.5" />
                    Found {detectedCount} account{detectedCount === 1 ? '' : 's'}. Check the details below.
                  </p>
                )}
              </Panel>

              <div className="space-y-2">
                <p className="text-[13px] font-medium text-text-secondary">Add quickly</p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_ACCOUNTS.map((q) => {
                    const added = drafts.some((d) => d.name === q.name)
                    return (
                      <button
                        key={q.name}
                        type="button"
                        disabled={added}
                        onClick={() => onAddQuickAccount(q.name, q.type)}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
                          added
                            ? 'border-calm-indigo/30 bg-calm-indigo/10 text-calm-indigo-light'
                            : 'border-border-subtle bg-surface-card text-text-secondary hover:border-indigo-500/40 hover:text-text-primary'
                        }`}
                      >
                        {added ? <Check size={12} /> : <Plus size={12} />}
                        {q.name}
                      </button>
                    )
                  })}
                </div>
              </div>

              {drafts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border-subtle px-4 py-8 text-center">
                  <Wallet className="mx-auto mb-2 size-7 text-text-muted" />
                  <p className="text-[14px] font-medium text-text-secondary">No accounts yet</p>
                  <p className="mt-1 text-[13px] text-text-muted">Scan your alerts or tap a bank above to begin.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {drafts.map((draft) => (
                    <div
                      key={draft.key}
                      className="space-y-3.5 rounded-2xl border border-border-subtle bg-surface-card p-4"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-[13px] font-semibold text-text-secondary">
                            {draft.name.trim() || 'New account'}
                          </span>
                          {draft.detected && (
                            <span className="shrink-0 rounded-full border border-calm-emerald/30 bg-calm-emerald/10 px-2 py-0.5 text-[10px] text-calm-emerald">
                              Detected
                            </span>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5">
                          {draft.sourceTexts && draft.sourceTexts.length > 0 && (
                            <button
                              type="button"
                              aria-label="Why was this detected?"
                              className="rounded-full p-1.5 text-text-muted hover:bg-surface-raised hover:text-text-primary"
                              onClick={() => onInfoDraft(draft.key)}
                            >
                              <Info size={16} />
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label="Remove account"
                            className="rounded-full p-1.5 text-text-muted hover:bg-surface-raised hover:text-gentle-rose"
                            onClick={() => onRemoveDraft(draft.key)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>

                      <div
                        role="radiogroup"
                        aria-label="Account type"
                        className="grid grid-cols-5 gap-1 rounded-xl border border-border-subtle bg-surface-canvas p-0.5"
                      >
                        {ACCOUNT_TYPES.map(({ type, label, icon: Icon }) => (
                          <button
                            key={type}
                            type="button"
                            role="radio"
                            aria-checked={draft.type === type}
                            onClick={() => onUpdateDraft(draft.key, { type })}
                            className={`flex h-9 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] transition-all ${
                              draft.type === type
                                ? 'bg-calm-indigo text-white shadow-sm'
                                : 'text-text-muted hover:text-text-primary'
                            }`}
                          >
                            <Icon size={14} />
                            <span className="max-w-full truncate leading-none">{label}</span>
                          </button>
                        ))}
                      </div>

                      <Field
                        label="Account name"
                        value={draft.name}
                        placeholder="HDFC Savings"
                        onChange={(e) => onUpdateDraft(draft.key, { name: e.target.value })}
                      />
                      <div className="flex gap-3">
                        <Field
                          className="flex-1"
                          label="Last 4 digits"
                          inputMode="numeric"
                          maxLength={4}
                          value={draft.lastDigits}
                          placeholder="4821"
                          onChange={(e) =>
                            onUpdateDraft(draft.key, { lastDigits: e.target.value.replace(/\D/g, '').slice(0, 4) })
                          }
                        />
                        <Field
                          className="flex-[2]"
                          label="Balance now"
                          prefix="₹"
                          inputMode="decimal"
                          value={draft.balanceInput}
                          placeholder="0.00"
                          onChange={(e) => onUpdateDraft(draft.key, { balanceInput: e.target.value })}
                        />
                      </div>
                    </div>
                  ))}

                  <div className="flex items-center justify-between rounded-2xl border border-indigo-500/20 bg-gradient-to-r from-indigo-600/10 to-violet-500/5 px-4 py-3">
                    <span className="text-[13px] text-text-secondary">
                      Total across {drafts.length} account{drafts.length === 1 ? '' : 's'}
                    </span>
                    <span className="font-headline text-[18px] font-bold tabular-nums">{formatMinor(totalBalance)}</span>
                  </div>
                </div>
              )}

              <Button
                variant="outline"
                className="h-11 w-full"
                onClick={onAddDraft}
              >
                <Plus className="size-4" />
                Add another account
              </Button>

              <div className="space-y-2.5 pt-1">
                <div>
                  <h2 className="font-headline text-[15px] font-semibold">Apps to watch</h2>
                  <p className="text-[13px] text-text-muted">Finxeity only reads alerts from these apps.</p>
                </div>
                <div className="w-full min-w-0 max-w-full overflow-hidden rounded-2xl [&_*]:min-w-0 [&_*]:break-words">
                  <AppPicker selected={selectedApps} onChange={onAppsChange} />
                </div>
                <p className={`text-[12px] ${selectedApps.length === 0 ? 'text-amber-400' : 'text-text-muted'}`}>
                  {selectedApps.length === 0
                    ? 'Pick at least one app, or nothing will be tracked automatically.'
                    : `${selectedApps.length} app${selectedApps.length === 1 ? '' : 's'} selected.`}
                </p>
              </div>
            </>
    </>
  )
}

function CategoriesStep({
  categories,
  selected,
  onSelectAll,
  onClear,
  onToggle,
}: {
  categories: Category[]
  selected: Set<string>
  onSelectAll: () => void
  onClear: () => void
  onToggle: (id: string) => void
}) {
  return (
    <>

            <>
              <StepHeading
                icon={Layers}
                title="What counts as essential"
                subtitle="Pick the areas you can’t skip. Everything else is treated as flexible spending."
                aside={
                  <span className="shrink-0 rounded-full border border-indigo-500/25 bg-indigo-500/10 px-2.5 py-0.5 text-[12px] text-calm-indigo-light tabular-nums">
                    {selected.size} chosen
                  </span>
                }
              />

              <div className="flex gap-3 text-[13px]">
                <button
                  type="button"
                  className="text-calm-indigo-light hover:underline"
                  onClick={() => onSelectAll()}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="text-text-muted hover:underline"
                  onClick={() => onClear()}
                >
                  Clear
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {categories.map((category) => {
                  const active = selected.has(category.id)
                  return (
                    <button
                      key={category.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => onToggle(category.id)}
                      className={`relative flex items-center gap-2.5 rounded-2xl border p-3 text-left transition-all active:scale-[0.97] ${
                        active
                          ? 'border-indigo-500/40 bg-gradient-to-br from-indigo-600/15 to-surface-card shadow-sm shadow-indigo-500/10'
                          : 'border-border-subtle bg-surface-canvas opacity-70 hover:opacity-100'
                      }`}
                    >
                      <span className="text-[22px] leading-none">{category.icon ?? '•'}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{category.name}</span>
                      {active && (
                        <span className="fx-pop absolute right-2 top-2 flex size-4 items-center justify-center rounded-full bg-calm-indigo text-white">
                          <Check size={10} strokeWidth={3} />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </>
    </>
  )
}

function RecurringStep({
  recurring,
  recurringMonthly,
  confirmedRecurringMonthly,
  statusPending,
  onToggle,
}: {
  recurring: RecurringSummary[]
  recurringMonthly: number
  confirmedRecurringMonthly: number
  statusPending: boolean
  onToggle: (id: string, confirmed: boolean) => void
}) {
  return (
    <>

            <>
              <StepHeading
                icon={Repeat}
                title="Things that repeat"
                subtitle="Subscriptions and EMIs we spotted. Confirm the real ones so they stay out of your daily money."
              />

              {recurring.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border-subtle px-4 py-9 text-center">
                  <Repeat className="mx-auto mb-2 size-7 text-text-muted" />
                  <p className="text-[14px] font-medium text-text-secondary">Nothing repeating yet</p>
                  <p className="mx-auto mt-1 max-w-[260px] text-[13px] text-text-muted">
                    Payments show up here once they appear two or more times in your alerts. You can continue now.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {recurring.map((payment: RecurringSummary) => {
                    const id = payment.merchantId ?? payment.name
                    return (
                      <div
                        key={id}
                        className={`flex items-center gap-3 rounded-2xl border p-3.5 transition-colors ${
                          payment.confirmed
                            ? 'border-indigo-500/35 bg-gradient-to-r from-indigo-600/10 to-surface-card'
                            : 'border-border-subtle bg-surface-card'
                        }`}
                      >
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-raised font-headline text-[15px] font-bold text-calm-indigo-light">
                          {payment.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-semibold">{payment.name}</p>
                          <p className="text-[12px] tabular-nums text-text-muted">
                            {formatMinor(payment.amountMinor)} ·{' '}
                            {String(payment.cadence).toLowerCase().replace(/^./, (c) => c.toUpperCase())}
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-pressed={payment.confirmed}
                          disabled={statusPending}
                          onClick={() => onToggle(id, payment.confirmed)}
                          className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-all active:scale-95 ${
                            payment.confirmed
                              ? 'border-calm-indigo/40 bg-calm-indigo text-white'
                              : 'border-border-subtle bg-surface-raised text-text-secondary hover:text-text-primary'
                          }`}
                        >
                          {payment.confirmed ? <Check size={13} /> : null}
                          {payment.confirmed ? 'Confirmed' : 'Yes, it’s real'}
                        </button>
                      </div>
                    )
                  })}

                  <div className="mt-1 grid grid-cols-2 gap-2.5">
                    <div className="rounded-2xl border border-border-subtle bg-surface-canvas p-3.5">
                      <p className="text-[12px] text-text-muted">Spotted per month</p>
                      <p className="mt-0.5 font-headline text-[17px] font-bold tabular-nums">
                        {formatMinor(Math.round(recurringMonthly))}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-indigo-500/25 bg-indigo-500/10 p-3.5">
                      <p className="text-[12px] text-text-secondary">Confirmed per month</p>
                      <p className="mt-0.5 font-headline text-[17px] font-bold tabular-nums text-calm-indigo-light">
                        {formatMinor(Math.round(confirmedRecurringMonthly))}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
    </>
  )
}

function FixedStep({
  commitments,
  fixedTotal,
  commitmentName,
  commitmentAmount,
  commitmentDue,
  addPending,
  onName,
  onAmount,
  onDue,
  onAdd,
  onRemove,
}: {
  commitments: Commitment[]
  fixedTotal: number
  commitmentName: string
  commitmentAmount: string
  commitmentDue: string
  addPending: boolean
  onName: (value: string) => void
  onAmount: (value: string) => void
  onDue: (value: string) => void
  onAdd: () => void
  onRemove: (id: string) => void
}) {
  return (
    <>

            <>
              <StepHeading
                icon={Wallet}
                title="Fixed monthly costs"
                subtitle="Rent, school fees, anything you must pay before spending on anything else."
              />

              {commitments.length > 0 && (
                <div className="flex flex-col gap-2.5">
                  {commitments.map((commitment: Commitment) => (
                    <div
                      key={commitment.id}
                      className="flex items-center gap-3 rounded-2xl border border-border-subtle bg-surface-card p-3.5"
                    >
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border-subtle bg-surface-raised text-calm-indigo-light">
                        <Wallet size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-semibold">{commitment.name}</p>
                        <p className="text-[12px] text-text-muted">
                          Due {new Date(commitment.dueAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </p>
                      </div>
                      <span className="text-[14px] font-semibold tabular-nums">{formatMinor(commitment.amountMinor)}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${commitment.name}`}
                        className="rounded-full p-2 text-text-muted hover:bg-surface-raised hover:text-gentle-rose"
                        onClick={() => onRemove(commitment.id)}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <Panel className="space-y-3.5">
                <h2 className="font-headline text-[15px] font-semibold">Add a fixed cost</h2>
                <Field
                  label="What is it?"
                  placeholder="Apartment rent"
                  value={commitmentName}
                  onChange={(e) => onName(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Amount"
                    prefix="₹"
                    inputMode="decimal"
                    placeholder="28000"
                    value={commitmentAmount}
                    onChange={(e) => onAmount(e.target.value)}
                  />
                  <Field
                    label="Next due date"
                    type="date"
                    value={commitmentDue}
                    onChange={(e) => onDue(e.target.value)}
                  />
                </div>
                <Button
                  className="h-11 w-full"
                  disabled={
                    addPending ||
                    !commitmentName.trim() ||
                    !((parseMajorToMinor(commitmentAmount) ?? 0) > 0)
                  }
                  onClick={onAdd}
                >
                  <Plus className="size-4" />
                  {addPending ? 'Adding…' : 'Add fixed cost'}
                </Button>
              </Panel>

              <div className="flex items-center justify-between rounded-2xl border border-indigo-500/20 bg-gradient-to-r from-indigo-600/10 to-violet-500/5 px-4 py-3.5">
                <span className="text-[13px] text-text-secondary">Total set aside each month</span>
                <span className="font-headline text-[20px] font-bold tabular-nums text-calm-indigo-light">
                  {formatMinor(fixedTotal)}
                </span>
              </div>
            </>
    </>
  )
}

function GoalsStep({
  goals,
  goalName,
  goalTarget,
  goalSaved,
  bufferInput,
  incomeDay,
  expectedIncome,
  savingsRate,
  addPending,
  onName,
  onTarget,
  onSaved,
  onBuffer,
  onIncomeDay,
  onExpectedIncome,
  onSavingsRate,
  onAdd,
  onRemove,
}: {
  goals: Goal[]
  goalName: string
  goalTarget: string
  goalSaved: string
  bufferInput: string
  incomeDay: string
  expectedIncome: string
  savingsRate: number
  addPending: boolean
  onName: (value: string) => void
  onTarget: (value: string) => void
  onSaved: (value: string) => void
  onBuffer: (value: string) => void
  onIncomeDay: (value: string) => void
  onExpectedIncome: (value: string) => void
  onSavingsRate: (value: number) => void
  onAdd: () => void
  onRemove: (id: string) => void
}) {
  return (
    <>

            <>
              <StepHeading
                icon={Target}
                title="Goals and buffer"
                subtitle="Protect a cushion and tell us what you’re saving toward. We keep them out of your daily number."
              />

              {goals.length > 0 && (
                <div className="space-y-2.5">
                  {goals.map((goal: Goal) => {
                    const pct = goal.targetMinor > 0 ? Math.min(100, (goal.savedMinor / goal.targetMinor) * 100) : 0
                    return (
                      <div
                        key={goal.id}
                        className="flex items-center gap-3.5 rounded-2xl border border-border-subtle bg-surface-card p-4"
                      >
                        <div className="relative">
                          <Ring pct={pct} />
                          <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold tabular-nums">
                            {Math.round(pct)}%
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-semibold">{goal.name}</p>
                          <p className="text-[12px] tabular-nums text-text-muted">
                            {formatMinor(goal.savedMinor)} of {formatMinor(goal.targetMinor)}
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label={`Remove ${goal.name}`}
                          className="rounded-full p-2 text-text-muted hover:bg-surface-raised hover:text-gentle-rose"
                          onClick={() => onRemove(goal.id)}
                        >
                          <X size={15} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              <Panel className="space-y-3.5">
                <h2 className="font-headline text-[15px] font-semibold">Add a goal</h2>
                <Field
                  label="Goal name"
                  placeholder="Emergency fund"
                  value={goalName}
                  onChange={(e) => onName(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Target"
                    prefix="₹"
                    inputMode="decimal"
                    placeholder="150000"
                    value={goalTarget}
                    onChange={(e) => onTarget(e.target.value)}
                  />
                  <Field
                    label="Saved so far"
                    prefix="₹"
                    inputMode="decimal"
                    placeholder="40000"
                    value={goalSaved}
                    onChange={(e) => onSaved(e.target.value)}
                  />
                </div>
                <Button
                  className="h-11 w-full"
                  variant="secondary"
                  disabled={addPending || !goalName.trim() || !((parseMajorToMinor(goalTarget) ?? 0) > 0)}
                  onClick={onAdd}
                >
                  <Plus className="size-4" />
                  {addPending ? 'Adding…' : 'Add goal'}
                </Button>
              </Panel>

              <Panel className="space-y-4">
                <h2 className="font-headline text-[15px] font-semibold">Buffer and income</h2>
                <Field
                  label="Emergency buffer to protect"
                  prefix="₹"
                  inputMode="decimal"
                  placeholder="25000"
                  value={bufferInput}
                  onChange={(e) => onBuffer(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Payday (day of month)"
                    type="number"
                    min={1}
                    max={31}
                    inputMode="numeric"
                    placeholder="1"
                    value={incomeDay}
                    onChange={(e) => onIncomeDay(e.target.value)}
                  />
                  <Field
                    label="Monthly income"
                    prefix="₹"
                    inputMode="decimal"
                    placeholder="85000"
                    value={expectedIncome}
                    onChange={(e) => onExpectedIncome(e.target.value)}
                  />
                </div>

                <div className="space-y-2.5 border-t border-border-subtle pt-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] text-text-secondary">Save each month</Label>
                    <span className="text-[13px] font-semibold tabular-nums text-calm-indigo-light">
                      {savingsRate}%
                      {(parseMajorToMinor(expectedIncome) ?? 0) > 0 &&
                        ` · ${formatMinor(Math.round((parseMajorToMinor(expectedIncome) ?? 0) * (savingsRate / 100)))}`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={50}
                    step={5}
                    value={savingsRate}
                    aria-label="Savings rate"
                    onChange={(e) => onSavingsRate(Number(e.target.value))}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-surface-raised accent-calm-indigo"
                  />
                  <p className="text-[12px] text-text-muted">
                    Used to work out your daily number on the next screen. Add income above to see the amount.
                  </p>
                </div>
              </Panel>
            </>
    </>
  )
}

function ReadyStep({
  calm,
  animatedPerDay,
  animatedTotal,
  namedDraftsCount,
  existingAccountCount,
  fixedTotal,
  commitmentCount,
  selectedCategoryCount,
  goalCount,
  granted,
  ignoring,
  onEdit,
  onFixAccess,
  onRequestBattery,
}: {
  calm: { days: number; saving: number; spendable: number; perDay: number }
  animatedPerDay: number
  animatedTotal: number
  namedDraftsCount: number
  existingAccountCount: number
  fixedTotal: number
  commitmentCount: number
  selectedCategoryCount: number
  goalCount: number
  granted: boolean
  ignoring: boolean
  onEdit: (index: number) => void
  onFixAccess: () => void
  onRequestBattery: () => void
}) {
  return (
    <>

            <>
              <div className="relative overflow-hidden rounded-3xl border border-indigo-500/25 bg-gradient-to-b from-indigo-600/20 via-surface-card to-surface-card p-6 text-center">
                <div className="pointer-events-none absolute left-1/2 top-0 size-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-calm-indigo/30 blur-3xl" />
                <p className="relative text-[14px] text-text-secondary">You can comfortably spend about</p>
                <p
                  className={`relative mt-1 font-headline text-[56px] font-extrabold leading-none tracking-tight tabular-nums ${
                    calm.spendable > 0 ? 'text-text-primary' : 'text-gentle-rose'
                  }`}
                >
                  {formatMinor(animatedPerDay)}
                </p>
                <p className="relative mt-1.5 text-[14px] font-medium text-calm-indigo-light">
                  a day, for the next {calm.days} day{calm.days === 1 ? '' : 's'}
                </p>
                <p className="relative mx-auto mt-4 max-w-[290px] text-[12px] leading-relaxed text-text-muted">
                  {calm.spendable > 0
                    ? 'An estimate from your balances after the buffer, fixed costs, confirmed repeats and savings. It sharpens as alerts come in.'
                    : 'Your commitments are higher than your balance right now. Go back and check your balances, buffer or savings rate.'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { label: 'Starting balance', value: formatMinor(animatedTotal), sub: `${namedDraftsCount || existingAccountCount} accounts`, go: 2 },
                  { label: 'Fixed per month', value: formatMinor(fixedTotal), sub: `${commitmentCount} cost${commitmentCount === 1 ? '' : 's'}`, go: 5 },
                  { label: 'Essential buckets', value: String(selectedCategoryCount), sub: 'chosen', go: 3 },
                  { label: 'Goals', value: String(goalCount), sub: calm.saving > 0 ? `saving ${formatMinor(calm.saving)}/mo` : 'none yet', go: 6 },
                ].map((tile) => (
                  <button
                    key={tile.label}
                    type="button"
                    onClick={() => onEdit(tile.go)}
                    className="rounded-2xl border border-border-subtle bg-surface-card p-3.5 text-left transition-colors hover:border-indigo-500/40"
                  >
                    <p className="text-[12px] text-text-muted">{tile.label}</p>
                    <p className="mt-0.5 font-headline text-[18px] font-bold tabular-nums">{tile.value}</p>
                    <p className="text-[11px] text-text-muted">{tile.sub} · Edit</p>
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3 rounded-2xl border border-border-subtle bg-surface-raised/60 p-3.5">
                <Lock className="size-5 shrink-0 text-calm-indigo-light" />
                <p className="text-[12px] leading-relaxed text-text-secondary">
                  Everything above is encrypted and kept only on this phone.
                </p>
              </div>

              {!granted && (
                <Alert variant="destructive">
                  <AlertTitle>Notification access is still off</AlertTitle>
                  <AlertDescription>
                    Finxeity can’t track new spending until you turn it on.{' '}
                    <button type="button" className="underline" onClick={() => onFixAccess()}>
                      Fix it now
                    </button>
                  </AlertDescription>
                </Alert>
              )}
              {!ignoring && (
                <Button
                  className="h-11 w-full"
                  variant="outline"
                  onClick={() => onRequestBattery()}
                >
                  <BatteryCharging className="size-4" />
                  Exempt from battery optimization
                </Button>
              )}
            </>
    </>
  )
}
