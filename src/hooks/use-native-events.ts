import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { LocalExpense } from '@/lib/plugin'
import { queryKeys } from '@/lib/query'
import { subscribeToListeners } from '@/lib/subscriptions'

export function useNativeEvents() {
  const client = useQueryClient()

  useEffect(
    () =>
      subscribeToListeners(
        () =>
          LocalExpense.addListener('rawEventCaptured', () => {
            void client.invalidateQueries({ queryKey: ['rawEvents'] })
            void client.invalidateQueries({ queryKey: queryKeys.listener })
          }),
        () =>
          LocalExpense.addListener('transactionAdded', () => {
            void client.invalidateQueries({ queryKey: ['transactions'] })
            void client.invalidateQueries({ queryKey: queryKeys.ingestionStats })
            void client.invalidateQueries({ queryKey: queryKeys.dashboard })
          }),
        () =>
          LocalExpense.addListener('listenerHealthChanged', () => {
            void client.invalidateQueries({ queryKey: queryKeys.listener })
          }),
        () =>
          LocalExpense.addListener('dataChanged', ({ scope }) => {
            if (scope === 'accounts') void client.invalidateQueries({ queryKey: queryKeys.accounts })
            if (scope === 'monitored_apps') void client.invalidateQueries({ queryKey: queryKeys.monitoredApps })
            void client.invalidateQueries({ queryKey: ['rawEvents'] })
            void client.invalidateQueries({ queryKey: ['transactions'] })
            void client.invalidateQueries({ queryKey: queryKeys.ingestionStats })
            void client.invalidateQueries({ queryKey: queryKeys.dashboard })
          }),
      ),
    [client],
  )
}
