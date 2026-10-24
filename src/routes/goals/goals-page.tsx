import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { LocalExpense } from '@/lib/plugin'
import type { Goal } from '@/lib/plugin'
import { formatMinor, parseMajorToMinor } from '@/lib/money'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'

export function GoalsPage() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['goals'], queryFn: () => LocalExpense.listGoals() })
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [saved, setSaved] = useState('')

  const add = useMutation({
    mutationFn: () =>
      LocalExpense.upsertGoal({
        name,
        targetMinor: parseMajorToMinor(target) ?? 0,
        savedMinor: parseMajorToMinor(saved) ?? 0,
      }),
    onSuccess: () => {
      setName('')
      setTarget('')
      setSaved('')
      void client.invalidateQueries({ queryKey: ['goals'] })
      toast.success('Goal added')
    },
    onError: () => toast.error('Could not add goal'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => LocalExpense.deleteGoal({ id }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['goals'] }),
  })

  const items = query.data?.goals ?? []

  return (
    <div className="mx-auto block h-full max-w-lg space-y-4 overflow-y-auto px-4 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-4">
      <header>
        <h1 className="text-xl font-semibold">Savings goals</h1>
      </header>

      <Card className="shrink-0">
        <CardHeader>
          <CardTitle className="text-base">Add a goal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Target amount</Label>
            <Input value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Saved so far</Label>
            <Input value={saved} onChange={(e) => setSaved(e.target.value)} />
          </div>
          <Button onClick={() => add.mutate()} disabled={add.isPending || !name || !target}>
            {add.isPending ? 'Adding…' : 'Add goal'}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {items.map((g: Goal) => {
          const pct = g.targetMinor > 0 ? Math.min(100, (g.savedMinor / g.targetMinor) * 100) : 0
          return (
            <Card key={g.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{g.name}</p>
                  <Button variant="ghost" size="sm" onClick={() => remove.mutate(g.id)}>
                    Remove
                  </Button>
                </div>
                <Progress value={pct} />
                <p className="text-xs text-muted-foreground">
                  {formatMinor(g.savedMinor)} of {formatMinor(g.targetMinor)}
                </p>
              </CardContent>
            </Card>
          )
        })}
        {items.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">No goals yet.</p>
        )}
      </div>
    </div>
  )
}
