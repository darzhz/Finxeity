import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Repeat, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import { LocalExpense } from '@/lib/plugin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { formatMinor } from '@/lib/money'
import { formatDay } from '@/lib/format'
import { queryKeys } from '@/lib/query'

const cadenceLabel: Record<string, string> = {
  WEEKLY: 'a week',
  FORTNIGHTLY: 'a fortnight',
  MONTHLY: 'a month',
  QUARTERLY: 'a quarter',
  HALF_YEARLY: 'six months',
  YEARLY: 'a year',
  IRREGULAR: 'now and then',
}

/**
 * The payments that come round again. The user confirms the ones that are real
 * and ignores the ones the app got wrong.
 */
export function RecurringPage() {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: queryKeys.recurring,
    queryFn: () => LocalExpense.listRecurring(),
  })

  const setStatus = useMutation({
    mutationFn: (payload: {
      merchantId: string
      status: 'SUGGESTED' | 'CONFIRMED' | 'IGNORED'
    }) => LocalExpense.setRecurringStatus(payload),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.recurring })
      void client.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
    onError: () => toast.error('Could not save that'),
  })

  const payments = query.data?.recurring ?? []
  const monthly = payments
    .filter((payment) => payment.cadence === 'MONTHLY' || payment.cadence === 'QUARTERLY')
    .reduce((sum, payment) => {
      const months = payment.cadence === 'QUARTERLY' ? 3 : 1
      return sum + payment.amountMinor / months
    }, 0)

  return (
    <div className="mx-auto block h-full max-w-lg space-y-4 px-4 pt-[calc(1.25rem+env(safe-area-inset-top))]">
      <header className="shrink-0">
        <h1 className="text-xl font-semibold">Recurring</h1>
        <p className="text-sm text-muted-foreground">
          Payments the app noticed coming back.
        </p>
      </header>

      {query.isLoading && (
        <>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </>
      )}

      {!query.isLoading && payments.length === 0 && (
        <Card className="shrink-0">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing recurring yet. The app looks for a merchant that keeps charging the
            same amount.
          </CardContent>
        </Card>
      )}

      {payments.length > 0 && (
        <Card className="shrink-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Repeat className="size-4" />
              Monthly total
            </CardTitle>
            <CardDescription>
              {formatMinor(Math.round(monthly))} of payments that keep coming back
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-4">
        {payments.map((payment) => (
          <Card key={payment.merchantId ?? payment.name} className="shrink-0">
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{payment.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatMinor(payment.amountMinor)}{' '}
                    {cadenceLabel[payment.cadence] ?? payment.cadence.toLowerCase()}
                  </p>
                </div>
                {payment.priceIncreaseMinor !== null && (
                  <Badge variant="destructive" className="shrink-0">
                    <TrendingUp className="size-3" />
                    +{formatMinor(payment.priceIncreaseMinor)}
                  </Badge>
                )}
                {payment.confirmed && (
                  <Badge variant="outline" className="shrink-0">
                    Confirmed
                  </Badge>
                )}
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <CalendarClock className="size-3.5" />
                  {payment.nextExpectedAt
                    ? `Next expected ${formatDay(payment.nextExpectedAt)}`
                    : 'No expected date'}
                </span>
                <span className="flex items-center gap-2">
                  <span>Real payment</span>
                  <Switch
                    checked={payment.confirmed}
                    aria-label={`Confirm ${payment.name}`}
                    onCheckedChange={(checked) =>
                      setStatus.mutate({
                        merchantId: payment.merchantId ?? payment.name,
                        status: checked ? 'CONFIRMED' : 'SUGGESTED',
                      })
                    }
                  />
                </span>
              </div>

              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  onClick={() =>
                    setStatus.mutate({
                      merchantId: payment.merchantId ?? payment.name,
                      status: 'IGNORED',
                    })
                  }
                >
                  Not this one
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
