import { QueryClient } from '@tanstack/react-query'
import type {
  RawEventSource,
  RawEventStatus,
  TransactionDirection,
  TransactionStatus,
} from './plugin'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

export interface RawEventFilters {
  status: RawEventStatus | null
  source: RawEventSource | null
}

export interface TransactionFilters {
  status: TransactionStatus | null
  direction: TransactionDirection | null
  categoryId: string | null
}

export const queryKeys = {
  onboarding: ['onboarding'] as const,
  listener: ['listener'] as const,
  candidateApps: ['candidateApps'] as const,
  monitoredApps: ['monitoredApps'] as const,
  accounts: ['accounts'] as const,
  balances: ['balances'] as const,
  smsImport: ['smsImport'] as const,
  battery: ['battery'] as const,
  ingestionStats: ['ingestionStats'] as const,
  rules: ['rules'] as const,
  recurring: ['recurring'] as const,
  dashboard: ['dashboard'] as const,
  rawEvents: (filters: RawEventFilters) => ['rawEvents', filters.status, filters.source] as const,
  rawEventFeed: (filters: RawEventFilters) =>
    ['rawEvents', 'feed', filters.status, filters.source] as const,
  transactions: (filters: TransactionFilters) =>
    ['transactions', filters.status, filters.direction, filters.categoryId] as const,
  transactionFeed: (filters: TransactionFilters) =>
    ['transactions', 'feed', filters.status, filters.direction, filters.categoryId] as const,
}
