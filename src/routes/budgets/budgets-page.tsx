import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Gauge, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { LocalExpense } from '@/lib/plugin'
import type { Budget, Transaction } from '@/lib/plugin'
import { formatMinor, parseMajorToMinor } from '@/lib/money'
import type { TransactionFilters } from '@/lib/query'
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
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'

/* ────────────────────────────── helpers ────────────────────────────── */

type BudgetInput = Parameters<typeof LocalExpense.upsertBudget>[0]
type Category = { id: string; name: string }
type Status = 'ok' | 'risk' | 'over'

const DAY = 24 * 60 * 60 * 1000
const DEBITS: TransactionFilters = { status: 'ACTIVE', direction: 'DEBIT', categoryId: null }
const currencySymbol = formatMinor(0).replace(/[\d.,\s-]/g, '') || '₹'

const CATEGORY_EMOJI: [string[], string][] = [
  [['food', 'dining'], '🍽️'],
  [['grocer'], '🛒'],
  [['transport', 'commute'], '🚗'],
  [['bill', 'util'], '💡'],
  [['shop'], '🛍️'],
  [['health'], '💊'],
  [['entertain', 'leisure'], '🍿'],
  [['fee'], '💳'],
]
const emojiFor = (name: string) => {
  const n = name.toLowerCase()
  return CATEGORY_EMOJI.find(([keys]) => keys.some((k) => n.includes(k)))?.[1] ?? '📁'
}

const STATUS_STYLE: Record<Status, { bar: string; chip: string; label: string }> = {
  ok: { bar: 'bg-emerald-400', chip: 'bg-emerald-500/15 text-emerald-300', label: 'On track' },
  risk: { bar: 'bg-amber-400', chip: 'bg-amber-500/15 text-amber-300', label: 'Heading over' },
  over: { bar: 'bg-rose-400', chip: 'bg-rose-500/15 text-rose-300', label: 'Over limit' },
}

/** Round a suggestion to something a human would type. */
function niceRound(minor: number) {
  const major = minor / 100
  const step = major >= 10000 ? 1000 : major >= 1000 ? 500 : major >= 100 ? 50 : 10
  return Math.max(step, Math.round(major / step) * step) * 100
}

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

async function fetchDebits(from: number, to: number): Promise<Transaction[]> {
  const out: Transaction[] = []
  let cursor: { occurredAt: number; id: string } | null = null
  for (let i = 0; i < 40; i++) {
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

/** Month and week windows, plus how far through each we are. */
function useWindows() {
  return useMemo(() => {
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth()
    const monthStart = new Date(y, m, 1).getTime()
    const monthEnd = new Date(y, m + 1, 1).getTime()
    const prevMonthStart = new Date(y, m - 1, 1).getTime()
    const dow = (now.getDay() + 6) % 7
    const weekStart = new Date(y, now.getMonth(), now.getDate() - dow).getTime()
    const t = now.getTime()
    return {
      prevMonthStart,
      monthStart,
      weekStart,
      month: { fraction: (t - monthStart) / (monthEnd - monthStart), daysLeft: Math.max(1, Math.ceil((monthEnd - t) / DAY)), day: now.getDate(), days: new Date(y, m + 1, 0).getDate(), noun: 'month' },
      week: { fraction: (t - weekStart) / (7 * DAY), daysLeft: Math.max(1, 7 - dow), day: dow + 1, days: 7, noun: 'week' },
    }
  }, [])
}

type Spend = { total: number; byCat: Map<string, number> }
const emptySpend = (): Spend => ({ total: 0, byCat: new Map() })
const add = (s: Spend, t: Transaction) => {
  s.total += t.amountMinor
  if (t.categoryId) s.byCat.set(t.categoryId, (s.byCat.get(t.categoryId) ?? 0) + t.amountMinor)
}
const spentIn = (s: Spend, categoryId: string | null) => (categoryId == null ? s.total : (s.byCat.get(categoryId) ?? 0))

/* ───────────────────────────── page ───────────────────────────── */

export function BudgetsPage() {
  const client = useQueryClient()
  const w = useWindows()
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => LocalExpense.listCategories() })
  const budgetsQ = useQuery({ queryKey: ['budgets'], queryFn: () => LocalExpense.listBudgets() })
  const spendQ = useQuery({
    queryKey: ['transactions', 'spendByCategory', w.prevMonthStart],
    queryFn: () => fetchDebits(w.prevMonthStart, Date.now()),
    staleTime: 60_000,
  })

  const [drawer, setDrawer] = useState<{ budget: Budget | null; categoryId?: string | null; amountMinor?: number } | null>(null)

  const categoryList: Category[] = useMemo(() => categories.data?.categories ?? [], [categories.data])
  const nameOf = (id: string | null) => (id == null ? 'All spending' : (categoryList.find((c) => c.id === id)?.name ?? 'Category'))
  const budgets: Budget[] = useMemo(() => budgetsQ.data?.budgets ?? [], [budgetsQ.data])

  const { month, last, week } = useMemo(() => {
    const month = emptySpend()
    const last = emptySpend()
    const week = emptySpend()
    for (const t of spendQ.data ?? []) {
      if (t.occurredAt >= w.monthStart) add(month, t)
      else add(last, t)
      if (t.occurredAt >= w.weekStart) add(week, t)
    }
    return { month, last, week }
  }, [spendQ.data, w.monthStart, w.weekStart])

  const rows = useMemo(() => {
    return budgets
      .map((b) => {
        const weekly = b.period.toUpperCase() === 'WEEKLY'
        const win = weekly ? w.week : w.month
        const spent = spentIn(weekly ? week : month, b.categoryId)
        const pct = b.limitMinor > 0 ? spent / b.limitMinor : 0
        const projected = win.fraction > 0.08 ? spent / win.fraction : null
        const status: Status = spent > b.limitMinor ? 'over' : projected != null && projected > b.limitMinor ? 'risk' : 'ok'
        const remaining = b.limitMinor - spent
        return { budget: b, win, spent, pct, status, remaining, perDay: remaining > 0 ? Math.round(remaining / win.daysLeft) : 0 }
      })
      .sort((a, b) => b.pct - a.pct)
  }, [budgets, month, week, w.month, w.week])

  const upsert = useMutation({
    mutationFn: (input: BudgetInput) => LocalExpense.upsertBudget(input),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['budgets'] }),
  })

  const remove = useMutation({
    mutationFn: (b: Budget) => LocalExpense.deleteBudget({ id: b.id }),
    onSuccess: (_r, b) => {
      void client.invalidateQueries({ queryKey: ['budgets'] })
      toast('Limit removed', {
        action: {
          label: 'Undo',
          onClick: () => upsert.mutate({ categoryId: b.categoryId, period: b.period, limitMinor: b.limitMinor } as BudgetInput),
        },
      })
    },
    onError: () => toast.error('Could not remove the limit. Try again.'),
  })

  const save = (input: BudgetInput, message: string, done: () => void) =>
    upsert.mutate(input, {
      onSuccess: () => {
        toast.success(message)
        done()
      },
      onError: () => toast.error('Could not save the limit. Try again.'),
    })

  // ideas: biggest categories last month that have no limit yet
  const ideas = useMemo(() => {
    const covered = new Set(budgets.map((b) => b.categoryId))
    return [...last.byCat.entries()]
      .filter(([id]) => !covered.has(id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, spent]) => ({ id, spent }))
  }, [last, budgets])

  const loading = budgetsQ.isLoading || spendQ.isLoading

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-lg">
        <header className="sticky top-0 z-20 flex items-center justify-between bg-background/85 px-4 pb-3 pt-[calc(1rem+env(safe-area-inset-top))] backdrop-blur-xl">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Spending limits</h1>
            <p className="text-sm text-muted-foreground">Cap a category and watch your pace.</p>
          </div>
          <Button size="icon" className="size-11 rounded-full" onClick={() => setDrawer({ budget: null })} aria-label="Add limit">
            <Plus className="size-5" />
          </Button>
        </header>

        <div className="space-y-6 px-4 pb-10 pt-2">
          {loading && (
            <>
              <Skeleton className="h-48 w-full rounded-3xl" />
              <Skeleton className="h-28 w-full rounded-3xl" />
              <Skeleton className="h-28 w-full rounded-3xl" />
            </>
          )}

          {!loading && budgets.length === 0 && (
            <EmptyState
              ideas={ideas.map((i) => ({ ...i, name: nameOf(i.id) }))}
              onPick={(id, spent) => setDrawer({ budget: null, categoryId: id, amountMinor: niceRound(spent) })}
              onAll={() => setDrawer({ budget: null, categoryId: null })}
            />
          )}

          {!loading && rows.length > 0 && <Overview rows={rows} month={w.month} />}

          {!loading && rows.length > 0 && (
            <section className="space-y-3">
              <h2 className="px-1 text-base font-semibold">Your limits</h2>
              {rows.map((r) => (
                <BudgetCard key={r.budget.id} row={r} name={nameOf(r.budget.categoryId)} onOpen={() => setDrawer({ budget: r.budget })} />
              ))}
            </section>
          )}

          {!loading && budgets.length > 0 && ideas.length > 0 && (
            <section className="space-y-3">
              <h2 className="px-1 text-base font-semibold">Worth a limit?</h2>
              <ul className="divide-y divide-border/60 overflow-hidden rounded-3xl border border-border bg-card">
                {ideas.map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      onClick={() => setDrawer({ budget: null, categoryId: i.id, amountMinor: niceRound(i.spent) })}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-muted/60"
                    >
                      <span className="flex size-10 items-center justify-center rounded-2xl bg-muted text-lg">{emojiFor(nameOf(i.id))}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{nameOf(i.id)}</span>
                        <span className="block text-xs text-muted-foreground">You spent {formatMinor(i.spent)} here last month</span>
                      </span>
                      <span className="text-xs font-medium text-indigo-300">Set limit</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <BudgetDrawer
        state={drawer}
        categories={categoryList}
        budgets={budgets}
        lastSpend={last}
        pending={upsert.isPending || remove.isPending}
        onClose={() => setDrawer(null)}
        onSave={save}
        onRemove={(b) => remove.mutate(b, { onSuccess: () => setDrawer(null) })}
      />
    </div>
  )
}

type Row = {
  budget: Budget
  win: { fraction: number; daysLeft: number; day: number; days: number; noun: string }
  spent: number
  pct: number
  status: Status
  remaining: number
  perDay: number
}

/* ───────────────────────────── overview ─────────────────────────────
   The showy part: what's left across your limits, and how many are fine. */

function statusCounts(rows: Row[]) {
  const counts: Record<Status, number> = { ok: 0, risk: 0, over: 0 }
  for (const row of rows) counts[row.status]++
  return counts
}

function overviewSummary(rows: Row[]) {
  const monthly = rows.filter((row) => row.budget.period.toUpperCase() !== 'WEEKLY')
  const overall = monthly.find((row) => row.budget.categoryId == null)
  const considered = overall ? [overall] : monthly
  const limit = considered.reduce((sum, row) => sum + row.budget.limitMinor, 0)
  const spent = considered.reduce((sum, row) => sum + row.spent, 0)
  const left = limit - spent
  const counts = statusCounts(rows)
  return {
    monthlyCount: monthly.length,
    overall: overall != null,
    limit,
    spent,
    left,
    counts,
    pct: limit > 0 ? Math.min(1, spent / limit) : 0,
    tone: left < 0 ? 'text-rose-400' : counts.risk > 0 ? 'text-amber-300' : 'text-emerald-400',
  }
}

function StatusChips({ counts }: { counts: Record<Status, number> }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {(['ok', 'risk', 'over'] as Status[]).map(
        (status) =>
          counts[status] > 0 && (
            <span key={status} className={cn('rounded-full px-2.5 py-1 text-xs font-medium', STATUS_STYLE[status].chip)}>
              {counts[status]} {STATUS_STYLE[status].label.toLowerCase()}
            </span>
          ),
      )}
    </div>
  )
}

function Overview({ rows, month }: { rows: Row[]; month: { fraction: number; day: number; days: number } }) {
  const summary = overviewSummary(rows)
  const shown = useCountUp(Math.abs(summary.left))

  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])

  if (summary.monthlyCount === 0) return null

  return (
    <section className="rounded-3xl border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">
        {summary.left < 0 ? 'Over your monthly limits by' : summary.overall ? 'Left of your overall limit' : `Left across ${summary.monthlyCount} ${summary.monthlyCount === 1 ? 'limit' : 'limits'}`}
      </p>
      <p className={cn('font-display mt-1 text-4xl font-bold tracking-tight tabular-nums', summary.tone)}>{formatMinor(shown)}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {formatMinor(summary.spent)} spent of {formatMinor(summary.limit)}, day {month.day} of {month.days}
      </p>

      <div className="relative mt-5 h-3 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-[width] duration-1000 ease-out motion-reduce:transition-none', summary.left < 0 ? 'bg-rose-400' : summary.counts.risk > 0 ? 'bg-amber-400' : 'bg-emerald-400')}
          style={{ width: ready ? `${summary.pct * 100}%` : '0%' }}
        />
        <span className="absolute inset-y-0 w-0.5 bg-foreground/70" style={{ left: `${Math.min(99, month.fraction * 100)}%` }} aria-hidden />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">The line shows how far through the month you are.</p>

      <StatusChips counts={summary.counts} />
    </section>
  )
}

/* ───────────────────────────── card ───────────────────────────── */

function BudgetCard({ row, name, onOpen }: { row: Row; name: string; onOpen: () => void }) {
  const { budget, win, spent, pct, status, remaining, perDay } = row
  const st = STATUS_STYLE[status]
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])

  return (
    <button type="button" onClick={onOpen} className="block w-full rounded-3xl border border-border bg-card p-4 text-left transition-transform active:scale-[0.99]">
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-muted text-xl">{budget.categoryId == null ? '💸' : emojiFor(name)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">
            {formatMinor(spent)} of {formatMinor(budget.limitMinor)} this {win.noun}
          </p>
        </div>
        <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-medium', st.chip)}>{st.label}</span>
      </div>

      <div className="relative mt-4 h-2.5 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none', st.bar)} style={{ width: ready ? `${Math.min(100, pct * 100)}%` : '0%' }} />
        <span className="absolute inset-y-0 w-0.5 bg-foreground/70" style={{ left: `${Math.min(99, win.fraction * 100)}%` }} aria-hidden />
      </div>

      <p className="mt-2.5 text-xs text-muted-foreground">
        {status === 'over'
          ? `${formatMinor(-remaining)} over. Spending here will keep adding to it until the ${win.noun} resets.`
          : `${formatMinor(remaining)} left, about ${formatMinor(perDay)} a day for the next ${win.daysLeft} ${win.daysLeft === 1 ? 'day' : 'days'}.`}
        {status === 'risk' && ' At this pace you will go over.'}
      </p>
    </button>
  )
}

/* ───────────────────────────── empty ───────────────────────────── */

function EmptyState({
  ideas,
  onPick,
  onAll,
}: {
  ideas: { id: string; spent: number; name: string }[]
  onPick: (id: string, spent: number) => void
  onAll: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border px-6 py-12 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-300">
        <Gauge className="size-6" />
      </div>
      <div>
        <p className="font-medium">No limits yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {ideas.length > 0 ? 'Here is where your money went last month. Tap one to cap it.' : 'Set a monthly cap for a category, or for everything.'}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {ideas.map((i) => (
          <button key={i.id} type="button" onClick={() => onPick(i.id, i.spent)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm active:scale-95">
            <span>{emojiFor(i.name)}</span>
            {i.name}
            <span className="text-muted-foreground tabular-nums">{formatMinor(i.spent)}</span>
          </button>
        ))}
        <button type="button" onClick={onAll} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm active:scale-95">
          <span>💸</span>
          All spending
        </button>
      </div>
    </div>
  )
}

/* ───────────────────────────── add / edit drawer ───────────────────────────── */

type BudgetDrawerState = { budget: Budget | null; categoryId?: string | null; amountMinor?: number } | null
type BudgetOption = { id: string | null; name: string }

function budgetOptions(categories: Category[], budgets: Budget[]): BudgetOption[] {
  const taken = new Set(budgets.map((b) => b.categoryId))
  return [
    ...(taken.has(null) ? [] : [{ id: null, name: 'All spending' }]),
    ...categories.filter((c) => !taken.has(c.id)).map((c) => ({ id: c.id, name: c.name })),
  ]
}

function categoryName(categories: Category[], id: string | null) {
  return id == null ? 'All spending' : (categories.find((c) => c.id === id)?.name ?? 'Category')
}

function budgetSuggestions(lastMonth: number) {
  if (lastMonth <= 0) return []
  return [
    { label: 'Same as last month', minor: niceRound(lastMonth) },
    { label: '10% less', minor: niceRound(lastMonth * 0.9) },
    { label: '20% less', minor: niceRound(lastMonth * 0.8) },
  ]
}

function budgetDrawerKey(state: BudgetDrawerState) {
  if (!state) return 'closed'
  if (state.budget) return `edit:${state.budget.id}`
  return `new:${state.categoryId ?? 'auto'}:${state.amountMinor ?? 'none'}`
}

function BudgetCategoryPicker({
  options,
  catId,
  onPick,
}: {
  options: BudgetOption[]
  catId: string | null
  onPick: (id: string | null) => void
}) {
  return (
    <div className="space-y-2">
      <Label>What to cap</Label>
      <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto py-0.5">
        {options.map((option) => (
          <button
            key={option.id ?? 'all'}
            type="button"
            onClick={() => onPick(option.id)}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-sm transition-all active:scale-95',
              catId === option.id ? 'border-indigo-400/70 bg-indigo-500/20 font-medium' : 'border-border bg-card text-muted-foreground',
            )}
          >
            <span>{option.id == null ? '💸' : emojiFor(option.name)}</span>
            {option.name}
          </button>
        ))}
      </div>
    </div>
  )
}

function BudgetLimitField({
  limit,
  onChange,
  lastMonth,
  suggestions,
  catName,
}: {
  limit: string
  onChange: (value: string) => void
  lastMonth: number
  suggestions: { label: string; minor: number }[]
  catName: string
}) {
  return (
    <div className="space-y-2">
      <p className="text-center text-xs text-muted-foreground">Monthly limit</p>
      <div className="flex items-baseline justify-center gap-1.5">
        <span className="text-3xl font-medium text-muted-foreground">{currencySymbol}</span>
        <input
          inputMode="decimal"
          value={limit}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
          placeholder="0"
          aria-label="Monthly limit"
          className="w-52 bg-transparent text-center text-5xl font-semibold tabular-nums outline-none placeholder:text-muted-foreground/40"
        />
      </div>
      {suggestions.length > 0 ? (
        <>
          <p className="text-center text-xs text-muted-foreground">
            You spent {formatMinor(lastMonth)} on {catName.toLowerCase()} last month.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.label}
                type="button"
                onClick={() => onChange((suggestion.minor / 100).toString())}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs active:scale-95"
              >
                <span className="font-medium">{suggestion.label}</span>
                <span className="ml-1.5 tabular-nums text-muted-foreground">{formatMinor(suggestion.minor)}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="text-center text-xs text-muted-foreground">No spending here last month, so there is nothing to base a suggestion on.</p>
      )}
    </div>
  )
}

function budgetDrawerCopy(budget: Budget | null, selectedName: string) {
  if (!budget) {
    return { title: 'New spending limit', description: 'Pick what to cap and how much per month.', save: 'Add limit' }
  }
  return {
    title: `${selectedName} limit`,
    description: 'Change the monthly cap, or remove it.',
    save: 'Save changes',
  }
}

function BudgetDrawerFooter({
  nothingLeft,
  canSave,
  saveLabel,
  pending,
  onSave,
  onClose,
}: {
  nothingLeft: boolean
  canSave: boolean
  saveLabel: string
  pending: boolean
  onSave: () => void
  onClose: () => void
}) {
  return (
    <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
      {!nothingLeft && (
        <Button className="h-12 text-base" disabled={!canSave || pending} onClick={onSave}>
          {pending ? 'Saving…' : saveLabel}
        </Button>
      )}
      <Button variant="ghost" onClick={onClose}>
        {nothingLeft ? 'Close' : 'Cancel'}
      </Button>
    </DrawerFooter>
  )
}

function BudgetDrawerBody({
  state,
  categories,
  budgets,
  lastSpend,
  pending,
  onClose,
  onSave,
  onRemove,
}: {
  state: BudgetDrawerState
  categories: Category[]
  budgets: Budget[]
  lastSpend: Spend
  pending: boolean
  onClose: () => void
  onSave: (input: BudgetInput, message: string, done: () => void) => void
  onRemove: (b: Budget) => void
}) {
  const budget = state?.budget ?? null
  const options = budgetOptions(categories, budgets)
  const [catId, setCatId] = useState<string | null>(() => {
    if (budget) return budget.categoryId
    if (state?.categoryId !== undefined) return state.categoryId
    return options[0]?.id ?? null
  })
  const [limit, setLimit] = useState(() => {
    if (budget) return (budget.limitMinor / 100).toFixed(2)
    return state?.amountMinor ? (state.amountMinor / 100).toString() : ''
  })
  const [confirmRemove, setConfirmRemove] = useState(false)

  const limitMinor = parseMajorToMinor(limit) ?? 0
  const lastMonth = spentIn(lastSpend, catId)
  const suggestions = budgetSuggestions(lastMonth)
  const selectedName = categoryName(categories, catId)
  const copy = budgetDrawerCopy(budget, selectedName)
  const nothingLeft = !budget && options.length === 0

  return (
    <>
      <DrawerHeader className="pb-2">
        <DrawerTitle>{copy.title}</DrawerTitle>
        <DrawerDescription>{copy.description}</DrawerDescription>
      </DrawerHeader>

      <div className="space-y-5 overflow-y-auto px-4 pb-2">
        {nothingLeft ? (
          <p className="rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">Every category already has a limit. Tap one in the list to change it.</p>
        ) : (
          <>
            {!budget && <BudgetCategoryPicker options={options} catId={catId} onPick={setCatId} />}
            <BudgetLimitField
              limit={limit}
              onChange={setLimit}
              lastMonth={lastMonth}
              suggestions={suggestions}
              catName={selectedName}
            />
          </>
        )}

        {budget && (
          <Button
            variant="ghost"
            className={cn('w-full', confirmRemove ? 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/20' : 'text-muted-foreground')}
            disabled={pending}
            onClick={() => (confirmRemove ? onRemove(budget) : setConfirmRemove(true))}
          >
            {confirmRemove ? 'Tap again to remove this limit' : 'Remove limit'}
          </Button>
        )}
      </div>

      <BudgetDrawerFooter
        nothingLeft={nothingLeft}
        canSave={limitMinor > 0}
        saveLabel={copy.save}
        pending={pending}
        onSave={() =>
          onSave(
            { id: budget?.id, categoryId: catId, period: budget?.period ?? 'MONTHLY', limitMinor } as BudgetInput,
            budget ? 'Limit updated' : 'Limit added',
            onClose,
          )
        }
        onClose={onClose}
      />
    </>
  )
}

function BudgetDrawer(props: {
  state: BudgetDrawerState
  categories: Category[]
  budgets: Budget[]
  lastSpend: Spend
  pending: boolean
  onClose: () => void
  onSave: (input: BudgetInput, message: string, done: () => void) => void
  onRemove: (b: Budget) => void
}) {
  return (
    <Drawer open={props.state !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DrawerContent className="max-h-[92dvh]">
        <BudgetDrawerBody key={budgetDrawerKey(props.state)} {...props} />
      </DrawerContent>
    </Drawer>
  )
}
