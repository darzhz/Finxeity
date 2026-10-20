import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { HistoryPage } from './history-page'
import { queryKeys } from '@/lib/query'
import { resetMockPlugin } from '@/lib/plugin-mock'

function renderHistory(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
}

describe('HistoryPage', () => {
  beforeEach(() => {
    resetMockPlugin()
  })

  it('renders when the dashboard already cached a plain recent-events page', async () => {
    const client = newClient()
    client.setQueryData(queryKeys.rawEvents({ status: null, source: null }), { items: [] })

    renderHistory(client)

    await waitFor(() =>
      expect(screen.getByText('Notification history')).toBeInTheDocument(),
    )
  })

  it('keeps the paginated feed on a cache key of its own', () => {
    const filters = { status: null, source: null }
    expect(queryKeys.rawEventFeed(filters)).not.toEqual(queryKeys.rawEvents(filters))
  })

  it('shows what each message became', async () => {
    renderHistory(newClient())

    const row = await screen.findByText('Paid ₹450 to Swiggy')
    fireEvent.click(row)

    const outcome = await screen.findByText('₹450.00 · Swiggy')
    expect(outcome).toBeInTheDocument()
  })

  it('removes a message and offers to restore it', async () => {
    renderHistory(newClient())

    const row = await screen.findByText('Paid ₹450 to Swiggy')
    fireEvent.click(row)

    const remove = await screen.findByText('Remove this one')
    fireEvent.click(remove)

    await waitFor(() => expect(screen.getByText('Restore')).toBeInTheDocument())
  })

  it('filters to the messages that became transactions', async () => {
    renderHistory(newClient())

    fireEvent.click(await screen.findByRole('tab', { name: 'Transactions' }))

    await waitFor(() =>
      expect(
        screen.queryByText('Get ₹100 cashback on your next UPI transaction'),
      ).toBeNull(),
    )
    expect(screen.getByText('Paid ₹450 to Swiggy')).toBeInTheDocument()
  })

  it('filters to the messages that were ignored', async () => {
    renderHistory(newClient())

    fireEvent.click(await screen.findByRole('tab', { name: 'Ignored' }))

    await waitFor(() =>
      expect(screen.queryByText('Paid ₹450 to Swiggy')).toBeNull(),
    )
    expect(
      screen.getByText('Get ₹100 cashback on your next UPI transaction'),
    ).toBeInTheDocument()
  })
})
