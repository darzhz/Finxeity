import { useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, Check, ChevronDown } from 'lucide-react'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [adding, setAdding] = useState(false)
  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState<'DEBIT' | 'CREDIT'>('DEBIT')
  const [newCategoryId, setNewCategoryId] = useState<string | null>(null)
  const [merchant, setMerchant] = useState('')
  const [note, setNote] = useState('')
  const filters = filtersFor[tab]

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => LocalExpense.listCategories(),
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

  const transactions = query.data?.pages.flatMap((page) => page.items) ?? []

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
    <div className="mx-auto flex h-full max-w-lg flex-col gap-4 px-4 pt-[calc(1rem+env(safe-area-inset-top))]">
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

      <div className="flex shrink-0 gap-2 overflow-x-auto pb-1">
        {ranges.map((entry) => (
          <Button
            key={entry.key}
            variant={entry.key === range ? 'secondary' : 'outline'}
            size="sm"
            className="h-9 shrink-0"
            onClick={() => setRange(entry.key)}
          >
            {entry.label}
          </Button>
        ))}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1">
              {categories.data?.categories.find((c) => c.id === categoryId)?.name ?? 'Category'}
              <ChevronDown className="size-3.5 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-0">
            <Command>
              <CommandInput placeholder="Search categories" />
              <CommandList>
                <CommandEmpty>No category found.</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="all categories"
                    onSelect={() => setCategoryId(null)}
                  >
                    <Check className={categoryId === null ? 'size-4 opacity-100' : 'size-4 opacity-0'} />
                    All categories
                  </CommandItem>
                  {categories.data?.categories.map((category) => (
                    <CommandItem
                      key={category.id}
                      value={category.name}
                      onSelect={() => setCategoryId(category.id)}
                    >
                      <Check
                        className={
                          category.id === categoryId ? 'size-4 opacity-100' : 'size-4 opacity-0'
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

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-4">
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
            className="flex w-full items-center gap-3 rounded-lg border p-3 text-left active:bg-muted"
            onClick={() => setEditing(transaction)}
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

      <EditDrawer
        transaction={editing}
        onClose={() => setEditing(null)}
        onSaved={() => setEditing(null)}
      />
    </div>
  )
}

function TransactionRow({ transaction }: { transaction: Transaction }) {
  const isCredit = transaction.direction === 'CREDIT'
  return (
    <>
      <div className="mt-0.5 rounded-md bg-muted p-1.5">
        {isCredit ? (
          <ArrowDownLeft className="size-4 text-muted-foreground" />
        ) : (
          <ArrowUpRight className="size-4 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {transaction.merchantName ?? 'Unknown merchant'}
        </p>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span title={formatDateTime(transaction.occurredAt)}>
            {formatRelativeTime(transaction.occurredAt)}
          </span>
          {transaction.categoryName && (
            <Badge variant="outline" className="shrink-0">
              {transaction.categoryName}
            </Badge>
          )}
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

        <div className="space-y-4 px-4 pb-4">
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
        </div>

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
