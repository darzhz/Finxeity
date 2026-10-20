import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AppPicker } from '@/components/app-picker'
import { Button } from '@/components/ui/button'
import { LocalExpense } from '@/lib/plugin'
import { queryKeys } from '@/lib/query'

export function ManageAppsPage() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const monitored = useQuery({
    queryKey: queryKeys.monitoredApps,
    queryFn: () => LocalExpense.getMonitoredApps(),
  })
  const [selected, setSelected] = useState<string[] | null>(null)

  useEffect(() => {
    if (selected === null && monitored.data) {
      setSelected(monitored.data.packages)
    }
  }, [monitored.data, selected])

  const save = useMutation({
    mutationFn: (packages: string[]) => LocalExpense.setMonitoredApps({ packages }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.monitoredApps })
      await client.invalidateQueries({ queryKey: queryKeys.listener })
      toast.success('Monitored apps updated')
      navigate(-1)
    },
  })

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col gap-3 px-4 pt-[calc(1rem+env(safe-area-inset-top))]">
      <header>
        <h1 className="text-xl font-semibold">Monitored apps</h1>
        <p className="text-sm text-muted-foreground">
          Only notifications from selected apps are read.
        </p>
      </header>
      <AppPicker selected={selected ?? []} onChange={setSelected} />
      <div className="flex gap-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Button variant="outline" className="h-11" onClick={() => navigate(-1)}>
          Cancel
        </Button>
        <Button
          className="h-11 flex-1"
          disabled={selected === null || selected.length === 0 || save.isPending}
          onClick={() => selected && save.mutate(selected)}
        >
          Save
        </Button>
      </div>
    </div>
  )
}
