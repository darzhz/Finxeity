import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { LocalExpense } from '@/lib/plugin'
import type { Commitment } from '@/lib/plugin'
import { formatMinor, parseMajorToMinor } from '@/lib/money'
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

type CommitmentInput = Parameters<typeof LocalExpense.upsertCommitment>[0]
type Recurrence = 'NONE' | 'MONTHLY'

const DAY = 24 * 60 * 60 * 1000
const TIMELINE_DAYS = 30
const currencySymbol = formatMinor(0).replace(/[\d.,\s-]/g, '') || '₹'
const recurrenceOf = (c: Commitment): string => (c as { recurrence?: string }).recurrence ?? 'NONE'

const startOfDay = (t: number) => new Date(new Date(t).setHours(0, 0, 0, 0)).getTime()
const daysFromToday = (t: number) => Math.round((startOfDay(t) - startOfDay(Date.now())) / DAY)
const toInputValue = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** Parse a yyyy-mm-dd value as a LOCAL date (new Date('2026-11-03') would be UTC and can land on the wrong day). */
const fromInputValue = (v: string) => {
  const [y, m, d] = v.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0).getTime()
}
const longDate = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

const BILL_META: { match: string[]; emoji: string; tint: string }[] = [
  { match: ['rent', 'maintenance', 'housing'], emoji: '🏠', tint: 'bg-emerald-500/15' },
  { match: ['electric', 'power', 'water', 'gas', 'utility'], emoji: '💡', tint: 'bg-yellow-500/15' },
  { match: ['internet', 'wifi', 'broadband', 'fiber'], emoji: '📶', tint: 'bg-sky-500/15' },
  { match: ['phone', 'mobile', 'recharge', 'postpaid'], emoji: '📱', tint: 'bg-violet-500/15' },
  { match: ['emi', 'loan', 'mortgage', 'credit card'], emoji: '🏦', tint: 'bg-orange-500/15' },
  { match: ['insurance', 'premium', 'lic'], emoji: '🛡️', tint: 'bg-indigo-500/15' },
  { match: ['netflix', 'spotify', 'prime', 'subscription', 'youtube', 'hotstar'], emoji: '🎬', tint: 'bg-pink-500/15' },
  { match: ['school', 'tuition', 'fees'], emoji: '🎓', tint: 'bg-teal-500/15' },
]
const billMeta = (name: string) => {
  const n = name.toLowerCase()
  return BILL_META.find((m) => m.match.some((k) => n.includes(k))) ?? { emoji: '🧾', tint: 'bg-muted' }
}

const SUGGESTIONS = ['Rent', 'Electricity', 'Internet', 'Phone', 'EMI', 'Insurance', 'Subscription']

function dueInfo(dueAt: number) {
  const d = daysFromToday(dueAt)
  if (d < 0) return { d, text: `${-d} ${-d === 1 ? 'day' : 'days'} overdue`, tone: 'bg-rose-500/15 text-rose-300' }
  if (d === 0) return { d, text: 'Today', tone: 'bg-amber-500/15 text-amber-300' }
  if (d === 1) return { d, text: 'Tomorrow', tone: 'bg-amber-500/15 text-amber-300' }
  if (d <= 6) return { d, text: new Date(dueAt).toLocaleDateString(undefined, { weekday: 'long' }), tone: d <= 3 ? 'bg-amber-500/15 text-amber-300' : 'bg-muted text-muted-foreground' }
  return { d, text: new Date(dueAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), tone: 'bg-muted text-muted-foreground' }
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

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[]
  value: T
  onChange: (key: T) => void
}) {
  const index = Math.max(0, options.findIndex((o) => o.key === value))
  return (
    <div className="relative flex rounded-2xl bg-muted/70 p-1" role="tablist">
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 rounded-xl bg-background shadow-sm ring-1 ring-border transition-transform duration-300 ease-out"
        style={{ width: `calc((100% - 0.5rem) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={o.key === value}
          onClick={() => onChange(o.key)}
          className={cn('relative z-10 h-9 flex-1 rounded-xl text-sm font-medium transition-colors', o.key === value ? 'text-foreground' : 'text-muted-foreground')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ───────────────────────────── page ───────────────────────────── */

export function CommitmentsPage() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['commitments'], queryFn: () => LocalExpense.listCommitments() })
  const [drawer, setDrawer] = useState<{ bill: Commitment | null; name?: string } | null>(null)

  const bills: Commitment[] = useMemo(
    () => [...(query.data?.commitments ?? [])].sort((a, b) => a.dueAt - b.dueAt),
    [query.data],
  )

  const upsert = useMutation({
    mutationFn: (input: CommitmentInput) => LocalExpense.upsertCommitment(input),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['commitments'] }),
  })

  const remove = useMutation({
    mutationFn: (bill: Commitment) => LocalExpense.deleteCommitment({ id: bill.id }),
    onSuccess: (_r, bill) => {
      void client.invalidateQueries({ queryKey: ['commitments'] })
      toast('Bill removed', {
        action: {
          label: 'Undo',
          onClick: () =>
            upsert.mutate({
              name: bill.name,
              amountMinor: bill.amountMinor,
              dueAt: bill.dueAt,
              recurrence: recurrenceOf(bill) as Recurrence,
            }),
        },
      })
    },
    onError: () => toast.error('Could not remove the bill. Try again.'),
  })

  const save = (input: CommitmentInput, message: string, done: () => void) =>
    upsert.mutate(input, {
      onSuccess: () => {
        toast.success(message)
        done()
      },
      onError: () => toast.error('Could not save the bill. Try again.'),
    })

  const groups = useMemo(() => {
    const defs = [
      { key: 'overdue', title: 'Overdue', test: (d: number) => d < 0 },
      { key: 'week', title: 'This week', test: (d: number) => d >= 0 && d <= 7 },
      { key: 'month', title: 'Later this month', test: (d: number) => d > 7 && d <= 30 },
      { key: 'later', title: 'Further out', test: (d: number) => d > 30 },
    ]
    return defs
      .map((g) => {
        const items = bills.filter((b) => g.test(daysFromToday(b.dueAt)))
        return { ...g, items, total: items.reduce((s, b) => s + b.amountMinor, 0) }
      })
      .filter((g) => g.items.length > 0)
  }, [bills])

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-lg">
        <header className="sticky top-0 z-20 flex items-center justify-between bg-background/85 px-4 pb-3 pt-[calc(1rem+env(safe-area-inset-top))] backdrop-blur-xl">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Upcoming bills</h1>
            <p className="text-sm text-muted-foreground">Rent, utilities, EMIs and subscriptions.</p>
          </div>
          <Button size="icon" className="size-11 rounded-full" onClick={() => setDrawer({ bill: null })} aria-label="Add bill">
            <Plus className="size-5" />
          </Button>
        </header>

        <div className="space-y-6 px-4 pb-10 pt-2">
          {query.isLoading && (
            <>
              <Skeleton className="h-52 w-full rounded-3xl" />
              <Skeleton className="h-16 w-full rounded-3xl" />
              <Skeleton className="h-16 w-full rounded-3xl" />
            </>
          )}

          {!query.isLoading && bills.length === 0 && <EmptyState onPick={(name) => setDrawer({ bill: null, name })} />}

          {bills.length > 0 && <Overview bills={bills} onOpen={(b) => setDrawer({ bill: b })} />}

          {groups.map((g) => (
            <section key={g.key} className="space-y-2">
              <div className="flex items-baseline justify-between px-1">
                <h2 className={cn('text-base font-semibold', g.key === 'overdue' && 'text-rose-300')}>{g.title}</h2>
                <span className="text-xs tabular-nums text-muted-foreground">{formatMinor(g.total)}</span>
              </div>
              <ul className="divide-y divide-border/60 overflow-hidden rounded-3xl border border-border bg-card">
                {g.items.map((b) => (
                  <BillRow key={b.id} bill={b} onOpen={() => setDrawer({ bill: b })} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>

      <BillDrawer
        state={drawer}
        onClose={() => setDrawer(null)}
        pending={upsert.isPending || remove.isPending}
        onSave={save}
        onRemove={(bill) =>
          remove.mutate(bill, { onSuccess: () => setDrawer(null) })
        }
      />
    </div>
  )
}

/* ───────────────────────────── overview ─────────────────────────────
   The showy part: a 30-day runway with every bill dropped on it.         */

function Overview({ bills, onOpen }: { bills: Commitment[]; onOpen: (b: Commitment) => void }) {
  const [peek, setPeek] = useState<string | null>(null)

  const overdue = bills.filter((b) => daysFromToday(b.dueAt) < 0)
  const soon = bills.filter((b) => {
    const d = daysFromToday(b.dueAt)
    return d >= 0 && d <= 14
  })
  const overdueTotal = overdue.reduce((s, b) => s + b.amountMinor, 0)
  const dueTotal = overdueTotal + soon.reduce((s, b) => s + b.amountMinor, 0)
  const shown = useCountUp(dueTotal)
  const monthly = bills.filter((b) => recurrenceOf(b) === 'MONTHLY').reduce((s, b) => s + b.amountMinor, 0)

  const onTrack = bills.filter((b) => daysFromToday(b.dueAt) <= TIMELINE_DAYS)
  const later = bills.length - onTrack.length
  const maxAmount = Math.max(...bills.map((b) => b.amountMinor), 1)
  const peeked = bills.find((b) => b.id === peek) ?? null

  return (
    <section className="rounded-3xl border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">To pay in the next 14 days</p>
      <p className="font-display mt-1 text-4xl font-bold tracking-tight tabular-nums">{formatMinor(shown)}</p>
      <p className="mt-1 text-sm">
        {overdueTotal > 0 ? (
          <span className="font-medium text-rose-300">{formatMinor(overdueTotal)} already overdue. </span>
        ) : dueTotal === 0 ? (
          <span className="text-emerald-300">Nothing due soon. </span>
        ) : null}
        {monthly > 0 && <span className="text-muted-foreground">Repeating bills add up to {formatMinor(monthly)} a month.</span>}
      </p>

      {/* runway */}
      <div className="mt-6">
        <div className="relative h-14">
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
          <span className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-foreground/70" aria-hidden />
          {onTrack.map((b) => {
            const d = daysFromToday(b.dueAt)
            const late = d < 0
            const pct = (Math.max(0, d) / TIMELINE_DAYS) * 100
            const size = 14 + 16 * Math.sqrt(b.amountMinor / maxAmount)
            return (
              <button
                key={b.id}
                type="button"
                aria-label={`${b.name}, ${formatMinor(b.amountMinor)}, ${dueInfo(b.dueAt).text}`}
                onClick={() => setPeek(peek === b.id ? null : b.id)}
                className={cn(
                  'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-transform active:scale-90',
                  late ? 'border-rose-300 bg-rose-500/70' : d <= 3 ? 'border-amber-300 bg-amber-500/70' : 'border-indigo-300 bg-indigo-500/60',
                  peek === b.id && 'ring-2 ring-foreground/70',
                )}
                style={{ left: `${Math.min(97, Math.max(3, pct))}%`, width: size, height: size }}
              />
            )
          })}
        </div>
        <div className="flex justify-between text-[0.7rem] text-muted-foreground">
          <span>Today</span>
          <span>10 days</span>
          <span>20 days</span>
          <span>30 days</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Bigger dots are bigger bills. Tap one to peek.</p>
      </div>

      {peeked && (
        <button
          type="button"
          onClick={() => onOpen(peeked)}
          className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-muted/60 p-3 text-left active:bg-muted"
        >
          <span className={cn('flex size-9 items-center justify-center rounded-xl text-lg', billMeta(peeked.name).tint)}>{billMeta(peeked.name).emoji}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{peeked.name}</span>
            <span className="block text-xs text-muted-foreground">{dueInfo(peeked.dueAt).text}</span>
          </span>
          <span className="text-sm font-semibold tabular-nums">{formatMinor(peeked.amountMinor)}</span>
        </button>
      )}

      {later > 0 && <p className="mt-3 text-xs text-muted-foreground">{later} more {later === 1 ? 'bill is' : 'bills are'} further out than 30 days.</p>}
    </section>
  )
}

/* ───────────────────────────── row ───────────────────────────── */

function BillRow({ bill, onOpen }: { bill: Commitment; onOpen: () => void }) {
  const meta = billMeta(bill.name)
  const info = dueInfo(bill.dueAt)
  const repeats = recurrenceOf(bill) === 'MONTHLY'
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-muted/60">
        <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-2xl text-xl', meta.tint)}>{meta.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{bill.name}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', info.tone)}>{info.text}</span>
            {repeats && <span className="text-xs text-muted-foreground">Every month</span>}
          </div>
        </div>
        <p className="shrink-0 text-sm font-semibold tabular-nums">{formatMinor(bill.amountMinor)}</p>
      </button>
    </li>
  )
}

/* ───────────────────────────── empty ───────────────────────────── */

function EmptyState({ onPick }: { onPick: (name: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border px-6 py-12 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-300">
        <CalendarClock className="size-6" />
      </div>
      <div>
        <p className="font-medium">No bills yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Add what you owe regularly, and it will count against your safe-to-spend number.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.slice(0, 5).map((s) => (
          <button key={s} type="button" onClick={() => onPick(s)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm active:scale-95">
            <span>{billMeta(s).emoji}</span>
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ───────────────────────────── add / edit drawer ───────────────────────────── */

function BillDrawer({
  state,
  onClose,
  onSave,
  onRemove,
  pending,
}: {
  state: { bill: Commitment | null; name?: string } | null
  onClose: () => void
  onSave: (input: CommitmentInput, message: string, done: () => void) => void
  onRemove: (bill: Commitment) => void
  pending: boolean
}) {
  const bill = state?.bill ?? null
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [due, setDue] = useState('')
  const [recurrence, setRecurrence] = useState<Recurrence>('NONE')
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(() => {
    if (!state) return
    setConfirmRemove(false)
    if (bill) {
      setName(bill.name)
      setAmount((bill.amountMinor / 100).toFixed(2))
      setDue(toInputValue(bill.dueAt))
      setRecurrence(recurrenceOf(bill) === 'MONTHLY' ? 'MONTHLY' : 'NONE')
    } else {
      setName(state.name ?? '')
      setAmount('')
      setDue('')
      setRecurrence(state.name ? 'MONTHLY' : 'NONE')
    }
  }, [state]) // eslint-disable-line react-hooks/exhaustive-deps

  const quickDates = useMemo(() => {
    const now = new Date()
    const at = (d: Date) => toInputValue(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime())
    return [
      { label: 'Tomorrow', value: at(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)) },
      { label: 'In a week', value: at(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7)) },
      { label: '1st of next month', value: at(new Date(now.getFullYear(), now.getMonth() + 1, 1)) },
      { label: 'Month end', value: at(new Date(now.getFullYear(), now.getMonth() + 1, 0)) },
    ]
  }, [state]) // eslint-disable-line react-hooks/exhaustive-deps

  const amountMinor = parseMajorToMinor(amount) ?? 0
  const valid = name.trim().length > 0 && amountMinor > 0 && due !== ''
  const dueAt = due ? fromInputValue(due) : null

  return (
    <Drawer open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="pb-2">
          <DrawerTitle>{bill ? 'Edit bill' : 'Add a bill'}</DrawerTitle>
          <DrawerDescription>{bill ? 'Change anything, or remove it below.' : 'What do you owe, how much, and when?'}</DrawerDescription>
        </DrawerHeader>

        <div className="space-y-5 overflow-y-auto px-4 pb-2">
          <div className="flex items-baseline justify-center gap-1.5 py-1">
            <span className="text-3xl font-medium text-muted-foreground">{currencySymbol}</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="0"
              aria-label="Amount"
              className="w-52 bg-transparent text-center text-5xl font-semibold tabular-nums outline-none placeholder:text-muted-foreground/40"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bill-name">Name</Label>
            <Input id="bill-name" className="h-11" value={name} placeholder="Apartment rent" onChange={(e) => setName(e.target.value)} />
            {!bill && (
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setName(s)}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs',
                      name === s ? 'border-indigo-400/60 bg-indigo-500/15 text-indigo-200' : 'border-border bg-card text-muted-foreground',
                    )}
                  >
                    {billMeta(s).emoji} {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="bill-due">Due date</Label>
            <div className="flex flex-wrap gap-2">
              {quickDates.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => setDue(q.value)}
                  className={cn(
                    'inline-flex h-8 items-center rounded-full border px-3 text-xs',
                    due === q.value ? 'border-indigo-400/60 bg-indigo-500/15 text-indigo-200' : 'border-border bg-card text-muted-foreground',
                  )}
                >
                  {q.label}
                </button>
              ))}
            </div>
            <Input id="bill-due" type="date" className="h-11" value={due} onChange={(e) => setDue(e.target.value)} />
            {dueAt != null && (
              <p className="text-xs text-muted-foreground">
                {longDate(dueAt)}, {dueInfo(dueAt).text.toLowerCase()}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Repeats</Label>
            <Segmented
              options={[
                { key: 'NONE', label: 'Just once' },
                { key: 'MONTHLY', label: 'Every month' },
              ]}
              value={recurrence}
              onChange={setRecurrence}
            />
            {recurrence === 'MONTHLY' && dueAt != null && (
              <p className="text-xs text-muted-foreground">Repeats on the {ordinal(new Date(dueAt).getDate())} of each month.</p>
            )}
          </div>

          {bill && (
            <Button
              variant="ghost"
              className={cn('w-full', confirmRemove ? 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/20' : 'text-muted-foreground')}
              disabled={pending}
              onClick={() => (confirmRemove ? onRemove(bill) : setConfirmRemove(true))}
            >
              {confirmRemove ? 'Tap again to remove this bill' : 'Remove bill'}
            </Button>
          )}
        </div>

        <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button
            className="h-12 text-base"
            disabled={!valid || pending}
            onClick={() =>
              onSave(
                { id: bill?.id, name: name.trim(), amountMinor, dueAt: dueAt!, recurrence },
                bill ? 'Changes saved' : 'Bill added',
                onClose,
              )
            }
          >
            {pending ? 'Saving…' : bill ? 'Save changes' : 'Add bill'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

function ordinal(n: number) {
  const v = n % 100
  const suffix = v >= 11 && v <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${suffix}`
}