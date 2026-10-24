import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, Check, Inbox, Plus, Search, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Transaction } from '@/lib/plugin'
import { LocalExpense } from '@/lib/plugin'
import { queryKeys, type TransactionFilters } from '@/lib/query'
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
import { formatMinor, parseMajorToMinor } from '@/lib/money'
import { formatDateTime } from '@/lib/format'

/* ────────────────────────────── config ────────────────────────────── */

type FilterKey = 'all' | 'debit' | 'credit'
type RangeKey = 'all' | '7d' | '30d' | '90d'

const filtersFor: Record<FilterKey, TransactionFilters> = {
  all: { status: 'ACTIVE', direction: null, categoryId: null },
  debit: { status: 'ACTIVE', direction: 'DEBIT', categoryId: null },
  credit: { status: 'ACTIVE', direction: 'CREDIT', categoryId: null },
}

const tabs: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'debit', label: 'Spent' },
  { key: 'credit', label: 'Income' },
]

const ranges: { key: RangeKey; label: string; days: number | null }[] = [
  { key: 'all', label: 'All time', days: null },
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
]

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
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))
const buzz = (ms = 8) => {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* not supported */
  }
}

/** Currency symbol derived from the app's own formatter, so it always matches. */
const currencySymbol = formatMinor(0).replace(/[\d.,\s-]/g, '') || '₹'

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString()
}

function dayLabel(ts: number) {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (sameDay(d, today)) return 'Today'
  if (sameDay(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  })
}

function timeLabel(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function useCountUp(target: number, ms = 650) {
  const [value, setValue] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms)
      const eased = 1 - Math.pow(1 - p, 3)
      const v = a + (target - a) * eased
      from.current = v
      setValue(v)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return Math.round(value)
}

/* ───────────────────────── small building blocks ───────────────────────── */

function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { key: T; label: string }[]
  value: T
  onChange: (key: T) => void
  className?: string
}) {
  const index = Math.max(0, options.findIndex((o) => o.key === value))
  return (
    <div className={cn('relative flex rounded-2xl bg-muted/70 p-1', className)} role="tablist">
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 rounded-xl bg-background shadow-sm ring-1 ring-border transition-transform duration-300 ease-out"
        style={{
          width: `calc((100% - 0.5rem) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={o.key === value}
          onClick={() => onChange(o.key)}
          className={cn(
            'relative z-10 h-9 flex-1 rounded-xl text-sm font-medium transition-colors',
            o.key === value ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
        active
          ? 'border-indigo-400/60 bg-indigo-500/15 text-indigo-200'
          : 'border-border bg-card text-muted-foreground active:bg-muted',
      )}
    >
      {children}
    </button>
  )
}

type Category = { id: string; name: string }

function CategoryPicker({
  categories,
  value,
  onChange,
  allowNone,
}: {
  categories: Category[]
  value: string | null
  onChange: (id: string | null) => void
  allowNone?: boolean
}) {
  return (
    <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto py-0.5">
      {categories.map((c) => {
        const active = c.id === value
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(active && allowNone ? null : c.id)}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-sm transition-all active:scale-95',
              active
                ? 'border-indigo-400/70 bg-indigo-500/20 font-medium text-foreground'
                : 'border-border bg-card text-muted-foreground',
            )}
          >
            <span>{categoryMeta(c.name).emoji}</span>
            {c.name}
            {active && <Check className="size-3.5 text-indigo-300" />}
          </button>
        )
      })}
    </div>
  )
}

/* ──────────────────────────── summary hero ──────────────────────────── */

function SummaryCard({
  spent,
  income,
  count,
  rangeLabel,
  loading,
}: {
  spent: number
  income: number
  count: number
  rangeLabel: string
  loading: boolean
}) {
  const net = income - spent
  const animatedNet = useCountUp(Math.abs(net))
  const animatedSpent = useCountUp(spent)
  const animatedIncome = useCountUp(income)
  const total = spent + income
  const incomeShare = total === 0 ? 50 : (income / total) * 100

  if (loading) return <Skeleton className="h-40 w-full rounded-3xl" />

  return (
    <section className="rounded-3xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {net >= 0 ? 'You kept' : 'You overspent by'}
          </p>
          <p
            className={cn(
              'mt-1 text-4xl font-semibold tracking-tight tabular-nums',
              net >= 0 ? 'text-emerald-400' : 'text-rose-400',
            )}
          >
            {formatMinor(animatedNet)}
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{rangeLabel}</p>
          <p>
            {count} {count === 1 ? 'transaction' : 'transactions'}
          </p>
        </div>
      </div>

      {/* income vs spend split */}
      <div className="mt-5 flex h-2.5 overflow-hidden rounded-full bg-muted">
        <div
          className="bg-emerald-400 transition-[width] duration-700 ease-out"
          style={{ width: `${incomeShare}%` }}
        />
        <div className="flex-1 bg-rose-400" />
      </div>

      <div className="mt-3 flex justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
            <ArrowDownLeft className="size-3.5" />
          </span>
          <div>
            <p className="text-xs text-muted-foreground">Income</p>
            <p className="font-semibold tabular-nums">{formatMinor(animatedIncome)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-right">
          <div>
            <p className="text-xs text-muted-foreground">Spent</p>
            <p className="font-semibold tabular-nums">{formatMinor(animatedSpent)}</p>
          </div>
          <span className="flex size-6 items-center justify-center rounded-full bg-rose-500/15 text-rose-400">
            <ArrowUpRight className="size-3.5" />
          </span>
        </div>
      </div>
    </section>
  )
}

/* ─────────────────────────── transaction row ─────────────────────────── */

function TransactionItem({
  transaction,
  onOpen,
  onLongPress,
}: {
  transaction: Transaction
  onOpen: () => void
  onLongPress: (x: number, y: number) => void
}) {
  const timer = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)
  const isCredit = transaction.direction === 'CREDIT'
  const meta = categoryMeta(transaction.categoryName)

  const cancel = () => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
  }

  return (
    <button
      type="button"
      className="flex w-full touch-pan-y select-none items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition-colors active:bg-muted/70"
      onClick={() => {
        if (fired.current) {
          fired.current = false
          return
        }
        onOpen()
      }}
      onPointerDown={(e) => {
        fired.current = false
        start.current = { x: e.clientX, y: e.clientY }
        const x = e.clientX
        const y = e.clientY
        timer.current = window.setTimeout(() => {
          fired.current = true
          buzz(18)
          onLongPress(x, y)
        }, 420)
      }}
      onPointerMove={(e) => {
        if (timer.current && start.current) {
          if (Math.abs(e.clientX - start.current.x) > 10 || Math.abs(e.clientY - start.current.y) > 10) cancel()
        }
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-2xl text-xl', meta.tint)}>
        {meta.emoji}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.95rem] font-medium">
          {transaction.merchantName ?? 'Unknown merchant'}
        </p>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{transaction.categoryName ?? 'Uncategorised'}</span>
          <span className="shrink-0 text-muted-foreground/70" title={formatDateTime(transaction.occurredAt)}>
            {timeLabel(transaction.occurredAt)}
          </span>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <p
          className={cn(
            'text-[0.95rem] font-semibold tabular-nums',
            isCredit ? 'text-emerald-400' : 'text-foreground',
          )}
        >
          {isCredit ? '+' : '−'}
          {formatMinor(transaction.amountMinor)}
        </p>
        {transaction.confidence < 0.85 && (
          <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[0.65rem] font-medium text-amber-300">
            <Sparkles className="size-2.5" />
            Check this
          </span>
        )}
      </div>
    </button>
  )
}

/* ───────────────────────── the category wheel ─────────────────────────
   Long-press a row, drag to a category, release to apply. Release in the
   middle (or off the wheel) to cancel.                                    */

const WHEEL_RADIUS = 104

function CategoryWheel({
  state,
  categories,
  onPick,
  onClose,
}: {
  state: { x: number; y: number; transaction: Transaction }
  categories: Category[] | undefined
  onPick: (categoryId: string) => void
  onClose: () => void
}) {
  const items = useMemo(() => (categories ?? []).slice(0, 8), [categories])
  const center = useMemo(() => {
    const m = WHEEL_RADIUS + 36
    return {
      x: clamp(state.x, m, window.innerWidth - m),
      y: clamp(state.y, m + 80, window.innerHeight - m),
    }
  }, [state.x, state.y])

  const positions = useMemo(
    () =>
      items.map((cat, i) => {
        const angle = (i / items.length) * Math.PI * 2 - Math.PI / 2
        return {
          cat,
          x: center.x + WHEEL_RADIUS * Math.cos(angle),
          y: center.y + WHEEL_RADIUS * Math.sin(angle),
        }
      }),
    [items, center],
  )

  const [pointer, setPointer] = useState({ x: state.x, y: state.y })
  const [hover, setHover] = useState<string | null>(null)
  const hoverRef = useRef<string | null>(null)
  const pick = useRef(onPick)
  const close = useRef(onClose)
  pick.current = onPick
  close.current = onClose

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      setPointer({ x: e.clientX, y: e.clientY })
      let nearest: string | null = null
      let min = 44
      for (const p of positions) {
        const d = Math.hypot(e.clientX - p.x, e.clientY - p.y)
        if (d < min) {
          min = d
          nearest = p.cat.id
        }
      }
      if (nearest !== hoverRef.current) {
        hoverRef.current = nearest
        setHover(nearest)
        if (nearest) buzz(8)
      }
    }
    const onUp = () => {
      const selected = hoverRef.current
      if (selected && selected !== state.transaction.categoryId) pick.current(selected)
      else close.current()
    }
    // stop the page from scrolling away under the finger while the wheel is open
    const stopScroll = (e: TouchEvent) => e.preventDefault()

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('touchmove', stopScroll, { passive: false })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('touchmove', stopScroll)
    }
  }, [positions, state.transaction.categoryId])

  const hovered = items.find((c) => c.id === hover)
  const currentId = state.transaction.categoryId

  return (
    <div className="fixed inset-0 z-[60] touch-none select-none">
      <div className="absolute inset-0 animate-in fade-in bg-background/70 backdrop-blur-md duration-200" />

      {/* caption */}
      <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+1.5rem)] text-center">
        <p className="truncate px-8 text-sm text-muted-foreground">
          {state.transaction.merchantName ?? 'Unknown merchant'}
        </p>
        <p className="mt-1 text-2xl font-semibold tracking-tight">
          {hovered ? `${categoryMeta(hovered.name).emoji} ${hovered.name}` : 'Slide to a category'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {hovered ? 'Release to apply' : 'Release in the middle to cancel'}
        </p>
      </div>

      {/* tether */}
      <svg className="pointer-events-none absolute inset-0 size-full">
        <line
          x1={center.x}
          y1={center.y}
          x2={pointer.x}
          y2={pointer.y}
          stroke="rgb(129 140 248 / 0.55)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>

      {/* hub */}
      <div
        className="pointer-events-none absolute size-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-indigo-400/70 bg-indigo-500/15"
        style={{ left: center.x, top: center.y }}
      >
        <span className="absolute inset-0 animate-ping rounded-full bg-indigo-400/20" />
      </div>

      {/* petals */}
      {positions.map(({ cat, x, y }, i) => {
        const active = hover === cat.id
        const current = currentId === cat.id
        return (
          <div
            key={cat.id}
            className={cn(
              'absolute flex size-14 -translate-x-1/2 -translate-y-1/2 animate-in zoom-in-50 fade-in items-center justify-center rounded-full border text-2xl fill-mode-both duration-200',
              'transition-[transform,box-shadow,background-color] ease-out',
              active
                ? 'scale-[1.35] border-indigo-300 bg-indigo-600 shadow-[0_0_32px_rgb(99_102_241/0.65)]'
                : current
                  ? 'border-indigo-400/60 bg-card ring-2 ring-indigo-400/30'
                  : 'border-border bg-card',
            )}
            style={{ left: x, top: y, animationDelay: `${i * 22}ms` }}
          >
            {categoryMeta(cat.name).emoji}
          </div>
        )
      })}
    </div>
  )
}

/* ──────────────────────────── add drawer ──────────────────────────── */

function AddDrawer({
  open,
  onOpenChange,
  categories,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: Category[]
}) {
  const client = useQueryClient()
  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState<'DEBIT' | 'CREDIT'>('DEBIT')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [merchant, setMerchant] = useState('')
  const [note, setNote] = useState('')

  const minor = parseMajorToMinor(amount) ?? 0
  const valid = minor > 0

  const add = useMutation({
    mutationFn: () =>
      LocalExpense.createManualTransaction({
        amountMinor: minor,
        direction,
        kind: direction === 'CREDIT' ? 'INCOME' : 'SPEND',
        categoryId,
        merchantName: merchant.trim() || null,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      onOpenChange(false)
      setAmount('')
      setMerchant('')
      setNote('')
      setCategoryId(null)
      void client.invalidateQueries({ queryKey: ['transactions'] })
      toast.success('Transaction added')
    },
    onError: () => toast.error('Could not add the transaction. Try again.'),
  })

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="pb-2">
          <DrawerTitle>Add a transaction</DrawerTitle>
          <DrawerDescription>For anything that never showed up as a notification.</DrawerDescription>
        </DrawerHeader>

        <div className="space-y-5 overflow-y-auto px-4 pb-2">
          <Segmented
            options={[
              { key: 'DEBIT', label: 'Spent' },
              { key: 'CREDIT', label: 'Income' },
            ]}
            value={direction}
            onChange={setDirection}
          />

          <div className="flex items-baseline justify-center gap-1.5 py-2">
            <span className="text-3xl font-medium text-muted-foreground">{currencySymbol}</span>
            <input
              autoFocus
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="0"
              aria-label="Amount"
              className={cn(
                'w-48 bg-transparent text-center text-6xl font-semibold tabular-nums outline-none placeholder:text-muted-foreground/40',
                direction === 'CREDIT' ? 'text-emerald-400' : 'text-foreground',
              )}
            />
          </div>

          <div className="space-y-2">
            <Label>Category</Label>
            <CategoryPicker categories={categories} value={categoryId} onChange={setCategoryId} allowNone />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="merchant">Merchant</Label>
              <Input
                id="merchant"
                className="h-11"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                placeholder="Where?"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="note">Note</Label>
              <Input
                id="note"
                className="h-11"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What for?"
              />
            </div>
          </div>
        </div>

        <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button className="h-12 text-base" onClick={() => add.mutate()} disabled={add.isPending || !valid}>
            {add.isPending ? 'Adding…' : 'Add transaction'}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

/* ──────────────────────────── edit drawer ──────────────────────────── */

type Draft = {
  amount: string
  merchant: string
  note: string
  categoryId: string | null
}

function EditDrawer({
  transaction,
  categories,
  onClose,
}: {
  transaction: Transaction | null
  categories: Category[]
  onClose: () => void
}) {
  const client = useQueryClient()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [view, setView] = useState<'details' | 'source'>('details')

  // Rebuild the draft whenever a different transaction is opened.
  useEffect(() => {
    if (!transaction) return
    setView('details')
    setDraft({
      amount: (transaction.amountMinor / 100).toFixed(2),
      merchant: transaction.merchantName ?? '',
      note: transaction.note ?? '',
      categoryId: transaction.categoryId,
    })
  }, [transaction?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const rawEvent = useQuery({
    queryKey: ['rawEventForTxn', transaction?.id],
    queryFn: async () => {
      if (!transaction?.rawEventId) return null
      const page = await LocalExpense.listRawEvents({ limit: 200 })
      return page.items.find((e) => e.id === transaction.rawEventId) ?? null
    },
    enabled: !!transaction && view === 'source',
  })

  const save = useMutation({
    mutationFn: () =>
      LocalExpense.correctTransaction({
        id: transaction!.id,
        amountMinor: parseMajorToMinor(draft?.amount ?? '') ?? transaction!.amountMinor,
        categoryId: draft?.categoryId ?? undefined,
        merchantName: draft?.merchant.trim() || undefined,
        note: draft?.note.trim() || undefined,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['transactions'] })
      toast.success('Changes saved')
      onClose()
    },
    onError: () => toast.error('Could not save your changes. Try again.'),
  })

  const dirty =
    !!transaction &&
    !!draft &&
    (parseMajorToMinor(draft.amount) !== transaction.amountMinor ||
      draft.merchant !== (transaction.merchantName ?? '') ||
      draft.note !== (transaction.note ?? '') ||
      draft.categoryId !== transaction.categoryId)

  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d))
  const isCredit = transaction?.direction === 'CREDIT'
  const selectedName = categories.find((c) => c.id === draft?.categoryId)?.name

  return (
    <Drawer open={transaction !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="items-center pb-2 text-center">
          <div
            className={cn(
              'flex size-14 items-center justify-center rounded-2xl text-3xl transition-colors',
              categoryMeta(selectedName).tint,
            )}
          >
            {categoryMeta(selectedName).emoji}
          </div>
          <DrawerTitle className="mt-2">{transaction?.merchantName ?? 'Unknown merchant'}</DrawerTitle>
          <DrawerDescription>
            {transaction && (
              <span className={cn('font-semibold tabular-nums', isCredit ? 'text-emerald-400' : 'text-foreground')}>
                {isCredit ? '+' : '−'}
                {formatMinor(transaction.amountMinor)}
              </span>
            )}
            {transaction && <span className="ml-2">{formatDateTime(transaction.occurredAt)}</span>}
          </DrawerDescription>
        </DrawerHeader>

        <div className="space-y-4 overflow-y-auto px-4 pb-2">
          <Segmented
            options={[
              { key: 'details', label: 'Details' },
              { key: 'source', label: 'Source message' },
            ]}
            value={view}
            onChange={setView}
          />

          {view === 'details' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Amount</Label>
                  <Input
                    className="h-11 tabular-nums"
                    inputMode="decimal"
                    value={draft?.amount ?? ''}
                    onChange={(e) => patch({ amount: e.target.value.replace(/[^\d.]/g, '') })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Merchant</Label>
                  <Input
                    className="h-11"
                    value={draft?.merchant ?? ''}
                    placeholder="Unknown merchant"
                    onChange={(e) => patch({ merchant: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Category</Label>
                <CategoryPicker
                  categories={categories}
                  value={draft?.categoryId ?? null}
                  onChange={(id) => patch({ categoryId: id })}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Note</Label>
                <Input
                  className="h-11"
                  value={draft?.note ?? ''}
                  placeholder="What was this for?"
                  onChange={(e) => patch({ note: e.target.value })}
                />
              </div>
            </div>
          )}

          {view === 'source' && (
            <div className="space-y-2 text-sm">
              {rawEvent.isLoading && <Skeleton className="h-32 w-full rounded-2xl" />}
              {!rawEvent.isLoading && !rawEvent.data && (
                <p className="rounded-2xl border border-dashed border-border p-6 text-center text-muted-foreground">
                  This one was added by hand, so there is no source message.
                </p>
              )}
              {rawEvent.data && (
                <>
                  <div className="rounded-2xl border border-border bg-muted/40 p-3.5">
                    <p className="text-xs text-muted-foreground">
                      From {rawEvent.data.sender ?? rawEvent.data.packageName ?? 'unknown sender'}
                    </p>
                    <p className="mt-1 font-medium">{rawEvent.data.title ?? '—'}</p>
                    <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                      {rawEvent.data.bigText ?? rawEvent.data.text ?? rawEvent.data.textLines ?? '—'}
                    </p>
                  </div>
                  <div className="flex justify-between rounded-2xl border border-border bg-muted/40 p-3.5 text-xs">
                    <span className="text-muted-foreground">
                      Received {new Date(rawEvent.data.postedAt).toLocaleString()}
                    </span>
                    <span className="font-medium">{rawEvent.data.status}</span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex w-full max-w-lg gap-2">
            <Button variant="outline" className="h-12 flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              className="h-12 flex-[1.4]"
              onClick={() => save.mutate()}
              disabled={save.isPending || !dirty}
            >
              {save.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

/* ───────────────────────────────── page ───────────────────────────────── */

export function TransactionsPage() {
  const client = useQueryClient()
  const [tab, setTab] = useState<FilterKey>('all')
  const [range, setRange] = useState<RangeKey>('all')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [adding, setAdding] = useState(false)
  const [wheel, setWheel] = useState<{ x: number; y: number; transaction: Transaction } | null>(null)
  const sentinel = useRef<HTMLDivElement | null>(null)
  const filters = filtersFor[tab]

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => LocalExpense.listCategories(),
  })
  const accounts = useQuery({
    queryKey: queryKeys.accounts,
    queryFn: () => LocalExpense.listAccounts(),
  })

  const query = useInfiniteQuery({
    queryKey: [...queryKeys.transactionFeed(filters), range, categoryId],
    queryFn: ({ pageParam }) => {
      const days = ranges.find((entry) => entry.key === range)?.days ?? null
      const from = days == null ? null : Date.now() - days * 24 * 60 * 60 * 1000
      return LocalExpense.listTransactions({
        status: filters.status,
        direction: filters.direction,
        categoryId,
        from,
        to: null,
        cursor: pageParam,
        limit: 30,
      })
    },
    initialPageParam: null as { occurredAt: number; id: string } | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })

  const recategorise = useMutation({
    mutationFn: (v: { id: string; categoryId: string }) => LocalExpense.correctTransaction(v),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['transactions'] })
      toast.success('Category updated')
    },
    onError: () => toast.error('Could not update the category'),
  })

  const allTransactions = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data])

  const transactions = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allTransactions.filter((t) => {
      if (accountId && t.accountId !== accountId) return false
      if (q && !`${t.merchantName ?? ''} ${t.note ?? ''} ${t.categoryName ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [allTransactions, accountId, search])

  const totals = useMemo(() => {
    let spent = 0
    let income = 0
    for (const t of transactions) {
      if (t.direction === 'CREDIT') income += t.amountMinor
      else spent += t.amountMinor
    }
    return { spent, income }
  }, [transactions])

  const groups = useMemo(() => {
    const out: { label: string; items: Transaction[]; net: number }[] = []
    for (const t of transactions) {
      const label = dayLabel(t.occurredAt)
      let g = out[out.length - 1]
      if (!g || g.label !== label) {
        g = { label, items: [], net: 0 }
        out.push(g)
      }
      g.items.push(t)
      g.net += t.direction === 'CREDIT' ? t.amountMinor : -t.amountMinor
    }
    return out
  }, [transactions])

  // Infinite scroll
  useEffect(() => {
    const el = sentinel.current
    if (!el || !query.hasNextPage) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !query.isFetchingNextPage) void query.fetchNextPage()
      },
      { rootMargin: '400px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasFilters = range !== 'all' || !!categoryId || !!accountId || !!search.trim()
  const clearFilters = () => {
    setRange('all')
    setCategoryId(null)
    setAccountId(null)
    setSearch('')
  }
  const rangeLabel = ranges.find((r) => r.key === range)?.label ?? 'All time'
  const categoryList = categories.data?.categories ?? []
  const accountList = accounts.data?.accounts ?? []

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-lg">
        {/* sticky header */}
        <header className="sticky top-0 z-20 space-y-3 bg-background/85 px-4 pb-3 pt-[calc(1rem+env(safe-area-inset-top))] backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
              <p className="text-sm text-muted-foreground">Hold a row to recategorise it fast.</p>
            </div>
            <Button size="icon" className="size-11 rounded-full" onClick={() => setAdding(true)} aria-label="Add transaction">
              <Plus className="size-5" />
            </Button>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search merchant, note or category"
              className="h-11 rounded-2xl pl-10 pr-10"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </header>

        <div className="space-y-4 px-4 pb-10">
          <SummaryCard
            spent={totals.spent}
            income={totals.income}
            count={transactions.length}
            rangeLabel={rangeLabel}
            loading={query.isLoading}
          />

          <Segmented options={tabs} value={tab} onChange={setTab} />

          {/* filters */}
          <div className="-mx-4 space-y-2">
            <div className={cn('flex gap-2 overflow-x-auto px-4', hideScrollbar)}>
              {ranges.map((r) => (
                <Chip key={r.key} active={range === r.key} onClick={() => setRange(r.key)}>
                  {r.label}
                </Chip>
              ))}
            </div>
            <div className={cn('flex gap-2 overflow-x-auto px-4', hideScrollbar)}>
              <Chip active={categoryId === null} onClick={() => setCategoryId(null)}>
                All categories
              </Chip>
              {categoryList.map((c) => (
                <Chip key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}>
                  <span>{categoryMeta(c.name).emoji}</span>
                  {c.name}
                </Chip>
              ))}
            </div>
            {accountList.length > 1 && (
              <div className={cn('flex gap-2 overflow-x-auto px-4', hideScrollbar)}>
                <Chip active={accountId === null} onClick={() => setAccountId(null)}>
                  All accounts
                </Chip>
                {accountList.map((a) => (
                  <Chip key={a.id} active={accountId === a.id} onClick={() => setAccountId(accountId === a.id ? null : a.id)}>
                    {a.name}
                  </Chip>
                ))}
              </div>
            )}
          </div>

          {/* list */}
          {query.isLoading && (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-2">
                  <Skeleton className="size-11 rounded-2xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          )}

          {!query.isLoading && transactions.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-12 text-center">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Inbox className="size-6" />
              </div>
              {hasFilters ? (
                <>
                  <div>
                    <p className="font-medium">No matches</p>
                    <p className="mt-1 text-sm text-muted-foreground">Try widening the date range or clearing a filter.</p>
                  </div>
                  <Button variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                </>
              ) : (
                <>
                  <div>
                    <p className="font-medium">Nothing here yet</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Spending and income appear as bank notifications arrive, or add one yourself.
                    </p>
                  </div>
                  <Button onClick={() => setAdding(true)}>Add a transaction</Button>
                </>
              )}
            </div>
          )}

          {groups.map((group) => (
            <section key={group.label}>
              <div className="sticky top-[calc(8.25rem+env(safe-area-inset-top))] z-10 -mx-4 flex items-baseline justify-between bg-background/85 px-6 py-1.5 backdrop-blur-md">
                <h2 className="text-sm font-semibold">{group.label}</h2>
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    group.net > 0 ? 'text-emerald-400' : 'text-muted-foreground',
                  )}
                >
                  {group.net > 0 ? '+' : group.net < 0 ? '−' : ''}
                  {formatMinor(Math.abs(group.net))}
                </span>
              </div>
              <div className="divide-y divide-border/50">
                {group.items.map((t) => (
                  <TransactionItem
                    key={t.id}
                    transaction={t}
                    onOpen={() => setEditing(t)}
                    onLongPress={(x, y) => setWheel({ x, y, transaction: t })}
                  />
                ))}
              </div>
            </section>
          ))}

          <div ref={sentinel} className="h-1" />
          {query.isFetchingNextPage && <Skeleton className="h-14 w-full rounded-2xl" />}
          {!query.hasNextPage && transactions.length > 0 && (
            <p className="pt-2 text-center text-xs text-muted-foreground">That's everything.</p>
          )}
        </div>
      </div>

      {wheel && (
        <CategoryWheel
          state={wheel}
          categories={categories.data?.categories}
          onClose={() => setWheel(null)}
          onPick={(id) => {
            recategorise.mutate({ id: wheel.transaction.id, categoryId: id })
            setWheel(null)
          }}
        />
      )}

      <AddDrawer open={adding} onOpenChange={setAdding} categories={categoryList} />
      <EditDrawer transaction={editing} categories={categoryList} onClose={() => setEditing(null)} />
    </div>
  )
}