import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Bell,
  Check,
  ChevronDown,
  CircleDashed,
  Eye,
  EyeOff,
  Inbox,
  MessageSquare,
  Search,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import type { RawEvent, RawEventStatus } from '@/lib/plugin'
import { LocalExpense } from '@/lib/plugin'
import { queryKeys, type RawEventFilters } from '@/lib/query'
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
import { Skeleton } from '@/components/ui/skeleton'
import { formatMinor } from '@/lib/money'
import { formatDateTime, formatRelativeTime } from '@/lib/format'

/* ────────────────────────────── config ────────────────────────────── */

type FilterKey = 'all' | 'parsed' | 'review' | 'ignored' | 'dismissed'
type SourceKey = 'all' | 'sms' | 'notification'

const filtersFor: Record<FilterKey, RawEventFilters> = {
  all: { status: null, source: null },
  parsed: { status: 'PARSED' as RawEventStatus, source: null },
  review: { status: 'NEEDS_REVIEW' as RawEventStatus, source: null },
  ignored: { status: 'IGNORED' as RawEventStatus, source: null },
  dismissed: { status: 'DISMISSED' as RawEventStatus, source: null },
}

const TABS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'parsed', label: 'Transactions' },
  { key: 'review', label: 'Needs review' },
  { key: 'ignored', label: 'Ignored' },
  { key: 'dismissed', label: 'Removed' },
]

const SOURCES: { key: SourceKey; label: string }[] = [
  { key: 'all', label: 'All sources' },
  { key: 'sms', label: 'SMS' },
  { key: 'notification', label: 'Notifications' },
]

const STATUS: Record<RawEventStatus, { label: string; chip: string; bar: string; icon: React.ReactNode; tab: FilterKey | null }> = {
  PARSED: { label: 'Became a transaction', chip: 'bg-emerald-500/15 text-emerald-300', bar: 'bg-emerald-400', icon: <Check className="size-3" />, tab: 'parsed' },
  NEEDS_REVIEW: { label: 'Needs review', chip: 'bg-amber-500/15 text-amber-300', bar: 'bg-amber-400', icon: <Eye className="size-3" />, tab: 'review' },
  CAPTURED: { label: 'Not read yet', chip: 'bg-sky-500/15 text-sky-300', bar: 'bg-sky-400', icon: <CircleDashed className="size-3" />, tab: null },
  IGNORED: { label: 'Ignored', chip: 'bg-muted text-muted-foreground', bar: 'bg-slate-400', icon: <EyeOff className="size-3" />, tab: 'ignored' },
  DISMISSED: { label: 'Removed', chip: 'bg-rose-500/15 text-rose-300', bar: 'bg-rose-400', icon: <X className="size-3" />, tab: 'dismissed' },
}

const STATUS_ORDER: RawEventStatus[] = ['PARSED', 'NEEDS_REVIEW', 'CAPTURED', 'IGNORED', 'DISMISSED']
const hideScrollbar = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

/* ────────────────────────────── helpers ────────────────────────────── */

const messageOf = (e: RawEvent) => e.bigText ?? e.text ?? e.textLines ?? 'No text'
const shortSource = (e: RawEvent) => e.sender ?? (e.packageName ? (e.packageName.split('.').pop() ?? e.packageName) : 'Unknown')
const titleOf = (e: RawEvent) => e.title ?? e.sender ?? (e.packageName ? (e.packageName.split('.').pop() ?? e.packageName) : 'Notification')
const isSms = (e: RawEvent) => e.source === 'SMS'

function dayLabel(ts: number) {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  })
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
        active ? 'border-indigo-400/60 bg-indigo-500/15 text-indigo-200' : 'border-border bg-card text-muted-foreground active:bg-muted',
      )}
    >
      {children}
    </button>
  )
}

/* ───────────────────────────── page ───────────────────────────── */

export function HistoryPage() {
  const [tab, setTab] = useState<FilterKey>('all')
  const [sourceKey, setSourceKey] = useState<SourceKey>('all')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<RawEvent | null>(null)
  const sentinel = useRef<HTMLDivElement | null>(null)
  const filters = filtersFor[tab]

  const query = useInfiniteQuery({
    queryKey: queryKeys.rawEventFeed(filters),
    queryFn: ({ pageParam }) =>
      LocalExpense.listRawEvents({
        status: filters.status,
        source: filters.source,
        cursor: pageParam,
        limit: 30,
      }),
    initialPageParam: null as { postedAt: number; id: string } | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })

  const events = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return events.filter((e) => {
      if (sourceKey === 'sms' && !isSms(e)) return false
      if (sourceKey === 'notification' && isSms(e)) return false
      if (q && !`${titleOf(e)} ${shortSource(e)} ${messageOf(e)} ${e.transaction?.merchantName ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [events, sourceKey, search])

  const groups = useMemo(() => {
    const out: { label: string; items: RawEvent[] }[] = []
    for (const e of shown) {
      const label = dayLabel(e.postedAt)
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(e)
      else out.push({ label, items: [e] })
    }
    return out
  }, [shown])

  const counts = useMemo(() => {
    const c: Partial<Record<RawEventStatus, number>> = {}
    for (const e of events) c[e.status] = (c[e.status] ?? 0) + 1
    return c
  }, [events])

  const filtering = !!search.trim() || sourceKey !== 'all'

  // infinite scroll
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

  // searching or filtering should dig deeper when the loaded pages come up short
  useEffect(() => {
    if (filtering && shown.length < 8 && query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage()
  }, [filtering, shown.length, query.hasNextPage, query.isFetchingNextPage]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-lg">
        <header className="sticky top-0 z-20 space-y-3 bg-background/85 px-4 pb-3 pt-[calc(1rem+env(safe-area-inset-top))] backdrop-blur-xl">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">History</h1>
            <p className="text-sm text-muted-foreground">Every message the app read, and what it did with it.</p>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search bank, merchant or message text"
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

          <div className="-mx-4 space-y-2">
            <div className={cn('flex gap-2 overflow-x-auto px-4', hideScrollbar)}>
              {TABS.map((t) => (
                <Chip key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
                  {t.label}
                </Chip>
              ))}
            </div>
            <div className={cn('flex gap-2 overflow-x-auto px-4', hideScrollbar)}>
              {SOURCES.map((s) => (
                <Chip key={s.key} active={sourceKey === s.key} onClick={() => setSourceKey(s.key)}>
                  {s.key === 'sms' && <MessageSquare className="size-3" />}
                  {s.key === 'notification' && <Bell className="size-3" />}
                  {s.label}
                </Chip>
              ))}
            </div>
          </div>
        </header>

        <div className="space-y-5 px-4 pb-10 pt-2">
          {tab === 'all' && events.length > 0 && !query.isLoading && (
            <ReadingBar counts={counts} total={events.length} onPick={(t) => setTab(t)} />
          )}

          {query.isLoading && (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3 px-2">
                  <Skeleton className="size-10 rounded-2xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-1/2" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!query.isLoading && shown.length === 0 && !query.hasNextPage && (
            <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-12 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Inbox className="size-6" />
              </span>
              {filtering ? (
                <>
                  <div>
                    <p className="font-medium">No matches</p>
                    <p className="mt-1 text-sm text-muted-foreground">Nothing in the messages loaded so far fits that search.</p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch('')
                      setSourceKey('all')
                    }}
                  >
                    Clear search and filters
                  </Button>
                </>
              ) : (
                <div>
                  <p className="font-medium">No messages here</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {tab === 'all' ? 'Bank alerts will show up as they arrive.' : 'Nothing has this status right now.'}
                  </p>
                </div>
              )}
            </div>
          )}

          {groups.map((g) => (
            <section key={g.label}>
              <div className="sticky top-[calc(10.75rem+env(safe-area-inset-top))] z-10 -mx-4 bg-background/85 px-5 py-1.5 backdrop-blur-md">
                <h2 className="text-sm font-semibold">{g.label}</h2>
              </div>
              <ul className="divide-y divide-border/50">
                {g.items.map((e) => (
                  <EventRow key={e.id} event={e} onOpen={() => setOpen(e)} />
                ))}
              </ul>
            </section>
          ))}

          <div ref={sentinel} className="h-1" />
          {query.isFetchingNextPage && <Skeleton className="h-16 w-full rounded-2xl" />}
          {!query.hasNextPage && shown.length > 0 && <p className="pt-2 text-center text-xs text-muted-foreground">That's the whole history.</p>}
        </div>
      </div>

      <EventDrawer event={open} onClose={() => setOpen(null)} />
    </div>
  )
}

/* ───────────────────────────── reading bar ─────────────────────────────
   The showy part: how your messages were read, as one tappable bar.     */

function ReadingBar({
  counts,
  total,
  onPick,
}: {
  counts: Partial<Record<RawEventStatus, number>>
  total: number
  onPick: (tab: FilterKey) => void
}) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])
  const parsed = counts.PARSED ?? 0

  return (
    <section className="rounded-3xl border border-border bg-card p-4">
      <p className="text-sm">
        <span className="font-semibold">{parsed}</span> of the last {total} {total === 1 ? 'message' : 'messages'} became {parsed === 1 ? 'a transaction' : 'transactions'}.
      </p>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-muted">
        {STATUS_ORDER.map((s) => {
          const n = counts[s] ?? 0
          if (n === 0) return null
          return (
            <button
              key={s}
              type="button"
              aria-label={`${STATUS[s].label}: ${n}`}
              disabled={!STATUS[s].tab}
              onClick={() => STATUS[s].tab && onPick(STATUS[s].tab!)}
              className={cn('h-full border-r border-background/60 transition-[width] duration-700 ease-out last:border-r-0 motion-reduce:transition-none', STATUS[s].bar)}
              style={{ width: ready ? `${(n / total) * 100}%` : '0%' }}
            />
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {STATUS_ORDER.filter((s) => (counts[s] ?? 0) > 0).map((s) => (
          <button
            key={s}
            type="button"
            disabled={!STATUS[s].tab}
            onClick={() => STATUS[s].tab && onPick(STATUS[s].tab!)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground enabled:active:text-foreground"
          >
            <span className={cn('size-2 rounded-full', STATUS[s].bar)} />
            {STATUS[s].label} <span className="font-medium tabular-nums text-foreground">{counts[s]}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

/* ───────────────────────────── row ───────────────────────────── */

function EventRow({ event, onOpen }: { event: RawEvent; onOpen: () => void }) {
  const st = STATUS[event.status]
  const removed = event.status === 'DISMISSED'
  const tx = event.transaction

  return (
    <li>
      <button type="button" onClick={onOpen} className={cn('flex w-full items-start gap-3 px-1 py-3.5 text-left active:bg-muted/50', removed && 'opacity-60')}>
        <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          {isSms(event) ? <MessageSquare className="size-[1.15rem]" /> : <Bell className="size-[1.15rem]" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className={cn('truncate text-sm font-medium', removed && 'line-through')}>{titleOf(event)}</p>
            <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(event.postedAt)}</span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{messageOf(event)}</p>

          {tx ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs">
              <ArrowRight className="size-3 shrink-0 text-emerald-400" />
              <span className="font-semibold tabular-nums">{formatMinor(tx.amountMinor)}</span>
              {tx.merchantName && <span className="truncate text-muted-foreground">{tx.merchantName}</span>}
              {tx.categoryName && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[0.7rem] text-muted-foreground">{tx.categoryName}</span>}
            </p>
          ) : (
            <span className={cn('mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', st.chip)}>
              {st.icon}
              {st.label}
            </span>
          )}
          {event.duplicateOf && <p className="mt-1 text-xs text-muted-foreground">Looks like a duplicate of an earlier message.</p>}
        </div>
      </button>
    </li>
  )
}

/* ───────────────────────────── detail drawer ───────────────────────────── */

function EventDrawer({ event, onClose }: { event: RawEvent | null; onClose: () => void }) {
  const client = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [techOpen, setTechOpen] = useState(false)

  useEffect(() => {
    setConfirmDelete(false)
    setTechOpen(false)
  }, [event?.id])

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['rawEvents'] })
    void client.invalidateQueries({ queryKey: ['transactions'] })
    void client.invalidateQueries({ queryKey: queryKeys.ingestionStats })
  }

  const dismiss = useMutation({
    mutationFn: () => LocalExpense.dismissEvent({ id: event!.id }),
    onSuccess: () => {
      const id = event!.id
      refresh()
      onClose()
      toast('Removed', {
        description: 'The transaction and its effects were undone.',
        duration: 8000,
        action: {
          label: 'Undo',
          onClick: () => void LocalExpense.restoreEvent({ id }).then(refresh),
        },
      })
    },
    onError: () => toast.error('Could not remove this message. Try again.'),
  })

  const restore = useMutation({
    mutationFn: () => LocalExpense.restoreEvent({ id: event!.id }),
    onSuccess: () => {
      refresh()
      onClose()
      toast.success('Restored')
    },
    onError: () => toast.error('Could not restore this message. Try again.'),
  })

  const ignore = useMutation({
    mutationFn: () => LocalExpense.createIgnoreRule({ id: event!.id }),
    onSuccess: () => {
      refresh()
      onClose()
      toast.success('Similar messages will be ignored from now on')
    },
    onError: () => toast.error('Could not create the rule. Try again.'),
  })

  const promote = useMutation({
    mutationFn: (kind: 'SPEND' | 'INCOME') =>
      LocalExpense.promoteEvent({
        id: event!.id,
        as: kind,
        amountMinor: event!.transaction?.amountMinor,
        merchantName: event!.transaction?.merchantName ?? undefined,
      }),
    onSuccess: ({ promoted }) => {
      refresh()
      onClose()
      if (promoted) toast.success('Marked as a transaction')
    },
    onError: () => toast.error('Could not mark this message. Try again.'),
  })

  const removeForever = useMutation({
    mutationFn: () => LocalExpense.deleteRawEvent({ id: event!.id }),
    onSuccess: () => {
      refresh()
      onClose()
      toast.success('Deleted permanently')
    },
    onError: () => toast.error('Could not delete this message. Try again.'),
  })

  const busy = dismiss.isPending || restore.isPending || ignore.isPending || promote.isPending || removeForever.isPending
  const removed = event?.status === 'DISMISSED'
  const st = event ? STATUS[event.status] : null
  const tx = event?.transaction

  return (
    <Drawer open={event !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="max-h-[92dvh]">
        {event && st && (
          <>
            <DrawerHeader className="items-center pb-2 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                {isSms(event) ? <MessageSquare className="size-6" /> : <Bell className="size-6" />}
              </span>
              <DrawerTitle className="mt-2">{titleOf(event)}</DrawerTitle>
              <DrawerDescription>
                {isSms(event) ? 'SMS' : 'Notification'} from {shortSource(event)}, {formatRelativeTime(event.postedAt)}
              </DrawerDescription>
              <span className={cn('mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium', st.chip)}>
                {st.icon}
                {st.label}
              </span>
            </DrawerHeader>

            <div className="space-y-4 overflow-y-auto px-4 pb-2">
              <div className="rounded-2xl bg-muted/60 p-3.5">
                <p className="mb-1 text-xs text-muted-foreground">The message</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  <Highlighted text={messageOf(event)} merchant={tx?.merchantName} />
                </p>
              </div>

              {tx && (
                <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-3.5">
                  <ArrowRight className="size-5 shrink-0 text-emerald-300" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">It became</p>
                    <p className="truncate text-sm font-medium">
                      {[tx.merchantName, tx.categoryName].filter(Boolean).join(', ') || 'A transaction'}
                    </p>
                  </div>
                  <p className="text-lg font-bold tabular-nums">{formatMinor(tx.amountMinor)}</p>
                </div>
              )}

              {event.status === 'NEEDS_REVIEW' && (
                <Button asChild className="h-11 w-full">
                  <Link to="/review">Go to the review inbox</Link>
                </Button>
              )}

              {removed ? (
                <Button className="h-11 w-full" disabled={busy} onClick={() => restore.mutate()}>
                  <Undo2 className="size-4" />
                  Restore this message
                </Button>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" className="h-11" disabled={busy} onClick={() => promote.mutate('SPEND')}>
                      Count as spend
                    </Button>
                    <Button variant="outline" className="h-11" disabled={busy} onClick={() => promote.mutate('INCOME')}>
                      Count as income
                    </Button>
                  </div>
                  <Button variant="outline" className="h-11 w-full" disabled={busy} onClick={() => ignore.mutate()}>
                    <EyeOff className="size-4" />
                    Ignore messages like this
                  </Button>
                  <Button variant="ghost" className="h-11 w-full" disabled={busy} onClick={() => dismiss.mutate()}>
                    Remove this one
                  </Button>
                  <p className="px-1 text-xs text-muted-foreground">Removing undoes the transaction and its effect on your balances. You can restore it later.</p>
                </div>
              )}

              {/* technical details */}
              <div className="rounded-2xl border border-border">
                <button type="button" onClick={() => setTechOpen((o) => !o)} className="flex w-full items-center justify-between px-3.5 py-3 text-sm text-muted-foreground">
                  Technical details
                  <ChevronDown className={cn('size-4 transition-transform', techOpen && 'rotate-180')} />
                </button>
                {techOpen && (
                  <dl className="space-y-2.5 border-t border-border px-3.5 py-3 text-xs">
                    <Detail label="Source" value={event.source} />
                    <Detail label="Posted" value={formatDateTime(event.postedAt)} />
                    {event.duplicateOf && <Detail label="Duplicate of" value={event.duplicateOf} />}
                    <Detail label="Notification key" value={event.notificationKey} />
                    <Detail label="Content hash" value={event.contentHash} />
                    {event.textLines && <Detail label="Text lines" value={event.textLines} />}
                  </dl>
                )}
              </div>

              <Button
                variant="ghost"
                className={cn('w-full', confirmDelete ? 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/20' : 'text-muted-foreground')}
                disabled={busy}
                onClick={() => (confirmDelete ? removeForever.mutate() : setConfirmDelete(true))}
              >
                <Trash2 className="size-4" />
                {confirmDelete ? 'Tap again to delete this for good' : 'Delete permanently'}
              </Button>
            </div>

            <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
              <Button variant="outline" className="h-12" onClick={onClose}>
                Close
              </Button>
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-all">{value}</dd>
    </div>
  )
}