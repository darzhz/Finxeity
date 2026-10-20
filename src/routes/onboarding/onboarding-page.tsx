import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import {
  BellRing,
  BatteryCharging,
  CheckCircle2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { AppPicker } from '@/components/app-picker'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { LocalExpense } from '@/lib/plugin'
import type { AccountType } from '@/lib/plugin'
import { formatMinor, parseMajorToMinor } from '@/lib/money'
import { formatRelativeTime } from '@/lib/format'
import { queryKeys } from '@/lib/query'

const STEPS = ['welcome', 'permission', 'apps', 'balances', 'battery', 'done'] as const
type Step = (typeof STEPS)[number]

interface AccountDraft {
  key: string
  id?: string
  name: string
  lastDigits: string
  balanceInput: string
}

export function OnboardingPage() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const [stepIndex, setStepIndex] = useState(0)
  const step: Step = STEPS[stepIndex]

  const [selectedApps, setSelectedApps] = useState<string[]>([])
  const [drafts, setDrafts] = useState<AccountDraft[]>([])
  const draftsInitialised = useRef(false)

  const accountsQuery = useQuery({
    queryKey: queryKeys.accounts,
    queryFn: () => LocalExpense.listAccounts(),
  })

  useEffect(() => {
    if (draftsInitialised.current || !accountsQuery.data) return
    draftsInitialised.current = true
    if (accountsQuery.data.accounts.length > 0) {
      setDrafts(
        accountsQuery.data.accounts.map((account) => ({
          key: account.id,
          id: account.id,
          name: account.name,
          lastDigits: account.lastDigits ?? '',
          balanceInput: (account.anchorBalanceMinor / 100).toString(),
        })),
      )
    }
  }, [accountsQuery.data])

  const saveApps = useMutation({
    mutationFn: (packages: string[]) => LocalExpense.setMonitoredApps({ packages }),
  })

  function next() {
    setStepIndex((index) => Math.min(index + 1, STEPS.length - 1))
  }

  function back() {
    setStepIndex((index) => Math.max(index - 1, 0))
  }

  async function finish() {
    await LocalExpense.setOnboardingComplete({ completed: true })
    await client.invalidateQueries({ queryKey: queryKeys.onboarding })
    navigate('/dashboard', { replace: true })
  }

  const progress = ((stepIndex + 1) / STEPS.length) * 100

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="space-y-3 border-b px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Set up Finxeity</h1>
          <Badge variant="secondary">
            Step {stepIndex + 1} of {STEPS.length}
          </Badge>
        </div>
        <Progress value={progress} />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {step === 'welcome' && <WelcomeStep />}
        {step === 'permission' && <PermissionStep onGranted={next} />}
        {step === 'apps' && (
          <AppsStep
            selected={selectedApps}
            onChange={setSelectedApps}
          />
        )}
        {step === 'balances' && (
          <BalancesStep
            drafts={drafts}
            setDrafts={setDrafts}
            loading={accountsQuery.isLoading}
          />
        )}
        {step === 'battery' && <BatteryStep />}
        {step === 'done' && <DoneStep />}
      </div>

      <footer className="border-t px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-lg gap-2">
          {stepIndex > 0 && step !== 'done' && (
            <Button variant="outline" className="h-11" onClick={back}>
              Back
            </Button>
          )}
          {step === 'welcome' && (
            <Button className="h-11 flex-1" onClick={next}>
              Get started
            </Button>
          )}
          {step === 'permission' && (
            <Button className="h-11 flex-1" variant="secondary" onClick={next}>
              I granted access
            </Button>
          )}
          {step === 'apps' && (
            <Button
              className="h-11 flex-1"
              disabled={selectedApps.length === 0 || saveApps.isPending}
              onClick={async () => {
                await saveApps.mutateAsync(selectedApps)
                toast.success(`Monitoring ${selectedApps.length} app(s)`)
                next()
              }}
            >
              Continue
            </Button>
          )}
          {step === 'balances' && (
            <>
              <Button variant="ghost" className="h-11" onClick={next}>
                Skip
              </Button>
              <SaveBalancesButton drafts={drafts} onSaved={next} />
            </>
          )}
          {step === 'battery' && (
            <Button className="h-11 flex-1" variant="secondary" onClick={next}>
              Skip
            </Button>
          )}
          {step === 'done' && (
            <Button className="h-11 flex-1" onClick={finish}>
              Go to dashboard
            </Button>
          )}
        </div>
      </footer>
    </div>
  )
}

function WelcomeStep() {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <Card>
        <CardHeader>
          <ShieldCheck className="mb-2 size-8 text-primary" />
          <CardTitle>Your data stays on this device</CardTitle>
          <CardDescription>
            Finxeity reads notifications only from the apps you choose, stores
            everything locally, and never connects to the internet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>There is no account, no cloud, and no analytics.</p>
          <p>
            You can review every notification it reads and remove anything it got wrong,
            along with its effects.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function PermissionStep({ onGranted }: { onGranted: () => void }) {
  const status = useQuery({
    queryKey: queryKeys.listener,
    queryFn: () => LocalExpense.getListenerStatus(),
  })
  const advanced = useRef(false)

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let remove: (() => void) | undefined
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void status.refetch()
    }).then((handle) => {
      remove = () => handle.remove()
    })
    return () => remove?.()
  }, [status])

  useEffect(() => {
    if (status.data?.accessGranted && !advanced.current) {
      advanced.current = true
      onGranted()
    }
  }, [status.data?.accessGranted, onGranted])

  const granted = status.data?.accessGranted ?? false

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <Card>
        <CardHeader>
          <BellRing className="mb-2 size-8 text-primary" />
          <CardTitle>Allow notification access</CardTitle>
          <CardDescription>
            Android only lets an app see new notifications after you enable it in
            settings. Finxeity never reads past notifications.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {granted ? (
            <Alert>
              <CheckCircle2 className="size-4" />
              <AlertTitle>Access granted</AlertTitle>
              <AlertDescription>Listening for notifications now.</AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <AlertTitle>Access not granted yet</AlertTitle>
              <AlertDescription>
                Open notification access, find Finxeity, and turn it on.
              </AlertDescription>
            </Alert>
          )}
          <Button className="h-11 w-full" onClick={() => LocalExpense.openNotificationSettings()}>
            Open notification access
          </Button>
          <Button
            variant="outline"
            className="h-11 w-full"
            onClick={() => void status.refetch()}
            disabled={status.isFetching}
          >
            <RefreshCw className="size-4" />
            Check again
          </Button>
        </CardContent>
      </Card>

      <Collapsible>
        <Card>
          <CollapsibleTrigger className="w-full text-left">
            <CardHeader>
              <CardTitle className="text-base">
                Toggle greyed out? (Android 13+)
              </CardTitle>
              <CardDescription>
                Sideloaded apps need restricted settings unlocked first.
              </CardDescription>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <ol className="list-decimal space-y-1 pl-5">
                <li>Open App info for Finxeity.</li>
                <li>Tap the ⋮ menu in the top-right corner.</li>
                <li>Choose “Allow restricted settings”.</li>
                <li>Return here and enable notification access.</li>
              </ol>
              <Button
                variant="link"
                className="h-auto px-0"
                onClick={() => LocalExpense.openAppDetailsSettings()}
              >
                Open App info
              </Button>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  )
}

function AppsStep({
  selected,
  onChange,
}: {
  selected: string[]
  onChange: (packages: string[]) => void
}) {
  return (
    <div className="mx-auto flex h-full max-w-lg flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">Choose apps to monitor</h2>
        <p className="text-sm text-muted-foreground">
          Only notifications from these apps are read. You can change this later.
        </p>
      </div>
      <AppPicker selected={selected} onChange={onChange} preselectDefaultSms />
      <p className="text-xs text-muted-foreground">
        {selected.length === 0
          ? 'Select at least one app.'
          : `${selected.length} app(s) selected.`}
      </p>
    </div>
  )
}

function SaveBalancesButton({
  drafts,
  onSaved,
}: {
  drafts: AccountDraft[]
  onSaved: () => void
}) {
  const client = useQueryClient()
  const save = useMutation({
    mutationFn: async () => {
      const valid = drafts.filter((draft) => draft.name.trim())
      for (const draft of valid) {
        const balanceMinor = parseMajorToMinor(draft.balanceInput) ?? 0
        await LocalExpense.setAccountBalance({
          id: draft.id,
          name: draft.name.trim(),
          lastDigits: draft.lastDigits.trim() || null,
          type: 'BANK' as AccountType,
          balanceMinor,
        })
      }
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.accounts })
      toast.success('Balances saved')
      onSaved()
    },
  })

  return (
    <Button
      className="h-11 flex-1"
      disabled={save.isPending}
      onClick={() => save.mutate()}
    >
      Save balances
    </Button>
  )
}

function BalancesStep({
  drafts,
  setDrafts,
  loading,
}: {
  drafts: AccountDraft[]
  setDrafts: (drafts: AccountDraft[]) => void
  loading: boolean
}) {
  const detect = useMutation({
    mutationFn: () => LocalExpense.detectAccounts(),
    onSuccess: ({ proposals }) => {
      if (proposals.length === 0) {
        toast.info('No accounts detected in current notifications')
        return
      }
      const merged = [...drafts]
      for (const proposal of proposals) {
        const exists = merged.some(
          (draft) => draft.lastDigits === proposal.lastDigits && draft.name === proposal.name,
        )
        if (!exists) {
          merged.push({
            key: `proposal-${proposal.packageName}-${proposal.lastDigits}`,
            name: proposal.name,
            lastDigits: proposal.lastDigits,
            balanceInput:
              proposal.balanceMinor != null ? (proposal.balanceMinor / 100).toString() : '',
          })
        }
      }
      setDrafts(merged)
    },
  })

  function update(key: string, patch: Partial<AccountDraft>) {
    setDrafts(drafts.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)))
  }

  const totalBalance = useMemo(
    () =>
      drafts.reduce((sum, draft) => sum + (parseMajorToMinor(draft.balanceInput) ?? 0), 0),
    [drafts],
  )

  if (loading) {
    return (
      <div className="mx-auto max-w-lg space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">Sync account balances</h2>
        <p className="text-sm text-muted-foreground">
          Enter the current balance for each account. Tracking starts from here.
        </p>
      </div>

      <Button
        variant="outline"
        className="h-11"
        onClick={() => detect.mutate()}
        disabled={detect.isPending}
      >
        <Wallet className="size-4" />
        Detect accounts from notifications
      </Button>

      <div className="space-y-3">
        {drafts.map((draft) => (
          <Card key={draft.key}>
            <CardContent className="space-y-3 pt-4">
              <div className="space-y-1.5">
                <Label>Account name</Label>
                <Input
                  className="h-11"
                  value={draft.name}
                  placeholder="HDFC Savings"
                  onChange={(event) => update(draft.key, { name: event.target.value })}
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1 space-y-1.5">
                  <Label>Last 4 digits</Label>
                  <Input
                    className="h-11"
                    inputMode="numeric"
                    maxLength={4}
                    value={draft.lastDigits}
                    placeholder="4821"
                    onChange={(event) =>
                      update(draft.key, {
                        lastDigits: event.target.value.replace(/\D/g, '').slice(0, 4),
                      })
                    }
                  />
                </div>
                <div className="flex-[2] space-y-1.5">
                  <Label>Current balance (₹)</Label>
                  <Input
                    className="h-11"
                    inputMode="decimal"
                    value={draft.balanceInput}
                    placeholder="0.00"
                    onChange={(event) =>
                      update(draft.key, { balanceInput: event.target.value })
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        <Button
          variant="ghost"
          className="h-11 w-full"
          onClick={() =>
            setDrafts([
              ...drafts,
              {
                key: `manual-${Date.now()}`,
                name: '',
                lastDigits: '',
                balanceInput: '',
              },
            ])
          }
        >
          <Plus className="size-4" />
          Add account manually
        </Button>

        {drafts.length > 0 && (
          <>
            <Separator />
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total</span>
              <span className="font-semibold">{formatMinor(totalBalance)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function BatteryStep() {
  const battery = useQuery({
    queryKey: queryKeys.battery,
    queryFn: () => LocalExpense.isIgnoringBatteryOptimizations(),
  })

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let remove: (() => void) | undefined
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void battery.refetch()
    }).then((handle) => {
      remove = () => handle.remove()
    })
    return () => remove?.()
  }, [battery])

  const ignoring = battery.data?.ignoring ?? false

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <Card>
        <CardHeader>
          <BatteryCharging className="mb-2 size-8 text-primary" />
          <CardTitle>Keep tracking reliable</CardTitle>
          <CardDescription>
            Some phone makers stop background services to save battery, which can pause
            notification tracking.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {ignoring ? (
            <Alert>
              <CheckCircle2 className="size-4" />
              <AlertTitle>Battery optimization is off</AlertTitle>
              <AlertDescription>Finxeity can keep listening.</AlertDescription>
            </Alert>
          ) : (
            <Button
              className="h-11 w-full"
              onClick={() => LocalExpense.requestIgnoreBatteryOptimizations()}
            >
              Exempt from battery optimization
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            This is optional. Tracking works without it, but may be delayed on some devices.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function DoneStep() {
  const status = useQuery({
    queryKey: queryKeys.listener,
    queryFn: () => LocalExpense.getListenerStatus(),
  })

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <Card>
        <CardHeader>
          <CheckCircle2 className="mb-2 size-8 text-primary" />
          <CardTitle>You’re set up</CardTitle>
          <CardDescription>
            New transactions appear here as notifications arrive.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Listener</span>
            <Badge variant={status.data?.accessGranted ? 'default' : 'destructive'}>
              {status.data?.state ?? 'UNKNOWN'}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Monitoring</span>
            <span>{status.data?.monitoredCount ?? 0} app(s)</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Last event</span>
            <span>{formatRelativeTime(status.data?.lastEventAt ?? 0)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
