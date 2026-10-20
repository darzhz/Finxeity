import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { LocalExpense } from '@/lib/plugin'
import { queryKeys } from '@/lib/query'

/**
 * Bridges native events into the query cache. Mounted once at the app root.
 */
export function useNativeEvents() {
  const client = useQueryClient()

  useEffect(() => {
    const handles = [
      LocalExpense.addListener('rawEventCaptured', () => {
        client.invalidateQueries({ queryKey: ['rawEvents'] })
        client.invalidateQueries({ queryKey: queryKeys.listener })
      }),
      LocalExpense.addListener('transactionAdded', () => {
        client.invalidateQueries({ queryKey: ['transactions'] })
        client.invalidateQueries({ queryKey: queryKeys.ingestionStats })
        client.invalidateQueries({ queryKey: queryKeys.dashboard })
      }),
      LocalExpense.addListener('listenerHealthChanged', () => {
        client.invalidateQueries({ queryKey: queryKeys.listener })
      }),
      LocalExpense.addListener('dataChanged', ({ scope }) => {
        if (scope === 'accounts') client.invalidateQueries({ queryKey: queryKeys.accounts })
        if (scope === 'monitored_apps') client.invalidateQueries({ queryKey: queryKeys.monitoredApps })
        client.invalidateQueries({ queryKey: ['rawEvents'] })
        client.invalidateQueries({ queryKey: ['transactions'] })
        client.invalidateQueries({ queryKey: queryKeys.ingestionStats })
        client.invalidateQueries({ queryKey: queryKeys.dashboard })
      }),
    ]

    return () => {
      Promise.all(handles).then((resolved) => resolved.forEach((h) => h.remove()))
    }
  }, [client])
}
