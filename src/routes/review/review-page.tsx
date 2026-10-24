import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Pencil, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import type { RawEvent } from '@/lib/plugin'
import { LocalExpense } from '@/lib/plugin'
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
import { formatMinor, parseMajorToMinor } from '@/lib/money'
import { formatRelativeTime } from '@/lib/format'

/* ────────────────────────────── helpers ────────────────────────────── */

const SWIPE_THRESHOLD = 110
const LIKELY_CONFIDENCE = 0.7

type Decision = 'confirm' | 'dismiss'
type Category = { id: string; name: string }

const currencySymbol = formatMinor(0).replace(/[\d.,\s-]/g, '') || '₹'
const hideScrollbar = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
const buzz = (ms = 10) => {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* not supported */
  }
}

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

const messageOf = (e: RawEvent) => e.bigText ?? e.text ?? e.textLines ?? 'No text'
const sourceOf = (e: RawEvent) => e.sender ?? (e.packageName ? (e.packageName.split('.').pop() ?? e.packageName) : 'Unknown sender')
const confidenceOf = (e: RawEvent) => e.parsed?.confidence ?? 0

function confidenceInfo(c: number) {
  if (c >= LIKELY_CONFIDENCE) return { word: 'Looks right', bar: 'bg-emerald-400', text: 'text-emerald-300' }
  if (c >= 0.4) return { word: 'Not sure', bar: 'bg-amber-400', text: 'text-amber-300' }
  return { word: 'Best guess', bar: 'bg-rose-400', text: 'text-rose-300' }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Marks the amount and merchant inside the raw message so you can see what the parser latched onto. */
function Highlighted({ text, merchant }: { text: string; merchant?: string | null }) {
  const parts = ['(?:Rs\\.?|INR|₹)\\s?[\\d,]+(?:\\.\\d{1,2})?']
  if (merchant && merchant.trim().length > 2) parts.push(escapeRe(merchant.trim()))
  const pieces = text.split(new RegExp(`(${parts.join('|')})`, 'gi'))
  return (
    <>
      {pieces.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-indigo-500/25 px-0.5 font-medium text-indigo-100">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
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

function CategoryChips({
  categories,
  value,
  onChange,
  wrap,
}: {
  categories: Category[]
  value: string | null
  onChange: (id: string | null) => void
  wrap?: boolean
}) {
  return (
    <div data-nodrag className={cn('flex gap-2', wrap ? 'max-h-40 flex-wrap overflow-y-auto py-0.5' : cn('-mx-1 overflow-x-auto px-1 pb-0.5', hideScrollbar))}>
      {categories.map((c) => {
        const active = c.id === value
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(active ? null : c.id)}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm transition-all active:scale-95',
              active ? 'border-indigo-400/70 bg-indigo-500/20 font-medium text-foreground' : 'border-border bg-card text-muted-foreground',
            )}
          >
            <span>{emojiFor(c.name)}</span>
            {c.name}
            {active && <Check className="size-3.5 text-indigo-300" />}
          </button>
        )
      })}
    </div>
  )
}

/* ───────────────────────────── page ───────────────────────────── */

/**
 * The inbox for messages the parser was not sure about. Nothing here touches
 * the dashboard numbers until the user confirms it.
 */
export function ReviewPage() {
  const client = useQueryClient()
  const [mode, setMode] = useState<'swipe' | 'list'>('swipe')
  const [editing, setEditing] = useState<RawEvent | null>(null)
  const [gone, setGone] = useState<Set<string>>(new Set())
  const [flying, setFlying] = useState<{ id: string; dir: Decision } | null>(null)
  const [picked, setPicked] = useState<Record<string, string | null>>({})
  const [stats, setStats] = useState({ confirmed: 0, dismissed: 0 })
  const [bulkAsk, setBulkAsk] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<number | null>(null)

  const query = useInfiniteQuery({
    queryKey: queryKeys.rawEventFeed({ status: 'NEEDS_REVIEW', source: null }),
    queryFn: ({ pageParam }) =>
      LocalExpense.listRawEvents({ status: 'NEEDS_REVIEW', source: null, cursor: pageParam, limit: 30 }),
    initialPageParam: null as { postedAt: number; id: string } | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })

  const categories = useQuery({ queryKey: ['categories'], queryFn: () => LocalExpense.listCategories() })
  const categoryList: Category[] = categories.data?.categories ?? []

  const events = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data])
  const visible = useMemo(() => events.filter((e) => !gone.has(e.id)), [events, gone])
  const likely = visible.filter((e) => e.parsed?.amountMinor && confidenceOf(e) >= LIKELY_CONFIDENCE)

  const handled = stats.confirmed + stats.dismissed
  const total = visible.length + handled
  const left = visible.length

  // keep the stack topped up
  useEffect(() => {
    if (visible.length < 4 && query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage()
  }, [visible.length, query.hasNextPage, query.isFetchingNextPage]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['rawEvents'] })
    void client.invalidateQueries({ queryKey: ['transactions'] })
    void client.invalidateQueries({ queryKey: queryKeys.ingestionStats })
  }

  const restore = (id: string) =>
    setGone((g) => {
      const next = new Set(g)
      next.delete(id)
      return next
    })

  const confirm = useMutation({
    mutationFn: (v: { event: RawEvent; categoryId?: string | null }) =>
      LocalExpense.confirmEvent({
        id: v.event.id,
        amountMinor: v.event.parsed?.amountMinor ?? undefined,
        merchantName: v.event.parsed?.merchant ?? undefined,
        categoryId: v.categoryId ?? undefined,
      }),
    onSuccess: refresh,
    onError: (_e, v) => {
      restore(v.event.id)
      setStats((s) => ({ ...s, confirmed: Math.max(0, s.confirmed - 1) }))
      toast.error('Could not add that one. It is back in your inbox.')
    },
  })

  const dismiss = useMutation({
    mutationFn: (event: RawEvent) => LocalExpense.dismissEvent({ id: event.id }),
    onSuccess: (_r, event) => {
      refresh()
      toast('Dismissed', {
        action: {
          label: 'Undo',
          onClick: () => {
            void LocalExpense.restoreEvent({ id: event.id }).then(() => {
              restore(event.id)
              setStats((s) => ({ ...s, dismissed: Math.max(0, s.dismissed - 1) }))
              void client.invalidateQueries({ queryKey: ['rawEvents'] })
              void client.invalidateQueries({ queryKey: queryKeys.ingestionStats })
            })
          },
        },
      })
    },
    onError: (_e, event) => {
      restore(event.id)
      setStats((s) => ({ ...s, dismissed: Math.max(0, s.dismissed - 1) }))
      toast.error('Could not dismiss that one. Try again.')
    },
  })

  /** Used by swipes, buttons and the list. Animates the card out first, then commits. */
  const decide = (event: RawEvent, dir: Decision, animate = true) => {
    if (flying) return
    if (dir === 'confirm' && !event.parsed?.amountMinor) {
      toast('No amount found. Enter one to add it.')
      setEditing(event)
      return
    }
    buzz(dir === 'confirm' ? 14 : 8)
    const commit = () => {
      setGone((g) => new Set(g).add(event.id))
      setFlying(null)
      if (dir === 'confirm') {
        setStats((s) => ({ ...s, confirmed: s.confirmed + 1 }))
        confirm.mutate({ event, categoryId: picked[event.id] })
        toast.success('Added as a transaction')
      } else {
        setStats((s) => ({ ...s, dismissed: s.dismissed + 1 }))
        dismiss.mutate(event)
      }
    }
    if (animate) {
      setFlying({ id: event.id, dir })
      window.setTimeout(commit, 220)
    } else commit()
  }

  const runBulk = async () => {
    setBulkAsk(false)
    setBulkProgress(0)
    let done = 0
    for (const e of likely) {
      try {
        await LocalExpense.confirmEvent({
          id: e.id,
          amountMinor: e.parsed?.amountMinor ?? undefined,
          merchantName: e.parsed?.merchant ?? undefined,
        })
        setGone((g) => new Set(g).add(e.id))
        setStats((s) => ({ ...s, confirmed: s.confirmed + 1 }))
        done++
        setBulkProgress(done)
      } catch {
        toast.error('Stopped early. The rest are still waiting for you.')
        break
      }
    }
    refresh()
    setBulkProgress(null)
    if (done > 0) toast.success(`Added ${done} ${done === 1 ? 'transaction' : 'transactions'}`)
  }

  const top = visible[0]
  const allDone = !query.isLoading && visible.length === 0 && !query.hasNextPage

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-lg">
        <header className="sticky top-0 z-20 space-y-3 bg-background/85 px-4 pb-3 pt-[calc(1rem+env(safe-area-inset-top))] backdrop-blur-xl">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Needs review</h1>
              <p className="text-sm text-muted-foreground">
                {allDone ? 'Nothing waiting for you.' : left === 1 ? '1 message left' : `${left} messages left`}
              </p>
            </div>
            {total > 0 && !allDone && (
              <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium tabular-nums">
                {handled} of {total} done
              </span>
            )}
          </div>
          {total > 0 && (
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-emerald-400 transition-[width] duration-500" style={{ width: `${(handled / total) * 100}%` }} />
            </div>
          )}
          {!allDone && visible.length > 0 && (
            <Segmented
              options={[
                { key: 'swipe', label: 'Swipe' },
                { key: 'list', label: 'List' },
              ]}
              value={mode}
              onChange={setMode}
            />
          )}
        </header>

        <div className="space-y-5 px-4 pb-10 pt-2">
          {/* bulk confirm */}
          {likely.length >= 2 && (
            <div className="flex items-center gap-3 rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-300">
                <Sparkles className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{likely.length} look right already</p>
                <p className="text-xs text-muted-foreground">Add them all in one go, or go through them yourself.</p>
              </div>
              <Button
                size="sm"
                className="h-9"
                variant={bulkAsk ? 'default' : 'outline'}
                disabled={bulkProgress !== null}
                onClick={() => (bulkAsk ? void runBulk() : setBulkAsk(true))}
              >
                {bulkProgress !== null ? `${bulkProgress}/${likely.length + bulkProgress}` : bulkAsk ? 'Tap to confirm' : 'Add all'}
              </Button>
            </div>
          )}

          {query.isLoading && <Skeleton className="h-96 w-full rounded-3xl" />}

          {allDone && <AllCaughtUp stats={stats} />}

          {/* swipe mode */}
          {mode === 'swipe' && top && (
            <>
              <div className="relative pb-6">
                {visible.slice(1, 3).map((e, i) => (
                  <div
                    key={e.id}
                    aria-hidden
                    className="absolute inset-x-0 top-0 bottom-6 rounded-3xl border border-border bg-card"
                    style={{
                      transform: `translateY(${(i + 1) * 10}px) scale(${1 - (i + 1) * 0.05})`,
                      opacity: 1 - (i + 1) * 0.3,
                      zIndex: -i - 1,
                    }}
                  />
                ))}
                <ReviewCard
                  key={top.id}
                  event={top}
                  categories={categoryList.slice(0, 8)}
                  picked={picked[top.id] ?? null}
                  onPick={(id) => setPicked((p) => ({ ...p, [top.id]: id }))}
                  onMore={() => setEditing(top)}
                  onDecide={(dir) => decide(top, dir)}
                  flying={flying?.id === top.id ? flying.dir : null}
                />
              </div>

              <div className="flex items-center justify-center gap-5">
                <Button
                  variant="outline"
                  className="size-14 rounded-full border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
                  aria-label="Dismiss"
                  disabled={!!flying}
                  onClick={() => decide(top, 'dismiss')}
                >
                  <X className="size-6" />
                </Button>
                <Button variant="outline" className="size-12 rounded-full" aria-label="Edit details" disabled={!!flying} onClick={() => setEditing(top)}>
                  <Pencil className="size-5" />
                </Button>
                <Button className="size-14 rounded-full bg-emerald-500 text-white hover:bg-emerald-500/90" aria-label="Add as a transaction" disabled={!!flying} onClick={() => decide(top, 'confirm')}>
                  <Check className="size-6" />
                </Button>
              </div>
              <p className="text-center text-xs text-muted-foreground">Swipe right to add, left to dismiss.</p>
            </>
          )}

          {/* list mode */}
          {mode === 'list' && visible.length > 0 && (
            <ul className="divide-y divide-border/60 overflow-hidden rounded-3xl border border-border bg-card">
              {visible.map((e) => (
                <ListRow key={e.id} event={e} onEdit={() => setEditing(e)} onConfirm={() => decide(e, 'confirm', false)} onDismiss={() => decide(e, 'dismiss', false)} />
              ))}
            </ul>
          )}
        </div>
      </div>

      <ReviewDrawer
        event={editing}
        categories={categoryList}
        initialCategoryId={editing ? (picked[editing.id] ?? null) : null}
        onClose={() => setEditing(null)}
        onDone={(id) => {
          setGone((g) => new Set(g).add(id))
          setStats((s) => ({ ...s, confirmed: s.confirmed + 1 }))
          setEditing(null)
        }}
      />
    </div>
  )
}

/* ───────────────────────────── swipe card ─────────────────────────────
   The showy part: drag it, tilt it, and it stamps "Add" or "Dismiss".    */

function ReviewCard({
  event,
  categories,
  picked,
  onPick,
  onMore,
  onDecide,
  flying,
}: {
  event: RawEvent
  categories: Category[]
  picked: string | null
  onPick: (id: string | null) => void
  onMore: () => void
  onDecide: (dir: Decision) => void
  flying: Decision | null
}) {
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startX = useRef<number | null>(null)
  const crossed = useRef(false)

  const credit = event.parsed?.direction === 'CREDIT'
  const conf = confidenceOf(event)
  const info = confidenceInfo(conf)
  const amount = event.parsed?.amountMinor
  const progress = Math.min(1, Math.abs(dx) / SWIPE_THRESHOLD)

  const transform = flying
    ? `translateX(${flying === 'confirm' ? 560 : -560}px) rotate(${flying === 'confirm' ? 22 : -22}deg)`
    : `translateX(${dx}px) rotate(${dx / 18}deg)`

  return (
    <article
      className="relative touch-pan-y select-none rounded-3xl border border-border bg-card p-5 shadow-xl shadow-black/20"
      style={{
        transform,
        opacity: flying ? 0 : 1,
        transition: dragging ? 'none' : 'transform 220ms ease-out, opacity 220ms ease-out',
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('[data-nodrag]')) return
        startX.current = e.clientX
        crossed.current = false
        setDragging(true)
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (startX.current == null) return
        const next = e.clientX - startX.current
        setDx(next)
        const over = Math.abs(next) > SWIPE_THRESHOLD
        if (over && !crossed.current) buzz(6)
        crossed.current = over
      }}
      onPointerUp={() => {
        if (startX.current == null) return
        startX.current = null
        setDragging(false)
        const final = dx
        setDx(0)
        if (final > SWIPE_THRESHOLD) onDecide('confirm')
        else if (final < -SWIPE_THRESHOLD) onDecide('dismiss')
      }}
      onPointerCancel={() => {
        startX.current = null
        setDragging(false)
        setDx(0)
      }}
    >
      {/* stamps */}
      <span
        className="pointer-events-none absolute left-5 top-5 -rotate-12 rounded-xl border-2 border-emerald-400 px-3 py-1 text-lg font-bold text-emerald-300"
        style={{ opacity: dx > 0 ? progress : 0 }}
      >
        Add
      </span>
      <span
        className="pointer-events-none absolute right-5 top-5 rotate-12 rounded-xl border-2 border-rose-400 px-3 py-1 text-lg font-bold text-rose-300"
        style={{ opacity: dx < 0 ? progress : 0 }}
      >
        Dismiss
      </span>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="truncate font-medium text-foreground">{sourceOf(event)}</span>
        <span className="shrink-0">{formatRelativeTime(event.postedAt)}</span>
      </div>

      {/* what the parser understood */}
      <div className="mt-4 text-center">
        <p className={cn('font-display text-5xl font-bold tracking-tight tabular-nums', amount == null && 'text-muted-foreground/50')}>
          {amount != null ? (
            <>
              <span className={credit ? 'text-emerald-400' : 'text-foreground'}>{credit ? '+' : ''}</span>
              {formatMinor(amount)}
            </>
          ) : (
            'No amount'
          )}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {credit ? 'Income' : 'Spend'}
          {event.parsed?.merchant ? (
            <>
              {credit ? ' from ' : ' at '}
              <span className="font-medium text-foreground">{event.parsed.merchant}</span>
            </>
          ) : (
            ', merchant unknown'
          )}
        </p>
        <div className="mx-auto mt-3 flex w-40 flex-col items-center gap-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className={cn('h-full rounded-full transition-[width] duration-500', info.bar)} style={{ width: `${Math.max(6, conf * 100)}%` }} />
          </div>
          <span className={cn('text-xs font-medium', info.text)}>
            {info.word}, {Math.round(conf * 100)}%
          </span>
        </div>
      </div>

      {/* the original message */}
      <div className="mt-5 rounded-2xl bg-muted/60 p-3.5">
        <p className="mb-1 text-xs text-muted-foreground">The message</p>
        <p data-nodrag className="max-h-32 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
          <Highlighted text={messageOf(event)} merchant={event.parsed?.merchant} />
        </p>
      </div>

      {/* quick category */}
      <div className="mt-4 space-y-2">
        <p className="text-xs text-muted-foreground">Category (optional)</p>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <CategoryChips categories={categories} value={picked} onChange={onPick} />
          </div>
          <button data-nodrag type="button" onClick={onMore} className="h-9 shrink-0 rounded-xl border border-border px-3 text-sm text-muted-foreground active:bg-muted">
            More
          </button>
        </div>
      </div>
    </article>
  )
}

/* ───────────────────────────── list row ───────────────────────────── */

function ListRow({
  event,
  onEdit,
  onConfirm,
  onDismiss,
}: {
  event: RawEvent
  onEdit: () => void
  onConfirm: () => void
  onDismiss: () => void
}) {
  const credit = event.parsed?.direction === 'CREDIT'
  const amount = event.parsed?.amountMinor
  const info = confidenceInfo(confidenceOf(event))
  return (
    <li className="flex items-center gap-2 px-3 py-3">
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{event.parsed?.merchant ?? sourceOf(event)}</span>
          <span className={cn('shrink-0 text-sm font-semibold tabular-nums', credit && 'text-emerald-400')}>
            {amount != null ? `${credit ? '+' : '−'}${formatMinor(amount)}` : 'No amount'}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span className={cn('size-1.5 shrink-0 rounded-full', info.bar)} />
          <span className="truncate">{messageOf(event)}</span>
        </div>
      </button>
      <Button size="icon" variant="ghost" className="size-10 text-rose-300" aria-label="Dismiss" onClick={onDismiss}>
        <X className="size-4" />
      </Button>
      <Button size="icon" variant="ghost" className="size-10 text-emerald-300" aria-label="Add as a transaction" onClick={onConfirm}>
        <Check className="size-5" />
      </Button>
    </li>
  )
}

/* ───────────────────────────── all caught up ───────────────────────────── */

function AllCaughtUp({ stats }: { stats: { confirmed: number; dismissed: number } }) {
  const worked = stats.confirmed + stats.dismissed > 0
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl border border-emerald-500/20 bg-card px-6 py-14 text-center">
      <span className="flex size-20 animate-in zoom-in-50 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300 duration-500">
        <Check className="size-10" strokeWidth={2.5} />
      </span>
      <div>
        <h2 className="font-display text-2xl font-bold tracking-tight">All caught up</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {worked
            ? `You added ${stats.confirmed} and dismissed ${stats.dismissed} this time.`
            : 'Every message was understood. New doubtful ones will land here.'}
        </p>
      </div>
      <Button variant="outline" asChild>
        <Link to="/transactions">See your transactions</Link>
      </Button>
    </div>
  )
}

/* ───────────────────────────── edit drawer ───────────────────────────── */

function ReviewDrawer({
  event,
  categories,
  initialCategoryId,
  onClose,
  onDone,
}: {
  event: RawEvent | null
  categories: Category[]
  initialCategoryId: string | null
  onClose: () => void
  onDone: (id: string) => void
}) {
  const client = useQueryClient()
  const [amount, setAmount] = useState('')
  const [merchant, setMerchant] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)

  useEffect(() => {
    if (!event) return
    setAmount(event.parsed?.amountMinor != null ? (event.parsed.amountMinor / 100).toFixed(2) : '')
    setMerchant(event.parsed?.merchant ?? '')
    setCategoryId(initialCategoryId)
  }, [event?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const minor = parseMajorToMinor(amount) ?? 0
  const credit = event?.parsed?.direction === 'CREDIT'

  const confirm = useMutation({
    mutationFn: () =>
      LocalExpense.confirmEvent({
        id: event!.id,
        amountMinor: minor || (event!.parsed?.amountMinor ?? undefined),
        merchantName: merchant.trim() || undefined,
        categoryId: categoryId ?? undefined,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['rawEvents'] })
      void client.invalidateQueries({ queryKey: ['transactions'] })
      void client.invalidateQueries({ queryKey: queryKeys.ingestionStats })
      toast.success('Added as a transaction')
      onDone(event!.id)
    },
    onError: () => toast.error('Could not add this one. Try again.'),
  })

  return (
    <Drawer open={event !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="pb-2">
          <DrawerTitle>Check the details</DrawerTitle>
          <DrawerDescription>Fix anything the app got wrong, then add it.</DrawerDescription>
        </DrawerHeader>

        <div className="space-y-5 overflow-y-auto px-4 pb-2">
          {event && (
            <div className="rounded-2xl bg-muted/60 p-3.5 text-sm leading-relaxed">
              <Highlighted text={messageOf(event)} merchant={merchant || event.parsed?.merchant} />
            </div>
          )}

          <div className="flex items-baseline justify-center gap-1.5">
            <span className="text-3xl font-medium text-muted-foreground">{currencySymbol}</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="0"
              aria-label="Amount"
              className={cn('w-48 bg-transparent text-center text-5xl font-semibold tabular-nums outline-none placeholder:text-muted-foreground/40', credit && 'text-emerald-400')}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Merchant</Label>
            <Input className="h-11" value={merchant} placeholder="Unknown merchant" onChange={(e) => setMerchant(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Category</Label>
            <CategoryChips categories={categories} value={categoryId} onChange={setCategoryId} wrap />
          </div>
        </div>

        <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button className="h-12 text-base" onClick={() => confirm.mutate()} disabled={confirm.isPending || (minor <= 0 && !event?.parsed?.amountMinor)}>
            {confirm.isPending ? 'Adding…' : 'Add transaction'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}