import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { LocalExpense } from '@/lib/plugin'
import type { Commitment } from '@/lib/plugin'
import { formatMinor, parseMajorToMinor } from '@/lib/money'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function CommitmentsPage() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['commitments'], queryFn: () => LocalExpense.listCommitments() })
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [due, setDue] = useState('')

  const add = useMutation({
    mutationFn: () =>
      LocalExpense.upsertCommitment({
        name,
        amountMinor: parseMajorToMinor(amount) ?? 0,
        dueAt: due ? new Date(due).getTime() : Date.now(),
        recurrence: 'NONE',
      }),
    onSuccess: () => {
      setName('')
      setAmount('')
      setDue('')
      void client.invalidateQueries({ queryKey: ['commitments'] })
      toast.success('Bill added')
    },
    onError: () => toast.error('Could not add bill'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => LocalExpense.deleteCommitment({ id }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['commitments'] }),
  })

  const items = query.data?.commitments ?? []

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col gap-4 overflow-y-auto px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-4">
      <header>
        <h1 className="text-xl font-semibold">Upcoming bills</h1>
        <p className="text-sm text-muted-foreground">Rent, utilities, EMIs and subscriptions.</p>
      </header>

      <Card className="shrink-0">
        <CardHeader>
          <CardTitle className="text-base">Add a bill</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Amount</Label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Due date</Label>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <Button onClick={() => add.mutate()} disabled={add.isPending || !name || !amount}>
            {add.isPending ? 'Adding…' : 'Add bill'}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {items.map((c: Commitment) => (
          <Card key={c.id}>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatMinor(c.amountMinor)} · {new Date(c.dueAt).toLocaleDateString()}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => remove.mutate(c.id)}>
                Remove
              </Button>
            </CardContent>
          </Card>
        ))}
        {items.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">No bills yet.</p>
        )}
      </div>
    </div>
  )
}
