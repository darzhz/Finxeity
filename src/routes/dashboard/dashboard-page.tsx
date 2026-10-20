import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  Activity,
  ArrowRight,
  BellRing,
  CalendarClock,
  Flame,
  PiggyBank,
  Repeat,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { LocalExpense } from '@/lib/plugin'
import type { Dashboard } from '@/lib/plugin'
import { formatMinor } from '@/lib/money'
import { formatDateTime, formatDay, formatMonth, formatRelativeTime } from '@/lib/format'
import { queryKeys } from '@/lib/query'

const cashflowConfig: ChartConfig = {
  spend: { label: 'Spent', color: 'var(--destructive)' },
  income: { label: 'Income', color: 'var(--primary)' },
}

export function DashboardPage() {
  const dashboard = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => LocalExpense.getDashboard({ rangeDays: 180 }),
  })
  const forecast = useQuery({
    queryKey: ['forecast'],
    queryFn: () => LocalExpense.getForecast(),
  })

  const listener = useQuery({
    queryKey: queryKeys.listener,
    queryFn: () => LocalExpense.getListenerStatus(),
    refetchInterval: 15_000,
  })

  if (dashboard.isLoading) {
    return <DashboardSkeleton />
  }

  const data = dashboard.data
  if (!data) {
    return (
      <div className="mx-auto max-w-lg px-4 pt-[calc(1rem+env(safe-area-inset-top))]">
        <p className="text-sm text-muted-foreground">
          The dashboard could not be loaded.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col gap-4 overflow-y-auto px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-4">
      <header className="shrink-0">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Where your money is going.</p>
      </header>

      <BalanceCard data={data} />
      {forecast.data && (
        <Card className="shrink-0">
          <CardHeader>
            <CardTitle className="text-base">Money until payday</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>Lowest projected balance: {formatMinor(forecast.data.minBalanceMinor)}</p>
            <p>On the last day: {formatMinor(forecast.data.endBalanceMinor)}</p>
          </CardContent>
        </Card>
      )}
      <BurnCard data={data} />
      <CashflowCard data={data} />
      <StatusCard
        state={listener.data?.state ?? 'UNKNOWN'}
        accessGranted={listener.data?.accessGranted ?? false}
        monitored={listener.data?.monitoredCount ?? 0}
        needsReview={data.needsReview}
      />
      {data.categories.length > 0 && <CategoriesCard data={data} />}
      {data.topMerchants.length > 0 && <MerchantsCard data={data} />}
      {data.recurring.length > 0 && <RecurringCard data={data} />}
      {data.savings.items.length > 0 && <SavingsCard data={data} />}

      <p className="shrink-0 pt-1 text-center text-[0.7rem] text-muted-foreground">
        Figures updated {formatRelativeTime(data.lastUpdatedAt)} ·{' '}
        {formatDateTime(data.lastUpdatedAt)}
      </p>
    </div>
  )
}

function BalanceCard({ data }: { data: Dashboard }) {
  return (
    <Card className="shrink-0">
      <CardHeader>
        <CardTitle className="text-base">Total balance</CardTitle>
        <CardDescription>
          {data.accounts.length === 0
            ? 'No accounts tracked yet'
            : `${data.accounts.length} account(s) tracked`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-3xl font-semibold tracking-tight">
          {formatMinor(data.totalBalanceMinor)}
        </p>

        {data.accounts.length === 0 && (
          <Button asChild variant="link" className="h-auto px-0">
            <Link to="/onboarding">
              Finish setup to see balances <ArrowRight className="size-4" />
            </Link>
          </Button>
        )}

        {data.accounts.map((account) => (
          <div key={account.id} className="flex items-center justify-between text-sm">
            <span className="truncate text-muted-foreground">
              {account.name}
              {account.lastDigits ? ` ••${account.lastDigits}` : ''}
            </span>
            <span className="tabular-nums">{formatMinor(account.derivedBalanceMinor)}</span>
          </div>
        ))}

        {data.safeToSpend && (
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Wallet className="size-3.5" />
              Safe to spend
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatMinor(data.safeToSpend.todayMinor)}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                today
              </span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatMinor(data.safeToSpend.weekMinor)} this week ·{' '}
              {data.safeToSpend.daysLeft} days to month end
            </p>
            <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              {data.safeToSpend.breakdown.map((item) => (
                <li key={item.source} className="flex justify-between">
                  <span>{item.detail}</span>
                  <span className="tabular-nums">{formatMinor(item.amountMinor)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function BurnCard({ data }: { data: Dashboard }) {
  const { burn } = data
  return (
    <Card className="shrink-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Flame className="size-4" />
          Spending rate
        </CardTitle>
        <CardDescription>
          Average over the last {burn.daysCounted} day(s) with activity
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-semibold tabular-nums">
            {formatMinor(burn.dailyMinor)}
          </span>
          <span className="text-xs text-muted-foreground">a day</span>
        </div>
        <p className="text-sm text-muted-foreground">
          That is {formatMinor(burn.monthlyMinor)} a month.
        </p>
        <div className="flex items-center justify-between border-t pt-2 text-sm">
          <span className="text-muted-foreground">Runway</span>
          <span className="font-medium tabular-nums">
            {burn.runwayDays === null
              ? '—'
              : burn.runwayMonths !== null
                ? `${burn.runwayMonths} months`
                : `${burn.runwayDays} days`}
          </span>
        </div>
        {burn.runwayDays !== null && burn.runwayDays < 30 && (
          <p className="text-xs text-destructive">
            At this rate the money runs out in under a month.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function CashflowCard({ data }: { data: Dashboard }) {
  const points = data.cashflow.slice(-6)
  const series = points.map((point) => ({
    month: formatMonth(point.periodStart),
    spend: point.spendMinor / 100,
    income: point.incomeMinor / 100,
  }))
  const net = points.reduce((sum, point) => sum + point.netMinor, 0)

  if (points.length === 0) return null

  return (
    <Card className="shrink-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="size-4" />
          Cashflow
        </CardTitle>
        <CardDescription>
          Income against spend, month by month ·{' '}
          <span className={net >= 0 ? 'text-foreground' : 'text-destructive'}>
            {formatMinor(net)} net
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={cashflowConfig} className="aspect-auto h-44 w-full">
          <BarChart data={series} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => `₹${Number(value).toLocaleString('en-IN')}`}
                />
              }
            />
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            />
            <YAxis hide domain={[0, 'auto']} />
            <Bar dataKey="spend" fill={cashflowConfig.spend.color} radius={[4, 4, 0, 0]} />
            <Bar dataKey="income" fill={cashflowConfig.income.color} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

function StatusCard({
  state,
  accessGranted,
  monitored,
  needsReview,
}: {
  state: string
  accessGranted: boolean
  monitored: number
  needsReview: number
}) {
  return (
    <Card className="shrink-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="size-4" />
          Capture status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Listener</span>
          <Badge variant={accessGranted ? 'default' : 'destructive'}>{state}</Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Monitoring</span>
          <span>{monitored} app{monitored === 1 ? '' : 's'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Needs review</span>
          {needsReview > 0 ? (
            <Button asChild variant="link" className="h-auto px-0">
              <Link to="/review">{needsReview} to check</Link>
            </Button>
          ) : (
            <span>0</span>
          )}
        </div>
        {!accessGranted && (
          <Button
            variant="outline"
            className="mt-2 h-11 w-full"
            onClick={() => LocalExpense.openNotificationSettings()}
          >
            <BellRing className="size-4" />
            Enable notification access
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function CategoriesCard({ data }: { data: Dashboard }) {
  const categories = data.categories.slice(0, 6)
  const max = Math.max(...categories.map((category) => category.spendMinor), 1)

  return (
    <Card className="shrink-0">
      <CardHeader>
        <CardTitle className="text-base">Where it went</CardTitle>
        <CardDescription>This month, by category</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {categories.map((category) => (
          <div key={category.categoryId ?? category.name} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="truncate">{category.name}</span>
              <span className="flex items-center gap-2">
                {category.changeMinor !== null && category.changeMinor !== 0 && (
                  <span
                    className={
                      category.changeMinor > 0
                        ? 'text-xs text-destructive'
                        : 'text-xs text-muted-foreground'
                    }
                  >
                    {category.changeMinor > 0 ? '+' : ''}
                    {formatMinor(category.changeMinor)}
                  </span>
                )}
                <span className="tabular-nums">{formatMinor(category.spendMinor)}</span>
              </span>
            </div>
            <Progress value={(category.spendMinor / max) * 100} className="h-1.5" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function MerchantsCard({ data }: { data: Dashboard }) {
  const [byAmount, setByAmount] = useState(true)
  const merchants = [...data.topMerchants].sort((a, b) =>
    byAmount ? b.spendMinor - a.spendMinor : b.count - a.count,
  )

  return (
    <Card className="shrink-0">
      <CardHeader>
        <CardTitle className="text-base">Top merchants</CardTitle>
        <CardDescription className="flex items-center gap-1">
          Where the money goes most often
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => setByAmount((value) => !value)}
          >
            {byAmount ? 'by frequency' : 'by amount'}
          </button>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {merchants.map((merchant) => (
          <div key={merchant.merchantId ?? merchant.name} className="flex items-center gap-3 text-sm">
            <span className="min-w-0 flex-1 truncate">{merchant.name}</span>
            <span className="text-xs text-muted-foreground">{merchant.count}×</span>
            <span className="tabular-nums">{formatMinor(merchant.spendMinor)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function RecurringCard({ data }: { data: Dashboard }) {
  const monthly = data.recurring
    .filter((payment) => payment.cadence === 'MONTHLY' || payment.cadence === 'QUARTERLY')
    .reduce((sum, payment) => {
      const months = payment.cadence === 'QUARTERLY' ? 3 : 1
      return sum + payment.amountMinor / months
    }, 0)

  return (
    <Card className="shrink-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Repeat className="size-4" />
          Recurring
        </CardTitle>
        <CardDescription>
          {formatMinor(Math.round(monthly))} a month
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.recurring.map((payment) => (
          <div key={payment.merchantId ?? payment.name} className="flex items-center gap-3 text-sm">
            <span className="min-w-0 flex-1 truncate">{payment.name}</span>
            {payment.priceIncreaseMinor !== null && (
              <Badge variant="destructive" className="shrink-0">
                +{formatMinor(payment.priceIncreaseMinor)}
              </Badge>
            )}
            <span className="shrink-0 text-xs text-muted-foreground">
              {payment.cadence.toLowerCase()}
            </span>
            <span className="shrink-0 tabular-nums">{formatMinor(payment.amountMinor)}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 border-t pt-2 text-xs text-muted-foreground">
          <CalendarClock className="size-3.5" />
          {data.recurring.find((payment) => payment.nextExpectedAt)?.nextExpectedAt
            ? `Next expected ${formatDay(
                data.recurring.find((payment) => payment.nextExpectedAt)!.nextExpectedAt!,
              )}`
            : 'No expected payments yet'}
          <Button asChild variant="link" className="ml-auto h-auto px-0 text-xs">
            <Link to="/recurring">Manage</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function SavingsCard({ data }: { data: Dashboard }) {
  return (
    <Card className="shrink-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PiggyBank className="size-4" />
          Savings potential
        </CardTitle>
        <CardDescription>
          {formatMinor(data.savings.totalMinor)} could stay with you
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.savings.items.map((item, index) => (
          <div key={`${item.source}-${index}`} className="flex items-center gap-3 text-sm">
            <Badge variant="outline" className="shrink-0">
              {item.source}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {item.detail}
            </span>
            <span className="tabular-nums">{formatMinor(item.amountMinor)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 pt-[calc(1rem+env(safe-area-inset-top))]">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-56 w-full" />
    </div>
  )
}
