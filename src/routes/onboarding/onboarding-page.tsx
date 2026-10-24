import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  BatteryCharging,
  BellRing,
  CheckCircle2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { AppPicker } from '@/components/app-picker'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { LocalExpense } from '@/lib/plugin'
import type { AccountType, Commitment, Goal, RecurringSummary } from '@/lib/plugin'
import { formatMinor, parseMajorToMinor } from '@/lib/money'
import { queryKeys } from '@/lib/query'

const PROTOTYPE_STEPS = [
  'privacy',
  'access',
  'accounts',
  'categories',
  'recurring',
  'fixed',
  'goals',
  'ready',
] as const
type Step = (typeof PROTOTYPE_STEPS)[number]

const STEP_TITLES = [
  'Privacy & Vault',
  'Access',
  'Accounts & Balances',
  'Spend Buckets',
  'Recurring & Bills',
  'Fixed Living Costs',
  'Goals & Buffers',
  'Review Ledger',
]

interface AccountDraft {
  key: string
  id?: string
  name: string
  lastDigits: string
  balanceInput: string
  type: AccountType
  sourceTexts?: string[]
}

export function OnboardingPage() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const [stepIndex, setStepIndex] = useState(0)
  const step: Step = PROTOTYPE_STEPS[stepIndex]

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
  const [detectedProposals, setDetectedProposals] = useState<
    { packageName: string; name: string; type?: string; lastDigits: string; balanceMinor: number | null; sourceTexts?: string[] }[]
  >([])

  const accountsQuery = useQuery({
    queryKey: queryKeys.accounts,
    queryFn: () => LocalExpense.listAccounts(),
  })

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => LocalExpense.listCategories(),
  })

  const recurringQuery = useQuery({
    queryKey: queryKeys.recurring,
    queryFn: () => LocalExpense.listRecurring(),
  })

  const commitmentsQuery = useQuery({
    queryKey: ['commitments'],
    queryFn: () => LocalExpense.listCommitments(),
  })

  const goalsQuery = useQuery({
    queryKey: ['goals'],
    queryFn: () => LocalExpense.listGoals(),
  })

  const financialQuery = useQuery({
    queryKey: ['financialSettings'],
    queryFn: () => LocalExpense.getFinancialSettings(),
  })

  const listenerQuery = useQuery({
    queryKey: queryKeys.listener,
    queryFn: () => LocalExpense.getListenerStatus(),
  })

  const batteryQuery = useQuery({
    queryKey: queryKeys.battery,
    queryFn: () => LocalExpense.isIgnoringBatteryOptimizations(),
  })

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
      if (proposals.length === 0) {
        toast.info('No accounts detected in current notifications')
        return
      }
      setDetectedProposals(proposals)
      const first = proposals[0]
      const nameInput = document.getElementById('acc-name-input') as HTMLInputElement | null
      const typeInput = document.getElementById('acc-type-input') as HTMLSelectElement | null
      const balInput = document.getElementById('acc-bal-input') as HTMLInputElement | null
      if (nameInput) nameInput.value = first.name
      if (typeInput) typeInput.value = 'Savings'
      if (balInput && first.balanceMinor != null) balInput.value = (first.balanceMinor / 100).toString()
      const merged = [...drafts]
      for (const proposal of proposals) {
        const exists = merged.some(
          (draft) => draft.lastDigits === proposal.lastDigits && draft.name === proposal.name,
        )
        if (!exists) {
          merged.push({
            key: `proposal-${proposal.packageName}-${proposal.lastDigits}`,
            name: proposal.name,
            lastDigits: proposal.lastDigits,
            balanceInput:
              proposal.balanceMinor != null ? (proposal.balanceMinor / 100).toString() : '',
            type: (proposal.type === 'CARD' ? 'CARD' : proposal.type === 'CASH' ? 'CASH' : proposal.type === 'WALLET' ? 'WALLET' : proposal.type === 'OTHER' ? 'OTHER' : 'BANK') as AccountType,
            sourceTexts: proposal.sourceTexts,
          })
        }
      }
      setDrafts(merged)
    },
  })

  const saveBalances = useMutation({
    mutationFn: async () => {
      const valid = drafts.filter((draft) => draft.name.trim())
      for (const draft of valid) {
        const balanceMinor = parseMajorToMinor(draft.balanceInput) ?? 0
        await LocalExpense.setAccountBalance({
          id: draft.id,
          name: draft.name.trim(),
          lastDigits: draft.lastDigits.trim() || null,
          type: draft.type,
          balanceMinor,
        })
      }
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.accounts })
      toast.success('Balances saved')
    },
  })

  const saveCategories = useMutation({
    mutationFn: () =>
      LocalExpense.setFinancialSettings({ essentialCategories: Array.from(selectedCategories) }),
    onSuccess: () => toast.success('Spend buckets saved'),
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
        name: commitmentName,
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
        name: goalName,
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
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['financialSettings'] })
      toast.success('Saved')
    },
  })

  async function finish() {
    await LocalExpense.setOnboardingComplete({ completed: true })
    await client.invalidateQueries({ queryKey: queryKeys.onboarding })
    navigate('/dashboard', { replace: true })
  }

  function next() {
    setStepIndex((index) => Math.min(index + 1, PROTOTYPE_STEPS.length - 1))
  }

  function back() {
    setStepIndex((index) => Math.max(index - 1, 0))
  }

  function goToStep(step: number) {
    if (step < 1 || step > PROTOTYPE_STEPS.length) return
    setStepIndex(step - 1)
  }

  const progress = ((stepIndex + 1) / PROTOTYPE_STEPS.length) * 100

  const totalBalance = useMemo(
    () => drafts.reduce((sum, draft) => sum + (parseMajorToMinor(draft.balanceInput) ?? 0), 0),
    [drafts],
  )

  const commitments = useMemo(() => commitmentsQuery.data?.commitments ?? [], [commitmentsQuery.data])
  const fixedTotal = useMemo(
    () => commitments.reduce((sum, c) => sum + c.amountMinor, 0),
    [commitments],
  )

  const goals = goalsQuery.data?.goals ?? []

  const granted = listenerQuery.data?.accessGranted ?? false
  const ignoring = batteryQuery.data?.ignoring ?? false

  function updateDraft(key: string, patch: Partial<AccountDraft>) {
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)))
  }

  return (
    <div className="flex h-dvh flex-col bg-surface-canvas text-text-primary">
      <header className="w-full px-5 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600/30 to-violet-500/20 border border-indigo-500/20 flex items-center justify-center text-primary shadow-sm shadow-indigo-500/10">
            <ShieldCheck className="text-calm-indigo-light" size={20} />
          </div>
          <div className="flex flex-col">
            <span className="font-headline text-[19px] tracking-tight text-text-primary font-bold leading-none">Finxeity</span>
            <span className="text-[11px] font-sans text-text-muted mt-1 leading-none tracking-wide">Calm, private financial clarity</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-card border border-border-subtle">
          <span className="w-1.5 h-1.5 rounded-full bg-calm-emerald animate-pulse" />
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">On-Device</span>
        </div>
      </header>

      <div className="w-full px-5 py-2.5 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono tracking-wide text-text-muted uppercase" id="step-counter-text">
            {stepIndex + 1} of {PROTOTYPE_STEPS.length} · {STEP_TITLES[stepIndex]}
          </span>
          <button
            className="text-[12px] font-medium text-calm-indigo-light hover:text-white transition-colors py-0.5 px-1.5"
            onClick={() => goToStep(PROTOTYPE_STEPS.length)}
            type="button"
          >
            Skip to Ready
          </button>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar" id="step-nav-pills">
          {PROTOTYPE_STEPS.map((_, index) => (
            <button
              key={index}
              className={`step-pill px-3.5 py-1.5 rounded-full text-[12px] whitespace-nowrap transition-all duration-200 flex items-center gap-1.5 ${
                index === stepIndex
                  ? 'bg-calm-indigo text-white font-medium shadow-sm shadow-indigo-500/20'
                  : 'bg-surface-card border border-border-subtle text-text-secondary hover:text-text-primary'
              }`}
              data-step-target={index + 1}
              onClick={() => goToStep(index + 1)}
              type="button"
            >
              <span>{index + 1}. {STEP_TITLES[index].split(' ')[0]}</span>
            </button>
          ))}
        </div>
        <div className="w-full h-1 bg-surface-raised rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-calm-indigo to-calm-indigo-light transition-all duration-300 rounded-full"
            id="step-progress-bar"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-6">
        <div className="w-full max-w-md mx-auto flex flex-col gap-5">
          {step === 'privacy' && (
            <section className="flex flex-col gap-6" id="step-1">
              <div className="relative w-full py-9 flex flex-col items-center justify-center overflow-hidden rounded-2xl bg-surface-card border border-border-subtle">
                <div className="absolute -top-12 -left-12 w-44 h-44 bg-calm-indigo/15 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute -bottom-10 -right-10 w-44 h-44 bg-calm-violet/15 rounded-full blur-3xl pointer-events-none" />
                <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-b from-surface-raised to-surface-card border border-indigo-500/25 flex items-center justify-center shadow-lg shadow-indigo-950/40">
                  <ShieldCheck className="text-calm-indigo-light" size={38} />
                </div>
                <div className="mt-4 px-3.5 py-1 rounded-full bg-surface-raised/80 border border-border-subtle flex items-center gap-2">
                  <ShieldCheck className="text-calm-indigo-light" size={15} />
                  <span className="font-mono text-[11px] text-text-secondary tracking-wide">Zero Cloud Relays · AES-256 Vault</span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <h1 className="font-headline text-[26px] font-bold tracking-tight text-text-primary leading-tight">Peace of Mind for Your Money.</h1>
                <p className="font-sans text-[14px] leading-relaxed text-text-secondary">
                  Track every rupee naturally without anxiety, third-party trackers, or cloud leaks. Everything stays locked inside your device.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                {[
                  { icon: ShieldCheck, title: '100% On-Device & Private', desc: 'Your numbers never touch remote servers. Pure offline security guaranteed at the OS layer.' },
                  { icon: BellRing, title: 'Hardware-Grade Enclave', desc: 'Encryption keys live securely inside your device\'s biometric vault for stress-free storage.' },
                  { icon: CheckCircle2, title: 'Zero Telemetry & Ad-Free', desc: 'No trackers, no financial nudges, and no cross-site profiling. Just serene clarity.' },
                ].map((item) => (
                  <div key={item.title} className="p-4 rounded-xl bg-surface-card border border-border-subtle flex items-start gap-3.5 transition-all hover:border-indigo-500/30">
                    <div className="w-10 h-10 rounded-xl bg-surface-raised text-calm-indigo-light flex items-center justify-center shrink-0 border border-border-subtle">
                      <item.icon size={20} />
                    </div>
                    <div className="flex flex-col">
                      <h2 className="font-headline text-[15px] font-semibold text-text-primary">{item.title}</h2>
                      <p className="font-sans text-[13px] text-text-muted mt-0.5 leading-normal">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

            </section>
          )}

          {step === 'access' && (
            <section className="flex flex-col gap-5" id="step-2">
              <div className="flex flex-col gap-1.5">
                <h2 className="font-headline text-[24px] font-bold tracking-tight text-text-primary">Access</h2>
                <p className="font-sans text-[14px] text-text-secondary">Grant the permissions Finxeity needs to read notifications and stay reliable.</p>
              </div>

              <Card className="shrink-0">
                <CardHeader>
                  <CardTitle className="text-base">Notification access</CardTitle>
                  <CardDescription>Allow Finxeity to read the apps you choose.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {granted ? (
                    <Alert>
                      <CheckCircle2 className="size-4" />
                      <AlertTitle>Access granted</AlertTitle>
                      <AlertDescription>Listening for notifications now.</AlertDescription>
                    </Alert>
                  ) : (
                    <Alert variant="destructive">
                      <AlertTitle>Access not granted yet</AlertTitle>
                      <AlertDescription>Open notification access, find Finxeity, and turn it on.</AlertDescription>
                    </Alert>
                  )}
                  <Button className="h-11 w-full" onClick={() => LocalExpense.openNotificationSettings()}>
                    Open notification access
                  </Button>
                  <Button variant="outline" className="h-11 w-full" onClick={() => void listenerQuery.refetch()} disabled={listenerQuery.isFetching}>
                    <RefreshCw className="size-4" />
                    Check again
                  </Button>
                </CardContent>
              </Card>

              <Collapsible>
                <Card>
                  <CollapsibleTrigger className="w-full text-left">
                    <CardHeader>
                      <CardTitle className="text-base">Toggle greyed out? (Android 13+)</CardTitle>
                      <CardDescription>Sideloaded apps need restricted settings unlocked first.</CardDescription>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="space-y-2 text-sm text-muted-foreground">
                      <ol className="list-decimal space-y-1 pl-5">
                        <li>Open App info for Finxeity.</li>
                        <li>Tap the ⋮ menu in the top-right corner.</li>
                        <li>Choose “Allow restricted settings”.</li>
                        <li>Return here and enable notification access.</li>
                      </ol>
                      <Button variant="link" className="h-auto px-0" onClick={() => LocalExpense.openAppDetailsSettings()}>
                        Open App info
                      </Button>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>

              <Card className="shrink-0">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <BatteryCharging className="size-4" />
                    Keep tracking reliable
                  </CardTitle>
                  <CardDescription>Exempt Finxeity from battery optimization.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {ignoring ? (
                    <Alert>
                      <CheckCircle2 className="size-4" />
                      <AlertTitle>Battery optimization is off</AlertTitle>
                      <AlertDescription>Finxeity can keep listening.</AlertDescription>
                    </Alert>
                  ) : (
                    <Button className="h-11 w-full" onClick={() => LocalExpense.requestIgnoreBatteryOptimizations()}>
                      Exempt from battery optimization
                    </Button>
                  )}
                </CardContent>
              </Card>

            </section>
          )}

          {step === 'accounts' && (
            <section className="flex flex-col gap-5" id="step-2">
              <div className="flex flex-col gap-1.5">
                <h2 className="font-headline text-[24px] font-bold tracking-tight text-text-primary">Add Your Balances</h2>
                <p className="font-sans text-[14px] text-text-secondary">Establish an initial balance snapshot to see your calm net position effortlessly.</p>
              </div>

              <div className="p-4 rounded-2xl bg-surface-card border border-border-subtle flex flex-col gap-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <BellRing className="text-calm-indigo-light" size={22} />
                    <span className="font-headline text-[15px] font-semibold text-text-primary">Smart SMS Detection</span>
                  </div>
                  <span className="font-mono text-[10px] px-2.5 py-0.5 rounded-full bg-surface-raised text-calm-indigo-light border border-border-subtle">OFFLINE ONLY</span>
                </div>
                <p className="font-sans text-[13px] text-text-muted">Instantly read local bank transaction alerts to pre-fill balances without aggregators.</p>
                <button
                  className="w-full py-2.5 px-3 rounded-xl bg-surface-raised hover:bg-surface-high text-calm-indigo-light font-sans text-[13px] font-medium flex items-center justify-center gap-2 border border-border-subtle transition-colors"
                  id="btn-detect-sms"
                  onClick={() => detect.mutate()}
                  type="button"
                >
                  <Wallet size={18} id="sms-scan-icon" className={detect.isPending ? 'animate-spin' : ''} />
                  <span id="sms-scan-label">{detect.isPending ? 'Scanning on-device alerts...' : 'Auto-Detect from Bank Alerts'}</span>
                </button>
                {detectedProposals.length > 0 && (
                  <p className="text-[11px] text-text-muted">
                    Detected {detectedProposals.length} account(s). Review and edit them below.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-mono text-text-muted uppercase tracking-wider">Quick Presets</label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { name: 'HDFC Bank', type: 'Savings', amount: '84200', color: 'bg-calm-indigo-light' },
                    { name: 'ICICI Bank', type: 'Savings', amount: '46150', color: 'bg-calm-violet' },
                    { name: 'SBI Account', type: 'Savings', amount: '22400', color: 'bg-tertiary' },
                    { name: 'Cash In Hand', type: 'Cash', amount: '6000', color: 'bg-calm-emerald' },
                  ].map((preset) => (
                    <button
                      key={preset.name}
                      className="px-3 py-1.5 rounded-xl bg-surface-card border border-border-subtle hover:border-indigo-500/40 text-text-secondary hover:text-text-primary text-[12px] flex items-center gap-1.5 transition-colors"
                      onClick={() => {
                        setDrafts((current) => {
                          const exists = current.some((d) => d.name === preset.name)
                          if (exists) return current
                          return [
                            ...current,
                            {
                              key: `preset-${preset.name}`,
                              name: preset.name,
                              lastDigits: '',
                              balanceInput: preset.amount,
                              type: (preset.type === 'Credit Card'
                                ? 'CARD'
                                : preset.type === 'Cash'
                                  ? 'CASH'
                                  : preset.type === 'Brokerage'
                                    ? 'OTHER'
                                    : 'BANK') as AccountType,
                            },
                          ]
                        })
                      }}
                      type="button"
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${preset.color}`} />
                      {preset.name.split(' ')[0]}
                    </button>
                  ))}
                </div>
              </div>

              <Button
                variant="outline"
                className="h-11 w-full"
                onClick={() =>
                  setDrafts((current) => [
                    ...current,
                    { key: `manual-${Date.now()}`, name: '', lastDigits: '', balanceInput: '', type: 'BANK' },
                  ])
                }
              >
                <Plus className="size-4" />
                Add account manually
              </Button>


              {drafts.length > 0 && (
                <div className="space-y-3">
                  {drafts.map((draft) => (
                    <Card key={draft.key}>
                      <CardContent className="space-y-3 pt-4">
                        <div className="flex items-center justify-between">
                          <div className="flex flex-wrap gap-1.5">
                            {(['BANK', 'CARD', 'WALLET', 'CASH', 'OTHER'] as AccountType[]).map((kind) => (
                              <button
                                key={kind}
                                type="button"
                                className={`rounded-full border px-2 py-0.5 text-[10px] ${draft.type === kind ? 'border-calm-indigo bg-calm-indigo/15 text-calm-indigo-light' : 'border-border-subtle text-text-muted'}`}
                                onClick={() => updateDraft(draft.key, { type: kind })}
                              >
                                {kind}
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            className="text-[10px] text-text-muted hover:text-gentle-rose"
                            onClick={() => setDrafts((current) => current.filter((d) => d.key !== draft.key))}
                          >
                            Remove
                          </button>
                        </div>
                        {draft.sourceTexts && draft.sourceTexts.length > 0 && (
                          <div className="flex justify-end">
                            <button
                              type="button"
                              className="rounded-full border border-border-subtle px-2 py-0.5 text-[10px] text-text-muted hover:text-text-primary"
                              onClick={() => setInfoDraftKey(infoDraftKey === draft.key ? null : draft.key)}
                            >
                              info
                            </button>
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <Label>Account name</Label>
                          <Input
                            className="h-11"
                            value={draft.name}
                            placeholder="HDFC Savings"
                            onChange={(event) => updateDraft(draft.key, { name: event.target.value })}
                          />
                        </div>
                        <div className="flex gap-3">
                          <div className="flex-1 space-y-1.5">
                            <Label>Last 4 digits</Label>
                            <Input
                              className="h-11"
                              inputMode="numeric"
                              maxLength={4}
                              value={draft.lastDigits}
                              placeholder="4821"
                              onChange={(event) =>
                                updateDraft(draft.key, {
                                  lastDigits: event.target.value.replace(/\D/g, '').slice(0, 4),
                                })
                              }
                            />
                          </div>
                          <div className="flex-[2] space-y-1.5">
                            <Label>Current balance (₹)</Label>
                            <Input
                              className="h-11"
                              inputMode="decimal"
                              value={draft.balanceInput}
                              placeholder="0.00"
                              onChange={(event) =>
                                updateDraft(draft.key, { balanceInput: event.target.value })
                              }
                            />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  <Separator />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-muted">Total</span>
                    <span className="font-semibold">{formatMinor(totalBalance)}</span>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-3">
                <h3 className="font-headline text-[14px] font-semibold text-text-primary">Monitored apps</h3>
                <AppPicker selected={selectedApps} onChange={setSelectedApps} preselectDefaultSms />
                <p className="text-xs text-text-muted">
                  {selectedApps.length === 0 ? 'Select at least one app.' : `${selectedApps.length} app(s) selected.`}
                </p>
              </div>

            </section>
          )}

          {step === 'categories' && (
            <section className="flex flex-col gap-5" id="step-3">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <h2 className="font-headline text-[24px] font-bold tracking-tight text-text-primary">Spend Buckets</h2>
                  <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/20 text-calm-indigo-light text-[11px] font-mono" id="category-counter-badge">
                    {selectedCategories.size} Selected
                  </span>
                </div>
                <p className="font-sans text-[14px] text-text-secondary">Select your core spend areas to set your calm, guilt-free daily allowance.</p>
              </div>

              <div className="grid grid-cols-2 gap-2.5" id="category-chips-grid">
                {(categoriesQuery.data?.categories ?? []).filter((category) => category.kind === 'EXPENSE').map((category) => {
                  const active = selectedCategories.has(category.id)
                  return (
                    <button
                      key={category.id}
                      className={`cat-chip p-3 rounded-xl text-left flex items-start gap-2.5 transition-all ${
                        active
                          ? 'is-selected bg-surface-card border border-indigo-500/30 shadow-sm'
                          : 'bg-surface-canvas border border-border-subtle opacity-60'
                      }`}
                      onClick={() => {
                        setSelectedCategories((current) => {
                          const nextSet = new Set(current)
                          if (nextSet.has(category.id)) nextSet.delete(category.id)
                          else nextSet.add(category.id)
                          return nextSet
                        })
                      }}
                      type="button"
                    >
                      <span className="text-lg">{category.icon ?? '•'}</span>
                      <div className="flex flex-col min-w-0">
                        <span className="text-[13px] font-semibold text-text-primary truncate">{category.name}</span>
                        <span className={`text-[11px] font-mono status-text ${active ? 'text-calm-indigo-light' : 'text-text-muted'}`}>
                          {active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>

            </section>
          )}

          {step === 'recurring' && (
            <section className="flex flex-col gap-5" id="step-4">
              <div className="flex flex-col gap-1.5">
                <h2 className="font-headline text-[24px] font-bold tracking-tight text-text-primary">Recurring Outflows</h2>
                <p className="font-sans text-[14px] text-text-secondary">Keep subscriptions and EMIs separated from daily pocket money.</p>
              </div>

              <div className="flex flex-col gap-2.5" id="recurring-list-items">
                {(recurringQuery.data?.recurring ?? []).map((payment: RecurringSummary) => (
                  <div key={payment.merchantId ?? payment.name} className="p-3.5 rounded-xl bg-surface-card border border-border-subtle flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-surface-raised flex items-center justify-center font-mono text-[12px] font-semibold text-rose-400">
                        {payment.name.charAt(0)}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[14px] font-semibold text-text-primary">{payment.name}</span>
                        <span className="text-[12px] text-text-muted">Detected recurring</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="font-mono text-[13px] font-semibold text-text-primary">
                        {formatMinor(payment.amountMinor)}
                        <span className="text-text-muted font-normal text-[11px]">/{payment.cadence === 'MONTHLY' ? 'mo' : payment.cadence.toLowerCase()}</span>
                      </span>
                      <button
                        className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                          payment.confirmed
                            ? 'bg-calm-indigo/15 border-calm-indigo/30 text-calm-indigo-light'
                            : 'bg-surface-raised border-border-subtle text-text-muted'
                        }`}
                        onClick={() =>
                          setStatus.mutate({
                            merchantId: payment.merchantId ?? payment.name,
                            status: payment.confirmed ? 'SUGGESTED' : 'CONFIRMED',
                          })
                        }
                        type="button"
                      >
                        {payment.confirmed ? 'Confirmed' : 'Mark real'}
                      </button>
                    </div>
                  </div>
                ))}
                {(recurringQuery.data?.recurring ?? []).length === 0 && (
                  <p className="py-6 text-center text-sm text-text-muted">Nothing recurring yet.</p>
                )}
              </div>

              {(recurringQuery.data?.recurring ?? []).length > 0 && (
                <div className="p-3 rounded-xl bg-surface-canvas border border-border-subtle flex items-center justify-between">
                  <span className="text-[12px] font-mono text-text-muted">Monthly Recurring</span>
                  <span className="font-mono text-[14px] text-calm-indigo-light font-bold">
                    {formatMinor(
                      Math.round(
                        (recurringQuery.data?.recurring ?? []).reduce((sum, payment) => {
                          const months = payment.cadence === 'QUARTERLY' ? 3 : 1
                          return sum + payment.amountMinor / months
                        }, 0),
                      ),
                    )}
                    /mo
                  </span>
                </div>
              )}

            </section>
          )}

          {step === 'fixed' && (
            <section className="flex flex-col gap-5" id="step-5">
              <div className="flex flex-col gap-1.5">
                <h2 className="font-headline text-[24px] font-bold tracking-tight text-text-primary">Fixed Living Costs</h2>
                <p className="font-sans text-[14px] text-text-secondary">Mandatory monthly overhead before your discretionary budget is formed.</p>
              </div>

              <div className="flex flex-col gap-2.5">
                {commitments.map((commitment: Commitment) => (
                  <div key={commitment.id} className="p-3.5 rounded-xl bg-surface-card border border-border-subtle flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-surface-raised border border-border-subtle flex items-center justify-center text-calm-indigo-light">
                        <Wallet size={19} />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[14px] font-semibold text-text-primary">{commitment.name}</span>
                        <span className="text-[12px] text-text-muted">Due {new Date(commitment.dueAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[13px] font-semibold text-text-primary">{formatMinor(commitment.amountMinor)}</span>
                      <button
                        className="text-xs text-text-muted hover:text-text-primary"
                        onClick={() => removeCommitment.mutate(commitment.id)}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                {commitments.length === 0 && (
                  <p className="py-6 text-center text-sm text-text-muted">No fixed costs yet.</p>
                )}
              </div>

              <div className="p-4 rounded-2xl bg-surface-card border border-border-subtle flex flex-col gap-3">
                <span className="font-headline text-[14px] font-semibold text-text-primary">Add Fixed Cost</span>
                <div className="space-y-1">
                  <label className="text-[11px] font-mono text-text-muted">NAME</label>
                  <input
                    className="w-full px-3 py-2 rounded-xl bg-surface-canvas border border-border-subtle text-text-primary text-[13px] placeholder:text-text-muted focus:outline-none focus:border-calm-indigo transition-colors"
                    placeholder="Apartment Rent"
                    value={commitmentName}
                    onChange={(event) => setCommitmentName(event.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-text-muted">AMOUNT (₹)</label>
                    <input
                      className="w-full px-3 py-2 rounded-xl bg-surface-canvas border border-border-subtle text-text-primary text-[13px] font-mono focus:outline-none focus:border-calm-indigo transition-colors"
                      placeholder="28000"
                      value={commitmentAmount}
                      onChange={(event) => setCommitmentAmount(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-text-muted">DUE DATE</label>
                    <input
                      className="w-full px-3 py-2 rounded-xl bg-surface-canvas border border-border-subtle text-text-primary text-[13px] focus:outline-none focus:border-calm-indigo transition-colors"
                      type="date"
                      value={commitmentDue}
                      onChange={(event) => setCommitmentDue(event.target.value)}
                    />
                  </div>
                </div>
                <Button
                  className="h-11"
                  disabled={addCommitment.isPending || !commitmentName || !commitmentAmount}
                  onClick={() => addCommitment.mutate()}
                >
                  {addCommitment.isPending ? 'Adding…' : 'Add fixed cost'}
                </Button>
              </div>

              <div className="p-4 rounded-xl bg-surface-card border border-border-subtle flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-[10px] font-mono text-text-muted uppercase">Fixed Commitments</span>
                  <span className="text-[13px] font-semibold text-text-primary">Total Overhead</span>
                </div>
                <span className="font-mono text-[18px] font-bold text-calm-indigo-light">
                  {formatMinor(fixedTotal)}
                  <span className="text-[12px] font-normal text-text-muted">/mo</span>
                </span>
              </div>

            </section>
          )}

          {step === 'goals' && (
            <section className="flex flex-col gap-5" id="step-6">
              <div className="flex flex-col gap-1.5">
                <h2 className="font-headline text-[24px] font-bold tracking-tight text-text-primary">Reserves &amp; Targets</h2>
                <p className="font-sans text-[14px] text-text-secondary">Protected reserves to keep you shielded from unexpected life changes.</p>
              </div>

              <div className="space-y-3">
                {goals.map((goal: Goal) => {
                  const pct = goal.targetMinor > 0 ? Math.min(100, (goal.savedMinor / goal.targetMinor) * 100) : 0
                  return (
                    <div key={goal.id} className="p-4 rounded-2xl bg-surface-card border border-border-subtle flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="text-xl">🛡️</span>
                          <div className="flex flex-col">
                            <span className="text-[14px] font-semibold text-text-primary">{goal.name}</span>
                            <span className="text-[12px] text-text-muted">Goal: {formatMinor(goal.targetMinor)}</span>
                          </div>
                        </div>
                        <span className="font-mono text-[13px] text-calm-indigo-light font-bold">{pct.toFixed(1)}%</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-surface-raised overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-calm-indigo to-calm-indigo-light rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-mono text-text-muted">
                        <span>Seeded: {formatMinor(goal.savedMinor)}</span>
                        <button className="text-text-muted hover:text-text-primary" onClick={() => removeGoal.mutate(goal.id)} type="button">
                          Remove
                        </button>
                      </div>
                    </div>
                  )
                })}
                {goals.length === 0 && (
                  <p className="py-6 text-center text-sm text-text-muted">No goals yet.</p>
                )}
              </div>

              <div className="p-4 rounded-2xl bg-surface-card border border-border-subtle flex flex-col gap-3">
                <span className="font-headline text-[14px] font-semibold text-text-primary">Add a Goal</span>
                <div className="space-y-1">
                  <label className="text-[11px] font-mono text-text-muted">NAME</label>
                  <input
                    className="w-full px-3 py-2 rounded-xl bg-surface-canvas border border-border-subtle text-text-primary text-[13px] placeholder:text-text-muted focus:outline-none focus:border-calm-indigo transition-colors"
                    placeholder="Emergency Cushion"
                    value={goalName}
                    onChange={(event) => setGoalName(event.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-text-muted">TARGET (₹)</label>
                    <input
                      className="w-full px-3 py-2 rounded-xl bg-surface-canvas border border-border-subtle text-text-primary text-[13px] font-mono focus:outline-none focus:border-calm-indigo transition-colors"
                      placeholder="150000"
                      value={goalTarget}
                      onChange={(event) => setGoalTarget(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-text-muted">SAVED (₹)</label>
                    <input
                      className="w-full px-3 py-2 rounded-xl bg-surface-canvas border border-border-subtle text-text-primary text-[13px] font-mono focus:outline-none focus:border-calm-indigo transition-colors"
                      placeholder="40000"
                      value={goalSaved}
                      onChange={(event) => setGoalSaved(event.target.value)}
                    />
                  </div>
                </div>
                <Button
                  className="h-11"
                  disabled={addGoal.isPending || !goalName || !goalTarget}
                  onClick={() => addGoal.mutate()}
                >
                  {addGoal.isPending ? 'Adding…' : 'Add goal'}
                </Button>
              </div>

              <div className="p-4 rounded-2xl bg-surface-card border border-border-subtle flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono uppercase text-text-muted">Automatic Savings Rate</span>
                  <span className="text-[13px] text-calm-indigo-light font-mono font-bold" id="savings-rate-label">
                    {savingsRate}% (₹{Math.round((savingsRate / 100) * 85000).toLocaleString('en-IN')}/mo)
                  </span>
                </div>
                <input
                  className="w-full accent-calm-indigo cursor-pointer h-1.5 bg-surface-raised rounded-lg appearance-none"
                  max={50}
                  min={5}
                  onChange={(event) => setSavingsRate(Number(event.target.value))}
                  step={5}
                  type="range"
                  value={savingsRate}
                />
                <span className="text-[12px] text-text-muted">Safely stored in your goals before computing your everyday spend balance.</span>
              </div>

              <div className="p-4 rounded-2xl bg-surface-card border border-border-subtle flex flex-col gap-3">
                <span className="font-headline text-[14px] font-semibold text-text-primary">Financial settings</span>
                <div className="space-y-1">
                  <label className="text-[11px] font-mono text-text-muted">Emergency buffer (₹)</label>
                  <input
                    className="w-full px-3 py-2 rounded-xl bg-surface-canvas border border-border-subtle text-text-primary text-[13px] font-mono focus:outline-none focus:border-calm-indigo transition-colors"
                    value={bufferInput}
                    onChange={(event) => setBufferInput(event.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-text-muted">Income day</label>
                    <input
                      className="w-full px-3 py-2 rounded-xl bg-surface-canvas border border-border-subtle text-text-primary text-[13px] font-mono focus:outline-none focus:border-calm-indigo transition-colors"
                      type="number"
                      value={incomeDay}
                      onChange={(event) => setIncomeDay(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-text-muted">Expected income (₹)</label>
                    <input
                      className="w-full px-3 py-2 rounded-xl bg-surface-canvas border border-border-subtle text-text-primary text-[13px] font-mono focus:outline-none focus:border-calm-indigo transition-colors"
                      value={expectedIncome}
                      onChange={(event) => setExpectedIncome(event.target.value)}
                    />
                  </div>
                </div>
              </div>

            </section>
          )}

          {step === 'ready' && (
            <section className="flex flex-col gap-5" id="step-7">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-calm-indigo-light animate-ping" />
                  <h2 className="font-headline text-[24px] font-bold tracking-tight text-text-primary">Everything Is Ready</h2>
                </div>
                <p className="font-sans text-[14px] text-text-secondary">Your local configuration is set up. Welcome to anxiety-free financial clarity.</p>
              </div>

              <div className="p-4 rounded-2xl bg-surface-card border border-border-subtle flex flex-col gap-4 shadow-sm">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-mono uppercase text-text-muted">Starting Balance</span>
                  <div className="flex items-baseline justify-between">
                    <span className="font-headline text-[28px] font-bold text-text-primary font-mono tracking-tight">
                      {formatMinor(totalBalance)}
                      <span className="text-[15px] text-text-muted font-normal">.00</span>
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-surface-raised text-calm-indigo-light text-[11px] font-mono border border-border-subtle">
                      {drafts.length || accountsQuery.data?.accounts.length || 0} Accounts
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <div className="p-3 rounded-xl bg-surface-canvas border border-border-subtle flex flex-col gap-1">
                    <span className="text-[10px] font-mono text-text-muted">MONTHLY FIXED</span>
                    <span className="text-[14px] font-mono font-bold text-text-primary">{formatMinor(fixedTotal)}</span>
                    <span className="text-[11px] text-text-muted">Rent &amp; Subscriptions</span>
                  </div>
                  <div className="p-3 rounded-xl bg-surface-canvas border border-border-subtle flex flex-col gap-1">
                    <span className="text-[10px] font-mono text-text-muted">CALM DAILY LIMIT</span>
                    <span className="text-[14px] font-mono font-bold text-calm-emerald">₹2,150 / day</span>
                    <span className="text-[11px] text-text-muted">Safe discretionary</span>
                  </div>
                  <div className="p-3 rounded-xl bg-surface-canvas border border-border-subtle flex flex-col gap-1">
                    <span className="text-[10px] font-mono text-text-muted">CATEGORIES</span>
                    <span className="text-[14px] font-mono font-bold text-text-primary">{selectedCategories.size} Active</span>
                    <span className="text-[11px] text-text-muted">Focused buckets</span>
                  </div>
                  <div className="p-3 rounded-xl bg-surface-canvas border border-border-subtle flex flex-col gap-1">
                    <span className="text-[10px] font-mono text-text-muted">RESERVES</span>
                    <span className="text-[14px] font-mono font-bold text-calm-violet">{goals.length} goals</span>
                    <span className="text-[11px] text-text-muted">Protected targets</span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-surface-raised/70 border border-border-subtle flex items-center gap-2.5">
                  <ShieldCheck className="text-calm-indigo-light" size={20} />
                  <div className="flex flex-col">
                    <span className="text-[12px] font-semibold text-text-primary">Air-Gapped Guarantee</span>
                    <span className="text-[11px] text-text-muted">Data stays encrypted purely on your phone.</span>
                  </div>
                </div>
              </div>

              {!ignoring && (
                <Button
                  className="h-11 w-full"
                  variant="outline"
                  onClick={() => LocalExpense.requestIgnoreBatteryOptimizations()}
                >
                  Exempt from battery optimization
                </Button>
              )}

            </section>
          )}
        </div>
      </div>

      <footer className="shrink-0 border-t border-border-subtle bg-surface-canvas/95 backdrop-blur-xl px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-md">
          {step === 'privacy' && (
            <button
              className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-calm-indigo to-indigo-600 hover:from-indigo-500 hover:to-indigo-600 text-white font-headline text-[15px] font-semibold flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/25 active:scale-[0.98] transition-all"
              onClick={() => goToStep(2)}
              type="button"
            >
              <span>Begin Setup</span>
              <ArrowRight size={19} />
            </button>
          )}

          {step === 'access' && (
            <div className="grid grid-cols-2 gap-3">
              <button
                className="py-3 px-4 rounded-xl bg-surface-card border border-border-subtle hover:bg-surface-raised text-text-secondary hover:text-text-primary font-headline text-[14px] font-semibold transition-colors"
                onClick={back}
                type="button"
              >
                Back
              </button>
              <button
                className="py-3 px-4 rounded-xl bg-calm-indigo hover:bg-indigo-600 text-white font-headline text-[14px] font-semibold shadow-md shadow-indigo-600/20 transition-all"
                onClick={next}
                type="button"
              >
                Continue →
              </button>
            </div>
          )}

          {step === 'accounts' && (
            <div className="grid grid-cols-2 gap-3">
              <button
                className="py-3 px-4 rounded-xl bg-surface-card border border-border-subtle hover:bg-surface-raised text-text-secondary hover:text-text-primary font-headline text-[14px] font-semibold transition-colors"
                onClick={back}
                type="button"
              >
                Back
              </button>
              <button
                className="py-3 px-4 rounded-xl bg-calm-indigo hover:bg-indigo-600 text-white font-headline text-[14px] font-semibold shadow-md shadow-indigo-600/20 transition-all"
                onClick={async () => {
                  try {
                    if (selectedApps.length > 0) await saveApps.mutateAsync(selectedApps)
                    await saveBalances.mutateAsync()
                  } catch {
                    toast.error('Could not save balances')
                  }
                  next()
                }}
                type="button"
              >
                Continue →
              </button>
            </div>
          )}

          {step === 'categories' && (
            <div className="grid grid-cols-2 gap-3">
              <button
                className="py-3 px-4 rounded-xl bg-surface-card border border-border-subtle hover:bg-surface-raised text-text-secondary hover:text-text-primary font-headline text-[14px] font-semibold transition-colors"
                onClick={back}
                type="button"
              >
                Back
              </button>
              <button
                className="py-3 px-4 rounded-xl bg-calm-indigo hover:bg-indigo-600 text-white font-headline text-[14px] font-semibold shadow-md shadow-indigo-600/20 transition-all"
                onClick={async () => {
                  await saveCategories.mutateAsync()
                  next()
                }}
                type="button"
              >
                Continue →
              </button>
            </div>
          )}

          {step === 'recurring' && (
            <div className="grid grid-cols-2 gap-3">
              <button
                className="py-3 px-4 rounded-xl bg-surface-card border border-border-subtle hover:bg-surface-raised text-text-secondary hover:text-text-primary font-headline text-[14px] font-semibold transition-colors"
                onClick={back}
                type="button"
              >
                Back
              </button>
              <button
                className="py-3 px-4 rounded-xl bg-calm-indigo hover:bg-indigo-600 text-white font-headline text-[14px] font-semibold shadow-md shadow-indigo-600/20 transition-all"
                onClick={next}
                type="button"
              >
                Continue →
              </button>
            </div>
          )}

          {step === 'fixed' && (
            <div className="grid grid-cols-2 gap-3">
              <button
                className="py-3 px-4 rounded-xl bg-surface-card border border-border-subtle hover:bg-surface-raised text-text-secondary hover:text-text-primary font-headline text-[14px] font-semibold transition-colors"
                onClick={back}
                type="button"
              >
                Back
              </button>
              <button
                className="py-3 px-4 rounded-xl bg-calm-indigo hover:bg-indigo-600 text-white font-headline text-[14px] font-semibold shadow-md shadow-indigo-600/20 transition-all"
                onClick={next}
                type="button"
              >
                Continue →
              </button>
            </div>
          )}

          {step === 'goals' && (
            <div className="grid grid-cols-2 gap-3">
              <button
                className="py-3 px-4 rounded-xl bg-surface-card border border-border-subtle hover:bg-surface-raised text-text-secondary hover:text-text-primary font-headline text-[14px] font-semibold transition-colors"
                onClick={back}
                type="button"
              >
                Back
              </button>
              <button
                className="py-3 px-4 rounded-xl bg-calm-indigo hover:bg-indigo-600 text-white font-headline text-[14px] font-semibold shadow-md shadow-indigo-600/20 transition-all"
                onClick={async () => {
                  await saveFinancial.mutateAsync()
                  next()
                }}
                type="button"
              >
                Review →
              </button>
            </div>
          )}

          {step === 'ready' && (
            <div className="flex flex-col gap-2.5">
              <button
                className="w-full py-4 px-4 rounded-xl bg-gradient-to-r from-calm-indigo to-indigo-600 hover:from-indigo-500 hover:to-indigo-600 text-white font-headline text-[15px] font-bold flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 active:scale-[0.98] transition-all"
                id="btn-final-launch"
                onClick={finish}
                type="button"
              >
                <CheckCircle2 size={20} />
                <span id="launch-button-label">Get Started with Finxeity</span>
              </button>
              <button
                className="w-full py-2 px-4 rounded-xl bg-transparent text-text-muted hover:text-text-primary text-[13px] transition-colors text-center"
                onClick={() => goToStep(1)}
                type="button"
              >
                Review Preferences
              </button>
            </div>
          )}
        </div>
      </footer>

    </div>
      <Dialog open={infoDraftKey !== null} onOpenChange={(open) => !open && setInfoDraftKey(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Candidate messages</DialogTitle>
            <DialogDescription>
              Messages that vouched for this account.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {(() => {
              const draft = drafts.find((d) => d.key === infoDraftKey)
              const messages = draft?.sourceTexts ?? []
              if (messages.length === 0) {
                return <p className="text-sm text-muted-foreground">No candidate messages.</p>
              }
              return messages.map((text, index) => (
                <div key={index} className={`flex ${index % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                  <div className="max-w-[85%] rounded-2xl border border-border-subtle bg-surface-raised px-3 py-2 text-xs text-text-primary">
                    {text}
                  </div>
                </div>
              ))
            })()}
          </div>
        </DialogContent>
      </Dialog>

    </div>
  )
}
