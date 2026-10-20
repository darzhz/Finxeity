import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquarePlus, Pencil, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { LocalExpense } from '@/lib/plugin'
import type { AccountBalance, AccountType } from '@/lib/plugin'
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
    <div className="mx-auto flex h-full max-w-lg flex-col gap-4 overflow-y-auto px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-4">
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

  const accountKinds: { value: AccountType; label: string }[] = [
    { value: 'BANK', label: 'Bank' },
    { value: 'CARD', label: 'Card' },
    { value: 'WALLET', label: 'Wallet' },
    { value: 'CASH', label: 'Cash' },
    { value: 'OTHER', label: 'Other' },
  ]

  const isOpen = account ? (open ?? false) : internalOpen
  const setOpen = account ? (onOpenChange ?? (() => {})) : setInternalOpen

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
