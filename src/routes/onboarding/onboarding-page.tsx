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
import type { AccountType, Commitment, Goal, RecurringSummary } from '@/lib/plugin'
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

export function OnboardingPage() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const scrollRef = useRef<HTMLDivElement>(null)

  const [stepIndex, setStepIndex] = useState(0)
  const [maxReached, setMaxReached] = useState(0)
  const [direction, setDirection] = useState<'fwd' | 'back'>('fwd')
  const step: Step = STEPS[stepIndex].id

  const [selectedApps, setSelectedApps] = useState<string[]>([])
  const [drafts, setDrafts] = useState<AccountDraft[]>([])
  const draftsInitialised = useRef(false)

  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set())
  const categoriesInitialised = useRef(false)

  const [commitmentName, setCommitmentName] = useState('')
  const [commitmentAmount, setCommitmentAmount] = useState('')
  const [commitmentDue, setCommitmentDue] = useState('')

  const [goalName, setGoalName] = useState('')
  const [goalTarget, setGoalTarget] = useState('')
  const [goalSaved, setGoalSaved] = useState('')

  const [bufferInput, setBufferInput] = useState('')
  const [incomeDay, setIncomeDay] = useState('')
  const [expectedIncome, setExpectedIncome] = useState('')
  const [savingsRate, setSavingsRate] = useState(20)

  const [infoDraftKey, setInfoDraftKey] = useState<string | null>(null)
  const [detectedCount, setDetectedCount] = useState<number | null>(null)
  const [showConfetti, setShowConfetti] = useState(false)
  const [finishing, setFinishing] = useState(false)

  /* ---------------------------- queries ---------------------------- */

  const accountsQuery = useQuery({ queryKey: queryKeys.accounts, queryFn: () => LocalExpense.listAccounts() })
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: () => LocalExpense.listCategories() })
  const recurringQuery = useQuery({ queryKey: queryKeys.recurring, queryFn: () => LocalExpense.listRecurring() })
  const commitmentsQuery = useQuery({ queryKey: ['commitments'], queryFn: () => LocalExpense.listCommitments() })
  const goalsQuery = useQuery({ queryKey: ['goals'], queryFn: () => LocalExpense.listGoals() })
  const financialQuery = useQuery({ queryKey: ['financialSettings'], queryFn: () => LocalExpense.getFinancialSettings() })
  const listenerQuery = useQuery({ queryKey: queryKeys.listener, queryFn: () => LocalExpense.getListenerStatus() })
  const batteryQuery = useQuery({
    queryKey: queryKeys.battery,
    queryFn: () => LocalExpense.isIgnoringBatteryOptimizations(),
  })

  const refetchListener = listenerQuery.refetch
  const refetchBattery = batteryQuery.refetch

  /* ---------------------- seed local form state --------------------- */

  useEffect(() => {
    if (draftsInitialised.current || !accountsQuery.data) return
    draftsInitialised.current = true
    if (accountsQuery.data.accounts.length > 0) {
      setDrafts(
        accountsQuery.data.accounts.map((account) => ({
          key: account.id,
          id: account.id,
          name: account.name,
          lastDigits: account.lastDigits ?? '',
          balanceInput: (account.anchorBalanceMinor / 100).toString(),
          type: account.type,
        })),
      )
    }
  }, [accountsQuery.data])

  useEffect(() => {
    if (categoriesInitialised.current || !categoriesQuery.data || !financialQuery.data) return
    categoriesInitialised.current = true
    const essential = financialQuery.data.essentialCategories
    if (essential.length > 0) {
      setSelectedCategories(new Set(essential))
    } else {
      setSelectedCategories(new Set(categoriesQuery.data.categories.slice(0, 6).map((c) => c.id)))
    }
    setBufferInput((financialQuery.data.bufferMinor / 100).toString())
    setIncomeDay(financialQuery.data.incomeDay ? String(financialQuery.data.incomeDay) : '')
    setExpectedIncome(
      financialQuery.data.expectedIncomeMinor ? (financialQuery.data.expectedIncomeMinor / 100).toString() : '',
    )
  }, [categoriesQuery.data, financialQuery.data])

  /* Re-check permissions while on the access step: when the user returns
     from system settings, the status flips without a manual tap. */
  useEffect(() => {
    if (step !== 'access') return
    const check = () => {
      void refetchListener()
      void refetchBattery()
    }
    const id = window.setInterval(check, 1500)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', check)
    }
  }, [step, refetchListener, refetchBattery])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [stepIndex])

  useEffect(() => {
    if (step !== 'ready') return
    setShowConfetti(true)
    const id = window.setTimeout(() => setShowConfetti(false), 4200)
    return () => window.clearTimeout(id)
  }, [step])

  /* --------------------------- mutations ---------------------------- */

  const saveApps = useMutation({
    mutationFn: (packages: string[]) => LocalExpense.setMonitoredApps({ packages }),
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
      let added = 0
      setDrafts((current) => {
        const merged = [...current]
        for (const proposal of proposals) {
          const exists = merged.some(
            (d) => d.lastDigits && d.lastDigits === proposal.lastDigits && d.name === proposal.name,
          )
          if (exists) continue
          added += 1
          const type: AccountType =
            proposal.type === 'CARD' || proposal.type === 'CASH' || proposal.type === 'WALLET' || proposal.type === 'OTHER'
              ? proposal.type
              : 'BANK'
          merged.push({
            key: `proposal-${proposal.packageName}-${proposal.lastDigits}`,
            name: proposal.name,
            lastDigits: proposal.lastDigits,
            balanceInput: proposal.balanceMinor != null ? (proposal.balanceMinor / 100).toString() : '',
            type,
            sourceTexts: proposal.sourceTexts,
            detected: true,
          })
        }
        return merged
      })
      setDetectedCount(proposals.length)
      if (proposals.length === 0) toast.info('No accounts found in your recent alerts')
    },
    onError: () => toast.error('Could not scan alerts. You can add accounts by hand.'),
  })

  const saveBalances = useMutation({
    mutationFn: async () => {
      const valid = drafts.filter((d) => d.name.trim())
      for (const draft of valid) {
        await LocalExpense.setAccountBalance({
          id: draft.id,
          name: draft.name.trim(),
          lastDigits: draft.lastDigits.trim() || null,
          type: draft.type,
          balanceMinor: parseMajorToMinor(draft.balanceInput) ?? 0,
        })
      }
    },
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.accounts }),
  })

  const saveCategories = useMutation({
    mutationFn: () => LocalExpense.setFinancialSettings({ essentialCategories: Array.from(selectedCategories) }),
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

  /* --------------------------- derived data ------------------------- */

  const totalBalance = useMemo(
    () => drafts.reduce((sum, d) => sum + (parseMajorToMinor(d.balanceInput) ?? 0), 0),
    [drafts],
  )
  const namedDrafts = drafts.filter((d) => d.name.trim())
  const commitments = useMemo(() => commitmentsQuery.data?.commitments ?? [], [commitmentsQuery.data])
  const fixedTotal = useMemo(() => commitments.reduce((sum, c) => sum + c.amountMinor, 0), [commitments])
  const goals = goalsQuery.data?.goals ?? []
  const recurring = useMemo(() => recurringQuery.data?.recurring ?? [], [recurringQuery.data])

  const recurringMonthly = useMemo(
    () => recurring.reduce((sum, p) => sum + p.amountMinor * monthlyFactor(String(p.cadence)), 0),
    [recurring],
  )
  const confirmedRecurringMonthly = useMemo(
    () =>
      recurring
        .filter((p) => p.confirmed)
        .reduce((sum, p) => sum + p.amountMinor * monthlyFactor(String(p.cadence)), 0),
    [recurring],
  )

  const granted = listenerQuery.data?.accessGranted ?? false
  const ignoring = batteryQuery.data?.ignoring ?? false

  /* The "calm daily number": what is left after the buffer, fixed costs,
     confirmed recurring payments and savings, spread to the next payday. */
  const calm = useMemo(() => {
    const buffer = parseMajorToMinor(bufferInput) ?? 0
    const income = parseMajorToMinor(expectedIncome) ?? 0
    const saving = Math.round(income * (savingsRate / 100))
    const days = daysUntilIncome(Number(incomeDay) || 0)
    const spendable = totalBalance - buffer - fixedTotal - Math.round(confirmedRecurringMonthly) - saving
    return { days, saving, spendable, perDay: Math.max(0, Math.round(spendable / days)) }
  }, [bufferInput, expectedIncome, savingsRate, incomeDay, totalBalance, fixedTotal, confirmedRecurringMonthly])

  const animatedPerDay = useCountUp(step === 'ready' ? calm.perDay : 0)
  const animatedTotal = useCountUp(step === 'ready' ? totalBalance : 0)

  /* ---------------------------- navigation -------------------------- */

  const goTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= STEPS.length) return
      setDirection(index >= stepIndex ? 'fwd' : 'back')
      setStepIndex(index)
      setMaxReached((m) => Math.max(m, index))
    },
    [stepIndex],
  )
  const next = () => goTo(stepIndex + 1)
  const back = () => goTo(stepIndex - 1)

  function updateDraft(key: string, patch: Partial<AccountDraft>) {
    setDrafts((current) => current.map((d) => (d.key === key ? { ...d, ...patch } : d)))
  }

  function addQuickAccount(name: string, type: AccountType) {
    setDrafts((current) =>
      current.some((d) => d.name === name)
        ? current
        : [...current, { key: `quick-${name}`, name, lastDigits: '', balanceInput: '', type }],
    )
  }

  async function finish() {
    setFinishing(true)
    try {
      await LocalExpense.setOnboardingComplete({ completed: true })
      await client.invalidateQueries({ queryKey: queryKeys.onboarding })
      navigate('/dashboard', { replace: true })
    } catch {
      toast.error('Could not finish setup. Try again.')
      setFinishing(false)
    }
  }

  async function onPrimary() {
    try {
      switch (step) {
        case 'accounts':
          if (selectedApps.length > 0) await saveApps.mutateAsync(selectedApps)
          await saveBalances.mutateAsync()
          if (namedDrafts.length > 0) toast.success('Accounts saved')
          break
        case 'categories':
          await saveCategories.mutateAsync()
          break
        case 'goals':
          await saveFinancial.mutateAsync()
          break
        case 'ready':
          await finish()
          return
      }
      next()
    } catch {
      toast.error('Could not save. Check your entries and try again.')
    }
  }

  const busy =
    saveApps.isPending || saveBalances.isPending || saveCategories.isPending || saveFinancial.isPending || finishing

  const primaryLabel: Record<Step, string> = {
    privacy: 'Start setup',
    access: granted ? 'Continue' : 'Continue without access',
    accounts: namedDrafts.length === 0 ? 'Skip for now' : 'Save and continue',
    categories: 'Save and continue',
    recurring: 'Continue',
    fixed: fixedTotal > 0 ? 'Continue' : 'Skip for now',
    goals: 'Save and review',
    ready: 'Open my dashboard',
  }

  const availableCategories = (categoriesQuery.data?.categories ?? []).filter((c) => c.kind === 'EXPENSE')
  const infoDraft = drafts.find((d) => d.key === infoDraftKey)

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */

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

      {/* ------------------------------ content ------------------------------ */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 pt-2 pb-8">
        <div
          key={step}
          className={`mx-auto flex w-full min-w-0 max-w-md flex-col gap-5 ${direction === 'fwd' ? 'fx-step-fwd' : 'fx-step-back'}`}
        >
          {/* ============================ PRIVACY ============================ */}
          {step === 'privacy' && (
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
          )}

          {/* ============================= ACCESS ============================= */}
          {step === 'access' && (
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
                        onClick={() => void refetchListener()}
                        disabled={listenerQuery.isFetching}
                      >
                        <RefreshCw className={`size-4 ${listenerQuery.isFetching ? 'animate-spin' : ''}`} />
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
          )}

          {/* ============================ ACCOUNTS ============================ */}
          {step === 'accounts' && (
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
                  onClick={() => detect.mutate()}
                  disabled={detect.isPending}
                >
                  <Sparkles className={`size-4 ${detect.isPending ? 'animate-pulse' : ''}`} />
                  {detect.isPending ? 'Scanning alerts…' : detectedCount === null ? 'Scan my alerts' : 'Scan again'}
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
                        onClick={() => addQuickAccount(q.name, q.type)}
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
                              onClick={() => setInfoDraftKey(draft.key)}
                            >
                              <Info size={16} />
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label="Remove account"
                            className="rounded-full p-1.5 text-text-muted hover:bg-surface-raised hover:text-gentle-rose"
                            onClick={() => setDrafts((c) => c.filter((d) => d.key !== draft.key))}
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
                            onClick={() => updateDraft(draft.key, { type })}
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
                        onChange={(e) => updateDraft(draft.key, { name: e.target.value })}
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
                            updateDraft(draft.key, { lastDigits: e.target.value.replace(/\D/g, '').slice(0, 4) })
                          }
                        />
                        <Field
                          className="flex-[2]"
                          label="Balance now"
                          prefix="₹"
                          inputMode="decimal"
                          value={draft.balanceInput}
                          placeholder="0.00"
                          onChange={(e) => updateDraft(draft.key, { balanceInput: e.target.value })}
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
                onClick={() =>
                  setDrafts((c) => [
                    ...c,
                    { key: `manual-${Date.now()}`, name: '', lastDigits: '', balanceInput: '', type: 'BANK' },
                  ])
                }
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
                  <AppPicker selected={selectedApps} onChange={setSelectedApps} preselectDefaultSms />
                </div>
                <p className={`text-[12px] ${selectedApps.length === 0 ? 'text-amber-400' : 'text-text-muted'}`}>
                  {selectedApps.length === 0
                    ? 'Pick at least one app, or nothing will be tracked automatically.'
                    : `${selectedApps.length} app${selectedApps.length === 1 ? '' : 's'} selected.`}
                </p>
              </div>
            </>
          )}

          {/* =========================== CATEGORIES =========================== */}
          {step === 'categories' && (
            <>
              <StepHeading
                icon={Layers}
                title="What counts as essential"
                subtitle="Pick the areas you can’t skip. Everything else is treated as flexible spending."
                aside={
                  <span className="shrink-0 rounded-full border border-indigo-500/25 bg-indigo-500/10 px-2.5 py-0.5 text-[12px] text-calm-indigo-light tabular-nums">
                    {selectedCategories.size} chosen
                  </span>
                }
              />

              <div className="flex gap-3 text-[13px]">
                <button
                  type="button"
                  className="text-calm-indigo-light hover:underline"
                  onClick={() => setSelectedCategories(new Set(availableCategories.map((c) => c.id)))}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="text-text-muted hover:underline"
                  onClick={() => setSelectedCategories(new Set())}
                >
                  Clear
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {availableCategories.map((category) => {
                  const active = selectedCategories.has(category.id)
                  return (
                    <button
                      key={category.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setSelectedCategories((current) => {
                          const nextSet = new Set(current)
                          if (nextSet.has(category.id)) nextSet.delete(category.id)
                          else nextSet.add(category.id)
                          return nextSet
                        })
                      }
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
          )}

          {/* ============================ RECURRING =========================== */}
          {step === 'recurring' && (
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
                          disabled={setStatus.isPending}
                          onClick={() =>
                            setStatus.mutate({ merchantId: id, status: payment.confirmed ? 'SUGGESTED' : 'CONFIRMED' })
                          }
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
          )}

          {/* ============================== FIXED ============================= */}
          {step === 'fixed' && (
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
                        onClick={() => removeCommitment.mutate(commitment.id)}
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
                  onChange={(e) => setCommitmentName(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Amount"
                    prefix="₹"
                    inputMode="decimal"
                    placeholder="28000"
                    value={commitmentAmount}
                    onChange={(e) => setCommitmentAmount(e.target.value)}
                  />
                  <Field
                    label="Next due date"
                    type="date"
                    value={commitmentDue}
                    onChange={(e) => setCommitmentDue(e.target.value)}
                  />
                </div>
                <Button
                  className="h-11 w-full"
                  disabled={
                    addCommitment.isPending ||
                    !commitmentName.trim() ||
                    !((parseMajorToMinor(commitmentAmount) ?? 0) > 0)
                  }
                  onClick={() => addCommitment.mutate()}
                >
                  <Plus className="size-4" />
                  {addCommitment.isPending ? 'Adding…' : 'Add fixed cost'}
                </Button>
              </Panel>

              <div className="flex items-center justify-between rounded-2xl border border-indigo-500/20 bg-gradient-to-r from-indigo-600/10 to-violet-500/5 px-4 py-3.5">
                <span className="text-[13px] text-text-secondary">Total set aside each month</span>
                <span className="font-headline text-[20px] font-bold tabular-nums text-calm-indigo-light">
                  {formatMinor(fixedTotal)}
                </span>
              </div>
            </>
          )}

          {/* ============================== GOALS ============================= */}
          {step === 'goals' && (
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
                          onClick={() => removeGoal.mutate(goal.id)}
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
                  onChange={(e) => setGoalName(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Target"
                    prefix="₹"
                    inputMode="decimal"
                    placeholder="150000"
                    value={goalTarget}
                    onChange={(e) => setGoalTarget(e.target.value)}
                  />
                  <Field
                    label="Saved so far"
                    prefix="₹"
                    inputMode="decimal"
                    placeholder="40000"
                    value={goalSaved}
                    onChange={(e) => setGoalSaved(e.target.value)}
                  />
                </div>
                <Button
                  className="h-11 w-full"
                  variant="secondary"
                  disabled={addGoal.isPending || !goalName.trim() || !((parseMajorToMinor(goalTarget) ?? 0) > 0)}
                  onClick={() => addGoal.mutate()}
                >
                  <Plus className="size-4" />
                  {addGoal.isPending ? 'Adding…' : 'Add goal'}
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
                  onChange={(e) => setBufferInput(e.target.value)}
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
                    onChange={(e) => setIncomeDay(e.target.value)}
                  />
                  <Field
                    label="Monthly income"
                    prefix="₹"
                    inputMode="decimal"
                    placeholder="85000"
                    value={expectedIncome}
                    onChange={(e) => setExpectedIncome(e.target.value)}
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
                    onChange={(e) => setSavingsRate(Number(e.target.value))}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-surface-raised accent-calm-indigo"
                  />
                  <p className="text-[12px] text-text-muted">
                    Used to work out your daily number on the next screen. Add income above to see the amount.
                  </p>
                </div>
              </Panel>
            </>
          )}

          {/* ============================== READY ============================= */}
          {step === 'ready' && (
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
                  { label: 'Starting balance', value: formatMinor(animatedTotal), sub: `${namedDrafts.length || accountsQuery.data?.accounts.length || 0} accounts`, go: 2 },
                  { label: 'Fixed per month', value: formatMinor(fixedTotal), sub: `${commitments.length} cost${commitments.length === 1 ? '' : 's'}`, go: 5 },
                  { label: 'Essential buckets', value: String(selectedCategories.size), sub: 'chosen', go: 3 },
                  { label: 'Goals', value: String(goals.length), sub: calm.saving > 0 ? `saving ${formatMinor(calm.saving)}/mo` : 'none yet', go: 6 },
                ].map((tile) => (
                  <button
                    key={tile.label}
                    type="button"
                    onClick={() => goTo(tile.go)}
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
                    <button type="button" className="underline" onClick={() => goTo(1)}>
                      Fix it now
                    </button>
                  </AlertDescription>
                </Alert>
              )}
              {!ignoring && (
                <Button
                  className="h-11 w-full"
                  variant="outline"
                  onClick={() => LocalExpense.requestIgnoreBatteryOptimizations()}
                >
                  <BatteryCharging className="size-4" />
                  Exempt from battery optimization
                </Button>
              )}
            </>
          )}
        </div>
      </div>

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
                <span>{primaryLabel[step]}</span>
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
                <div key={index} className={`flex ${index % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
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