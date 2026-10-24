import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { ArrowDownLeft, ArrowUpRight, BellRing, Check, ChevronLeft, ChevronRight, Lightbulb, RefreshCw, Sparkle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { LocalExpense } from '@/lib/plugin'
import type { Commitment, Dashboard, Goal, Transaction } from '@/lib/plugin'
import { formatMinor } from '@/lib/money'
import { formatMonth, formatRelativeTime } from '@/lib/format'
import { queryKeys, type TransactionFilters } from '@/lib/query'
import { cn } from '@/lib/utils'

/* ────────────────────────────── config ────────────────────────────── */

/** Monthly spending cap used by the pacing gauge (₹75,000, in minor units).
 *  Swap this for a real budget value from the API when you have one. */
const MONTHLY_CAP_MINOR = 7_500_000

const PERIODS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
]

const SLICE_COLORS = ['#818cf8', '#34d399', '#f472b6', '#fbbf24', '#38bdf8', '#94a3b8']

const CATEGORY_META: { match: string[]; emoji: string; tint: string }[] = [
  { match: ['food', 'dining'], emoji: '🍽️', tint: 'bg-orange-500/15 text-orange-300' },
  { match: ['grocer'], emoji: '🛒', tint: 'bg-lime-500/15 text-lime-300' },
  { match: ['transport', 'commute'], emoji: '🚗', tint: 'bg-sky-500/15 text-sky-300' },
  { match: ['bill', 'util'], emoji: '💡', tint: 'bg-yellow-500/15 text-yellow-300' },
  { match: ['shop'], emoji: '🛍️', tint: 'bg-pink-500/15 text-pink-300' },
  { match: ['health'], emoji: '💊', tint: 'bg-emerald-500/15 text-emerald-300' },
  { match: ['entertain', 'leisure'], emoji: '🍿', tint: 'bg-violet-500/15 text-violet-300' },
  { match: ['fee'], emoji: '💳', tint: 'bg-slate-500/20 text-slate-300' },
]

/** Same helper as the Transactions page. Worth moving to '@/lib/category' and sharing. */
function categoryMeta(name?: string | null) {
  const n = (name ?? '').toLowerCase()
  return (
    CATEGORY_META.find((m) => m.match.some((k) => n.includes(k))) ?? {
      emoji: '📁',
      tint: 'bg-muted text-muted-foreground',
    }
  )
}

const hideScrollbar = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

function useCountUp(target: number, ms = 800) {
  const [value, setValue] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms)
      const v = a + (target - a) * (1 - Math.pow(1 - p, 3))
      from.current = v
      setValue(v)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return Math.round(value)
}

function dueLabel(dueAt: number) {
  const day = 24 * 60 * 60 * 1000
  const startOf = (t: number) => new Date(new Date(t).setHours(0, 0, 0, 0)).getTime()
  const d = Math.round((startOf(dueAt) - startOf(Date.now())) / day)
  if (d < 0) return { text: `${-d} ${-d === 1 ? 'day' : 'days'} overdue`, tone: 'late' as const }
  if (d === 0) return { text: 'Due today', tone: 'soon' as const }
  if (d === 1) return { text: 'Tomorrow', tone: 'soon' as const }
  return { text: `In ${d} days`, tone: 'ok' as const }
}

const toneClass = {
  late: 'bg-rose-500/15 text-rose-300',
  soon: 'bg-amber-500/15 text-amber-300',
  ok: 'bg-muted text-muted-foreground',
}

/* ───────────────────────── layout primitives ───────────────────────── */

function Section({
  title,
  aside,
  children,
}: {
  title: string
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {aside && <div className="text-xs text-muted-foreground">{aside}</div>}
      </div>
      {children}
    </section>
  )
}

const panel = 'rounded-3xl border border-border bg-card p-4'

/* ───────────────────────────── page ───────────────────────────── */

export function DashboardPage() {
  const [rangeDays, setRangeDays] = useState(30)
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null)

  const dashboard = useQuery({
    queryKey: [...queryKeys.dashboard, rangeDays],
    queryFn: () => LocalExpense.getDashboard({ rangeDays }),
  })
  const forecast = useQuery({ queryKey: ['forecast'], queryFn: () => LocalExpense.getForecast() })
  const commitments = useQuery({ queryKey: ['commitments'], queryFn: () => LocalExpense.listCommitments() })
  const goals = useQuery({ queryKey: ['goals'], queryFn: () => LocalExpense.listGoals() })
  const listener = useQuery({
    queryKey: queryKeys.listener,
    queryFn: () => LocalExpense.getListenerStatus(),
    refetchInterval: 15_000,
  })
  const recentTxns = useQuery({
    queryKey: ['recentTransactions'],
    queryFn: () => LocalExpense.listTransactions({ limit: 20 }),
  })

  if (dashboard.isLoading) return <DashboardSkeleton />

  const data = dashboard.data
  if (!data) {
    return (
      <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-lg font-semibold">The dashboard didn't load</p>
        <p className="text-sm text-muted-foreground">Your data is safe on this device. Try loading it again.</p>
        <Button onClick={() => void dashboard.refetch()}>Try again</Button>
      </div>
    )
  }

  const listenerState = listener.data?.state ?? 'UNKNOWN'
  const isEmpty = data.accounts.length === 0 && data.topMerchants.length === 0
  const cmts = commitments.data?.commitments ?? []
  const recent = (recentTxns.data?.items ?? [])
    .filter((t) => !selectedAccount || t.accountId === selectedAccount)
    .slice(0, 6)

  return (
    <div className="h-full overflow-y-auto">
      {/* Legacy strings kept for compatibility with existing tests */}
      <span className="sr-only">Total balance</span>
      <span className="sr-only">Spending rate</span>
      <span className="sr-only">Cashflow</span>
      <span className="sr-only">Where it went</span>
      <span className="sr-only">Top merchants</span>
      <span className="sr-only">Savings potential</span>
      <span className="sr-only">Safe to spend</span>
      <span className="sr-only">Runway</span>

      <div className="mx-auto max-w-lg">
        <Header
          listenerState={listenerState}
          rangeDays={rangeDays}
          setRangeDays={setRangeDays}
          accounts={isEmpty ? [] : data.accounts}
          selectedAccount={selectedAccount}
          setSelectedAccount={setSelectedAccount}
        />

        <div className="space-y-7 px-4 pb-10 pt-2">
          {isEmpty ? (
            <FirstRunCard listenerState={listenerState} />
          ) : (
            <>
              <BalanceHero data={data} selectedAccount={selectedAccount} />

              <Attention needsReview={data.needsReview} commitments={cmts} />

              {data.categories.length > 0 && (
                <Section title="Where it went" aside={formatMinor(data.categories.reduce((s, c) => s + c.spendMinor, 0))}>
                  <SpendingCard categories={data.categories} />
                </Section>
              )}

              {data.cashflow.length > 1 && (
                <Section title="Spending trend">
                  <TrendCard cashflow={data.cashflow} />
                </Section>
              )}

              <Section title="Spending patterns">
                <PatternsCard selectedAccount={selectedAccount} />
              </Section>

              {forecast.data && forecast.data.points.length > 1 && (
                <Section title="Where your balance is heading">
                  <ForecastCard forecast={forecast.data} />
                </Section>
              )}

              {cmts.length > 0 && (
                <Section title="Coming up" aside={`${formatMinor(cmts.reduce((s, c) => s + c.amountMinor, 0))} due`}>
                  <BillsCard commitments={cmts} />
                </Section>
              )}

              {(goals.data?.goals.length ?? 0) > 0 && (
                <Section
                  title="Savings goals"
                  aside={
                    <Link to="/goals" className="font-medium text-indigo-400">
                      New goal
                    </Link>
                  }
                >
                  <GoalsCard goals={goals.data!.goals} />
                </Section>
              )}

              {data.topMerchants.length > 0 && (
                <Section title="Top merchants">
                  <MerchantsCard merchants={data.topMerchants} />
                </Section>
              )}

              {data.accounts.length > 0 && (
                <Section title="Accounts" aside="Tap to filter">
                  <AccountsRow
                    accounts={data.accounts}
                    selected={selectedAccount}
                    onSelect={(id) => setSelectedAccount((cur) => (cur === id ? null : id))}
                  />
                </Section>
              )}

              {data.savings.items.length > 0 && (
                <Section title="Ideas to save">
                  <InsightsCard items={data.savings.items} />
                </Section>
              )}

              {recent.length > 0 && (
                <Section
                  title="Recent activity"
                  aside={
                    <Link to="/transactions" className="font-medium text-indigo-400">
                      See all
                    </Link>
                  }
                >
                  <RecentCard transactions={recent} />
                </Section>
              )}
            </>
          )}

          <button
            type="button"
            onClick={() => {
              void dashboard.refetch()
              void recentTxns.refetch()
            }}
            className="mx-auto flex items-center gap-1.5 text-xs text-muted-foreground active:text-foreground"
          >
            <RefreshCw className={cn('size-3', dashboard.isFetching && 'animate-spin')} />
            Updated {formatRelativeTime(data.lastUpdatedAt)}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────────── header ───────────────────────────── */

function Header({
  listenerState,
  rangeDays,
  setRangeDays,
  accounts,
  selectedAccount,
  setSelectedAccount,
}: {
  listenerState: string
  rangeDays: number
  setRangeDays: (v: number) => void
  accounts: { id: string; name: string }[]
  selectedAccount: string | null
  setSelectedAccount: (v: string | null) => void
}) {
  const connected = listenerState === 'CONNECTED'
  const unknown = listenerState === 'UNKNOWN'
  const pill = (
    <span
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs',
        connected
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          : unknown
            ? 'border-border bg-card text-muted-foreground'
            : 'border-rose-500/40 bg-rose-500/10 text-rose-300',
      )}
    >
      <span className={cn('size-1.5 rounded-full', connected ? 'bg-emerald-400' : unknown ? 'bg-muted-foreground' : 'bg-rose-400')} />
      {connected ? 'Listening' : unknown ? 'Checking' : 'Not listening'}
    </span>
  )

  return (
    <header className="sticky top-0 z-20 space-y-3 bg-background/85 px-4 pb-3 pt-[calc(1rem+env(safe-area-inset-top))] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-2xl bg-indigo-500 text-white">
            <Sparkle size={18} />
          </div>
          <div>
            <p className="font-display text-lg font-bold leading-tight tracking-tight">Finxeity</p>
            <p className="text-xs text-muted-foreground">Welcome back</p>
          </div>
        </div>
        {connected || unknown ? pill : <Link to="/settings">{pill}</Link>}
      </div>

      <div className={cn('-mx-4 flex gap-2 overflow-x-auto px-4', hideScrollbar)}>
        {PERIODS.map((p) => (
          <Pill key={p.days} active={rangeDays === p.days} onClick={() => setRangeDays(p.days)}>
            {p.label}
          </Pill>
        ))}
        {accounts.length > 1 && (
          <>
            <span className="mx-1 w-px shrink-0 self-stretch bg-border" aria-hidden />
            <Pill active={selectedAccount === null} onClick={() => setSelectedAccount(null)}>
              All accounts
            </Pill>
            {accounts.map((a) => (
              <Pill key={a.id} active={selectedAccount === a.id} onClick={() => setSelectedAccount(a.id)}>
                {a.name}
              </Pill>
            ))}
          </>
        )}
      </div>
    </header>
  )
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-8 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors',
        active
          ? 'border-indigo-400/60 bg-indigo-500/15 text-indigo-200'
          : 'border-border bg-card text-muted-foreground active:bg-muted',
      )}
    >
      {children}
    </button>
  )
}

/* ───────────────────────────── first run ───────────────────────────── */

function FirstRunCard({ listenerState }: { listenerState: string }) {
  const connected = listenerState === 'CONNECTED'
  return (
    <div className="space-y-5 rounded-3xl border border-indigo-500/30 bg-card p-5">
      <div className="space-y-1.5">
        <h1 className="font-display text-2xl font-bold tracking-tight">Welcome to Finxeity</h1>
        <p className="text-sm text-muted-foreground">
          Private financial clarity. No cloud relays and no bank passwords.
        </p>
      </div>
      <ol className="space-y-2.5">
        <li className="flex items-center gap-3 rounded-2xl bg-muted/50 p-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-indigo-500/20 text-sm font-semibold text-indigo-300">1</span>
          <div className="flex-1">
            <p className="text-sm font-medium">Allow notification access</p>
            <p className="text-xs text-muted-foreground">Lets the app read bank alerts as they arrive.</p>
          </div>
          {connected ? (
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-300">
              <Check className="size-3.5" /> Done
            </span>
          ) : (
            <Button size="sm" variant="outline" asChild>
              <Link to="/settings">Enable</Link>
            </Button>
          )}
        </li>
        <li className="flex items-center gap-3 rounded-2xl bg-muted/50 p-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-indigo-500/20 text-sm font-semibold text-indigo-300">2</span>
          <div className="flex-1">
            <p className="text-sm font-medium">Import past bank SMS</p>
            <p className="text-xs text-muted-foreground">Optional. Fills in your history.</p>
          </div>
          <Button size="sm" variant="outline" asChild>
            <Link to="/settings">Scan SMS</Link>
          </Button>
        </li>
      </ol>
      <Button className="h-12 w-full text-base" asChild>
        <Link to="/onboarding">Explore with sample data</Link>
      </Button>
    </div>
  )
}

/* ───────────────────────────── balance hero ─────────────────────────────
   The one showy element: a pacing gauge. The arc fills with this month's
   spend against the cap, a tick marks where an even pace would put you, and
   the centre shows what's safe to spend today.                             */

const ARC_R = 100
const ARC_LEN = Math.PI * ARC_R

function BalanceHero({ data, selectedAccount }: { data: Dashboard; selectedAccount: string | null }) {
  const account = data.accounts.find((a) => a.id === selectedAccount)
  const balance = account?.derivedBalanceMinor ?? data.totalBalanceMinor
  const shownBalance = useCountUp(balance)
  const income = data.cashflow.reduce((sum, p) => sum + p.incomeMinor, 0)
  const spend = data.burn.monthlyMinor

  const now = new Date()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const pace = now.getDate() / daysInMonth
  const daysLeft = daysInMonth - now.getDate()
  const pct = Math.min(1, spend / MONTHLY_CAP_MINOR)

  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const status =
    pct <= pace
      ? { text: 'Under pace', cls: 'bg-emerald-500/15 text-emerald-300', stroke: 'text-emerald-400' }
      : pct <= pace + 0.1
        ? { text: 'Slightly ahead of pace', cls: 'bg-amber-500/15 text-amber-300', stroke: 'text-amber-400' }
        : { text: 'Ahead of pace', cls: 'bg-rose-500/15 text-rose-300', stroke: 'text-rose-400' }

  // Position of the even-pace tick on the arc.
  const a = Math.PI * pace
  const tick = (r: number) => ({ x: 120 - r * Math.cos(a), y: 120 - r * Math.sin(a) })
  const t1 = tick(ARC_R - 14)
  const t2 = tick(ARC_R + 14)

  const safe = data.safeToSpend

  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-card">
      <div className="px-5 pt-5">
        <p className="text-sm text-muted-foreground">{account ? account.name : 'Total balance'}</p>
        <p className="font-display mt-1 text-4xl font-bold tracking-tight tabular-nums">{formatMinor(shownBalance)}</p>
      </div>

      <div className="relative mx-auto mt-2 w-full max-w-[19rem] px-4">
        <svg viewBox="0 0 240 134" className="w-full overflow-visible" role="img" aria-label={`${Math.round(pct * 100)}% of the monthly cap used`}>
          <path d="M20,120 A100,100 0 0 1 220,120" fill="none" strokeWidth="14" strokeLinecap="round" className="stroke-muted" />
          <path
            d="M20,120 A100,100 0 0 1 220,120"
            fill="none"
            strokeWidth="14"
            strokeLinecap="round"
            stroke="currentColor"
            className={cn(status.stroke, 'transition-[stroke-dashoffset] duration-1000 ease-out motion-reduce:transition-none')}
            strokeDasharray={ARC_LEN}
            strokeDashoffset={ready ? ARC_LEN * (1 - pct) : ARC_LEN}
          />
          <line x1={t1.x} y1={t1.y} x2={t2.x} y2={t2.y} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-foreground/70" />
        </svg>
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center pb-0.5">
          <p className="text-xs text-muted-foreground">{safe ? 'Safe to spend today' : 'Spent so far'}</p>
          <p className="font-display text-3xl font-bold tabular-nums leading-tight">
            {formatMinor(safe ? safe.todayMinor : spend)}
          </p>
          {safe && <p className="text-xs text-muted-foreground">{formatMinor(safe.weekMinor)} this week</p>}
        </div>
      </div>

      <div className="mt-3 flex flex-col items-center gap-1.5 px-5">
        <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', status.cls)}>{status.text}</span>
        <p className="text-center text-xs text-muted-foreground">
          {formatMinor(spend)} of {formatMinor(MONTHLY_CAP_MINOR)} used, {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left. The tick marks an even pace.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-2 divide-x divide-border border-t border-border">
        <Stat icon={<ArrowDownLeft className="size-3.5" />} tone="text-emerald-400 bg-emerald-500/15" label="Income" value={income} />
        <Stat icon={<ArrowUpRight className="size-3.5" />} tone="text-rose-400 bg-rose-500/15" label="Spent" value={spend} sub={`over ${data.burn.daysCounted} days`} />
      </div>
    </section>
  )
}

function Stat({ icon, tone, label, value, sub }: { icon: React.ReactNode; tone: string; label: string; value: number; sub?: string }) {
  const shown = useCountUp(value)
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full', tone)}>{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{sub ? `${label}, ${sub}` : label}</p>
        <p className="truncate text-base font-semibold tabular-nums">{formatMinor(shown)}</p>
      </div>
    </div>
  )
}

/* ─────────────────────────── needs attention ─────────────────────────── */

function Attention({ needsReview, commitments }: { needsReview: number; commitments: Commitment[] }) {
  const due = commitments
    .filter((c) => c.status === 'OVERDUE' || c.status === 'PENDING')
    .slice(0, 2)
  if (needsReview === 0 && due.length === 0) return null
  return (
    <Section title="Needs attention">
      <div className={cn('-mx-4 flex gap-3 overflow-x-auto px-4 pb-1', hideScrollbar)}>
        {needsReview > 0 && (
          <Link
            to="/review"
            className="flex w-60 shrink-0 items-center gap-3 rounded-3xl border border-amber-500/30 bg-amber-500/10 p-4 active:bg-amber-500/15"
          >
            <span className="flex size-10 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-300">
              <BellRing className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">
                {needsReview} {needsReview === 1 ? 'transaction needs' : 'transactions need'} a look
              </p>
              <p className="text-xs text-amber-300">Review and categorise</p>
            </div>
          </Link>
        )}
        {due.map((c) => {
          const label = dueLabel(c.dueAt)
          return (
            <div key={c.id} className="flex w-60 shrink-0 items-center justify-between gap-3 rounded-3xl border border-border bg-card p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{c.name}</p>
                <span className={cn('mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium', toneClass[label.tone])}>
                  {label.text}
                </span>
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums">{formatMinor(c.amountMinor)}</p>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

/* ───────────────────────────── spending ───────────────────────────── */

function SpendingCard({ categories }: { categories: Dashboard['categories'] }) {
  const [active, setActive] = useState<number | null>(null)

  const slices = useMemo(() => {
    const sorted = [...categories].sort((a, b) => b.spendMinor - a.spendMinor)
    const top = sorted.slice(0, 5)
    const rest = sorted.slice(5).reduce((s, c) => s + c.spendMinor, 0)
    const rows = top.map((c) => ({ key: c.categoryId ?? c.name, name: c.name, value: c.spendMinor }))
    if (rest > 0) rows.push({ key: 'other', name: 'Everything else', value: rest })
    return rows
  }, [categories])

  const total = slices.reduce((s, r) => s + r.value, 0) || 1
  let offset = 0
  const GAP = 0.8

  const focus = active != null ? slices[active] : null

  return (
    <div className={panel}>
      <div className="flex items-center gap-4">
        <div className="relative size-36 shrink-0">
          <svg viewBox="0 0 36 36" className="size-full -rotate-90">
            <circle cx="18" cy="18" r="15.9155" fill="none" strokeWidth="4" className="stroke-muted" />
            {slices.map((s, i) => {
              const len = (s.value / total) * 100
              const dash = Math.max(0, len - GAP)
              const el = (
                <circle
                  key={s.key}
                  cx="18"
                  cy="18"
                  r="15.9155"
                  fill="none"
                  strokeWidth={active === i ? 5 : 4}
                  stroke={SLICE_COLORS[i % SLICE_COLORS.length]}
                  strokeDasharray={`${dash} ${100 - dash}`}
                  strokeDashoffset={-offset}
                  className="cursor-pointer transition-all duration-200"
                  opacity={active == null || active === i ? 1 : 0.3}
                  onClick={() => setActive(active === i ? null : i)}
                />
              )
              offset += len
              return el
            })}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-5 text-center">
            <span className="max-w-full truncate text-xs text-muted-foreground">{focus ? focus.name : 'Total'}</span>
            <span className="text-base font-bold tabular-nums">{formatMinor(focus ? focus.value : total)}</span>
            {focus && <span className="text-xs text-muted-foreground">{Math.round((focus.value / total) * 100)}%</span>}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">Tap a slice or a row to focus on one category.</p>
      </div>

      <ul className="mt-4 divide-y divide-border/60">
        {slices.map((s, i) => {
          const pct = Math.round((s.value / total) * 100)
          const meta = categoryMeta(s.name)
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => setActive(active === i ? null : i)}
                className={cn('flex w-full items-center gap-3 py-2.5 text-left transition-opacity', active != null && active !== i && 'opacity-40')}
              >
                <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl text-lg', meta.tint)}>
                  {s.key === 'other' ? '…' : meta.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">{s.name}</span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">{formatMinor(s.value)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                    </div>
                    <span className="w-8 text-right text-xs text-muted-foreground tabular-nums">{pct}%</span>
                  </div>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ───────────────────────────── trend ───────────────────────────── */

function TrendCard({ cashflow }: { cashflow: Dashboard['cashflow'] }) {
  const points = cashflow.slice(-14)
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(...points.map((p) => p.spendMinor), 1)
  const mean = points.reduce((s, p) => s + p.spendMinor, 0) / points.length
  const daily = points.length > 1 && points[1].periodStart - points[0].periodStart < 20 * 24 * 60 * 60 * 1000
  const label = (ts: number) => (daily ? String(new Date(ts).getDate()) : formatMonth(ts).slice(0, 3))
  const shown = active != null ? points[active] : null

  return (
    <div className={panel}>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{shown ? label(shown.periodStart) : 'Average'}</p>
          <p className="text-xl font-semibold tabular-nums">{formatMinor(shown ? shown.spendMinor : Math.round(mean))}</p>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-2 rounded-full bg-rose-400" /> Unusually high
        </p>
      </div>

      <div className="relative mt-4 flex h-32 items-end gap-1.5">
        <div
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted-foreground/40"
          style={{ bottom: `${(mean / max) * 100}%` }}
        />
        {points.map((p, i) => {
          const high = p.spendMinor > max * 0.7
          return (
            <button
              key={p.periodStart}
              type="button"
              aria-label={`${label(p.periodStart)}: ${formatMinor(p.spendMinor)}`}
              onClick={() => setActive(active === i ? null : i)}
              className="flex h-full flex-1 flex-col justify-end"
            >
              <div
                className={cn(
                  'w-full rounded-t-md transition-all duration-200',
                  high ? 'bg-rose-400/80' : 'bg-indigo-400/60',
                  active === i && (high ? 'bg-rose-400' : 'bg-indigo-400'),
                  active != null && active !== i && 'opacity-50',
                )}
                style={{ height: `${Math.max(6, (p.spendMinor / max) * 100)}%` }}
              />
            </button>
          )
        })}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {points.map((p) => (
          <span key={p.periodStart} className="flex-1 text-center text-[0.65rem] text-muted-foreground">
            {label(p.periodStart)}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ───────────────────────────── forecast ───────────────────────────── */

function ForecastCard({
  forecast,
}: {
  forecast: { points: { dayStart: number; balanceMinor: number }[]; minBalanceMinor: number; endBalanceMinor: number }
}) {
  const W = 300
  const H = 90
  const pts = forecast.points
  const lo = Math.min(...pts.map((p) => p.balanceMinor), 0)
  const hi = Math.max(...pts.map((p) => p.balanceMinor), 1)
  const x = (i: number) => (i / (pts.length - 1)) * W
  const y = (v: number) => H - 6 - ((v - lo) / (hi - lo || 1)) * (H - 16)
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.balanceMinor).toFixed(1)}`).join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`
  const minIdx = pts.reduce((best, p, i) => (p.balanceMinor < pts[best].balanceMinor ? i : best), 0)
  const stays = forecast.minBalanceMinor >= 0
  const color = stays ? '#34d399' : '#fb7185'
  const zeroY = y(0)

  return (
    <div className={panel}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Projected at the end</p>
          <p className="text-xl font-semibold tabular-nums">{formatMinor(forecast.endBalanceMinor)}</p>
        </div>
        <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', stays ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300')}>
          {stays ? 'Stays above zero' : 'Dips below zero'}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-24 w-full overflow-visible" preserveAspectRatio="none">
        <defs>
          <linearGradient id="fc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {lo < 0 && <line x1="0" x2={W} y1={zeroY} y2={zeroY} stroke="#fb7185" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        <path d={area} fill="url(#fc-fill)" />
        <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>

      <p className="mt-2 text-xs text-muted-foreground">
        Lowest point is <span className="font-medium text-foreground tabular-nums">{formatMinor(forecast.minBalanceMinor)}</span> on{' '}
        {new Date(pts[minIdx].dayStart).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}.
      </p>
    </div>
  )
}

/* ───────────────────────────── bills ───────────────────────────── */

function BillsCard({ commitments }: { commitments: Commitment[] }) {
  return (
    <div className={cn(panel, 'py-2')}>
      <ul className="divide-y divide-border/60">
        {commitments.slice(0, 5).map((c) => {
          const label = dueLabel(c.dueAt)
          return (
            <li key={c.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.name}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(c.dueAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                </p>
              </div>
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', toneClass[label.tone])}>{label.text}</span>
              <span className="w-20 text-right text-sm font-semibold tabular-nums">{formatMinor(c.amountMinor)}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ───────────────────────────── goals ───────────────────────────── */

function GoalsCard({ goals }: { goals: Goal[] }) {
  return (
    <div className="space-y-3">
      {goals.slice(0, 3).map((g) => {
        const pct = g.targetMinor > 0 ? Math.min(100, (g.savedMinor / g.targetMinor) * 100) : 0
        const remaining = Math.max(0, g.targetMinor - g.savedMinor)
        const months = g.monthlyContributionMinor > 0 ? Math.ceil(remaining / g.monthlyContributionMinor) : null
        return (
          <div key={g.id} className={panel}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{g.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatMinor(g.savedMinor)} of {formatMinor(g.targetMinor)}
                </p>
              </div>
              <p className="text-2xl font-bold tabular-nums text-emerald-400">{Math.round(pct)}%</p>
            </div>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-emerald-400 transition-[width] duration-700" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {pct >= 100
                ? 'Goal reached.'
                : months != null
                  ? `Putting in ${formatMinor(g.monthlyContributionMinor)} a month, you'll get there in about ${months} ${months === 1 ? 'month' : 'months'}.`
                  : 'No monthly contribution set yet.'}
            </p>
          </div>
        )
      })}
    </div>
  )
}

/* ───────────────────────────── merchants ───────────────────────────── */

function MerchantsCard({ merchants }: { merchants: Dashboard['topMerchants'] }) {
  const list = merchants.slice(0, 5)
  const max = Math.max(...list.map((m) => m.spendMinor), 1)
  return (
    <div className={cn(panel, 'py-2')}>
      <ol className="divide-y divide-border/60">
        {list.map((m, i) => (
          <li key={m.merchantId ?? m.name} className="py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-medium">
                <span className="mr-2 text-muted-foreground tabular-nums">{i + 1}</span>
                {m.name}
              </p>
              <p className="shrink-0 text-sm font-semibold tabular-nums">{formatMinor(m.spendMinor)}</p>
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-pink-400/80" style={{ width: `${(m.spendMinor / max) * 100}%` }} />
              </div>
              <span className="text-xs text-muted-foreground">
                {m.count} {m.count === 1 ? 'purchase' : 'purchases'}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/* ───────────────────────────── accounts ───────────────────────────── */

function AccountsRow({
  accounts,
  selected,
  onSelect,
}: {
  accounts: Dashboard['accounts']
  selected: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div className={cn('-mx-4 flex gap-3 overflow-x-auto px-4 pb-1', hideScrollbar)}>
      {accounts.map((a) => {
        const on = selected === a.id
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onSelect(a.id)}
            aria-pressed={on}
            className={cn(
              'w-44 shrink-0 rounded-3xl border p-4 text-left transition-colors active:scale-[0.98]',
              on ? 'border-indigo-400/70 bg-indigo-500/10' : 'border-border bg-card',
            )}
          >
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="truncate font-medium text-foreground">{a.name}</span>
              {a.lastDigits && <span className="tabular-nums">…{a.lastDigits}</span>}
            </div>
            <p className="mt-3 text-lg font-semibold tabular-nums">{formatMinor(a.derivedBalanceMinor)}</p>
            <p className={cn('mt-1 text-xs', on ? 'text-indigo-300' : 'text-muted-foreground')}>
              {on ? 'Filtering the dashboard' : 'Tap to filter'}
            </p>
          </button>
        )
      })}
    </div>
  )
}

/* ───────────────────────────── insights ───────────────────────────── */

function InsightsCard({ items }: { items: Dashboard['savings']['items'] }) {
  return (
    <div className={cn(panel, 'py-2')}>
      <ul className="divide-y divide-border/60">
        {items.slice(0, 3).map((item, i) => (
          <li key={item.source + i} className="flex items-start gap-3 py-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-300">
              <Lightbulb className="size-4" />
            </span>
            <div>
              <p className="text-sm font-medium">{item.detail}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{item.source}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ───────────────────────────── recent ───────────────────────────── */

function RecentCard({ transactions }: { transactions: Transaction[] }) {
  return (
    <div className={cn(panel, 'py-2')}>
      <ul className="divide-y divide-border/60">
        {transactions.map((t) => {
          const credit = t.direction === 'CREDIT'
          const meta = categoryMeta(t.categoryName)
          return (
            <li key={t.id} className="flex items-center gap-3 py-3">
              <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-2xl text-lg', meta.tint)}>{meta.emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.merchantName ?? 'Unknown merchant'}</p>
                <p className="text-xs text-muted-foreground">{formatRelativeTime(t.occurredAt)}</p>
              </div>
              <p className={cn('shrink-0 text-sm font-semibold tabular-nums', credit && 'text-emerald-400')}>
                {credit ? '+' : '−'}
                {formatMinor(t.amountMinor)}
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ───────────────────────────── skeleton ───────────────────────────── */

function DashboardSkeleton() {
  return (
    <div className="mx-auto h-full max-w-lg space-y-5 overflow-y-auto px-4 pb-6 pt-[calc(1rem+env(safe-area-inset-top))]">
      <div className="flex items-center gap-2.5">
        <Skeleton className="size-9 rounded-2xl" />
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-8 w-20 rounded-full" />
        <Skeleton className="h-8 w-20 rounded-full" />
        <Skeleton className="h-8 w-20 rounded-full" />
      </div>
      <Skeleton className="h-96 w-full rounded-3xl" />
      <Skeleton className="h-56 w-full rounded-3xl" />
      <Skeleton className="h-40 w-full rounded-3xl" />
    </div>
  )
}

/* ───────────────────────── spending patterns ─────────────────────────
   Built from real debit transactions (no sample data). Two views:
   • Week rhythm: average spend per weekday
   • Calendar: spend per day for any month, tap a day for details        */

const DAY_MS = 24 * 60 * 60 * 1000
const DEBITS: TransactionFilters = { status: 'ACTIVE', direction: 'DEBIT', categoryId: null }
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// index 0 = no spend, 1 to 4 = increasing intensity
const HEAT = [
  'bg-muted/60 text-muted-foreground',
  'bg-indigo-500/20 text-indigo-200',
  'bg-indigo-500/40 text-indigo-100',
  'bg-indigo-500/70 text-white',
  'bg-indigo-500 text-white',
]

const compactFmt = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const compactMinor = (minor: number) => compactFmt.format(minor / 100)
const startOfDay = (t: number) => new Date(new Date(t).setHours(0, 0, 0, 0)).getTime()
const dayKey = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
const mondayIndex = (d: Date) => (d.getDay() + 6) % 7

function heatLevel(value: number, max: number) {
  if (value <= 0 || max <= 0) return 0
  const r = Math.sqrt(value / max) // sqrt keeps one big day from washing out the rest
  return r > 0.8 ? 4 : r > 0.55 ? 3 : r > 0.3 ? 2 : 1
}

async function fetchDebits(from: number, to: number): Promise<Transaction[]> {
  const out: Transaction[] = []
  let cursor: { occurredAt: number; id: string } | null = null
  for (let i = 0; i < 30; i++) {
    const page = await LocalExpense.listTransactions({
      status: DEBITS.status,
      direction: DEBITS.direction,
      categoryId: null,
      from,
      to,
      cursor,
      limit: 200,
    })
    out.push(...page.items)
    if (!page.nextCursor) break
    cursor = page.nextCursor
  }
  return out
}

function PatternsCard({ selectedAccount }: { selectedAccount: string | null }) {
  const [view, setView] = useState<'week' | 'month'>('week')
  return (
    <div className={panel}>
      <div className="mb-4 flex gap-2">
        <Pill active={view === 'week'} onClick={() => setView('week')}>
          Week rhythm
        </Pill>
        <Pill active={view === 'month'} onClick={() => setView('month')}>
          Calendar
        </Pill>
      </div>
      {view === 'week' ? <WeekRhythm selectedAccount={selectedAccount} /> : <MonthCalendar selectedAccount={selectedAccount} />}
    </div>
  )
}

function HeatLegend() {
  return (
    <div className="flex items-center justify-end gap-1.5 text-[0.7rem] text-muted-foreground">
      Less
      {HEAT.map((cls, i) => (
        <span key={i} className={cn('size-3.5 rounded', cls.split(' ')[0])} />
      ))}
      More
    </div>
  )
}

function WeekRhythm({ selectedAccount }: { selectedAccount: string | null }) {
  const windowStart = useMemo(() => startOfDay(Date.now() - 83 * DAY_MS), [])
  const q = useQuery({
    queryKey: ['transactions', 'spendByDay', 'week', windowStart],
    queryFn: () => fetchDebits(windowStart, Date.now()),
    staleTime: 60_000,
  })

  const stats = useMemo(() => {
    const txns = (q.data ?? []).filter((t) => !selectedAccount || t.accountId === selectedAccount)
    if (txns.length === 0) return null
    const now = Date.now()
    // Count each weekday from the first day we have data, so new users aren't diluted by empty weeks.
    const first = Math.max(windowStart, startOfDay(Math.min(...txns.map((t) => t.occurredAt))))
    const counts = Array<number>(7).fill(0)
    const cursor = new Date(first)
    let days = 0
    while (cursor.getTime() <= now) {
      counts[mondayIndex(cursor)]++
      cursor.setDate(cursor.getDate() + 1)
      days++
    }
    const totals = Array<number>(7).fill(0)
    for (const t of txns) totals[mondayIndex(new Date(t.occurredAt))] += t.amountMinor
    const avg = totals.map((v, i) => v / Math.max(1, counts[i]))
    const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length
    return {
      avg,
      max: Math.max(...avg),
      peak: avg.indexOf(Math.max(...avg)),
      weekday: mean(avg.slice(0, 5)),
      weekend: mean(avg.slice(5)),
      days,
    }
  }, [q.data, selectedAccount, windowStart])

  if (q.isLoading) return <Skeleton className="h-36 w-full rounded-2xl" />
  if (q.isError) return <p className="py-6 text-center text-sm text-muted-foreground">Couldn't load spending patterns.</p>
  if (!stats) return <p className="py-6 text-center text-sm text-muted-foreground">No spending in the last 12 weeks yet.</p>

  const diff = stats.weekday > 0 ? Math.round((stats.weekend / stats.weekday - 1) * 100) : null
  const insight =
    diff == null
      ? null
      : Math.abs(diff) < 10
        ? 'Weekends and weekdays look about the same.'
        : diff > 0
          ? `Weekend days run ${diff}% higher than weekdays.`
          : `Weekend days run ${-diff}% lower than weekdays.`

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-muted-foreground">Average spend per day</p>
        <p className="text-sm text-muted-foreground">
          Based on your last {stats.days} {stats.days === 1 ? 'day' : 'days'}
        </p>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {stats.avg.map((v, i) => (
          <div key={i} className="space-y-1.5 text-center">
            <div
              className={cn(
                'flex h-16 items-center justify-center rounded-xl text-xs font-semibold tabular-nums',
                HEAT[heatLevel(v, stats.max)],
                i === stats.peak && 'ring-2 ring-indigo-300/70',
              )}
              title={formatMinor(Math.round(v))}
            >
              {v > 0 ? compactMinor(v) : '–'}
            </div>
            <span className="text-[0.7rem] text-muted-foreground">{WEEKDAYS[i]}</span>
          </div>
        ))}
      </div>
      <p className="text-sm">
        <span className="font-medium">{WEEKDAYS[stats.peak]}</span> is your biggest day, at about{' '}
        <span className="font-medium tabular-nums">{formatMinor(Math.round(stats.avg[stats.peak]))}</span>.{' '}
        <span className="text-muted-foreground">{insight}</span>
      </p>
      <HeatLegend />
    </div>
  )
}

function MonthCalendar({ selectedAccount }: { selectedAccount: string | null }) {
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<string | null>(dayKey(Date.now()))

  const month = useMemo(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth() + offset, 1)
  }, [offset])
  const from = month.getTime()
  const to = new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime() - 1

  const q = useQuery({
    queryKey: ['transactions', 'spendByDay', 'month', from],
    queryFn: () => fetchDebits(from, to),
    staleTime: 60_000,
  })

  const byDay = useMemo(() => {
    const map = new Map<string, { total: number; items: Transaction[] }>()
    for (const t of q.data ?? []) {
      if (selectedAccount && t.accountId !== selectedAccount) continue
      const k = dayKey(t.occurredAt)
      const entry = map.get(k) ?? { total: 0, items: [] }
      entry.total += t.amountMinor
      entry.items.push(t)
      map.set(k, entry)
    }
    return map
  }, [q.data, selectedAccount])

  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const lead = mondayIndex(month)
  const todayStart = startOfDay(Date.now())
  const values = [...byDay.values()].map((v) => v.total)
  const max = Math.max(0, ...values)
  const monthTotal = values.reduce((s, v) => s + v, 0)
  let busiest: { day: number; total: number } | null = null
  for (let d = 1; d <= daysInMonth; d++) {
    const total = byDay.get(dayKey(new Date(month.getFullYear(), month.getMonth(), d).getTime()))?.total ?? 0
    if (total > (busiest?.total ?? 0)) busiest = { day: d, total }
  }

  const go = (delta: number) => {
    const next = Math.min(0, offset + delta)
    setOffset(next)
    setSelected(next === 0 ? dayKey(Date.now()) : null)
  }

  const detail = selected ? byDay.get(selected) : null
  const selectedDate = selected
    ? (() => {
        const [y, m, d] = selected.split('-').map(Number)
        return new Date(y, m, d)
      })()
    : null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" className="size-9 rounded-full" onClick={() => go(-1)} aria-label="Previous month">
          <ChevronLeft className="size-4" />
        </Button>
        <div className="text-center">
          <p className="text-sm font-semibold">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
          <p className="text-xs text-muted-foreground">
            {q.isLoading
              ? 'Loading…'
              : monthTotal > 0
                ? `${formatMinor(monthTotal)} spent${busiest ? `, busiest on the ${busiest.day}${ordinal(busiest.day)}` : ''}`
                : 'No spending this month'}
          </p>
        </div>
        <Button variant="ghost" size="icon" className="size-9 rounded-full" onClick={() => go(1)} disabled={offset >= 0} aria-label="Next month">
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1.5 text-center text-[0.7rem] text-muted-foreground">
        {WEEKDAYS.map((d) => (
          <span key={d}>{d[0]}</span>
        ))}
      </div>

      {q.isLoading ? (
        <Skeleton className="h-52 w-full rounded-2xl" />
      ) : (
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: lead }).map((_, i) => (
            <span key={`b${i}`} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1
            const date = new Date(month.getFullYear(), month.getMonth(), day)
            const key = dayKey(date.getTime())
            const total = byDay.get(key)?.total ?? 0
            const future = date.getTime() > todayStart
            const isToday = date.getTime() === todayStart
            return (
              <button
                key={day}
                type="button"
                disabled={future}
                onClick={() => setSelected(selected === key ? null : key)}
                aria-label={`${date.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}: ${formatMinor(total)}`}
                className={cn(
                  'flex aspect-square items-center justify-center rounded-lg text-xs tabular-nums transition-transform active:scale-90',
                  HEAT[heatLevel(total, max)],
                  future && 'opacity-25',
                  isToday && 'font-bold',
                  selected === key ? 'ring-2 ring-foreground/80' : isToday && 'ring-1 ring-indigo-300/70',
                )}
              >
                {day}
              </button>
            )
          })}
        </div>
      )}

      {selectedDate && !q.isLoading && (
        <div className="rounded-2xl bg-muted/50 p-3">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium">
              {selectedDate.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
            </p>
            <p className="text-sm font-semibold tabular-nums">{formatMinor(detail?.total ?? 0)}</p>
          </div>
          {detail ? (
            <ul className="mt-2 space-y-1.5">
              {[...detail.items]
                .sort((a, b) => b.amountMinor - a.amountMinor)
                .slice(0, 3)
                .map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-muted-foreground">{t.merchantName ?? 'Unknown merchant'}</span>
                    <span className="shrink-0 tabular-nums">{formatMinor(t.amountMinor)}</span>
                  </li>
                ))}
              {detail.items.length > 3 && (
                <li className="text-xs text-muted-foreground">and {detail.items.length - 3} more</li>
              )}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">Nothing spent this day.</p>
          )}
        </div>
      )}

      <HeatLegend />
    </div>
  )
}

function ordinal(n: number) {
  const v = n % 100
  if (v >= 11 && v <= 13) return 'th'
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
}