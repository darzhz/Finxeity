import { useState } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, MessageSquare, Bell, MoreHorizontal, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { RawEvent, RawEventStatus } from '@/lib/plugin'
import { LocalExpense } from '@/lib/plugin'
import { queryKeys, type RawEventFilters } from '@/lib/query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatMinor } from '@/lib/money'
import { formatDateTime, formatRelativeTime } from '@/lib/format'

type FilterKey = 'all' | 'parsed' | 'ignored' | 'dismissed'

const filtersFor: Record<FilterKey, RawEventFilters> = {
  all: { status: null, source: null },
  parsed: { status: 'PARSED' as RawEventStatus, source: null },
  ignored: { status: 'IGNORED' as RawEventStatus, source: null },
  dismissed: { status: 'DISMISSED' as RawEventStatus, source: null },
}

const statusLabel: Record<RawEventStatus, string> = {
  CAPTURED: 'Not read yet',
  PARSED: 'Became a transaction',
  IGNORED: 'Ignored',
  NEEDS_REVIEW: 'Needs review',
  DISMISSED: 'Removed',
}

export function HistoryPage() {
  const [tab, setTab] = useState<FilterKey>('all')
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

  const events = query.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col gap-4 px-4 pt-[calc(1rem+env(safe-area-inset-top))]">
      <header className="shrink-0">
        <h1 className="text-xl font-semibold">Notification history</h1>
        <p className="text-sm text-muted-foreground">
          Everything read from monitored apps, newest first.
        </p>
      </header>

      <Tabs className="shrink-0" value={tab} onValueChange={(value) => setTab(value as FilterKey)}>
        <TabsList className="w-full">
          <TabsTrigger value="all" className="flex-1">
            All
          </TabsTrigger>
          <TabsTrigger value="parsed" className="flex-1">
            Transactions
          </TabsTrigger>
          <TabsTrigger value="ignored" className="flex-1">
            Ignored
          </TabsTrigger>
          <TabsTrigger value="dismissed" className="flex-1">
            Removed
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-4">
        {query.isLoading &&
          Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}

        {!query.isLoading && events.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No messages here yet.
          </p>
        )}

        {events.map((event) => (
          <EventRow key={event.id} event={event} />
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
    </div>
  )
}

function EventRow({ event }: { event: RawEvent }) {
  const client = useQueryClient()

  const dismiss = useMutation({
    mutationFn: () => LocalExpense.dismissEvent({ id: event.id }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['rawEvents'] })
      void client.invalidateQueries({ queryKey: ['transactions'] })
      void client.invalidateQueries({ queryKey: queryKeys.ingestionStats })
      toast('Removed', {
        description: 'The transaction and its effects were undone.',
        duration: 8000,
        action: {
          label: 'Undo',
          onClick: () => {
            void LocalExpense.restoreEvent({ id: event.id }).then(() => {
              void client.invalidateQueries({ queryKey: ['rawEvents'] })
              void client.invalidateQueries({ queryKey: ['transactions'] })
            })
          },
        },
      })
    },
    onError: () => toast.error('Could not remove this message'),
  })

  const restore = useMutation({
    mutationFn: () => LocalExpense.restoreEvent({ id: event.id }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['rawEvents'] })
      void client.invalidateQueries({ queryKey: ['transactions'] })
      toast.success('Restored')
    },
  })

  const ignore = useMutation({
    mutationFn: () => LocalExpense.createIgnoreRule({ id: event.id }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['rawEvents'] })
      toast.success('Similar messages will be ignored')
    },
    onError: () => toast.error('Could not create the rule'),
  })

  const promote = useMutation({
    mutationFn: (kind: 'SPEND' | 'INCOME') =>
      LocalExpense.promoteEvent({
        id: event.id,
        as: kind,
        amountMinor: event.transaction?.amountMinor,
        merchantName: event.transaction?.merchantName ?? undefined,
      }),
    onSuccess: ({ promoted }) => {
      void client.invalidateQueries({ queryKey: ['rawEvents'] })
      void client.invalidateQueries({ queryKey: ['transactions'] })
      if (promoted) toast.success('Marked as a transaction')
    },
    onError: () => toast.error('Could not mark this message'),
  })

  const removeForever = useMutation({
    mutationFn: () => LocalExpense.deleteRawEvent({ id: event.id }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['rawEvents'] })
      void client.invalidateQueries({ queryKey: ['transactions'] })
      toast.success('Deleted permanently')
    },
  })

  const dismissed = event.status === 'DISMISSED'

  return (
    <Collapsible>
      <Card>
        <CardContent className="p-0">
          <CollapsibleTrigger className="flex w-full items-start gap-3 p-4 text-left">
            <div className="mt-0.5 rounded-md bg-muted p-1.5">
              {event.source === 'SMS' ? (
                <MessageSquare className="size-4 text-muted-foreground" />
              ) : (
                <Bell className="size-4 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium">
                  {event.title ?? event.sender ?? event.packageName ?? 'Notification'}
                </p>
                <Badge variant="outline" className="shrink-0">
                  {statusLabel[event.status]}
                </Badge>
              </div>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                {event.bigText ?? event.text ?? event.textLines ?? 'No text'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {event.packageName ?? event.sender} · {formatRelativeTime(event.postedAt)}
              </p>
            </div>
            <ChevronDown className="mt-1 size-4 shrink-0 text-muted-foreground" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-3 border-t px-4 py-3 text-xs">
              <Detail label="Source" value={event.source} />
              <Detail label="Posted" value={formatDateTime(event.postedAt)} />
              {event.transaction && (
                <Detail
                  label="Outcome"
                  value={[
                    formatMinor(event.transaction.amountMinor),
                    event.transaction.merchantName,
                    event.transaction.categoryName,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
              )}
              {event.duplicateOf && <Detail label="Duplicate of" value={event.duplicateOf} />}
              <Detail label="Notification key" value={event.notificationKey} />
              <Detail label="Content hash" value={event.contentHash} />
              {event.textLines && <Detail label="Text lines" value={event.textLines} />}
              <Detail label="Raw text" value={event.bigText ?? event.text ?? '—'} />

              <div className="flex items-center gap-2 pt-1">
                {dismissed ? (
                  <Button
                    variant="outline"
                    className="h-11 flex-1"
                    onClick={() => restore.mutate()}
                    disabled={restore.isPending}
                  >
                    Restore
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="h-11 flex-1"
                    onClick={() => dismiss.mutate()}
                    disabled={dismiss.isPending}
                  >
                    Remove this one
                  </Button>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-11" aria-label="More actions">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {!dismissed && (
                      <DropdownMenuItem onSelect={() => ignore.mutate()}>
                        Ignore messages like this
                      </DropdownMenuItem>
                    )}
                    {!dismissed && (
                      <DropdownMenuItem onSelect={() => promote.mutate('SPEND')}>
                        Mark as spend
                      </DropdownMenuItem>
                    )}
                    {!dismissed && (
                      <DropdownMenuItem onSelect={() => promote.mutate('INCOME')}>
                        Mark as income
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => removeForever.mutate()}
                    >
                      <Trash2 className="size-4" />
                      Delete permanently
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CollapsibleContent>
        </CardContent>
      </Card>
    </Collapsible>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-words">{value}</span>
    </div>
  )
}
