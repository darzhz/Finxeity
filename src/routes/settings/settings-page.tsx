import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BellRing,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  EyeOff,
  Gauge,
  Landmark,
  MessageSquarePlus,
  Plus,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Target,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { LocalExpense } from '@/lib/plugin'
import type { AccountBalance, AccountProposal, AccountType } from '@/lib/plugin'
import { formatMinor, parseMajorToMinor } from '@/lib/money'
import { queryKeys } from '@/lib/query'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'

/* ────────────────────────────── helpers ────────────────────────────── */

const currencySymbol = formatMinor(0).replace(/[\d.,\s-]/g, '') || '₹'

const ACCOUNT_KINDS: { value: AccountType; label: string; emoji: string; hint: string }[] = [
  { value: 'BANK', label: 'Bank', emoji: '🏦', hint: 'A bank account holds the money you spend.' },
  { value: 'CARD', label: 'Card', emoji: '💳', hint: 'A credit card is a bill to pay, not money you hold.' },
  { value: 'WALLET', label: 'Wallet', emoji: '👛', hint: 'Money in a wallet is tracked apart from a bank account.' },
  { value: 'CASH', label: 'Cash', emoji: '💵', hint: 'Cash you keep on hand.' },
  { value: 'OTHER', label: 'Other', emoji: '📂', hint: 'Anything else you want to keep an eye on.' },
]

const kindMeta = (t: AccountType) => ACCOUNT_KINDS.find((k) => k.value === t) ?? ACCOUNT_KINDS[0]

const toAccountType = (t: string): AccountType =>
  (['CARD', 'CASH', 'WALLET', 'OTHER'].includes(t) ? t : 'BANK') as AccountType

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
const cleanAmount = (v: string) => v.replace(/[^\d.]/g, '')

/* ───────────────────────── layout primitives ───────────────────────── */

function Group({
  title,
  footer,
  children,
}: {
  title: string
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-base font-semibold tracking-tight">{title}</h2>
      <div className="divide-y divide-border/60 overflow-hidden rounded-3xl border border-border bg-card">{children}</div>
      {footer && <p className="px-1 text-xs text-muted-foreground">{footer}</p>}
    </section>
  )
}

function IconTile({ children, tone = 'bg-indigo-500/15 text-indigo-300' }: { children: React.ReactNode; tone?: string }) {
  return <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-2xl text-lg', tone)}>{children}</span>
}

const rowBase = 'flex w-full items-center gap-3 px-4 py-3.5 text-left'

function RowContent({
  icon,
  title,
  subtitle,
  right,
}: {
  icon: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <>
      {icon}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {right}
    </>
  )
}

function NavRow({ to, ...content }: { to: string; icon: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <Link to={to} className={cn(rowBase, 'active:bg-muted/60')}>
      <RowContent {...content} right={content.right ?? <ChevronRight className="size-4 text-muted-foreground" />} />
    </Link>
  )
}

function ActionRow({
  onClick,
  disabled,
  ...content
}: {
  onClick: () => void
  disabled?: boolean
  icon: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cn(rowBase, 'active:bg-muted/60 disabled:opacity-60')}>
      <RowContent {...content} right={content.right ?? <ChevronRight className="size-4 text-muted-foreground" />} />
    </button>
  )
}

function MoneyField({
  label,
  value,
  onChange,
  placeholder = '0.00',
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">{currencySymbol}</span>
        <Input className="h-11 pl-8 tabular-nums" inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => onChange(cleanAmount(e.target.value))} />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/* ───────────────────────────── page ───────────────────────────── */

export function SettingsPage() {
  const client = useQueryClient()
  const listener = useQuery({
    queryKey: queryKeys.listener,
    queryFn: () => LocalExpense.getListenerStatus(),
    refetchInterval: 10_000,
  })
  const monitored = useQuery({ queryKey: queryKeys.monitoredApps, queryFn: () => LocalExpense.getMonitoredApps() })
  const balances = useQuery({ queryKey: queryKeys.balances, queryFn: () => LocalExpense.listAccountBalances() })
  const sms = useQuery({ queryKey: queryKeys.smsImport, queryFn: () => LocalExpense.getSmsImportState() })
  const rules = useQuery({ queryKey: queryKeys.rules, queryFn: () => LocalExpense.listRules() })

  const [accountDrawer, setAccountDrawer] = useState<{ account: AccountBalance | null } | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [devTaps, setDevTaps] = useState(0)
  const devUnlocked = import.meta.env.DEV || devTaps >= 5

  const importSms = useMutation({
    mutationFn: () => LocalExpense.importSms({ lookbackDays: 90 }),
    onSuccess: ({ imported }) => {
      toast.success(imported > 0 ? `Imported ${plural(imported, 'message')}` : 'No new messages found')
      void client.invalidateQueries({ queryKey: ['rawEvents'] })
      void client.invalidateQueries({ queryKey: queryKeys.smsImport })
    },
    onError: () => toast.error('Could not import SMS. Check that SMS access is allowed.'),
  })

  const reparse = useMutation({
    mutationFn: () => LocalExpense.reparseAll(),
    onSuccess: ({ processed }) => {
      toast.success(`Read ${plural(processed, 'message')} again`)
      void client.invalidateQueries({ queryKey: ['rawEvents'] })
      void client.invalidateQueries({ queryKey: ['transactions'] })
      void client.invalidateQueries({ queryKey: queryKeys.ingestionStats })
      void client.invalidateQueries({ queryKey: queryKeys.balances })
    },
    onError: () => toast.error('Could not read the messages again. Try again.'),
  })

  const accounts = balances.data?.balances ?? []
  const ruleList = rules.data?.rules ?? []
  const appCount = monitored.data?.packages.length ?? 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-lg">
        <header className="sticky top-0 z-20 bg-background/85 px-4 pb-3 pt-[calc(1rem+env(safe-area-inset-top))] backdrop-blur-xl">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        </header>

        <div className="space-y-7 px-4 pb-12 pt-2">
          <StatusHero
            loading={listener.isLoading}
            accessGranted={!!listener.data?.accessGranted}
            state={listener.data?.state ?? 'UNKNOWN'}
            appCount={appCount}
            accountCount={accounts.length}
            ruleCount={ruleList.length}
          />

          <Group title="Tracking">
            <ActionRow
              onClick={() => void LocalExpense.openNotificationSettings()}
              icon={<IconTile><BellRing className="size-5" /></IconTile>}
              title="Notification access"
              subtitle={listener.data?.accessGranted ? 'Allowed. Opens system settings.' : 'Off. Tap to turn it on.'}
            />
            <NavRow
              to="/settings/apps"
              icon={<IconTile tone="bg-sky-500/15 text-sky-300"><Smartphone className="size-5" /></IconTile>}
              title="Monitored apps"
              subtitle={`${plural(appCount, 'app')} watched for bank alerts`}
            />
            {sms.data?.supported && (
              <ActionRow
                onClick={() => importSms.mutate()}
                disabled={importSms.isPending}
                icon={<IconTile tone="bg-emerald-500/15 text-emerald-300"><MessageSquarePlus className="size-5" /></IconTile>}
                title={importSms.isPending ? 'Importing…' : 'Import SMS history'}
                subtitle="Recover the last 90 days from bank texts (sideload builds only)"
                right={importSms.isPending ? <RefreshCw className="size-4 animate-spin text-muted-foreground" /> : undefined}
              />
            )}
            <ActionRow
              onClick={() => reparse.mutate()}
              disabled={reparse.isPending}
              icon={<IconTile tone="bg-amber-500/15 text-amber-300"><RefreshCw className={cn('size-5', reparse.isPending && 'animate-spin')} /></IconTile>}
              title={reparse.isPending ? 'Reading…' : 'Read all messages again'}
              subtitle="Useful after the app learns a new bank format"
              right={<span />}
            />
          </Group>

          <Group title="Accounts" footer="Each balance is the number you set, plus everything spent or received since.">
            {balances.isLoading && (
              <div className="space-y-3 p-4">
                <Skeleton className="h-10 w-full rounded-2xl" />
                <Skeleton className="h-10 w-full rounded-2xl" />
              </div>
            )}
            {!balances.isLoading && accounts.length === 0 && (
              <p className="px-4 py-5 text-sm text-muted-foreground">No accounts yet. Add one, or let the app find them in your messages.</p>
            )}
            {accounts.map((a) => {
              const k = kindMeta(a.type)
              const drifted = a.derivedBalanceMinor !== a.anchorBalanceMinor
              return (
                <ActionRow
                  key={a.id}
                  onClick={() => setAccountDrawer({ account: a })}
                  icon={<IconTile tone="bg-muted">{k.emoji}</IconTile>}
                  title={`${a.name}${a.lastDigits ? `  ••${a.lastDigits}` : ''}`}
                  subtitle={drifted ? `Started at ${formatMinor(a.anchorBalanceMinor)}` : k.label}
                  right={<span className="text-sm font-semibold tabular-nums">{formatMinor(a.derivedBalanceMinor)}</span>}
                />
              )
            })}
            <ActionRow
              onClick={() => setAccountDrawer({ account: null })}
              icon={<IconTile tone="bg-indigo-500/15 text-indigo-300"><Plus className="size-5" /></IconTile>}
              title="Add an account"
              right={<span />}
            />
            <ActionRow
              onClick={() => setDetecting(true)}
              icon={<IconTile tone="bg-violet-500/15 text-violet-300"><Sparkles className="size-5" /></IconTile>}
              title="Find accounts in my messages"
              subtitle="Looks through stored bank alerts for accounts you use"
            />
          </Group>

          <Group title="Planning">
            <NavRow to="/bills" icon={<IconTile tone="bg-orange-500/15 text-orange-300"><Receipt className="size-5" /></IconTile>} title="Upcoming bills" />
            <NavRow to="/goals" icon={<IconTile tone="bg-emerald-500/15 text-emerald-300"><Target className="size-5" /></IconTile>} title="Savings goals" />
            <NavRow to="/budgets" icon={<IconTile tone="bg-pink-500/15 text-pink-300"><Gauge className="size-5" /></IconTile>} title="Spending limits" />
          </Group>

          <FinancialCard />

          <RulesGroup rules={ruleList} loading={rules.isLoading} />

          {devUnlocked && <DeveloperGroup />}

          <button
            type="button"
            onClick={() => {
              if (devUnlocked) return
              const next = devTaps + 1
              setDevTaps(next)
              if (next === 5) toast.success('Developer tools unlocked')
            }}
            className="mx-auto flex flex-col items-center gap-1.5 pt-2 text-center"
          >
            <ShieldCheck className="size-5 text-emerald-400" />
            <span className="text-sm font-medium">Private by design</span>
            <span className="max-w-xs text-xs text-muted-foreground">
              Release builds have no internet permission. Everything stays on this device.
            </span>
          </button>
        </div>
      </div>

      <AccountDrawer state={accountDrawer} onClose={() => setAccountDrawer(null)} />
      <DetectDrawer open={detecting} onClose={() => setDetecting(false)} />
    </div>
  )
}

/* ───────────────────────────── status hero ─────────────────────────────
   The showy part: one glance tells you whether tracking actually works.   */

function StatusHero({
  loading,
  accessGranted,
  state,
  appCount,
  accountCount,
  ruleCount,
}: {
  loading: boolean
  accessGranted: boolean
  state: string
  appCount: number
  accountCount: number
  ruleCount: number
}) {
  if (loading) return <Skeleton className="h-44 w-full rounded-3xl" />

  const live = accessGranted && state === 'CONNECTED'
  const status = live
    ? { title: 'Tracking is on', body: 'New bank alerts become transactions as they arrive.', dot: 'bg-emerald-400', ring: 'bg-emerald-400/30', border: 'border-emerald-500/30' }
    : accessGranted
      ? { title: 'Waiting to connect', body: 'Access is on, but the listener isn\u2019t running yet. This usually fixes itself in a moment.', dot: 'bg-amber-400', ring: 'bg-amber-400/30', border: 'border-amber-500/30' }
      : { title: 'Tracking is off', body: 'Without notification access, Finxeity can\u2019t see your bank alerts.', dot: 'bg-rose-400', ring: 'bg-rose-400/30', border: 'border-rose-500/40' }

  return (
    <section className={cn('rounded-3xl border bg-card p-5', status.border)}>
      <div className="flex items-start gap-4">
        <span className="relative mt-1.5 flex size-3 shrink-0">
          {live && <span className={cn('absolute inline-flex size-full animate-ping rounded-full motion-reduce:animate-none', status.ring)} />}
          <span className={cn('relative inline-flex size-3 rounded-full', status.dot)} />
        </span>
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight">{status.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{status.body}</p>
        </div>
      </div>

      {!accessGranted && (
        <Button className="mt-4 h-11 w-full" onClick={() => void LocalExpense.openNotificationSettings()}>
          Turn on notification access
        </Button>
      )}

      <div className="mt-5 grid grid-cols-3 divide-x divide-border border-t border-border pt-4 text-center">
        <Stat value={appCount} label={appCount === 1 ? 'app watched' : 'apps watched'} />
        <Stat value={accountCount} label={accountCount === 1 ? 'account' : 'accounts'} />
        <Stat value={ruleCount} label={ruleCount === 1 ? 'ignore rule' : 'ignore rules'} />
      </div>
    </section>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

/* ───────────────────────────── financial settings ───────────────────────────── */

function FinancialCard() {
  const client = useQueryClient()
  const financial = useQuery({ queryKey: ['financialSettings'], queryFn: () => LocalExpense.getFinancialSettings() })
  const [buffer, setBuffer] = useState('')
  const [incomeDay, setIncomeDay] = useState('')
  const [income, setIncome] = useState('')

  // Fill the form once the saved values arrive (the old uncontrolled inputs stayed blank if data loaded late).
  useEffect(() => {
    const d = financial.data
    if (!d) return
    setBuffer(d.bufferMinor ? (d.bufferMinor / 100).toString() : '')
    setIncomeDay(d.incomeDay ? String(d.incomeDay) : '')
    setIncome(d.expectedIncomeMinor ? (d.expectedIncomeMinor / 100).toString() : '')
  }, [financial.data])

  const save = useMutation({
    mutationFn: (payload: { bufferMinor?: number; incomeDay?: number; expectedIncomeMinor?: number; essentialCategories?: string[] }) =>
      LocalExpense.setFinancialSettings(payload),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['financialSettings'] })
      void client.invalidateQueries({ queryKey: queryKeys.dashboard })
      toast.success('Saved')
    },
    onError: () => toast.error('Could not save. Try again.'),
  })

  const d = financial.data
  const bufferMinor = parseMajorToMinor(buffer || '0') ?? 0
  const incomeMinor = parseMajorToMinor(income || '0') ?? 0
  const day = incomeDay === '' ? 0 : Number(incomeDay)
  const dayValid = Number.isInteger(day) && day >= 0 && day <= 31
  const dirty = !!d && (bufferMinor !== d.bufferMinor || incomeMinor !== d.expectedIncomeMinor || day !== (d.incomeDay ?? 0))

  return (
    <section className="space-y-2">
      <h2 className="px-1 text-base font-semibold tracking-tight">Money basics</h2>
      <div className="space-y-4 rounded-3xl border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          These shape your safe-to-spend number and your forecast on the dashboard.
        </p>
        {financial.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : (
          <>
            <MoneyField label="Emergency buffer" value={buffer} onChange={setBuffer} hint="Money you never want to count as spendable." />
            <MoneyField label="Expected monthly income" value={income} onChange={setIncome} />
            <div className="space-y-1.5">
              <Label>Income arrives on day</Label>
              <Input
                className="h-11 tabular-nums"
                inputMode="numeric"
                value={incomeDay}
                placeholder="1 to 31"
                onChange={(e) => setIncomeDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
                aria-invalid={!dayValid}
              />
              {!dayValid && <p className="text-xs text-rose-400">Enter a day between 1 and 31.</p>}
            </div>
            <Button
              className="h-11 w-full"
              disabled={!dirty || !dayValid || save.isPending}
              onClick={() => save.mutate({ bufferMinor, expectedIncomeMinor: incomeMinor, incomeDay: day })}
            >
              {save.isPending ? 'Saving…' : dirty ? 'Save changes' : 'Up to date'}
            </Button>
          </>
        )}
      </div>
    </section>
  )
}

/* ───────────────────────────── rules ───────────────────────────── */

function RulesGroup({ rules, loading }: { rules: { id: string; packageName?: string | null; senderPattern?: string | null; templatePattern?: string | null }[]; loading: boolean }) {
  const client = useQueryClient()
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const remove = useMutation({
    mutationFn: (id: string) => LocalExpense.deleteRule({ id }),
    onSuccess: () => {
      setConfirmId(null)
      void client.invalidateQueries({ queryKey: queryKeys.rules })
      toast.success('Rule removed. Matching messages will count again.')
    },
    onError: () => toast.error('Could not remove the rule. Try again.'),
  })

  return (
    <Group title="Ignored messages" footer="A rule stops a matching message from becoming a transaction.">
      {loading && <Skeleton className="m-4 h-10 rounded-2xl" />}
      {!loading && rules.length === 0 && (
        <div className="flex items-start gap-3 px-4 py-5">
          <IconTile tone="bg-muted text-muted-foreground"><EyeOff className="size-5" /></IconTile>
          <p className="text-sm text-muted-foreground">
            Nothing ignored yet. In your message history, choose "Ignore messages like this" on anything you never want to see again.
          </p>
        </div>
      )}
      {rules.map((rule) => {
        const confirming = confirmId === rule.id
        return (
          <div key={rule.id} className="flex items-center gap-3 px-4 py-3">
            <IconTile tone="bg-muted text-muted-foreground"><EyeOff className="size-5" /></IconTile>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{rule.packageName ?? rule.senderPattern ?? 'Any app'}</p>
              {rule.templatePattern && <p className="truncate text-xs text-muted-foreground">{rule.templatePattern}</p>}
            </div>
            {confirming ? (
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" className="h-9 text-rose-300 hover:bg-rose-500/15" disabled={remove.isPending} onClick={() => remove.mutate(rule.id)}>
                  Remove
                </Button>
                <Button size="icon" variant="ghost" className="size-9" aria-label="Keep rule" onClick={() => setConfirmId(null)}>
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <Button size="icon" variant="ghost" className="size-10" aria-label="Delete rule" onClick={() => setConfirmId(rule.id)}>
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        )
      })}
    </Group>
  )
}

/* ───────────────────────────── account drawer ───────────────────────────── */

function AccountDrawer({ state, onClose }: { state: { account: AccountBalance | null } | null; onClose: () => void }) {
  const client = useQueryClient()
  const account = state?.account ?? null
  const [name, setName] = useState('')
  const [lastDigits, setLastDigits] = useState('')
  const [balance, setBalance] = useState('')
  const [type, setType] = useState<AccountType>('BANK')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!state) return
    setConfirmDelete(false)
    if (account) {
      setName(account.name)
      setLastDigits(account.lastDigits ?? '')
      setBalance((account.anchorBalanceMinor / 100).toFixed(2))
      setType(account.type)
    } else {
      setName('')
      setLastDigits('')
      setBalance('')
      setType('BANK')
    }
  }, [state]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    void client.invalidateQueries({ queryKey: queryKeys.accounts })
    void client.invalidateQueries({ queryKey: queryKeys.balances })
  }

  const save = useMutation({
    mutationFn: () =>
      LocalExpense.setAccountBalance({
        id: account?.id,
        name: name.trim(),
        lastDigits: lastDigits.trim() || null,
        type,
        balanceMinor: parseMajorToMinor(balance) ?? 0,
      }),
    onSuccess: () => {
      refresh()
      toast.success(account ? 'Account updated' : 'Account added')
      onClose()
    },
    onError: () => toast.error('Could not save the account. Try again.'),
  })

  const remove = useMutation({
    mutationFn: () => LocalExpense.deleteAccount({ id: account!.id }),
    onSuccess: () => {
      refresh()
      toast.success('Account removed')
      onClose()
    },
    onError: () => toast.error('Could not remove the account. Try again.'),
  })

  return (
    <Drawer open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="pb-2">
          <DrawerTitle>{account ? 'Edit account' : 'Add an account'}</DrawerTitle>
          <DrawerDescription>
            {account ? 'Set the balance to re-anchor the tracked total.' : 'Enter what the account shows right now. Activity after that keeps it current.'}
          </DrawerDescription>
        </DrawerHeader>

        <div className="space-y-5 overflow-y-auto px-4 pb-2">
          <div className="flex items-baseline justify-center gap-1.5 py-1">
            <span className="text-3xl font-medium text-muted-foreground">{currencySymbol}</span>
            <input
              inputMode="decimal"
              value={balance}
              onChange={(e) => setBalance(cleanAmount(e.target.value))}
              placeholder="0"
              aria-label="Balance"
              className="w-52 bg-transparent text-center text-5xl font-semibold tabular-nums outline-none placeholder:text-muted-foreground/40"
            />
          </div>

          <div className="space-y-2">
            <Label>Kind</Label>
            <div className="flex flex-wrap gap-2">
              {ACCOUNT_KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setType(k.value)}
                  className={cn(
                    'inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-sm transition-all active:scale-95',
                    type === k.value ? 'border-indigo-400/70 bg-indigo-500/20 font-medium' : 'border-border bg-card text-muted-foreground',
                  )}
                >
                  <span>{k.emoji}</span>
                  {k.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{kindMeta(type).hint}</p>
          </div>

          <div className="grid grid-cols-[1fr_6.5rem] gap-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input className="h-11" value={name} placeholder="HDFC Savings" onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Last 4</Label>
              <Input
                className="h-11 tabular-nums"
                inputMode="numeric"
                maxLength={4}
                value={lastDigits}
                placeholder="4821"
                onChange={(e) => setLastDigits(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </div>
          </div>

          {account && (
            <Button
              variant="ghost"
              className={cn('w-full', confirmDelete ? 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/20' : 'text-muted-foreground')}
              disabled={remove.isPending}
              onClick={() => (confirmDelete ? remove.mutate() : setConfirmDelete(true))}
            >
              {confirmDelete ? 'Tap again to remove this account' : 'Remove account'}
            </Button>
          )}
        </div>

        <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button className="h-12 text-base" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : account ? 'Save changes' : 'Add account'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

/* ───────────────────────────── detect drawer ───────────────────────────── */

function DetectDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useQueryClient()
  const [proposals, setProposals] = useState<AccountProposal[]>([])
  const [selected, setSelected] = useState<Set<AccountProposal>>(new Set())
  const [expanded, setExpanded] = useState<AccountProposal | null>(null)

  const detect = useMutation({
    mutationFn: () => LocalExpense.detectAccounts(),
    onSuccess: ({ proposals }) => {
      setProposals(proposals)
      setSelected(new Set(proposals))
    },
    onError: () => toast.error('Could not scan your messages. Try again.'),
  })

  useEffect(() => {
    if (!open) return
    setProposals([])
    setSelected(new Set())
    setExpanded(null)
    detect.mutate()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const add = useMutation({
    mutationFn: async () => {
      for (const p of proposals) {
        if (!selected.has(p)) continue
        await LocalExpense.setAccountBalance({
          name: p.name,
          lastDigits: p.lastDigits,
          type: toAccountType(p.type ?? 'BANK'),
          balanceMinor: p.balanceMinor ?? 0,
        })
      }
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.accounts })
      void client.invalidateQueries({ queryKey: queryKeys.balances })
      toast.success(`Added ${plural(selected.size, 'account')}`)
      onClose()
    },
    onError: () => toast.error('Could not add the accounts. Try again.'),
  })

  const toggle = (p: AccountProposal) =>
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="pb-2">
          <DrawerTitle>Accounts in your messages</DrawerTitle>
          <DrawerDescription>Pick the ones you want to track. You can fix balances afterwards.</DrawerDescription>
        </DrawerHeader>

        <div className="space-y-2.5 overflow-y-auto px-4 pb-2">
          {detect.isPending && (
            <>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="size-4 animate-spin" /> Reading your stored messages…
              </p>
              <Skeleton className="h-16 w-full rounded-2xl" />
              <Skeleton className="h-16 w-full rounded-2xl" />
            </>
          )}

          {!detect.isPending && proposals.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-10 text-center">
              <IconTile tone="bg-muted text-muted-foreground"><Landmark className="size-5" /></IconTile>
              <div>
                <p className="font-medium">No accounts found</p>
                <p className="mt-1 text-sm text-muted-foreground">Import your SMS history or wait for a few bank alerts, then scan again.</p>
              </div>
              <Button variant="outline" onClick={() => detect.mutate()}>
                Scan again
              </Button>
            </div>
          )}

          {proposals.map((p, i) => {
            const on = selected.has(p)
            const open = expanded === p
            const texts = p.sourceTexts ?? []
            return (
              <div key={`${p.lastDigits}-${i}`} className={cn('rounded-2xl border transition-colors', on ? 'border-indigo-400/60 bg-indigo-500/10' : 'border-border bg-card')}>
                <div className="flex items-center gap-3 p-3">
                  <button
                    type="button"
                    onClick={() => toggle(p)}
                    aria-pressed={on}
                    aria-label={`${on ? 'Deselect' : 'Select'} ${p.name}`}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors', on ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-border')}>
                      {on && <Check className="size-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {p.name} <span className="text-muted-foreground">••{p.lastDigits}</span>
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {kindMeta(toAccountType(p.type ?? 'BANK')).label}
                        {p.balanceMinor != null ? `, last seen at ${formatMinor(p.balanceMinor)}` : ''}
                      </span>
                    </span>
                  </button>
                  {texts.length > 0 && (
                    <Button size="icon" variant="ghost" className="size-9" aria-label="Show the messages behind this" onClick={() => setExpanded(open ? null : p)}>
                      <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-9"
                    aria-label={`Dismiss ${p.name}`}
                    onClick={() => {
                      setProposals((cur) => cur.filter((x) => x !== p))
                      setSelected((cur) => {
                        const next = new Set(cur)
                        next.delete(p)
                        return next
                      })
                    }}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
                {open && (
                  <div className="space-y-2 border-t border-border/60 p-3">
                    <p className="text-xs text-muted-foreground">Messages that pointed to this account</p>
                    {texts.map((t: string, idx: number) => (
                      <p key={idx} className="rounded-xl bg-muted px-3 py-2 text-xs">
                        {t}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button className="h-12 text-base" disabled={selected.size === 0 || add.isPending} onClick={() => add.mutate()}>
            {add.isPending ? 'Adding…' : selected.size === 0 ? 'Select an account' : `Add ${plural(selected.size, 'account')}`}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

/* ───────────────────────────── developer tools ───────────────────────────── */

function DeveloperGroup() {
  const client = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const running = progress !== null

  const seed = async () => {
    try {
      setProgress('Setting up accounts…')
      const categories = (await LocalExpense.listCategories()).categories
      const expenseCats = categories.filter((c) => c.kind === 'EXPENSE')
      await LocalExpense.setAccountBalance({ name: 'HDFC Savings', lastDigits: '4821', type: 'BANK', balanceMinor: 12500000 })
      await LocalExpense.setAccountBalance({ name: 'Cash Wallet', lastDigits: '0000', type: 'CASH', balanceMinor: 650000 })

      const merchants = ['Swiggy', 'Zomato', 'Amazon', 'Uber', 'BigBasket', 'Netflix', 'Spotify', 'Electricity Board', 'Rent', 'Pharmacy']
      const total = 80
      for (let i = 0; i < total; i++) {
        setProgress(`Adding transactions ${i + 1} of ${total}…`)
        const occurredAt = Date.now() - Math.floor(Math.random() * 90) * 24 * 60 * 60 * 1000
        const income = Math.random() > 0.85 // one roll, so direction and kind always agree
        await LocalExpense.createManualTransaction({
          amountMinor: Math.round((50 + Math.random() * 4950) * 100),
          direction: income ? 'CREDIT' : 'DEBIT',
          kind: income ? 'INCOME' : 'SPEND',
          categoryId: expenseCats[Math.floor(Math.random() * expenseCats.length)]?.id ?? null,
          merchantName: merchants[Math.floor(Math.random() * merchants.length)],
          occurredAt,
          note: null,
        })
      }

      setProgress('Adding bills, goals and limits…')
      await LocalExpense.upsertCommitment({ name: 'Apartment Rent', amountMinor: 2800000, dueAt: Date.now() + 5 * 24 * 60 * 60 * 1000, recurrence: 'MONTHLY' })
      await LocalExpense.upsertCommitment({ name: 'Electricity', amountMinor: 345000, dueAt: Date.now() + 12 * 24 * 60 * 60 * 1000, recurrence: 'MONTHLY' })
      await LocalExpense.upsertGoal({ name: 'Emergency Cushion', targetMinor: 15000000, savedMinor: 4000000 })
      await LocalExpense.upsertGoal({ name: 'Workstation Upgrade', targetMinor: 12000000, savedMinor: 2500000 })
      await LocalExpense.upsertBudget({ categoryId: expenseCats[0]?.id ?? null, period: 'MONTHLY', limitMinor: 1500000 })
      await LocalExpense.setFinancialSettings({
        bufferMinor: 5000000,
        incomeDay: 1,
        expectedIncomeMinor: 8500000,
        essentialCategories: expenseCats.slice(0, 3).map((c) => c.id),
      })
      await LocalExpense.setOnboardingComplete({ completed: true })
      void client.invalidateQueries()
      toast.success('Sample data added')
    } catch (error) {
      console.error(error)
      toast.error('Could not add sample data')
    } finally {
      setProgress(null)
      setConfirm(false)
    }
  }

  return (
    <Group title="Developer tools" footer="Sample data mixes with your real data, so only use this on a test install.">
      <ActionRow
        onClick={() => (confirm ? void seed() : setConfirm(true))}
        disabled={running}
        icon={<IconTile tone={confirm ? 'bg-rose-500/15 text-rose-300' : 'bg-muted text-muted-foreground'}><Code2 className="size-5" /></IconTile>}
        title={progress ?? (confirm ? 'Tap again to add sample data' : 'Add sample data')}
        subtitle={running ? undefined : '2 accounts, 80 transactions, bills, goals and a limit'}
        right={running ? <RefreshCw className="size-4 animate-spin text-muted-foreground" /> : <span />}
      />
    </Group>
  )
}