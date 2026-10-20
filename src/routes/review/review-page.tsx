import { useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, X } from 'lucide-react'
import { toast } from 'sonner'
import type { RawEvent } from '@/lib/plugin'
import { LocalExpense } from '@/lib/plugin'
import { queryKeys } from '@/lib/query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { formatMinor, parseMajorToMinor } from '@/lib/money'
import { formatRelativeTime } from '@/lib/format'

/**
 * The inbox for messages the parser was not sure about. Nothing here touches
 * the dashboard numbers until the user confirms it.
 */
export function ReviewPage() {
  const client = useQueryClient()
  const [editing, setEditing] = useState<RawEvent | null>(null)

  const query = useInfiniteQuery({
    queryKey: queryKeys.rawEventFeed({ status: 'NEEDS_REVIEW', source: null }),
    queryFn: ({ pageParam }) =>
      LocalExpense.listRawEvents({
        status: 'NEEDS_REVIEW',
        source: null,
        cursor: pageParam,
        limit: 30,
      }),
    initialPageParam: null as { postedAt: number; id: string } | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })

  const confirm = useMutation({
    mutationFn: (event: RawEvent) =>
      LocalExpense.confirmEvent({
        id: event.id,
        amountMinor: event.parsed?.amountMinor ?? undefined,
        merchantName: event.parsed?.merchant ?? undefined,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['rawEvents'] })
      void client.invalidateQueries({ queryKey: ['transactions'] })
      void client.invalidateQueries({ queryKey: queryKeys.ingestionStats })
      toast.success('Added as a transaction')
    },
    onError: () => toast.error('Could not confirm this message'),
  })

  const dismiss = useMutation({
    mutationFn: (event: RawEvent) => LocalExpense.dismissEvent({ id: event.id }),
    onSuccess: (_result, event) => {
      void client.invalidateQueries({ queryKey: ['rawEvents'] })
      void client.invalidateQueries({ queryKey: queryKeys.ingestionStats })
      toast('Dismissed', {
        action: {
          label: 'Undo',
          onClick: () => {
            void LocalExpense.restoreEvent({ id: event.id }).then(() => {
              void client.invalidateQueries({ queryKey: ['rawEvents'] })
            })
          },
        },
      })
    },
  })

  const events = query.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col gap-4 px-4 pt-[calc(1rem+env(safe-area-inset-top))]">
      <header className="shrink-0">
        <h1 className="text-xl font-semibold">Needs review</h1>
        <p className="text-sm text-muted-foreground">
          The app was not sure about these. Confirm, edit or dismiss them.
        </p>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-4">
        {query.isLoading &&
          Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}

        {!query.isLoading && events.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nothing to review. Every message was understood.
          </p>
        )}

        {events.map((event) => (
          <Card key={event.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-sm">
                  {event.bigText ?? event.text ?? event.textLines ?? 'No text'}
                </p>
                <Badge variant="outline" className="shrink-0">
                  {Math.round((event.parsed?.confidence ?? 0) * 100)}%
                </Badge>
              </div>

              <p className="text-xs text-muted-foreground">
                {[
                  event.parsed?.amountMinor != null
                    ? formatMinor(event.parsed.amountMinor)
                    : null,
                  event.parsed?.direction === 'CREDIT' ? 'income' : 'spend',
                  event.parsed?.merchant,
                  event.packageName,
                  formatRelativeTime(event.postedAt),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>

              <div className="flex gap-2">
                <Button
                  className="h-11 flex-1"
                  onClick={() => confirm.mutate(event)}
                  disabled={confirm.isPending || !event.parsed?.amountMinor}
                >
                  <Check className="size-4" />
                  Confirm
                </Button>
                <Button
                  variant="outline"
                  className="h-11 flex-1"
                  onClick={() => setEditing(event)}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  aria-label="Dismiss"
                  onClick={() => dismiss.mutate(event)}
                >
                  <X className="size-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
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

      <ReviewDrawer
        event={editing}
        onClose={() => setEditing(null)}
        onConfirm={() => setEditing(null)}
      />
    </div>
  )
}

function ReviewDrawer({
  event,
  onClose,
  onConfirm,
}: {
  event: RawEvent | null
  onClose: () => void
  onConfirm: () => void
}) {
  const client = useQueryClient()
  const [amount, setAmount] = useState('')
  const [merchant, setMerchant] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => LocalExpense.listCategories(),
  })

  const [loaded, setLoaded] = useState<string | null>(null)
  if (event && loaded !== event.id) {
    setLoaded(event.id)
    setAmount(event.parsed?.amountMinor != null ? (event.parsed.amountMinor / 100).toFixed(2) : '')
    setMerchant(event.parsed?.merchant ?? '')
    setCategoryId(null)
  }

  const confirm = useMutation({
    mutationFn: () =>
      LocalExpense.confirmEvent({
        id: event!.id,
        amountMinor: parseMajorToMinor(amount) ?? event!.parsed?.amountMinor ?? undefined,
        merchantName: merchant.trim() || undefined,
        categoryId: categoryId ?? undefined,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['rawEvents'] })
      void client.invalidateQueries({ queryKey: ['transactions'] })
      void client.invalidateQueries({ queryKey: queryKeys.ingestionStats })
      toast.success('Added as a transaction')
      onConfirm()
    },
    onError: () => toast.error('Could not confirm this message'),
  })

  const selected = categories.data?.categories.find((c) => c.id === categoryId)

  return (
    <Drawer open={event !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Confirm transaction</DrawerTitle>
          <DrawerDescription>
            {event?.bigText ?? event?.text ?? 'No text'}
          </DrawerDescription>
        </DrawerHeader>

        <div className="space-y-4 px-4 pb-4">
          <div className="space-y-1.5">
            <Label>Amount</Label>
            <Input
              className="h-11"
              inputMode="decimal"
              value={amount}
              onChange={(change) => setAmount(change.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Merchant</Label>
            <Input
              className="h-11"
              value={merchant}
              placeholder="Unknown merchant"
              onChange={(change) => setMerchant(change.target.value)}
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
        </div>

        <DrawerFooter>
          <div className="mx-auto flex w-full max-w-lg gap-2 pb-[env(safe-area-inset-bottom)]">
            <Button variant="outline" className="h-11 flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              className="h-11 flex-1"
              onClick={() => confirm.mutate()}
              disabled={confirm.isPending}
            >
              Confirm
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
