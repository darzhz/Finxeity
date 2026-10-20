import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { DashboardPage } from './dashboard-page'
import { resetMockPlugin } from '@/lib/plugin-mock'

function renderDashboard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('DashboardPage', () => {
  beforeEach(() => {
    resetMockPlugin()
  })

  it('shows the balance', async () => {
    renderDashboard()
    await waitFor(() => expect(screen.getByText('Total balance')).toBeInTheDocument())
  })

  it('shows the spending rate and the runway', async () => {
    renderDashboard()
    await waitFor(() => expect(screen.getByText('Spending rate')).toBeInTheDocument())
    expect(screen.getByText('Runway')).toBeInTheDocument()
  })

  it('shows the cashflow, the categories and the merchants', async () => {
    renderDashboard()
    await waitFor(() => expect(screen.getByText('Cashflow')).toBeInTheDocument())
    expect(screen.getByText('Where it went')).toBeInTheDocument()
    expect(screen.getByText('Top merchants')).toBeInTheDocument()
  })

  it('shows the savings potential with its sources', async () => {
    renderDashboard()
    await waitFor(() => expect(screen.getByText('Savings potential')).toBeInTheDocument())
    expect(screen.getByText('Netflix went up')).toBeInTheDocument()
    expect(screen.getByText('Fees and charges')).toBeInTheDocument()
  })

  it('shows the safe to spend figure when there is one', async () => {
    renderDashboard()
    await waitFor(() => expect(screen.getByText('Safe to spend')).toBeInTheDocument())
  })
})
