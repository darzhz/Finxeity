import { HashRouter, Navigate, Route, Routes } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { AppShell } from '@/components/app-shell'
import { useNativeEvents } from '@/hooks/use-native-events'
import { LocalExpense } from '@/lib/plugin'
import { queryKeys } from '@/lib/query'
import { Skeleton } from '@/components/ui/skeleton'
import { OnboardingPage } from '@/routes/onboarding/onboarding-page'
import { DashboardPage } from '@/routes/dashboard/dashboard-page'
import { TransactionsPage } from '@/routes/transactions/transactions-page'
import { HistoryPage } from '@/routes/history/history-page'
import { RecurringPage } from '@/routes/recurring/recurring-page'
import { CommitmentsPage } from '@/routes/commitments/commitments-page'
import { GoalsPage } from '@/routes/goals/goals-page'
import { BudgetsPage } from '@/routes/budgets/budgets-page'
import { ReviewPage } from '@/routes/review/review-page'
import { SettingsPage } from '@/routes/settings/settings-page'
import { ManageAppsPage } from '@/routes/settings/manage-apps-page'

function RootRedirect() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.onboarding,
    queryFn: () => LocalExpense.getOnboardingState(),
  })

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  return <Navigate to={data?.completed ? '/dashboard' : '/onboarding'} replace />
}

export default function App() {
  useNativeEvents()

  return (
    <HashRouter>
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/recurring" element={<RecurringPage />} />
          <Route path="/bills" element={<CommitmentsPage />} />
          <Route path="/goals" element={<GoalsPage />} />
          <Route path="/budgets" element={<BudgetsPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/apps" element={<ManageAppsPage />} />
        </Route>
        <Route path="/" element={<RootRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
