import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import type { Transaction } from '@/lib/plugin'
import { LocalExpense } from '@/lib/plugin'
import { queryKeys, type TransactionFilters } from '@/lib/query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatMinor, parseMajorToMinor } from '@/lib/money'
import { formatDateTime, formatRelativeTime } from '@/lib/format'

type FilterKey = 'all' | 'debit' | 'credit'
type RangeKey = 'all' | '7d' | '30d' | '90d'

const filtersFor: Record<FilterKey, TransactionFilters> = {
  all: { status: 'ACTIVE', direction: null, categoryId: null },
  debit: { status: 'ACTIVE', direction: 'DEBIT', categoryId: null },
  credit: { status: 'ACTIVE', direction: 'CREDIT', categoryId: null },
}

const ranges: { key: RangeKey; label: string; days: number | null }[] = [
  { key: 'all', label: 'All time', days: null },
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
]

export function TransactionsPage() {
  const [tab, setTab] = useState<FilterKey>('all')
  const [range, setRange] = useState<RangeKey>('all')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [adding, setAdding] = useState(false)
  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState<'DEBIT' | 'CREDIT'>('DEBIT')
  const [newCategoryId, setNewCategoryId] = useState<string | null>(null)
  const [merchant, setMerchant] = useState('')
  const [note, setNote] = useState('')
  const [wheel, setWheel] = useState<{ x: number; y: number; transaction: Transaction } | null>(null)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null)
  const hoveredCategoryRef = useRef<string | null>(null)
  const longPressTimer = useRef<number | null>(null)
  const startPos = useRef<{ x: number; y: number } | null>(null)
  const didLongPress = useRef(false)
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

  const allTransactions = query.data?.pages.flatMap((page) => page.items) ?? []
  const transactions = accountId ? allTransactions.filter((t) => t.accountId === accountId) : allTransactions

  useEffect(() => {
    if (!wheel) {
      hoveredCategoryRef.current = null
      return
    }
    const onMove = (e: PointerEvent) => {
      setDragPos({ x: e.clientX, y: e.clientY })
      const cats = (categories.data?.categories ?? []).slice(0, 8)
      const radius = 96
      let nearest: string | null = null
      let min = 42
      cats.forEach((cat, index) => {
        const angle = (index / cats.length) * Math.PI * 2 - Math.PI / 2
        const cx = wheel.x + radius * Math.cos(angle)
        const cy = wheel.y + radius * Math.sin(angle)
        const d = Math.hypot(e.clientX - cx, e.clientY - cy)
        if (d < min) {
          min = d
          nearest = cat.id
        }
      })
      hoveredCategoryRef.current = nearest
      setHoveredCategory(nearest)
    }
    const onUp = () => {
      const selected = hoveredCategoryRef.current
      if (wheel && selected) {
        LocalExpense.correctTransaction({ id: wheel.transaction.id, categoryId: selected })
          .then(() => {
            void client.invalidateQueries({ queryKey: ['transactions'] })
            toast.success('Category updated')
          })
          .catch(() => toast.error('Could not update category'))
      }
      setWheel(null)
      setDragPos(null)
      setHoveredCategory(null)
      hoveredCategoryRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [wheel, categories.data])

  const client = useQueryClient()
  const addTx = useMutation({
    mutationFn: () =>
      LocalExpense.createManualTransaction({
        amountMinor: parseMajorToMinor(amount) ?? 0,
        direction,
        kind: direction === 'CREDIT' ? 'INCOME' : 'SPEND',
        categoryId: newCategoryId,
        merchantName: merchant || null,
        note: note || null,
      }),
    onSuccess: () => {
      setAdding(false)
      setAmount('')
      setMerchant('')
      setNote('')
      void client.invalidateQueries({ queryKey: ['transactions'] })
      toast.success('Transaction added')
    },
    onError: () => toast.error('Could not add transaction'),
  })

  return (
    <div className="mx-auto block h-full max-w-lg space-y-4 overflow-y-auto px-4 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-6">
      <header className="shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Transactions</h1>
          <p className="text-sm text-muted-foreground">
            Everything the app understood as spending or income.
          </p>
        </div>
        <Button size="sm" onClick={() => setAdding(true)}>
          Add
        </Button>
      </header>

      <Tabs className="shrink-0" value={tab} onValueChange={(value) => setTab(value as FilterKey)}>
        <TabsList className="w-full">
          <TabsTrigger value="all" className="flex-1">
            All
          </TabsTrigger>
          <TabsTrigger value="debit" className="flex-1">
            Spent
          </TabsTrigger>
          <TabsTrigger value="credit" className="flex-1">
            Income
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex shrink-0 flex-wrap gap-2">
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as RangeKey)}
          className="h-9 rounded-xl border border-border bg-card px-3 text-xs text-foreground"
        >
          {ranges.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
            </option>
          ))}
        </select>
        <select
          value={accountId ?? ''}
          onChange={(e) => setAccountId(e.target.value || null)}
          className="h-9 rounded-xl border border-border bg-card px-3 text-xs text-foreground"
        >
          <option value="">All accounts</option>
          {accounts.data?.accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
        <select
          value={categoryId ?? ''}
          onChange={(e) => setCategoryId(e.target.value || null)}
          className="h-9 rounded-xl border border-border bg-card px-3 text-xs text-foreground"
        >
          <option value="">All categories</option>
          {categories.data?.categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <Drawer open={adding} onOpenChange={setAdding}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Add transaction</DrawerTitle>
            <DrawerDescription>Enter a transaction that never arrived as a notification.</DrawerDescription>
          </DrawerHeader>
          <div className="space-y-3 px-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={direction === 'DEBIT' ? 'secondary' : 'outline'}
                className="flex-1"
                onClick={() => setDirection('DEBIT')}
              >
                Spent
              </Button>
              <Button
                type="button"
                variant={direction === 'CREDIT' ? 'secondary' : 'outline'}
                className="flex-1"
                onClick={() => setDirection('CREDIT')}
              >
                Income
              </Button>
            </div>
            <div className="space-y-1">
              <Label htmlFor="amount">Amount</Label>
              <Input id="amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={categoryId ?? ''}
                onChange={(e) => setNewCategoryId(e.target.value || null)}
              >
                <option value="">Uncategorised</option>
                {categories.data?.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="merchant">Merchant</Label>
              <Input id="merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="note">Note</Label>
              <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>

        <DrawerFooter>
            <Button onClick={() => addTx.mutate()} disabled={addTx.isPending || !amount}>
              {addTx.isPending ? 'Adding…' : 'Add'}
            </Button>
            <Button variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <div className="space-y-2 pb-4">
        {query.isLoading &&
          Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}

        {!query.isLoading && transactions.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nothing here yet. Transactions appear as notifications arrive.
          </p>
        )}

        {transactions.map((transaction) => (
          <button
            key={transaction.id}
            type="button"
            className="flex w-full touch-pan-y select-none items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left active:bg-muted"
            onClick={() => {
              if (didLongPress.current) {
                didLongPress.current = false
                return
              }
              setEditing(transaction)
            }}
            onPointerDown={(e) => {
              startPos.current = { x: e.clientX, y: e.clientY }
              longPressTimer.current = window.setTimeout(() => {
                didLongPress.current = true
                setWheel({ x: e.clientX, y: e.clientY, transaction })
                setDragPos({ x: e.clientX, y: e.clientY })
              }, 450)
            }}
            onPointerMove={(e) => {
              if (longPressTimer.current && startPos.current) {
                if (Math.abs(e.clientX - startPos.current.x) > 10 || Math.abs(e.clientY - startPos.current.y) > 10) {
                  window.clearTimeout(longPressTimer.current)
                  longPressTimer.current = null
                }
              }
            }}
            onPointerUp={() => {
              if (longPressTimer.current) {
                window.clearTimeout(longPressTimer.current)
                longPressTimer.current = null
              }
            }}
            onPointerCancel={() => {
              if (longPressTimer.current) {
                window.clearTimeout(longPressTimer.current)
                longPressTimer.current = null
              }
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <TransactionRow transaction={transaction} />
          </button>
        ))}

        {query.hasNextPage && (
          <Button
            variant="outline"
            className="h-11 w-full"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        )}
      </div>

      {wheel && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-background/40 backdrop-blur-sm" />
          <div
            className="absolute h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-indigo-400 bg-indigo-500/20"
            style={{ left: wheel.x, top: wheel.y }}
          />
          {(categories.data?.categories ?? []).slice(0, 8).map((cat, index) => {
            const cats = (categories.data?.categories ?? []).slice(0, 8)
            const angle = (index / cats.length) * Math.PI * 2 - Math.PI / 2
            const radius = 96
            const x = wheel.x + radius * Math.cos(angle)
            const y = wheel.y + radius * Math.sin(angle)
            const active = hoveredCategory === cat.id
            return (
              <div
                key={cat.id}
                className={`absolute flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-xs font-bold transition-all ${active ? 'scale-125 border-indigo-400 bg-indigo-600 text-white shadow-lg' : 'border-border bg-card text-foreground'}`}
                style={{ left: x, top: y }}
              >
                {categoryEmoji(cat.name)}
              </div>
            )
          })}
          {dragPos && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full">
              <line x1={wheel.x} y1={wheel.y} x2={dragPos.x} y2={dragPos.y} stroke="rgba(99,102,241,0.6)" strokeWidth="2" />
            </svg>
          )}
        </div>
      )}

      <EditDrawer
        transaction={editing}
        onClose={() => setEditing(null)}
        onSaved={() => setEditing(null)}
      />
    </div>
  )
}

function categoryEmoji(name: string) {
  const n = name.toLowerCase()
  if (n.includes('food') || n.includes('dining')) return '🍽️'
  if (n.includes('grocer')) return '🛒'
  if (n.includes('transport') || n.includes('commute')) return '🚗'
  if (n.includes('bill') || n.includes('util')) return '💡'
  if (n.includes('shop')) return '🛍️'
  if (n.includes('health')) return '💊'
  if (n.includes('entertain') || n.includes('leisure')) return '🍿'
  if (n.includes('fee')) return '💳'
  return '📁'
}

function TransactionRow({ transaction }: { transaction: Transaction }) {
  const isCredit = transaction.direction === 'CREDIT'
  return (
    <>
      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl bg-muted text-base">
        {(() => {
          const n = (transaction.categoryName ?? '').toLowerCase()
          if (n.includes('food') || n.includes('dining')) return '🍽️'
          if (n.includes('grocer')) return '🛒'
          if (n.includes('transport') || n.includes('commute')) return '🚗'
          if (n.includes('bill') || n.includes('util')) return '💡'
          if (n.includes('shop')) return '🛍️'
          if (n.includes('health')) return '💊'
          if (n.includes('entertain') || n.includes('leisure')) return '🍿'
          if (n.includes('fee')) return '💳'
          return '📁'
        })()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {transaction.merchantName ?? 'Unknown merchant'}
        </p>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span title={formatDateTime(transaction.occurredAt)}>
            {formatRelativeTime(transaction.occurredAt)}
          </span>
          <Badge variant={isCredit ? 'secondary' : 'outline'} className={`shrink-0 ${isCredit ? 'text-emerald-400' : 'text-rose-400'}`}>
            {isCredit ? 'Income' : 'Spend'}
          </Badge>
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums">
          {isCredit ? '+' : '-'}
          {formatMinor(transaction.amountMinor)}
        </p>
        {transaction.confidence < 0.85 && (
          <p className="text-[0.65rem] text-muted-foreground">low confidence</p>
        )}
      </div>
    </>
  )
}

function EditDrawer({
  transaction,
  onClose,
  onSaved,
}: {
  transaction: Transaction | null
  onClose: () => void
  onSaved: () => void
}) {
  const client = useQueryClient()
  const [draft, setDraft] = useState<{
    key: string
    amount: string
    merchant: string
    note: string
    categoryId: string | null
  } | null>(null)

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => LocalExpense.listCategories(),
  })

  const rawEvent = useQuery({
    queryKey: ['rawEventForTxn', transaction?.id],
    queryFn: async () => {
      if (!transaction?.rawEventId) return null
      const page = await LocalExpense.listRawEvents({ limit: 200 })
      return page.items.find((e) => e.id === transaction.rawEventId) ?? null
    },
    enabled: !!transaction,
  })

  // Rebuild the draft whenever a different transaction is opened.
  if (transaction && draft?.key !== transaction.id) {
    setDraft({
      key: transaction.id,
      amount: (transaction.amountMinor / 100).toFixed(2),
      merchant: transaction.merchantName ?? '',
      note: transaction.note ?? '',
      categoryId: transaction.categoryId,
    })
  }

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
      toast.success('Saved')
      onSaved()
    },
    onError: () => toast.error('Could not save the changes'),
  })

  const selected = categories.data?.categories.find((c) => c.id === draft?.categoryId)

  return (
    <Drawer open={transaction !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Edit transaction</DrawerTitle>
          <DrawerDescription>Corrections are remembered for the app.</DrawerDescription>
        </DrawerHeader>

        <Tabs defaultValue="details" className="px-4">
          <TabsList className="w-full">
            <TabsTrigger value="details" className="flex-1">Details</TabsTrigger>
            <TabsTrigger value="source" className="flex-1">Source</TabsTrigger>
          </TabsList>
          <TabsContent value="source" className="space-y-3 py-3">
            {rawEvent.isLoading && <p className="text-sm text-muted-foreground">Loading source…</p>}
            {!rawEvent.isLoading && !rawEvent.data && (
              <p className="text-sm text-muted-foreground">No source message (manual transaction).</p>
            )}
            {rawEvent.data && (
              <div className="space-y-2 text-sm">
                <div className="rounded-xl border bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">Sender</p>
                  <p className="font-medium">{rawEvent.data.sender ?? rawEvent.data.packageName ?? 'Unknown'}</p>
                </div>
                <div className="rounded-xl border bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">Title</p>
                  <p className="font-medium">{rawEvent.data.title ?? '—'}</p>
                </div>
                <div className="rounded-xl border bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">Message</p>
                  <p className="whitespace-pre-wrap">{rawEvent.data.bigText ?? rawEvent.data.text ?? rawEvent.data.textLines ?? '—'}</p>
                </div>
                <div className="rounded-xl border bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">Posted</p>
                  <p className="font-medium">{new Date(rawEvent.data.postedAt).toLocaleString()}</p>
                </div>
                <div className="rounded-xl border bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="font-medium">{rawEvent.data.status}</p>
                </div>
              </div>
            )}
          </TabsContent>
          <TabsContent value="details" className="space-y-4 py-3">
            <div className="space-y-1.5">
            <Label>Amount</Label>
            <Input
              className="h-11"
              inputMode="decimal"
              value={draft?.amount ?? ''}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, amount: event.target.value } : current,
                )
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label>Merchant</Label>
            <Input
              className="h-11"
              value={draft?.merchant ?? ''}
              placeholder="Unknown merchant"
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, merchant: event.target.value } : current,
                )
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label>Category</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="h-11 w-full justify-between">
                  {selected?.name ?? 'Choose a category'}
                  <ChevronDown className="size-4 opacity-60" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                <Command>
                  <CommandInput placeholder="Search categories" />
                  <CommandList>
                    <CommandEmpty>No category found.</CommandEmpty>
                    <CommandGroup>
                      {categories.data?.categories.map((category) => (
                        <CommandItem
                          key={category.id}
                          value={category.name}
                          onSelect={() =>
                            setDraft((current) =>
                              current ? { ...current, categoryId: category.id } : current,
                            )
                          }
                        >
                          <Check
                            className={
                              category.id === draft?.categoryId
                                ? 'size-4 opacity-100'
                                : 'size-4 opacity-0'
                            }
                          />
                          {category.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1.5">
            <Label>Note</Label>
            <Input
              className="h-11"
              value={draft?.note ?? ''}
              placeholder="What was this for?"
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, note: event.target.value } : current,
                )
              }
            />
          </div>

          </TabsContent>
        </Tabs>

        <DrawerFooter>
          <div className="mx-auto flex w-full max-w-lg gap-2 pb-[env(safe-area-inset-bottom)]">
            <Button variant="outline" className="h-11 flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              className="h-11 flex-1"
              onClick={() => save.mutate()}
              disabled={save.isPending}
            >
              Save
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
