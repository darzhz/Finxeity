import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquarePlus, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { LocalExpense } from '@/lib/plugin'
import type { AccountBalance, AccountProposal, AccountType } from '@/lib/plugin'
import { formatMinor, parseMajorToMinor } from '@/lib/money'
import { queryKeys } from '@/lib/query'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'

export function SettingsPage() {
  const client = useQueryClient()
  const listener = useQuery({
    queryKey: queryKeys.listener,
    queryFn: () => LocalExpense.getListenerStatus(),
  })
  const monitored = useQuery({
    queryKey: queryKeys.monitoredApps,
    queryFn: () => LocalExpense.getMonitoredApps(),
  })
  const balances = useQuery({
    queryKey: queryKeys.balances,
    queryFn: () => LocalExpense.listAccountBalances(),
  })
  const sms = useQuery({
    queryKey: queryKeys.smsImport,
    queryFn: () => LocalExpense.getSmsImportState(),
  })
  const financial = useQuery({
    queryKey: ['financialSettings'],
    queryFn: () => LocalExpense.getFinancialSettings(),
  })

  const importSms = useMutation({
    mutationFn: () => LocalExpense.importSms({ lookbackDays: 90 }),
    onSuccess: ({ imported }) => {
      toast.success(imported > 0 ? `Imported ${imported} message(s)` : 'No new messages found')
      void client.invalidateQueries({ queryKey: ['rawEvents'] })
      void client.invalidateQueries({ queryKey: queryKeys.smsImport })
    },
    onError: () => toast.error('Could not import SMS'),
  })

  const reparse = useMutation({
    mutationFn: () => LocalExpense.reparseAll(),
    onSuccess: ({ processed }) => {
      toast.success(`Read ${processed} message(s) again`)
      void client.invalidateQueries({ queryKey: ['rawEvents'] })
      void client.invalidateQueries({ queryKey: ['transactions'] })
      void client.invalidateQueries({ queryKey: queryKeys.ingestionStats })
      void client.invalidateQueries({ queryKey: queryKeys.balances })
    },
    onError: () => toast.error('Could not read the messages again'),
  })

  const deleteAccount = useMutation({
    mutationFn: (id: string) => LocalExpense.deleteAccount({ id }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.accounts })
      void client.invalidateQueries({ queryKey: queryKeys.balances })
    },
  })

  const saveFinancial = useMutation({
    mutationFn: (payload: { bufferMinor?: number; incomeDay?: number; expectedIncomeMinor?: number; essentialCategories?: string[] }) =>
      LocalExpense.setFinancialSettings(payload),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['financialSettings'] })
      toast.success('Saved')
    },
    onError: () => toast.error('Could not save'),
  })

  const accounts = balances.data?.balances ?? []

  return (
    <div className="mx-auto block h-full max-w-lg space-y-4 overflow-y-auto px-4 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-4">
      <header>
        <h1 className="text-xl font-semibold">Settings</h1>
      </header>

      <Card className="shrink-0">
        <CardHeader>
          <CardTitle className="text-base">Tracking</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Listener">
            <Badge variant={listener.data?.accessGranted ? 'default' : 'destructive'}>
              {listener.data?.state ?? 'UNKNOWN'}
            </Badge>
          </Row>
          <Button
            variant="outline"
            className="h-11 w-full"
            onClick={() => LocalExpense.openNotificationSettings()}
          >
            Notification access settings
          </Button>
          <Separator />
          <Row label="Monitored apps">
            <span>{plural(monitored.data?.packages.length ?? 0, 'app')}</span>
          </Row>
          <Button asChild variant="outline" className="h-11 w-full">
            <Link to="/settings/apps">Manage monitored apps</Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="shrink-0">
        <CardHeader>
          <CardTitle className="text-base">Accounts</CardTitle>
          <CardDescription>
            Balances are the anchor plus everything spent since.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {accounts.length === 0 && (
            <p className="text-sm text-muted-foreground">No accounts yet.</p>
          )}
          {accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              onDelete={() => deleteAccount.mutate(account.id)}
            />
          ))}
          <AccountDialog />
        </CardContent>
      </Card>

      {sms.data?.supported && (
        <Card className="shrink-0">
          <CardHeader>
            <CardTitle className="text-base">SMS backfill</CardTitle>
            <CardDescription>
              Recover recent history from bank SMS (sideload builds only).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="h-11 w-full"
              onClick={() => importSms.mutate()}
              disabled={importSms.isPending}
            >
              <MessageSquarePlus className="size-4" />
              Import last 90 days of SMS
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="shrink-0">
        <CardHeader>
          <CardTitle className="text-base">Reading messages</CardTitle>
          <CardDescription>
            Read every stored message again, for example after the app learned a new
            pattern.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="h-11 w-full"
            onClick={() => reparse.mutate()}
            disabled={reparse.isPending}
          >
            <RefreshCw className="size-4" />
            {reparse.isPending ? 'Reading…' : 'Read all messages again'}
          </Button>
        </CardContent>
      </Card>

      <Card className="shrink-0">
        <CardHeader>
          <CardTitle className="text-base">Planning</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button asChild variant="outline" className="h-11 w-full">
            <Link to="/bills">Upcoming bills</Link>
          </Button>
          <Button asChild variant="outline" className="h-11 w-full">
            <Link to="/goals">Savings goals</Link>
          </Button>
          <Button asChild variant="outline" className="h-11 w-full">
            <Link to="/budgets">Spending limits</Link>
          </Button>
        </CardContent>
      </Card>

      <RulesCard />

      <Card className="shrink-0">
        <CardHeader>
          <CardTitle className="text-base">Financial settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Emergency buffer (amount)</Label>
            <Input
              defaultValue={financial.data ? (financial.data.bufferMinor / 100).toString() : ''}
              onBlur={(e) => {
                const v = parseMajorToMinor(e.target.value)
                if (v != null) saveFinancial.mutate({ bufferMinor: v })
              }}
            />
          </div>
          <div className="space-y-1">
            <Label>Income day of month</Label>
            <Input
              type="number"
              defaultValue={financial.data?.incomeDay ?? ''}
              onBlur={(e) => saveFinancial.mutate({ incomeDay: Number(e.target.value) || 0 })}
            />
          </div>
          <div className="space-y-1">
            <Label>Expected income amount</Label>
            <Input
              defaultValue={financial.data ? (financial.data.expectedIncomeMinor / 100).toString() : ''}
              onBlur={(e) => {
                const v = parseMajorToMinor(e.target.value)
                if (v != null) saveFinancial.mutate({ expectedIncomeMinor: v })
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="shrink-0">
        <CardHeader>
          <CardTitle className="text-base">Debug</CardTitle>
          <CardDescription>Populate the app with random sample data for testing.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="h-11 w-full"
            onClick={async () => {
              try {
                const categories = (await LocalExpense.listCategories()).categories
                const expenseCats = categories.filter((c) => c.kind === 'EXPENSE')
                await LocalExpense.setAccountBalance({
                  name: 'HDFC Savings',
                  lastDigits: '4821',
                  type: 'BANK',
                  balanceMinor: 12500000,
                })
                await LocalExpense.setAccountBalance({
                  name: 'Cash Wallet',
                  lastDigits: '0000',
                  type: 'CASH',
                  balanceMinor: 650000,
                })
                const merchants = ['Swiggy', 'Zomato', 'Amazon', 'Uber', 'BigBasket', 'Netflix', 'Spotify', 'Electricity Board', 'Rent', 'Pharmacy']
                for (let i = 0; i < 80; i++) {
                  const daysAgo = Math.floor(Math.random() * 90)
                  const occurredAt = Date.now() - daysAgo * 24 * 60 * 60 * 1000
                  const amount = Math.round((50 + Math.random() * 4950) * 100)
                  const merchant = merchants[Math.floor(Math.random() * merchants.length)]
                  const category = expenseCats[Math.floor(Math.random() * expenseCats.length)]
                  await LocalExpense.createManualTransaction({
                    amountMinor: amount,
                    direction: Math.random() > 0.85 ? 'CREDIT' : 'DEBIT',
                    kind: Math.random() > 0.85 ? 'INCOME' : 'SPEND',
                    categoryId: category?.id ?? null,
                    merchantName: merchant,
                    occurredAt,
                    note: null,
                  })
                }
                await LocalExpense.upsertCommitment({
                  name: 'Apartment Rent',
                  amountMinor: 2800000,
                  dueAt: Date.now() + 5 * 24 * 60 * 60 * 1000,
                  recurrence: 'MONTHLY',
                })
                await LocalExpense.upsertCommitment({
                  name: 'Electricity',
                  amountMinor: 345000,
                  dueAt: Date.now() + 12 * 24 * 60 * 60 * 1000,
                  recurrence: 'MONTHLY',
                })
                await LocalExpense.upsertGoal({
                  name: 'Emergency Cushion',
                  targetMinor: 15000000,
                  savedMinor: 4000000,
                })
                await LocalExpense.upsertGoal({
                  name: 'Workstation Upgrade',
                  targetMinor: 12000000,
                  savedMinor: 2500000,
                })
                await LocalExpense.upsertBudget({
                  categoryId: expenseCats[0]?.id ?? null,
                  period: 'MONTHLY',
                  limitMinor: 1500000,
                })
                await LocalExpense.setFinancialSettings({
                  bufferMinor: 5000000,
                  incomeDay: 1,
                  expectedIncomeMinor: 8500000,
                  essentialCategories: expenseCats.slice(0, 3).map((c) => c.id),
                })
                await LocalExpense.setOnboardingComplete({ completed: true })
                void client.invalidateQueries()
                toast.success('Sample data seeded')
              } catch (error) {
                console.error(error)
                toast.error('Could not seed data')
              }
            }}
          >
            Seed random data
          </Button>
        </CardContent>
      </Card>

      <Card className="shrink-0">
        <CardHeader>
          <ShieldCheck className="mb-1 size-6 text-primary" />
          <CardTitle className="text-base">Privacy</CardTitle>
          <CardDescription>
            No internet permission in release builds. All data stays on this device.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}

function RulesCard() {
  const client = useQueryClient()
  const rules = useQuery({
    queryKey: queryKeys.rules,
    queryFn: () => LocalExpense.listRules(),
  })

  const remove = useMutation({
    mutationFn: (id: string) => LocalExpense.deleteRule({ id }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.rules })
      toast.success('Rule removed')
    },
  })

  const list = rules.data?.rules ?? []

  return (
    <Card className="shrink-0">
      <CardHeader>
        <CardTitle className="text-base">Rules</CardTitle>
        <CardDescription>
          Messages you chose to ignore. A rule stops a matching message from becoming a
          transaction.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {list.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No rules yet. In the history, choose "Ignore messages like this" on a message
            you never want to see again.
          </p>
        )}
        {list.map((rule) => (
          <div key={rule.id} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {rule.packageName ?? rule.senderPattern ?? 'Any app'}
              </p>
              {rule.templatePattern && (
                <p className="truncate text-xs text-muted-foreground">
                  {rule.templatePattern}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label="Delete rule"
              onClick={() => remove.mutate(rule.id)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function AccountRow({
  account,
  onDelete,
}: {
  account: AccountBalance
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const drifted = account.derivedBalanceMinor !== account.anchorBalanceMinor

  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {account.name}
          {account.lastDigits ? ` ••${account.lastDigits}` : ''}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatMinor(account.derivedBalanceMinor)}
          {drifted && (
            <span className="ml-2 text-muted-foreground/70">
              (anchored at {formatMinor(account.anchorBalanceMinor)})
            </span>
          )}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label={`Edit ${account.name}`}
        onClick={() => setEditing(true)}
      >
        <Pencil className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label={`Delete ${account.name}`}
        onClick={onDelete}
      >
        <Trash2 className="size-4" />
      </Button>
      <AccountDialog account={account} open={editing} onOpenChange={setEditing} />
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function AccountDialog({
  account,
  open,
  onOpenChange,
}: {
  account?: AccountBalance
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const client = useQueryClient()
  const [internalOpen, setInternalOpen] = useState(false)
  const [name, setName] = useState('')
  const [lastDigits, setLastDigits] = useState('')
  const [balance, setBalance] = useState('')
  const [type, setType] = useState<AccountType>('BANK')
  const [detectedProposals, setDetectedProposals] = useState<AccountProposal[]>([])
  const [selectedDetected, setSelectedDetected] = useState<Set<number>>(new Set())
  const [infoIndex, setInfoIndex] = useState<number | null>(null)

  const accountKinds: { value: AccountType; label: string }[] = [
    { value: 'BANK', label: 'Bank' },
    { value: 'CARD', label: 'Card' },
    { value: 'WALLET', label: 'Wallet' },
    { value: 'CASH', label: 'Cash' },
    { value: 'OTHER', label: 'Other' },
  ]

  const isOpen = account ? (open ?? false) : internalOpen
  const setOpen = account ? (onOpenChange ?? (() => {})) : setInternalOpen

  useEffect(() => {
    if (!isOpen) return
    if (account) {
      setName(account.name)
      setLastDigits(account.lastDigits ?? '')
      setBalance((account.anchorBalanceMinor / 100).toFixed(2))
      setType(account.type)
    } else {
      setName('')
      setLastDigits('')
      setBalance('')
      setType('BANK')
    }
  }, [isOpen, account])
  const save = useMutation({
    mutationFn: () =>
      LocalExpense.setAccountBalance({
        id: account?.id,
        name: name.trim(),
        lastDigits: lastDigits.trim() || null,
        type,
        balanceMinor: parseMajorToMinor(balance) ?? 0,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.accounts })
      void client.invalidateQueries({ queryKey: queryKeys.balances })
      toast.success(account ? 'Account updated' : 'Account saved')
      setOpen(false)
      setName('')
      setLastDigits('')
      setBalance('')
    },
    onError: () => toast.error('Could not save the account'),
  })

  const detect = useMutation({
    mutationFn: () => LocalExpense.detectAccounts(),
    onSuccess: ({ proposals }) => {
      if (proposals.length === 0) {
        toast.info('No accounts detected in stored messages')
        return
      }
      setDetectedProposals(proposals)
      setSelectedDetected(new Set(proposals.map((_, index) => index)))
    },
    onError: () => toast.error('Could not detect accounts'),
  })

  const addDetected = useMutation({
    mutationFn: async () => {
      for (const index of selectedDetected) {
        const proposal = detectedProposals[index]
        if (!proposal) continue
        await LocalExpense.setAccountBalance({
          name: proposal.name,
          lastDigits: proposal.lastDigits,
          type: (proposal.type === 'CARD' ? 'CARD' : proposal.type === 'CASH' ? 'CASH' : proposal.type === 'WALLET' ? 'WALLET' : proposal.type === 'OTHER' ? 'OTHER' : 'BANK') as AccountType,
          balanceMinor: proposal.balanceMinor ?? 0,
        })
      }
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.accounts })
      await client.invalidateQueries({ queryKey: queryKeys.balances })
      toast.success(`Added ${selectedDetected.size} account(s)`)
      setDetectedProposals([])
      setSelectedDetected(new Set())
      setOpen(false)
    },
    onError: () => toast.error('Could not add accounts'),
  })

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        setOpen(next)
        if (next && account) {
          setName(account.name)
          setLastDigits(account.lastDigits ?? '')
          setBalance((account.anchorBalanceMinor / 100).toFixed(2))
          setType(account.type)
        }
      }}
    >
      {!account && (
        <DialogTrigger asChild>
          <Button variant="outline" className="h-11 w-full">
            <Plus className="size-4" />
            Add account
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{account ? 'Edit account' : 'Add account'}</DialogTitle>
           <DialogDescription>
             {account
               ? 'Set the balance to anchor the tracked total.'
               : 'Set the current balance to start tracking.'}
           </DialogDescription>
        </DialogHeader>
        <Button
          variant="outline"
          className="h-11 w-full"
          onClick={() => detect.mutate()}
          disabled={detect.isPending}
        >
          <Wallet className="size-4" />
          {detect.isPending ? 'Detecting…' : 'Auto-detect from messages'}
        </Button>

        {detectedProposals.length > 0 && (
          <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-3">
            <p className="text-xs font-medium text-foreground">Detected accounts (select to add)</p>
            {detectedProposals.map((proposal, index) => (
              <div key={`${proposal.lastDigits}-${index}`} className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={selectedDetected.has(index)}
                    onChange={(event) => {
                      setSelectedDetected((current) => {
                        const next = new Set(current)
                        if (event.target.checked) next.add(index)
                        else next.delete(index)
                        return next
                      })
                    }}
                  />
                  <span className="flex-1">
                    {proposal.name} · ··{proposal.lastDigits}
                    {proposal.balanceMinor != null ? ` · ${formatMinor(proposal.balanceMinor)}` : ''}
                  </span>
                  <button
                    type="button"
                    className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                    onClick={() => setInfoIndex(infoIndex === index ? null : index)}
                  >
                    info
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setDetectedProposals((current) => current.filter((_, i) => i !== index))
                      setSelectedDetected((current) => {
                        const next = new Set<number>()
                        current.forEach((value) => {
                          if (value < index) next.add(value)
                          else if (value > index) next.add(value - 1)
                        })
                        return next
                      })
                      if (infoIndex === index) setInfoIndex(null)
                      else if (infoIndex != null && infoIndex > index) setInfoIndex(infoIndex - 1)
                    }}
                  >
                    remove
                  </button>
                </div>
                {infoIndex === index && (
                  <div className="ml-6 space-y-1 rounded-lg border border-border bg-background/60 p-2 text-[10px] text-muted-foreground">
                    <p className="font-medium text-foreground">Candidate messages</p>
                    {(proposal.sourceTexts ?? []).length === 0 && <p>No candidate messages.</p>}
                    {(proposal.sourceTexts ?? []).map((text, i) => (
                      <p key={i} className="whitespace-pre-wrap">{text}</p>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <Button
              className="h-10 w-full"
              disabled={selectedDetected.size === 0 || addDetected.isPending}
              onClick={() => addDetected.mutate()}
            >
              {addDetected.isPending ? 'Adding…' : `Add selected (${selectedDetected.size})`}
            </Button>
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              className="h-11"
              value={name}
              placeholder="HDFC Savings"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1 space-y-1.5">
              <Label>Last 4 digits</Label>
              <Input
                className="h-11"
                inputMode="numeric"
                maxLength={4}
                value={lastDigits}
                placeholder="4821"
                onChange={(event) =>
                  setLastDigits(event.target.value.replace(/\D/g, '').slice(0, 4))
                }
              />
            </div>
            <div className="flex-[2] space-y-1.5">
              <Label>Balance (₹)</Label>
              <Input
                className="h-11"
                inputMode="decimal"
                value={balance}
                placeholder="0.00"
                onChange={(event) => setBalance(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Kind</Label>
            <div className="flex flex-wrap gap-2">
              {accountKinds.map((kind) => (
                <Button
                  key={kind.value}
                  type="button"
                  size="sm"
                  variant={type === kind.value ? 'secondary' : 'outline'}
                  className="h-9"
                  onClick={() => setType(kind.value)}
                >
                  {kind.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {type === 'WALLET'
                ? 'Money in a wallet is tracked apart from a bank account.'
                : type === 'CARD'
                  ? 'A credit card is a bill to pay, not money you hold.'
                  : 'A bank or cash account holds the money you spend.'}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            className="h-11 w-full"
            disabled={!name.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            {account ? 'Save changes' : 'Save account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
