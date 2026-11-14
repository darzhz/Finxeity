import { useState } from 'react'
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
import type { AccountBalance, AccountProposal, AccountType, FinancialSettings } from '@/lib/plugin'
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
import { MoneyField } from '@/components/money-field'
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

          <TrackingGroup
            loading={listener.isLoading}
            accessGranted={!!listener.data?.accessGranted}
            smsSupported={!!sms.data?.supported}
            appCount={appCount}
            importPending={importSms.isPending}
            reparsePending={reparse.isPending}
            onImportSms={() => importSms.mutate()}
            onReparse={() => reparse.mutate()}
          />

          <AccountsGroup
            loading={balances.isLoading}
            accounts={accounts}
            onEdit={(account) => setAccountDrawer({ account })}
            onAdd={() => setAccountDrawer({ account: null })}
            onDetect={() => setDetecting(true)}
          />

          <Group title="Planning">
            <NavRow to="/bills" icon={<IconTile tone="bg-orange-500/15 text-orange-300"><Receipt className="size-5" /></IconTile>} title="Upcoming bills" />
            <NavRow to="/goals" icon={<IconTile tone="bg-emerald-500/15 text-emerald-300"><Target className="size-5" /></IconTile>} title="Savings goals" />
            <NavRow to="/budgets" icon={<IconTile tone="bg-pink-500/15 text-pink-300"><Gauge className="size-5" /></IconTile>} title="Spending limits" />
          </Group>

          <FinancialCard />

          <RulesGroup rules={ruleList} loading={rules.isLoading} />

          {devUnlocked && <DeveloperGroup />}

          <PrivacyFooter
            unlocked={devUnlocked}
            onSecretTap={() => {
              const next = devTaps + 1
              setDevTaps(next)
              if (next === 5) toast.success('Developer tools unlocked')
            }}
          />
        </div>
      </div>

      <AccountDrawer state={accountDrawer} onClose={() => setAccountDrawer(null)} />
      {detecting && <DetectDrawer onClose={() => setDetecting(false)} />}
    </div>
  )
}

function TrackingGroup({
  loading,
  accessGranted,
  smsSupported,
  appCount,
  importPending,
  reparsePending,
  onImportSms,
  onReparse,
}: {
  loading: boolean
  accessGranted: boolean
  smsSupported: boolean
  appCount: number
  importPending: boolean
  reparsePending: boolean
  onImportSms: () => void
  onReparse: () => void
}) {
  return (
    <Group title="Tracking">
      <ActionRow
        onClick={() => void LocalExpense.openNotificationSettings()}
        icon={<IconTile><BellRing className="size-5" /></IconTile>}
        title="Notification access"
        subtitle={accessGranted ? 'Allowed. Opens system settings.' : 'Off. Tap to turn it on.'}
      />
      <NavRow
        to="/settings/apps"
        icon={<IconTile tone="bg-sky-500/15 text-sky-300"><Smartphone className="size-5" /></IconTile>}
        title="Monitored apps"
        subtitle={`${plural(appCount, 'app')} watched for bank alerts`}
      />
      {smsSupported && (
        <ActionRow
          onClick={onImportSms}
          disabled={importPending}
          icon={<IconTile tone="bg-emerald-500/15 text-emerald-300"><MessageSquarePlus className="size-5" /></IconTile>}
          title={importPending ? 'Importing…' : 'Import SMS history'}
          subtitle="Recover the last 90 days from bank texts (sideload builds only)"
          right={importPending ? <RefreshCw className="size-4 animate-spin text-muted-foreground" /> : undefined}
        />
      )}
      <ActionRow
        onClick={onReparse}
        disabled={reparsePending}
        icon={<IconTile tone="bg-amber-500/15 text-amber-300"><RefreshCw className={cn('size-5', reparsePending && 'animate-spin')} /></IconTile>}
        title={reparsePending ? 'Reading…' : 'Read all messages again'}
        subtitle="Useful after the app learns a new bank format"
        right={<span />}
      />
      {loading && <Skeleton className="m-4 h-8 rounded-xl" />}
    </Group>
  )
}

function AccountsGroup({
  loading,
  accounts,
  onEdit,
  onAdd,
  onDetect,
}: {
  loading: boolean
  accounts: AccountBalance[]
  onEdit: (account: AccountBalance) => void
  onAdd: () => void
  onDetect: () => void
}) {
  return (
    <Group title="Accounts" footer="Each balance is the number you set, plus everything spent or received since.">
      {loading && (
        <div className="space-y-3 p-4">
          <Skeleton className="h-10 w-full rounded-2xl" />
          <Skeleton className="h-10 w-full rounded-2xl" />
        </div>
      )}
      {!loading && accounts.length === 0 && (
        <p className="px-4 py-5 text-sm text-muted-foreground">No accounts yet. Add one, or let the app find them in your messages.</p>
      )}
      {accounts.map((account) => {
        const kind = kindMeta(account.type)
        const drifted = account.derivedBalanceMinor !== account.anchorBalanceMinor
        return (
          <ActionRow
            key={account.id}
            onClick={() => onEdit(account)}
            icon={<IconTile tone="bg-muted">{kind.emoji}</IconTile>}
            title={`${account.name}${account.lastDigits ? `  ••${account.lastDigits}` : ''}`}
            subtitle={drifted ? `Started at ${formatMinor(account.anchorBalanceMinor)}` : kind.label}
            right={<span className="text-sm font-semibold tabular-nums">{formatMinor(account.derivedBalanceMinor)}</span>}
          />
        )
      })}
      <ActionRow
        onClick={onAdd}
        icon={<IconTile tone="bg-indigo-500/15 text-indigo-300"><Plus className="size-5" /></IconTile>}
        title="Add an account"
        right={<span />}
      />
      <ActionRow
        onClick={onDetect}
        icon={<IconTile tone="bg-violet-500/15 text-violet-300"><Sparkles className="size-5" /></IconTile>}
        title="Find accounts in my messages"
        subtitle="Looks through stored bank alerts for accounts you use"
      />
    </Group>
  )
}

function PrivacyFooter({ unlocked, onSecretTap }: { unlocked: boolean; onSecretTap: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!unlocked) onSecretTap()
      }}
      className="mx-auto flex flex-col items-center gap-1.5 pt-2 text-center"
    >
      <ShieldCheck className="size-5 text-emerald-400" />
      <span className="text-sm font-medium">Private by design</span>
      <span className="max-w-xs text-xs text-muted-foreground">
        Release builds have no internet permission. Everything stays on this device.
      </span>
    </button>
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
  const financial = useQuery({ queryKey: ['financialSettings'], queryFn: () => LocalExpense.getFinancialSettings() })
  const d = financial.data
  const key = d ? `${d.bufferMinor}:${d.incomeDay ?? 0}:${d.expectedIncomeMinor}` : 'loading'

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
        ) : d ? (
          <FinancialForm key={key} data={d} />
        ) : null}
      </div>
    </section>
  )
}

function toAmountInput(minor: number) {
  return minor ? (minor / 100).toString() : ''
}

function toDayInput(day: number) {
  return day ? String(day) : ''
}

function financialDirty(data: FinancialSettings, bufferMinor: number, incomeMinor: number, day: number) {
  return bufferMinor !== data.bufferMinor || incomeMinor !== data.expectedIncomeMinor || day !== data.incomeDay
}

function FinancialForm({ data }: { data: FinancialSettings }) {
  const client = useQueryClient()
  const [buffer, setBuffer] = useState(() => toAmountInput(data.bufferMinor))
  const [incomeDay, setIncomeDay] = useState(() => toDayInput(data.incomeDay))
  const [income, setIncome] = useState(() => toAmountInput(data.expectedIncomeMinor))

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

  const bufferMinor = parseMajorToMinor(buffer || '0') ?? 0
  const incomeMinor = parseMajorToMinor(income || '0') ?? 0
  const day = incomeDay === '' ? 0 : Number(incomeDay)
  const dayValid = Number.isInteger(day) && day >= 0 && day <= 31
  const dirty = financialDirty(data, bufferMinor, incomeMinor, day)

  return (
    <>
      <MoneyField label="Emergency buffer" value={buffer} onChange={setBuffer} placeholder="0.00" hint="Money you never want to count as spendable." />
      <MoneyField label="Expected monthly income" value={income} onChange={setIncome} placeholder="0.00" />
      <IncomeDayField value={incomeDay} valid={dayValid} onChange={setIncomeDay} />
      <FinanceSaveButton
        dirty={dirty}
        valid={dayValid}
        pending={save.isPending}
        onSave={() => save.mutate({ bufferMinor, expectedIncomeMinor: incomeMinor, incomeDay: day })}
      />
    </>
  )
}

function IncomeDayField({ value, valid, onChange }: { value: string; valid: boolean; onChange: (value: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>Income arrives on day</Label>
      <Input
        className="h-11 tabular-nums"
        inputMode="numeric"
        value={value}
        placeholder="1 to 31"
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 2))}
        aria-invalid={!valid}
      />
      {!valid && <p className="text-xs text-rose-400">Enter a day between 1 and 31.</p>}
    </div>
  )
}

function FinanceSaveButton({
  dirty,
  valid,
  pending,
  onSave,
}: {
  dirty: boolean
  valid: boolean
  pending: boolean
  onSave: () => void
}) {
  const label = pending ? 'Saving…' : dirty ? 'Save changes' : 'Up to date'
  return (
    <Button className="h-11 w-full" disabled={!dirty || !valid || pending} onClick={onSave}>
      {label}
    </Button>
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
  if (!state) {
    return (
      <Drawer open={false} onOpenChange={() => {}}>
        <DrawerContent />
      </Drawer>
    )
  }

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="max-h-[92dvh]">
        <AccountDrawerBody key={state.account?.id ?? 'new'} account={state.account} onClose={onClose} />
      </DrawerContent>
    </Drawer>
  )
}

function AccountDrawerBody({ account, onClose }: { account: AccountBalance | null; onClose: () => void }) {
  const client = useQueryClient()
  const [name, setName] = useState(() => account?.name ?? '')
  const [lastDigits, setLastDigits] = useState(() => account?.lastDigits ?? '')
  const [balance, setBalance] = useState(() => (account ? (account.anchorBalanceMinor / 100).toFixed(2) : ''))
  const [type, setType] = useState<AccountType>(() => account?.type ?? 'BANK')
  const [confirmDelete, setConfirmDelete] = useState(false)

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

  const title = account ? 'Edit account' : 'Add an account'
  const description = account
    ? 'Set the balance to re-anchor the tracked total.'
    : 'Enter what the account shows right now. Activity after that keeps it current.'
  const submitLabel = save.isPending ? 'Saving…' : account ? 'Save changes' : 'Add account'
  const deleteLabel = confirmDelete ? 'Tap again to remove this account' : 'Remove account'

  return (
    <>
      <DrawerHeader className="pb-2">
        <DrawerTitle>{title}</DrawerTitle>
        <DrawerDescription>{description}</DrawerDescription>
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
            {ACCOUNT_KINDS.map((kind) => (
              <button
                key={kind.value}
                type="button"
                onClick={() => setType(kind.value)}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-sm transition-[color,background-color,border-color,transform] active:scale-95',
                  type === kind.value ? 'border-indigo-400/70 bg-indigo-500/20 font-medium' : 'border-border bg-card text-muted-foreground',
                )}
              >
                <span>{kind.emoji}</span>
                {kind.label}
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
            {deleteLabel}
          </Button>
        )}
      </div>

      <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button className="h-12 text-base" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
          {submitLabel}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </DrawerFooter>
    </>
  )
}

/* ───────────────────────────── detect drawer ───────────────────────────── */

function DetectDrawer({ onClose }: { onClose: () => void }) {
  const detect = useQuery({
    queryKey: ['detectAccounts'],
    queryFn: () => LocalExpense.detectAccounts(),
    staleTime: 0,
    gcTime: 0,
  })
  const proposals = detect.data?.proposals ?? []

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="pb-2">
          <DrawerTitle>Accounts in your messages</DrawerTitle>
          <DrawerDescription>Pick the ones you want to track. You can fix balances afterwards.</DrawerDescription>
        </DrawerHeader>

        {detect.isPending ? (
          <div className="space-y-2.5 overflow-y-auto px-4 pb-2">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="size-4 animate-spin" /> Reading your stored messages…
            </p>
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-16 w-full rounded-2xl" />
          </div>
        ) : (
          <DetectResults
            key={detect.dataUpdatedAt}
            proposals={proposals}
            onRescan={() => void detect.refetch()}
            onClose={onClose}
          />
        )}
      </DrawerContent>
    </Drawer>
  )
}

function DetectResults({
  proposals,
  onRescan,
  onClose,
}: {
  proposals: AccountProposal[]
  onRescan: () => void
  onClose: () => void
}) {
  const client = useQueryClient()
  const [selected, setSelected] = useState<Set<AccountProposal>>(() => new Set(proposals))
  const [expanded, setExpanded] = useState<AccountProposal | null>(null)

  const add = useMutation({
    mutationFn: () =>
      Promise.all(
        proposals
          .filter((proposal) => selected.has(proposal))
          .map((proposal) =>
            LocalExpense.setAccountBalance({
              name: proposal.name,
              lastDigits: proposal.lastDigits,
              type: toAccountType(proposal.type ?? 'BANK'),
              balanceMinor: proposal.balanceMinor ?? 0,
            }),
          ),
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.accounts })
      void client.invalidateQueries({ queryKey: queryKeys.balances })
      toast.success(`Added ${plural(selected.size, 'account')}`)
      onClose()
    },
    onError: () => toast.error('Could not add the accounts. Try again.'),
  })

  const toggle = (proposal: AccountProposal) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(proposal)) next.delete(proposal)
      else next.add(proposal)
      return next
    })

  const dismiss = (proposal: AccountProposal) => {
    setSelected((current) => {
      const next = new Set(current)
      next.delete(proposal)
      return next
    })
    setExpanded((current) => (current === proposal ? null : current))
  }

  return (
    <>
      <div className="space-y-2.5 overflow-y-auto px-4 pb-2">
        {proposals.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-10 text-center">
            <IconTile tone="bg-muted text-muted-foreground"><Landmark className="size-5" /></IconTile>
            <div>
              <p className="font-medium">No accounts found</p>
              <p className="mt-1 text-sm text-muted-foreground">Import your SMS history or wait for a few bank alerts, then scan again.</p>
            </div>
            <Button variant="outline" onClick={onRescan}>
              Scan again
            </Button>
          </div>
        )}

        {proposals.map((proposal) => (
          <ProposalCard
            key={`${proposal.name}-${proposal.lastDigits}`}
            proposal={proposal}
            selected={selected.has(proposal)}
            expanded={expanded === proposal}
            onToggle={() => toggle(proposal)}
            onExpand={() => setExpanded((current) => (current === proposal ? null : proposal))}
            onDismiss={() => dismiss(proposal)}
          />
        ))}
      </div>

      <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button className="h-12 text-base" disabled={selected.size === 0 || add.isPending} onClick={() => add.mutate()}>
          {add.isPending ? 'Adding…' : selected.size === 0 ? 'Select an account' : `Add ${plural(selected.size, 'account')}`}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </DrawerFooter>
    </>
  )
}

function ProposalCard({
  proposal,
  selected,
  expanded,
  onToggle,
  onExpand,
  onDismiss,
}: {
  proposal: AccountProposal
  selected: boolean
  expanded: boolean
  onToggle: () => void
  onExpand: () => void
  onDismiss: () => void
}) {
  const texts = proposal.sourceTexts ?? []
  const kind = kindMeta(toAccountType(proposal.type ?? 'BANK'))
  const balanceNote = proposal.balanceMinor != null ? `, last seen at ${formatMinor(proposal.balanceMinor)}` : ''

  return (
    <div className={cn('rounded-2xl border transition-colors', selected ? 'border-indigo-400/60 bg-indigo-500/10' : 'border-border bg-card')}>
      <div className="flex items-center gap-3 p-3">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={selected}
          aria-label={`${selected ? 'Deselect' : 'Select'} ${proposal.name}`}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors', selected ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-border')}>
            {selected && <Check className="size-3.5" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {proposal.name} <span className="text-muted-foreground">••{proposal.lastDigits}</span>
            </span>
            <span className="block text-xs text-muted-foreground">
              {kind.label}
              {balanceNote}
            </span>
          </span>
        </button>
        {texts.length > 0 && (
          <Button size="icon" variant="ghost" className="size-9" aria-label="Show the messages behind this" onClick={onExpand}>
            <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
          </Button>
        )}
        <Button size="icon" variant="ghost" className="size-9" aria-label={`Dismiss ${proposal.name}`} onClick={onDismiss}>
          <X className="size-4" />
        </Button>
      </div>
      {expanded && (
        <div className="space-y-2 border-t border-border/60 p-3">
          <p className="text-xs text-muted-foreground">Messages that pointed to this account</p>
          {texts.map((text) => (
            <p key={text} className="rounded-xl bg-muted px-3 py-2 text-xs">
              {text}
            </p>
          ))}
        </div>
      )}
    </div>
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
      await Promise.all([
        LocalExpense.setAccountBalance({ name: 'HDFC Savings', lastDigits: '4821', type: 'BANK', balanceMinor: 12500000 }),
        LocalExpense.setAccountBalance({ name: 'Cash Wallet', lastDigits: '0000', type: 'CASH', balanceMinor: 650000 }),
      ])

      const merchants = ['Swiggy', 'Zomato', 'Amazon', 'Uber', 'BigBasket', 'Netflix', 'Spotify', 'Electricity Board', 'Rent', 'Pharmacy']
      setProgress('Adding transactions…')
      await Promise.all(
        Array.from({ length: 80 }, () => {
          const occurredAt = Date.now() - Math.floor(Math.random() * 90) * 24 * 60 * 60 * 1000
          const income = Math.random() > 0.85
          return LocalExpense.createManualTransaction({
            amountMinor: Math.round((50 + Math.random() * 4950) * 100),
            direction: income ? 'CREDIT' : 'DEBIT',
            kind: income ? 'INCOME' : 'SPEND',
            categoryId: expenseCats[Math.floor(Math.random() * expenseCats.length)]?.id ?? null,
            merchantName: merchants[Math.floor(Math.random() * merchants.length)],
            occurredAt,
            note: null,
          })
        }),
      )

      setProgress('Adding bills, goals and limits…')
      await Promise.all([
        LocalExpense.upsertCommitment({ name: 'Apartment Rent', amountMinor: 2800000, dueAt: Date.now() + 5 * 24 * 60 * 60 * 1000, recurrence: 'MONTHLY' }),
        LocalExpense.upsertCommitment({ name: 'Electricity', amountMinor: 345000, dueAt: Date.now() + 12 * 24 * 60 * 60 * 1000, recurrence: 'MONTHLY' }),
        LocalExpense.upsertGoal({ name: 'Emergency Cushion', targetMinor: 15000000, savedMinor: 4000000 }),
        LocalExpense.upsertGoal({ name: 'Workstation Upgrade', targetMinor: 12000000, savedMinor: 2500000 }),
        LocalExpense.upsertBudget({ categoryId: expenseCats[0]?.id ?? null, period: 'MONTHLY', limitMinor: 1500000 }),
        LocalExpense.setFinancialSettings({
          bufferMinor: 5000000,
          incomeDay: 1,
          expectedIncomeMinor: 8500000,
          essentialCategories: expenseCats.slice(0, 3).map((c) => c.id),
        }),
        LocalExpense.setOnboardingComplete({ completed: true }),
      ])
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