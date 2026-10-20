import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import type { CandidateApp } from '@/lib/plugin'
import { LocalExpense } from '@/lib/plugin'
import { queryKeys } from '@/lib/query'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'

interface AppPickerProps {
  selected: string[]
  onChange: (packages: string[]) => void
  /** Preselect the device's default messaging app the first time apps load. */
  preselectDefaultSms?: boolean
}

function AppRow({
  app,
  checked,
  onToggle,
}: {
  app: CandidateApp
  checked: boolean
  onToggle: (next: boolean) => void
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 active:bg-accent">
      <Checkbox checked={checked} onCheckedChange={(value) => onToggle(value === true)} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{app.label}</span>
        <span className="truncate text-xs text-muted-foreground">{app.packageName}</span>
      </span>
      {app.isDefaultSms && <Badge variant="secondary">Default SMS</Badge>}
      {app.suggested && !app.isDefaultSms && <Badge variant="outline">Suggested</Badge>}
    </label>
  )
}

export function AppPicker({ selected, onChange, preselectDefaultSms = false }: AppPickerProps) {
  const [search, setSearch] = useState('')
  const preselected = useRef(false)

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.candidateApps,
    queryFn: () => LocalExpense.getCandidateApps(),
  })

  useEffect(() => {
    if (!preselectDefaultSms || preselected.current || !data) return
    preselected.current = true
    if (selected.length === 0 && data.defaultSmsPackage) {
      onChange([data.defaultSmsPackage])
    }
  }, [data, preselectDefaultSms, selected.length, onChange])

  const { suggested, others } = useMemo(() => {
    const apps = data?.apps ?? []
    const term = search.trim().toLowerCase()
    const filtered = term
      ? apps.filter(
          (app) =>
            app.label.toLowerCase().includes(term) ||
            app.packageName.toLowerCase().includes(term),
        )
      : apps
    return {
      suggested: filtered.filter((app) => app.suggested || app.isDefaultSms),
      others: filtered.filter((app) => !app.suggested && !app.isDefaultSms),
    }
  }, [data, search])

  function toggle(packageName: string, next: boolean) {
    if (next) {
      onChange(Array.from(new Set([...selected, packageName])))
    } else {
      onChange(selected.filter((pkg) => pkg !== packageName))
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search apps"
          className="h-11 pl-9"
          autoCapitalize="none"
          autoCorrect="off"
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 pr-2">
          {suggested.length > 0 && (
            <section className="space-y-1">
              <h3 className="px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Suggested
              </h3>
              {suggested.map((app) => (
                <AppRow
                  key={app.packageName}
                  app={app}
                  checked={selected.includes(app.packageName)}
                  onToggle={(next) => toggle(app.packageName, next)}
                />
              ))}
            </section>
          )}
          <section className="space-y-1">
            <h3 className="px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              All apps
            </h3>
            {others.map((app) => (
              <AppRow
                key={app.packageName}
                app={app}
                checked={selected.includes(app.packageName)}
                onToggle={(next) => toggle(app.packageName, next)}
              />
            ))}
            {others.length === 0 && suggested.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No apps match “{search}”.
              </p>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  )
}
