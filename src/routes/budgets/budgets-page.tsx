import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { LocalExpense } from '@/lib/plugin'
import type { Budget } from '@/lib/plugin'
import { formatMinor, parseMajorToMinor } from '@/lib/money'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function BudgetsPage() {
  const client = useQueryClient()
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => LocalExpense.listCategories() })
  const query = useQuery({ queryKey: ['budgets'], queryFn: () => LocalExpense.listBudgets() })
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [limit, setLimit] = useState('')

  const add = useMutation({
    mutationFn: () =>
      LocalExpense.upsertBudget({
        categoryId,
        period: 'MONTHLY',
        limitMinor: parseMajorToMinor(limit) ?? 0,
      }),
    onSuccess: () => {
      setLimit('')
      void client.invalidateQueries({ queryKey: ['budgets'] })
      toast.success('Budget added')
    },
    onError: () => toast.error('Could not add budget'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => LocalExpense.deleteBudget({ id }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['budgets'] }),
  })

  const items = query.data?.budgets ?? []

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col gap-4 overflow-y-auto px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-4">
      <header>
        <h1 className="text-xl font-semibold">Spending limits</h1>
      </header>

      <Card className="shrink-0">
        <CardHeader>
          <CardTitle className="text-base">Add a limit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Category</Label>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={categoryId ?? ''}
              onChange={(e) => setCategoryId(e.target.value || null)}
            >
              <option value="">All spending</option>
              {categories.data?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Monthly limit</Label>
            <Input value={limit} onChange={(e) => setLimit(e.target.value)} />
          </div>
          <Button onClick={() => add.mutate()} disabled={add.isPending || !limit}>
            {add.isPending ? 'Adding…' : 'Add limit'}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {items.map((b: Budget) => (
          <Card key={b.id}>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">
                  {categories.data?.categories.find((c) => c.id === b.categoryId)?.name ?? 'All spending'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatMinor(b.limitMinor)} / {b.period.toLowerCase()}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => remove.mutate(b.id)}>
                Remove
              </Button>
            </CardContent>
          </Card>
        ))}
        {items.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">No limits yet.</p>
        )}
      </div>
    </div>
  )
}
