import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Plus, Target } from 'lucide-react'
import { toast } from 'sonner'
import { LocalExpense } from '@/lib/plugin'
import type { Goal } from '@/lib/plugin'
import { formatMinor, parseMajorToMinor } from '@/lib/money'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
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
import { Skeleton } from '@/components/ui/skeleton'

/* ────────────────────────────── helpers ────────────────────────────── */

type GoalInput = Parameters<typeof LocalExpense.upsertGoal>[0]

const currencySymbol = formatMinor(0).replace(/[\d.,\s-]/g, '') || '₹'

const GOAL_META: { match: string[]; emoji: string; tint: string }[] = [
  { match: ['trip', 'travel', 'vacation', 'holiday', 'flight'], emoji: '✈️', tint: 'bg-sky-500/15' },
  { match: ['phone', 'laptop', 'gadget', 'iphone', 'macbook', 'tv'], emoji: '📱', tint: 'bg-violet-500/15' },
  { match: ['car', 'bike', 'scooter', 'vehicle'], emoji: '🚗', tint: 'bg-orange-500/15' },
  { match: ['home', 'house', 'flat', 'rent', 'down payment'], emoji: '🏠', tint: 'bg-emerald-500/15' },
  { match: ['emergency', 'rainy', 'safety', 'buffer'], emoji: '🛟', tint: 'bg-rose-500/15' },
  { match: ['wedding', 'ring', 'marriage'], emoji: '💍', tint: 'bg-pink-500/15' },
  { match: ['study', 'course', 'college', 'education', 'school'], emoji: '🎓', tint: 'bg-indigo-500/15' },
]

function goalMeta(name: string) {
  const n = name.toLowerCase()
  return GOAL_META.find((m) => m.match.some((k) => n.includes(k))) ?? { emoji: '🎯', tint: 'bg-indigo-500/15' }
}

const SUGGESTIONS = ['Emergency fund', 'Trip', 'New phone', 'Home']

const pctOf = (g: Goal) => (g.targetMinor > 0 ? Math.min(100, (g.savedMinor / g.targetMinor) * 100) : 0)
const isDone = (g: Goal) => g.targetMinor > 0 && g.savedMinor >= g.targetMinor
const cleanAmount = (v: string) => v.replace(/[^\d.]/g, '')

function useCountUp(target: number, ms = 800) {
  const [value, setValue] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms)
      const v = a + (target - a) * (1 - Math.pow(1 - p, 3))
      from.current = v
      setValue(v)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return Math.round(value)
}

function finishDate(goal: Goal) {
  const remaining = Math.max(0, goal.targetMinor - goal.savedMinor)
  if (remaining === 0 || goal.monthlyContributionMinor <= 0) return null
  const months = Math.ceil(remaining / goal.monthlyContributionMinor)
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return { months, label: d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) }
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[]
  value: T
  onChange: (key: T) => void
}) {
  const index = Math.max(0, options.findIndex((o) => o.key === value))
  return (
    <div className="relative flex rounded-2xl bg-muted/70 p-1" role="tablist">
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 rounded-xl bg-background shadow-sm ring-1 ring-border transition-transform duration-300 ease-out"
        style={{ width: `calc((100% - 0.5rem) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={o.key === value}
          onClick={() => onChange(o.key)}
          className={cn('relative z-10 h-9 flex-1 rounded-xl text-sm font-medium transition-colors', o.key === value ? 'text-foreground' : 'text-muted-foreground')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function MoneyField({
  label,
  value,
  onChange,
  placeholder = '0',
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">{currencySymbol}</span>
        <Input
          className="h-11 pl-8 tabular-nums"
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(cleanAmount(e.target.value))}
        />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/* ───────────────────────────── page ───────────────────────────── */

export function GoalsPage() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['goals'], queryFn: () => LocalExpense.listGoals() })
  const [adding, setAdding] = useState<{ name: string } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const items: Goal[] = query.data?.goals ?? []
  const active = items.filter((g) => !isDone(g))
  const reached = items.filter(isDone)
  const openGoal = items.find((g) => g.id === openId) ?? null

  const upsert = useMutation({
    mutationFn: (input: GoalInput) => LocalExpense.upsertGoal(input),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['goals'] }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => LocalExpense.deleteGoal({ id }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['goals'] }),
  })

  const save = (input: GoalInput, message: string, done: () => void) =>
    upsert.mutate(input, {
      onSuccess: () => {
        toast.success(message)
        done()
      },
      onError: () => toast.error('Could not save the goal. Try again.'),
    })

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-lg">
        <header className="sticky top-0 z-20 flex items-center justify-between bg-background/85 px-4 pb-3 pt-[calc(1rem+env(safe-area-inset-top))] backdrop-blur-xl">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Savings goals</h1>
            <p className="text-sm text-muted-foreground">Put a number on what you're saving for.</p>
          </div>
          <Button size="icon" className="size-11 rounded-full" onClick={() => setAdding({ name: '' })} aria-label="Add goal">
            <Plus className="size-5" />
          </Button>
        </header>

        <div className="space-y-6 px-4 pb-10 pt-2">
          {query.isLoading && (
            <>
              <Skeleton className="h-44 w-full rounded-3xl" />
              <Skeleton className="h-32 w-full rounded-3xl" />
              <Skeleton className="h-32 w-full rounded-3xl" />
            </>
          )}

          {!query.isLoading && items.length === 0 && <EmptyState onPick={(name) => setAdding({ name })} />}

          {items.length > 0 && <Overview goals={items} reachedCount={reached.length} />}

          {active.length > 0 && (
            <section className="space-y-3">
              <h2 className="px-1 text-base font-semibold">In progress</h2>
              {active.map((g) => (
                <GoalCard key={g.id} goal={g} onOpen={() => setOpenId(g.id)} />
              ))}
            </section>
          )}

          {reached.length > 0 && (
            <section className="space-y-3">
              <h2 className="px-1 text-base font-semibold">Reached</h2>
              {reached.map((g) => (
                <GoalCard key={g.id} goal={g} onOpen={() => setOpenId(g.id)} />
              ))}
            </section>
          )}
        </div>
      </div>

      <AddGoalDrawer
        state={adding}
        onClose={() => setAdding(null)}
        pending={upsert.isPending}
        onSave={(input, done) => save(input, 'Goal added', done)}
      />

      <GoalDrawer
        goal={openGoal}
        onClose={() => setOpenId(null)}
        pending={upsert.isPending || remove.isPending}
        onSave={save}
        onRemove={(id) =>
          remove.mutate(id, {
            onSuccess: () => {
              toast.success('Goal removed')
              setOpenId(null)
            },
            onError: () => toast.error('Could not remove the goal. Try again.'),
          })
        }
      />
    </div>
  )
}

/* ───────────────────────────── overview ─────────────────────────────
   The showy part: one big ring for everything you've saved across goals. */

const RING_R = 52
const RING_C = 2 * Math.PI * RING_R

function Overview({ goals, reachedCount }: { goals: Goal[]; reachedCount: number }) {
  const saved = goals.reduce((s, g) => s + g.savedMinor, 0)
  const target = goals.reduce((s, g) => s + g.targetMinor, 0)
  const pct = target > 0 ? Math.min(1, saved / target) : 0
  const shownSaved = useCountUp(saved)
  const shownPct = useCountUp(Math.round(pct * 100), 900)

  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const monthly = goals.filter((g) => !isDone(g)).reduce((s, g) => s + g.monthlyContributionMinor, 0)

  return (
    <section className="flex items-center gap-5 rounded-3xl border border-border bg-card p-5">
      <div className="relative size-32 shrink-0">
        <svg viewBox="0 0 120 120" className="size-full -rotate-90" role="img" aria-label={`${Math.round(pct * 100)}% saved across all goals`}>
          <circle cx="60" cy="60" r={RING_R} fill="none" strokeWidth="11" className="stroke-muted" />
          <circle
            cx="60"
            cy="60"
            r={RING_R}
            fill="none"
            strokeWidth="11"
            strokeLinecap="round"
            className="stroke-emerald-400 transition-[stroke-dashoffset] duration-1000 ease-out motion-reduce:transition-none"
            strokeDasharray={RING_C}
            strokeDashoffset={ready ? RING_C * (1 - pct) : RING_C}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-3xl font-bold tabular-nums">{shownPct}%</span>
          <span className="text-xs text-muted-foreground">saved</span>
        </div>
      </div>

      <div className="min-w-0 space-y-1">
        <p className="text-sm text-muted-foreground">Saved so far</p>
        <p className="font-display truncate text-2xl font-bold tabular-nums">{formatMinor(shownSaved)}</p>
        <p className="text-xs text-muted-foreground">of {formatMinor(target)} across {goals.length} {goals.length === 1 ? 'goal' : 'goals'}</p>
        <p className="pt-1 text-xs">
          {reachedCount > 0 && <span className="mr-2 font-medium text-emerald-300">{reachedCount} reached</span>}
          {monthly > 0 && <span className="text-muted-foreground">{formatMinor(monthly)} a month going in</span>}
        </p>
      </div>
    </section>
  )
}

/* ───────────────────────────── goal card ───────────────────────────── */

function GoalCard({ goal, onOpen }: { goal: Goal; onOpen: () => void }) {
  const pct = pctOf(goal)
  const done = isDone(goal)
  const meta = goalMeta(goal.name)
  const eta = finishDate(goal)
  const remaining = Math.max(0, goal.targetMinor - goal.savedMinor)

  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-3xl border border-border bg-card p-4 text-left transition-transform active:scale-[0.99]"
    >
      <div className="flex items-center gap-3">
        <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-2xl text-xl', meta.tint)}>{meta.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{goal.name}</p>
          <p className="text-xs text-muted-foreground">
            {formatMinor(goal.savedMinor)} of {formatMinor(goal.targetMinor)}
          </p>
        </div>
        {done ? (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
            <Check className="size-3.5" /> Reached
          </span>
        ) : (
          <p className="text-xl font-bold tabular-nums">{Math.round(pct)}%</p>
        )}
      </div>

      {/* bar with quarter marks */}
      <div className="relative mt-4 h-2.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-[width] duration-700', done ? 'bg-emerald-400' : 'bg-gradient-to-r from-indigo-400 to-emerald-400')}
          style={{ width: `${pct}%` }}
        />
        {[25, 50, 75].map((m) => (
          <span key={m} className="absolute inset-y-0 w-px bg-background/70" style={{ left: `${m}%` }} />
        ))}
      </div>

      <p className="mt-2.5 text-xs text-muted-foreground">
        {done
          ? 'Nicely done. Tap to adjust or remove it.'
          : eta
            ? `${formatMinor(remaining)} to go. At ${formatMinor(goal.monthlyContributionMinor)} a month, you'll get there around ${eta.label}.`
            : `${formatMinor(remaining)} to go. Tap to add money or set a monthly amount.`}
      </p>
    </button>
  )
}

/* ───────────────────────────── empty ───────────────────────────── */

function EmptyState({ onPick }: { onPick: (name: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border px-6 py-12 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-300">
        <Target className="size-6" />
      </div>
      <div>
        <p className="font-medium">No goals yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Pick something to start with, or add your own.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm active:scale-95"
          >
            <span>{goalMeta(s).emoji}</span>
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ───────────────────────────── add drawer ───────────────────────────── */

function AddGoalDrawer({
  state,
  onClose,
  onSave,
  pending,
}: {
  state: { name: string } | null
  onClose: () => void
  onSave: (input: GoalInput, done: () => void) => void
  pending: boolean
}) {
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [saved, setSaved] = useState('')
  const [monthly, setMonthly] = useState('')

  useEffect(() => {
    if (state) {
      setName(state.name)
      setTarget('')
      setSaved('')
      setMonthly('')
    }
  }, [state])

  const targetMinor = parseMajorToMinor(target) ?? 0
  const valid = name.trim().length > 0 && targetMinor > 0

  return (
    <Drawer open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="pb-2">
          <DrawerTitle>New goal</DrawerTitle>
          <DrawerDescription>What are you saving for, and how much will it take?</DrawerDescription>
        </DrawerHeader>

        <div className="space-y-4 overflow-y-auto px-4 pb-2">
          <div className="space-y-2">
            <Label htmlFor="goal-name">Name</Label>
            <Input id="goal-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} placeholder="Trip to Goa" />
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setName(s)}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs',
                    name === s ? 'border-indigo-400/60 bg-indigo-500/15 text-indigo-200' : 'border-border bg-card text-muted-foreground',
                  )}
                >
                  {goalMeta(s).emoji} {s}
                </button>
              ))}
            </div>
          </div>

          <MoneyField label="Target amount" value={target} onChange={setTarget} />
          <div className="grid grid-cols-2 gap-3">
            <MoneyField label="Saved so far" value={saved} onChange={setSaved} />
            <MoneyField label="Per month" value={monthly} onChange={setMonthly} />
          </div>
          <p className="text-xs text-muted-foreground">
            A monthly amount is optional. With it, you'll see roughly when you'll finish.
          </p>
        </div>

        <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button
            className="h-12 text-base"
            disabled={!valid || pending}
            onClick={() =>
              onSave(
                {
                  name: name.trim(),
                  targetMinor,
                  savedMinor: parseMajorToMinor(saved) ?? 0,
                  monthlyContributionMinor: parseMajorToMinor(monthly) ?? 0,
                },
                onClose,
              )
            }
          >
            {pending ? 'Adding…' : 'Add goal'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

/* ───────────────────────────── goal drawer ───────────────────────────── */

function GoalDrawer({
  goal,
  onClose,
  onSave,
  onRemove,
  pending,
}: {
  goal: Goal | null
  onClose: () => void
  onSave: (input: GoalInput, message: string, done: () => void) => void
  onRemove: (id: string) => void
  pending: boolean
}) {
  const [view, setView] = useState<'add' | 'edit'>('add')
  const [amount, setAmount] = useState('')
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [saved, setSaved] = useState('')
  const [monthly, setMonthly] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(() => {
    if (!goal) return
    setView('add')
    setAmount('')
    setConfirmRemove(false)
    setName(goal.name)
    setTarget((goal.targetMinor / 100).toFixed(2))
    setSaved((goal.savedMinor / 100).toFixed(2))
    setMonthly(goal.monthlyContributionMinor > 0 ? (goal.monthlyContributionMinor / 100).toFixed(2) : '')
  }, [goal?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!goal) {
    return <Drawer open={false} onOpenChange={() => {}}><DrawerContent /></Drawer>
  }

  const meta = goalMeta(goal.name)
  const remaining = Math.max(0, goal.targetMinor - goal.savedMinor)
  const addMinor = parseMajorToMinor(amount) ?? 0
  const afterPct = goal.targetMinor > 0 ? Math.min(100, ((goal.savedMinor + addMinor) / goal.targetMinor) * 100) : 0
  const quick = remaining > 0
    ? [
        { label: 'A quarter', minor: Math.round(remaining / 4) },
        { label: 'Half', minor: Math.round(remaining / 2) },
        { label: 'Finish it', minor: remaining },
      ]
    : []

  const editTarget = parseMajorToMinor(target) ?? 0
  const editValid = name.trim().length > 0 && editTarget > 0

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="items-center pb-2 text-center">
          <span className={cn('flex size-14 items-center justify-center rounded-2xl text-3xl', meta.tint)}>{meta.emoji}</span>
          <DrawerTitle className="mt-2">{goal.name}</DrawerTitle>
          <DrawerDescription>
            {formatMinor(goal.savedMinor)} of {formatMinor(goal.targetMinor)}
            {remaining > 0 ? `, ${formatMinor(remaining)} to go` : ', reached'}
          </DrawerDescription>
        </DrawerHeader>

        <div className="space-y-4 overflow-y-auto px-4 pb-2">
          <Segmented
            options={[
              { key: 'add', label: 'Add money' },
              { key: 'edit', label: 'Edit goal' },
            ]}
            value={view}
            onChange={setView}
          />

          {view === 'add' && (
            <div className="space-y-4">
              <div className="flex items-baseline justify-center gap-1.5 py-1">
                <span className="text-3xl font-medium text-muted-foreground">{currencySymbol}</span>
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(cleanAmount(e.target.value))}
                  placeholder="0"
                  aria-label="Amount to add"
                  className="w-48 bg-transparent text-center text-5xl font-semibold tabular-nums outline-none placeholder:text-muted-foreground/40"
                />
              </div>

              {quick.length > 0 && (
                <div className="flex justify-center gap-2">
                  {quick.map((q) => (
                    <button
                      key={q.label}
                      type="button"
                      onClick={() => setAmount((q.minor / 100).toFixed(2))}
                      className="rounded-full border border-border bg-card px-3 py-1.5 text-xs active:scale-95"
                    >
                      <span className="font-medium">{q.label}</span>
                      <span className="ml-1.5 text-muted-foreground tabular-nums">{formatMinor(q.minor)}</span>
                    </button>
                  ))}
                </div>
              )}

              <div>
                <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-emerald-400 transition-[width] duration-300" style={{ width: `${afterPct}%` }} />
                </div>
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  {addMinor > 0
                    ? afterPct >= 100
                      ? 'This reaches your goal.'
                      : `This takes you to ${Math.round(afterPct)}%.`
                    : `You're at ${Math.round(pctOf(goal))}% right now.`}
                </p>
              </div>
            </div>
          )}

          {view === 'edit' && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input className="h-11" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <MoneyField label="Target amount" value={target} onChange={setTarget} />
              <div className="grid grid-cols-2 gap-3">
                <MoneyField label="Saved so far" value={saved} onChange={setSaved} />
                <MoneyField label="Per month" value={monthly} onChange={setMonthly} />
              </div>
              <Button
                variant="ghost"
                className={cn('w-full', confirmRemove ? 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/20' : 'text-muted-foreground')}
                disabled={pending}
                onClick={() => (confirmRemove ? onRemove(goal.id) : setConfirmRemove(true))}
              >
                {confirmRemove ? 'Tap again to remove this goal for good' : 'Remove goal'}
              </Button>
            </div>
          )}
        </div>

        <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex w-full max-w-lg gap-2">
            <Button variant="outline" className="h-12 flex-1" onClick={onClose}>
              Cancel
            </Button>
            {view === 'add' ? (
              <Button
                className="h-12 flex-[1.4]"
                disabled={addMinor <= 0 || pending}
                onClick={() =>
                  onSave(
                    {
                      id: goal.id,
                      name: goal.name,
                      targetMinor: goal.targetMinor,
                      savedMinor: goal.savedMinor + addMinor,
                      monthlyContributionMinor: goal.monthlyContributionMinor,
                    },
                    goal.savedMinor + addMinor >= goal.targetMinor ? `${goal.name} reached 🎉` : `Added ${formatMinor(addMinor)}`,
                    onClose,
                  )
                }
              >
                {pending ? 'Saving…' : addMinor > 0 ? `Add ${formatMinor(addMinor)}` : 'Add money'}
              </Button>
            ) : (
              <Button
                className="h-12 flex-[1.4]"
                disabled={!editValid || pending}
                onClick={() =>
                  onSave(
                    {
                      id: goal.id,
                      name: name.trim(),
                      targetMinor: editTarget,
                      savedMinor: parseMajorToMinor(saved) ?? 0,
                      monthlyContributionMinor: parseMajorToMinor(monthly) ?? 0,
                    },
                    'Changes saved',
                    onClose,
                  )
                }
              >
                {pending ? 'Saving…' : 'Save changes'}
              </Button>
            )}
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}