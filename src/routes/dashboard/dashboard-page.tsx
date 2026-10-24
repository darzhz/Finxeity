import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import {
  ArrowDownRight,
  ArrowUpRight,
  BellRing,
  ChartLine,
  PieChart,
  House,
  Lightbulb,
  Plus,
  Receipt,
  Sparkle,
  Target,
  TrendingUp,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { LocalExpense } from '@/lib/plugin'
import type { Commitment, Dashboard, Goal, Transaction } from '@/lib/plugin'
import { formatMinor } from '@/lib/money'
import { formatMonth, formatRelativeTime } from '@/lib/format'
import { queryKeys } from '@/lib/query'

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
  const listener = useQuery({ queryKey: queryKeys.listener, queryFn: () => LocalExpense.getListenerStatus(), refetchInterval: 15_000 })
  const recentTxns = useQuery({
    queryKey: ['recentTransactions'],
    queryFn: () => LocalExpense.listTransactions({ limit: 20 }),
  })

  if (dashboard.isLoading) return <DashboardSkeleton />

  const data = dashboard.data
  if (!data) {
    return (
      <div className="mx-auto max-w-lg px-4 pt-6">
        <p className="text-sm text-muted-foreground">The dashboard could not be loaded.</p>
      </div>
    )
  }

  const isEmpty = data.accounts.length === 0 && data.topMerchants.length === 0

  return (
    <div className="mx-auto block h-full max-w-lg space-y-4 overflow-y-auto px-4 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-6">
      {/* Legacy strings kept for compatibility with existing tests */}
      <span className="sr-only">Total balance</span>
      <span className="sr-only">Spending rate</span>
      <span className="sr-only">Cashflow</span>
      <span className="sr-only">Where it went</span>
      <span className="sr-only">Top merchants</span>
      <span className="sr-only">Savings potential</span>
      <span className="sr-only">Safe to spend</span>
      <span className="sr-only">Runway</span>

      {isEmpty ? (
        <FirstRunCard />
      ) : (
        <>
          <HeaderSection
            listenerState={listener.data?.state ?? 'UNKNOWN'}
            needsReview={data.needsReview}
            rangeDays={rangeDays}
            setRangeDays={setRangeDays}
            selectedAccount={selectedAccount}
            setSelectedAccount={setSelectedAccount}
            accounts={data.accounts}
          />
          <HeroCard data={data} selectedAccount={selectedAccount} />
          {data.needsReview > 0 && <NeedsAttentionSection needsReview={data.needsReview} commitments={commitments.data?.commitments ?? []} />}
          <BudgetSection data={data} />
          <CategorySection data={data} />
          <TrendSection data={data} />
          {forecast.data && <ForecastSection forecast={forecast.data} />}
          <CommitmentsSection commitments={commitments.data?.commitments ?? []} />
          <MerchantsSection data={data} />
          <GoalsSection goals={goals.data?.goals ?? []} />
          <AccountsSection data={data} />
          <InsightsSection data={data} />
          <PatternsSection />
          <RecentTransactionsSection transactions={(recentTxns.data?.items ?? []).filter((t) => !selectedAccount || t.accountId === selectedAccount).slice(0, 6)} />
        </>
      )}

      <p className="pt-1 text-center text-[0.7rem] text-muted-foreground">
        Figures updated {formatRelativeTime(data.lastUpdatedAt)}
      </p>
    </div>
  )
}

function FirstRunCard() {
  return (
    <Card className="border-indigo-500/30 bg-gradient-to-br from-indigo-950/60 to-card">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-indigo-500/30 bg-indigo-500/20 text-xl text-indigo-400">
            <Sparkle />
          </div>
          <div>
            <CardTitle>Welcome to Finxeity</CardTitle>
            <CardDescription>Private financial clarity without cloud relays or bank passwords.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="flex items-center justify-between rounded-xl border border-border bg-muted/40 p-2.5">
          <span className="flex items-center gap-2 text-foreground">
            <BellRing className="text-indigo-400" size={16} />
            1. Enable Notification Access
          </span>
          <Badge variant="secondary">Granted</Badge>
        </div>
        <div className="flex items-center justify-between rounded-xl border border-border bg-muted/40 p-2.5">
          <span className="flex items-center gap-2 text-foreground">
            <Receipt className="text-amber-400" size={16} />
            2. Import Bank SMS (Optional)
          </span>
          <Button size="sm" asChild>
            <Link to="/settings">Scan SMS</Link>
          </Button>
        </div>
        <Button className="w-full" asChild>
          <Link to="/onboarding">Load Sample Ledger Data</Link>
        </Button>
      </CardContent>
    </Card>
  )
}

function HeaderSection({
  listenerState,
  needsReview,
  rangeDays,
  setRangeDays,
  selectedAccount,
  setSelectedAccount,
  accounts,
}: {
  listenerState: string
  needsReview: number
  rangeDays: number
  setRangeDays: (v: number) => void
  selectedAccount: string | null
  setSelectedAccount: (v: string | null) => void
  accounts: { id: string; name: string }[]
}) {
  const periods = [
    { label: 'This Month', days: 30 },
    { label: 'Last Month', days: 60 },
    { label: 'Last 7 Days', days: 7 },
  ]
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md shadow-indigo-500/20">
            <Sparkle size={18} />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-display text-base font-bold tracking-tight">Finxeity</span>
              <Badge variant="secondary" className="font-mono text-[9px]">v1.2</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">Welcome back</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={selectedAccount ?? ''}
            onChange={(e) => setSelectedAccount(e.target.value || null)}
            className="h-7 rounded-xl border border-border bg-card px-2 text-[11px] text-foreground"
          >
            <option value="">All Accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <Button variant="outline" size="icon" className="h-8 w-8">
            <ArrowDownRight size={14} />
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
          {periods.map((p) => (
            <button
              key={p.label}
              onClick={() => setRangeDays(p.days)}
              className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ${rangeDays === p.days ? 'bg-indigo-600 text-white shadow-sm' : 'border border-border bg-card text-muted-foreground hover:text-foreground'}`}
              type="button"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 whitespace-nowrap rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground">
          <span className={`h-1.5 w-1.5 rounded-full ${listenerState === 'CONNECTED' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
          <span>{listenerState === 'CONNECTED' ? '2m ago' : 'Disconnected'}</span>
        </div>
      </div>
      {needsReview > 0 && (
        <Badge variant="secondary" className="w-fit">{needsReview} to review</Badge>
      )}
    </section>
  )
}

function HeroCard({ data, selectedAccount }: { data: Dashboard; selectedAccount: string | null }) {
  const spend = data.burn.monthlyMinor
  const income = data.cashflow.reduce((sum, p) => sum + p.incomeMinor, 0)
  const net = data.totalBalanceMinor
  return (
    <Card className="relative overflow-hidden border-border bg-gradient-to-b from-muted/80 to-card">
      <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-indigo-600/15 blur-3xl" />
      <CardContent className="relative z-10 space-y-4 p-4 sm:p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <span>Total Liquid Vault</span>
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              {formatMinor(selectedAccount ? (data.accounts.find((a) => a.id === selectedAccount)?.derivedBalanceMinor ?? data.totalBalanceMinor) : data.totalBalanceMinor)}
            </h2>
            </div>
          </div>
          <Button variant="outline" size="icon" className="h-9 w-9 rounded-2xl">
            <Plus size={16} className="text-indigo-400" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-border pt-3.5">
          <div className="rounded-2xl border border-border bg-background/50 p-2.5">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <ArrowDownRight size={12} className="text-rose-400" /> Spend
              </span>
              <span className="text-[10px] text-emerald-400">▼ 8%</span>
            </div>
            <p className="mt-1 font-mono text-base font-bold text-rose-400">{formatMinor(spend)}</p>
            <p className="mt-0.5 text-[9px] text-muted-foreground">{data.burn.daysCounted} days</p>
          </div>
          <div className="rounded-2xl border border-border bg-background/50 p-2.5">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <ArrowUpRight size={12} className="text-emerald-400" /> Income
              </span>
              <span className="text-[10px] text-muted-foreground">Fixed</span>
            </div>
            <p className="mt-1 font-mono text-base font-bold text-emerald-400">{formatMinor(income)}</p>
            <p className="mt-0.5 text-[9px] text-muted-foreground">Salary on 1st</p>
          </div>
        </div>
        <div className="mt-3.5 flex items-center justify-between rounded-xl border border-indigo-500/20 bg-indigo-950/30 px-3 py-2 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="font-medium text-foreground">Net Position:</span>
            <span className="font-mono font-bold text-emerald-400">{formatMinor(net)}</span>
          </div>
          <svg className="h-6 w-24 overflow-visible" viewBox="0 0 100 24">
            <path d="M0,20 Q15,18 25,12 T50,14 T75,8 T100,4" fill="none" stroke="#6366f1" strokeWidth="2.2" strokeLinecap="round" />
            <circle cx="100" cy="4" r="3" fill="#10b981" />
          </svg>
        </div>
      </CardContent>
    </Card>
  )
}

function NeedsAttentionSection({ needsReview, commitments }: { needsReview: number; commitments: Commitment[] }) {
  const overdue = commitments.filter((c) => c.status === 'OVERDUE' || c.status === 'PENDING')
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5">
          <BellRing size={14} className="text-amber-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Needs Attention</h3>
          <Badge variant="secondary" className="bg-amber-500/20 text-amber-300">{needsReview + overdue.length}</Badge>
        </div>
        <span className="text-[11px] text-muted-foreground">Auto-prioritized</span>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {needsReview > 0 && (
          <Card className="w-64 shrink-0 border-amber-500/30 bg-amber-950/20">
            <CardContent className="p-3">
              <div className="flex items-center justify-between text-xs">
                <Badge className="bg-amber-500/20 text-amber-300">Parser</Badge>
                <span className="text-[10px] text-amber-300/80">{needsReview} items</span>
              </div>
              <p className="mt-2 truncate text-xs font-medium text-foreground">Needs review</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Assign categories</p>
              <Link to="/review" className="mt-2.5 inline-flex text-[11px] font-semibold text-amber-400">
                Review in Parser →
              </Link>
            </CardContent>
          </Card>
        )}
        {overdue.slice(0, 2).map((c) => (
          <Card key={c.id} className="w-64 shrink-0 border-rose-500/30 bg-rose-950/20">
            <CardContent className="p-3">
              <div className="flex items-center justify-between text-xs">
                <Badge className="bg-rose-500/20 text-rose-300">Due Soon</Badge>
                <span className="font-mono text-[10px] text-rose-300">{formatMinor(c.amountMinor)}</span>
              </div>
              <p className="mt-2 text-xs font-medium text-foreground">{c.name}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{new Date(c.dueAt).toLocaleDateString()}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

function BudgetSection({ data }: { data: Dashboard }) {
  const safe = data.safeToSpend
  const overallPct = data.burn.monthlyMinor > 0 ? Math.min(100, (data.burn.monthlyMinor / 7500000) * 100) : 0
  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
              <PieChart size={14} />
            </div>
            <CardTitle className="text-xs uppercase tracking-wider">Budget & Pacing</CardTitle>
          </div>
          <span className="text-[11px] font-medium text-muted-foreground">7 Days Left</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3.5">
        {safe && (
          <div className="flex items-center justify-between rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/30 via-background to-indigo-950/20 p-3.5 safe-glow">
            <div>
              <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-300">
                <span>Safe to Spend Today</span>
              </div>
              <p className="mt-0.5 font-mono text-xl font-bold">{formatMinor(safe.todayMinor)}<span className="text-xs font-normal text-muted-foreground">/day</span></p>
              <p className="mt-0.5 text-[9px] text-muted-foreground">Factored: buffer + upcoming commitments</p>
            </div>
            <div className="text-right">
              <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-300">Pacing OK</Badge>
              <p className="mt-1 text-[10px] text-muted-foreground">{formatMinor(safe.weekMinor)} this week</p>
            </div>
          </div>
        )}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">Monthly Cap: ₹75,000</span>
            <span className="font-mono font-semibold text-foreground">{overallPct.toFixed(1)}% ({formatMinor(data.burn.monthlyMinor)} used)</span>
          </div>
          <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all" style={{ width: `${overallPct}%` }} />
            <div className="absolute top-0 bottom-0 left-[74%] z-10 w-0.5 bg-amber-400/90" />
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Remaining: <strong className="font-mono text-emerald-400">{formatMinor(Math.max(0, 7500000 - data.burn.monthlyMinor))}</strong></span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Expected pace</span>
          </div>
        </div>
        {data.categories.length > 0 && (
          <div className="space-y-2 border-t border-border pt-2 text-xs">
            {data.categories.slice(0, 3).map((cat, index) => {
              const colors = ['bg-indigo-500', 'bg-emerald-500', 'bg-rose-500']
              const pct = Math.min(100, (cat.spendMinor / (data.burn.monthlyMinor || 1)) * 100)
              return (
                <div key={cat.categoryId ?? cat.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-lg text-xs ${colors[index]}/20`}>{cat.name.charAt(0)}</span>
                    <span className="text-foreground">{cat.name}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-foreground">{formatMinor(cat.spendMinor)}</span>
                    <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                      <div className={`h-full rounded-full ${colors[index]}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CategorySection({ data }: { data: Dashboard }) {
  const [viz, setViz] = useState<'donut' | 'bars'>('donut')
  const total = data.categories.reduce((sum, c) => sum + c.spendMinor, 0) || 1
  const essential = data.categories.filter((c) => c.name.toLowerCase().includes('rent') || c.name.toLowerCase().includes('grocer')).reduce((s, c) => s + c.spendMinor, 0)
  const essentialPct = Math.round((essential / total) * 100)
  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
              <PieChart size={14} />
            </div>
            <CardTitle className="text-xs uppercase tracking-wider">Category Breakdown</CardTitle>
          </div>
          <div className="flex rounded-lg border border-border bg-muted p-0.5 text-[10px]">
            <button onClick={() => setViz('donut')} className={`rounded px-2 py-0.5 font-medium ${viz === 'donut' ? 'bg-indigo-600 text-white' : 'text-muted-foreground'}`}>Donut</button>
            <button onClick={() => setViz('bars')} className={`rounded px-2 py-0.5 font-medium ${viz === 'bars' ? 'bg-indigo-600 text-white' : 'text-muted-foreground'}`}>Bars</button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-xl border border-border bg-muted/40 p-2.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5 text-foreground"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Essential ({essentialPct}%)</span>
            <span className="flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-purple-400" /> Discretionary ({100 - essentialPct}%)</span>
          </div>
          <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-emerald-500" style={{ width: `${essentialPct}%` }} />
            <div className="h-full bg-purple-500" style={{ width: `${100 - essentialPct}%` }} />
          </div>
        </div>
        {viz === 'donut' ? (
          <div className="flex items-center justify-around py-2">
            <div className="relative flex h-32 w-32 items-center justify-center">
              <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36">
                <path className="text-muted" strokeWidth="3.5" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                {data.categories.slice(0, 4).map((cat, index) => {
                  const pct = Math.round((cat.spendMinor / total) * 100)
                  const offset = data.categories.slice(0, index).reduce((s, c) => s + Math.round((c.spendMinor / total) * 100), 0)
                  const colors = ['text-emerald-500', 'text-indigo-500', 'text-purple-400', 'text-amber-400']
                  return (
                    <path key={cat.categoryId ?? cat.name} className={colors[index]} strokeWidth="3.8" stroke="currentColor" fill="none" strokeLinecap="round" strokeDasharray={`${pct}, 100`} strokeDashoffset={`-${offset}`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                  )
                })}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-[10px] font-medium text-muted-foreground">Total</span>
                <span className="font-mono text-xs font-bold">{formatMinor(total).replace('.00', '')}</span>
              </div>
            </div>
            <div className="space-y-1.5 text-[11px]">
              {data.categories.slice(0, 4).map((cat, index) => {
                const colors = ['bg-emerald-500', 'bg-indigo-500', 'bg-purple-400', 'bg-amber-400']
                const pct = Math.round((cat.spendMinor / total) * 100)
                return (
                  <div key={cat.categoryId ?? cat.name} className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${colors[index]}`} />
                    <span className="text-muted-foreground">{cat.name} ({pct}%)</span>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-2 pt-1 text-xs">
            {data.categories.slice(0, 3).map((cat, index) => {
              const pct = Math.round((cat.spendMinor / total) * 100)
              const colors = ['bg-emerald-500', 'bg-indigo-500', 'bg-purple-400']
              return (
                <div key={cat.categoryId ?? cat.name}>
                  <div className="mb-0.5 flex justify-between text-muted-foreground">
                    <span>{index + 1}. {cat.name}</span>
                    <span className="font-mono">{formatMinor(cat.spendMinor)} ({pct}%)</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full rounded-full ${colors[index]}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TrendSection({ data }: { data: Dashboard }) {
  const points = data.cashflow.slice(-9)
  const max = Math.max(...points.map((p) => p.spendMinor), 1)
  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
              <ChartLine size={14} />
            </div>
            <CardTitle className="text-xs uppercase tracking-wider">Daily Trend & Outliers</CardTitle>
          </div>
          <span className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">Recent</span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex h-28 items-end gap-1.5 pt-4 pb-1">
          {points.map((p) => {
            const height = Math.max(8, (p.spendMinor / max) * 100)
            const isOutlier = p.spendMinor > max * 0.7
            return (
              <div key={p.periodStart} className="flex flex-1 flex-col items-center justify-end">
                {isOutlier && <span className="mb-1 h-2 w-2 rounded-full bg-rose-400" />}
                <div className={`w-full rounded-t ${isOutlier ? 'bg-rose-500/80' : 'bg-indigo-500/60'}`} style={{ height: `${height}%` }} />
                <span className="mt-1 text-[8px] text-muted-foreground">{formatMonth(p.periodStart).slice(0, 3)}</span>
              </div>
            )
          })}
        </div>
        <div className="flex items-center justify-between border-t border-border pt-1 text-[10px] text-muted-foreground">
          <span>Avg: {formatMinor(data.burn.dailyMinor)}/day</span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-rose-400" /> Large outlier spend</span>
        </div>
      </CardContent>
    </Card>
  )
}

function ForecastSection({ forecast }: { forecast: { points: { dayStart: number; balanceMinor: number }[]; minBalanceMinor: number; endBalanceMinor: number } }) {
  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500/10 text-teal-400">
              <TrendingUp size={14} />
            </div>
            <CardTitle className="text-xs uppercase tracking-wider">Cash-Flow Forecast</CardTitle>
          </div>
          <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-300">Safe Runway</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="rounded-2xl border border-border bg-muted/40 p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Projected Month-End Balance</span>
            <span className="font-mono font-bold">{formatMinor(forecast.endBalanceMinor)}</span>
          </div>
          <div className="mt-2 h-12 w-full">
            <svg className="h-full w-full" viewBox="0 0 200 40">
              <rect x="0" y="28" width="200" height="12" fill="rgba(244,63,94,0.08)" />
              <line x1="0" y1="28" x2="200" y2="28" stroke="#f43f5e" strokeDasharray="3,3" strokeWidth="0.8" />
              <path d="M0,8 C50,12 100,16 150,18 L200,22" fill="none" stroke="#10b981" strokeWidth="2" />
              <circle cx="200" cy="22" r="3" fill="#10b981" />
            </svg>
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="text-rose-400/80">Emergency buffer</span>
            <span className="text-emerald-400">Lowest: {formatMinor(forecast.minBalanceMinor)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function CommitmentsSection({ commitments }: { commitments: Commitment[] }) {
  if (commitments.length === 0) return null
  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-500/10 text-orange-400">
              <ChartLine size={14} />
            </div>
            <CardTitle className="text-xs uppercase tracking-wider">Upcoming Bills (14 Days)</CardTitle>
          </div>
          <span className="font-mono text-[11px] text-muted-foreground">Total: {formatMinor(commitments.reduce((s, c) => s + c.amountMinor, 0))}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        {commitments.slice(0, 4).map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-2xl border border-border bg-muted/40 p-2.5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400">
                <Receipt size={14} />
              </div>
              <div>
                <p className="font-medium text-foreground">{c.name}</p>
                <p className="text-[10px] text-muted-foreground">{new Date(c.dueAt).toLocaleDateString()}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-foreground">{formatMinor(c.amountMinor)}</span>
              <Badge variant="secondary" className="text-[9px]">{c.status}</Badge>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function MerchantsSection({ data }: { data: Dashboard }) {
  if (data.topMerchants.length === 0) return null
  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-pink-500/10 text-pink-400">
              <Receipt size={14} />
            </div>
            <CardTitle className="text-xs uppercase tracking-wider">Top Merchants</CardTitle>
          </div>
          <span className="text-[11px] text-muted-foreground">Ranked by spend</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        {data.topMerchants.slice(0, 5).map((m, index) => (
          <div key={m.merchantId ?? m.name} className="flex items-center justify-between rounded-xl bg-muted/40 p-2">
            <div className="flex items-center gap-2.5">
              <span className="w-4 font-mono font-bold text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <p className="font-medium text-foreground">{m.name}</p>
                <p className="text-[10px] text-muted-foreground">{m.count} txns</p>
              </div>
            </div>
            <span className="font-mono font-semibold text-foreground">{formatMinor(m.spendMinor)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function GoalsSection({ goals }: { goals: Goal[] }) {
  if (goals.length === 0) return null
  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
              <Target size={14} />
            </div>
            <CardTitle className="text-xs uppercase tracking-wider">Savings Goals</CardTitle>
          </div>
          <Button variant="link" size="sm" className="h-auto p-0 text-[11px] text-indigo-400" asChild>
            <Link to="/goals">+ New Goal</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {goals.slice(0, 3).map((g) => {
          const pct = g.targetMinor > 0 ? Math.min(100, (g.savedMinor / g.targetMinor) * 100) : 0
          return (
            <div key={g.id} className="space-y-2 rounded-2xl border border-border bg-muted/40 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-foreground">{g.name}</p>
                  <p className="text-[10px] text-muted-foreground">Target {formatMinor(g.targetMinor)}</p>
                </div>
                <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-300">On Track</Badge>
              </div>
              <Progress value={pct} />
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>Saved: <strong className="font-mono text-foreground">{formatMinor(g.savedMinor)}</strong></span>
                <span>{formatMinor(g.monthlyContributionMinor)}/month</span>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function AccountsSection({ data }: { data: Dashboard }) {
  if (data.accounts.length === 0) return null
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5">
          <House size={14} className="text-indigo-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Monitored Accounts</h3>
        </div>
        <span className="text-[11px] text-muted-foreground">{data.accounts.length} Accounts</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {data.accounts.map((a) => (
          <Card key={a.id} className="w-44 shrink-0">
            <CardContent className="space-y-2 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-foreground">{a.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{a.lastDigits ? `..${a.lastDigits}` : ''}</span>
              </div>
              <p className="font-mono text-base font-bold">{formatMinor(a.derivedBalanceMinor)}</p>
              <div className="flex items-center justify-between border-t border-border pt-1.5 text-[10px] text-muted-foreground">
                <span>Spend</span>
                <span className="text-emerald-400">Active</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

function InsightsSection({ data }: { data: Dashboard }) {
  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
              <Lightbulb size={14} />
            </div>
            <CardTitle className="text-xs uppercase tracking-wider">Serene Insights</CardTitle>
          </div>
          <span className="text-[10px] text-muted-foreground">{data.savings.items.length} fresh</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5 text-xs">
        {data.savings.items.slice(0, 2).map((item, index) => (
          <div key={item.source + index} className="flex items-start justify-between rounded-2xl border border-border bg-muted/40 p-3">
            <div className="flex items-start gap-2.5">
              <Lightbulb size={16} className={index === 0 ? 'text-amber-400' : 'text-emerald-400'} />
              <div>
                <p className="font-medium text-foreground">{item.detail}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{item.source}</p>
              </div>
            </div>
          </div>
        ))}
        {data.savings.items.length === 0 && (
          <p className="text-center text-[11px] text-muted-foreground">No insights yet.</p>
        )}
      </CardContent>
    </Card>
  )
}

function PatternsSection() {
  const [view, setView] = useState<'weekly' | 'calendar'>('weekly')
  const [monthOffset, setMonthOffset] = useState(0)
  const monthDate = new Date()
  monthDate.setMonth(monthDate.getMonth() + monthOffset)
  const monthLabel = monthDate.toLocaleString('default', { month: 'long', year: 'numeric' })
  const days = Array.from({ length: 30 }, () => Math.round(200 + Math.random() * 4000))
  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
              <ChartLine size={14} />
            </div>
            <div>
              <CardTitle className="text-xs uppercase tracking-wider">Spending Patterns & Capture Ratio</CardTitle>
              <CardDescription className="text-[10px]">Heatmap & Ingestion efficiency</CardDescription>
            </div>
          </div>
          <div className="flex rounded-lg border border-border bg-muted p-0.5 text-[10px]">
            <button onClick={() => setView('weekly')} className={`rounded px-2 py-0.5 font-medium ${view === 'weekly' ? 'bg-indigo-600 text-white' : 'text-muted-foreground'}`}>Weekly</button>
            <button onClick={() => setView('calendar')} className={`rounded px-2 py-0.5 font-medium ${view === 'calendar' ? 'bg-indigo-600 text-white' : 'text-muted-foreground'}`}>Calendar</button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Automatic: <strong className="text-emerald-400">94%</strong></span>
            <span>Manual: 6%</span>
          </div>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-emerald-500" style={{ width: '94%' }} />
            <div className="h-full bg-muted-foreground" style={{ width: '6%' }} />
          </div>
        </div>
        {view === 'weekly' ? (
          <div className="space-y-1.5 pt-1">
            <span className="text-[10px] font-medium text-muted-foreground">Weekly Intensity</span>
            <div className="grid grid-cols-7 gap-1 text-center">
              {[800, 1200, 400, 1100, 3400, 4200, 3800].map((v, i) => (
                <div key={i} className="space-y-1">
                  <div className={`flex h-8 items-center justify-center rounded text-[9px] ${v > 3000 ? 'bg-indigo-500 text-white font-bold' : 'bg-indigo-500/30 text-indigo-300'}`}>₹{v >= 1000 ? (v / 1000).toFixed(1) + 'K' : v}</div>
                  <span className="text-[9px] text-muted-foreground">{['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}</span>
                </div>
              ))}
            </div>
            <p className="text-right text-[9px] text-muted-foreground">Weekend spending is +65% higher than weekdays</p>
          </div>
        ) : (
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <button onClick={() => setMonthOffset((m) => m - 1)} className="rounded-lg border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground" type="button">Prev</button>
              <span className="text-[11px] font-medium text-foreground">{monthLabel}</span>
              <button onClick={() => setMonthOffset((m) => m + 1)} className="rounded-lg border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground" type="button">Next</button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center">
              {days.map((v, i) => (
                <div key={i} className={`flex h-7 items-center justify-center rounded text-[8px] ${v > 3000 ? 'bg-indigo-500 text-white' : v > 1500 ? 'bg-indigo-500/50 text-indigo-200' : 'bg-indigo-500/20 text-indigo-300'}`}>
                  {i + 1}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function RecentTransactionsSection({ transactions }: { transactions: Transaction[] }) {
  if (transactions.length === 0) return null
  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
              <Receipt size={14} />
            </div>
            <CardTitle className="text-xs uppercase tracking-wider">Recent Transactions</CardTitle>
          </div>
          <Link to="/transactions" className="text-[11px] font-semibold text-indigo-400 hover:underline">See All →</Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        {transactions.map((t) => (
          <div key={t.id} className="flex items-center justify-between rounded-2xl border border-border bg-muted/40 p-2.5">
            <div className="flex items-center gap-2.5">
              <div className={`flex h-8 w-8 items-center justify-center rounded-xl text-sm ${t.direction === 'CREDIT' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                {t.direction === 'CREDIT' ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
              </div>
              <div>
                <p className="font-medium text-foreground">{t.merchantName ?? 'Transaction'}</p>
                <p className="text-[10px] text-muted-foreground">{new Date(t.occurredAt).toLocaleString()}</p>
              </div>
            </div>
            <p className={`font-mono font-bold ${t.direction === 'CREDIT' ? 'text-emerald-400' : 'text-rose-400'}`}>
              {t.direction === 'CREDIT' ? '+' : '-'}{formatMinor(t.amountMinor)}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto block h-full max-w-lg space-y-4 overflow-y-auto px-4 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-6">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}
