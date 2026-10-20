import { describe, expect, it } from 'vitest'
import { createMockPlugin } from './plugin-mock'

describe('mock plugin', () => {
  it('starts with onboarding incomplete', async () => {
    const plugin = createMockPlugin()
    const state = await plugin.getOnboardingState()
    expect(state.completed).toBe(false)
  })

  it('returns raw events newest first', async () => {
    const plugin = createMockPlugin()
    const page = await plugin.listRawEvents()
    expect(page.items.length).toBeGreaterThan(0)
    const [first, second] = page.items
    expect(first.postedAt).toBeGreaterThanOrEqual(second.postedAt)
  })

  it('filters by source and status', async () => {
    const plugin = createMockPlugin()
    const sms = await plugin.listRawEvents({ source: 'SMS' })
    expect(sms.items.every((event) => event.source === 'SMS')).toBe(true)

    const captured = await plugin.listRawEvents({ status: 'CAPTURED' })
    expect(captured.items.every((event) => event.status === 'CAPTURED')).toBe(true)
  })

  it('paginates with a cursor', async () => {
    const plugin = createMockPlugin()
    const firstPage = await plugin.listRawEvents({ limit: 2 })
    expect(firstPage.items).toHaveLength(2)
    expect(firstPage.nextCursor).toBeDefined()

    const secondPage = await plugin.listRawEvents({
      limit: 2,
      cursor: firstPage.nextCursor,
    })
    const firstIds = firstPage.items.map((event) => event.id)
    expect(secondPage.items.every((event) => !firstIds.includes(event.id))).toBe(true)
  })

  it('stores monitored apps', async () => {
    const plugin = createMockPlugin()
    await plugin.setMonitoredApps({ packages: ['a', 'b'] })
    const result = await plugin.getMonitoredApps()
    expect(result.packages).toEqual(['a', 'b'])
  })

  it('returns transactions newest first', async () => {
    const plugin = createMockPlugin()
    const page = await plugin.listTransactions()
    expect(page.items.length).toBeGreaterThan(0)
    const [first, second] = page.items
    expect(first.occurredAt).toBeGreaterThanOrEqual(second.occurredAt)
  })

  it('filters transactions by direction', async () => {
    const plugin = createMockPlugin()
    const credits = await plugin.listTransactions({ direction: 'CREDIT' })
    expect(credits.items.length).toBeGreaterThan(0)
    expect(credits.items.every((tx) => tx.direction === 'CREDIT')).toBe(true)

    const debits = await plugin.listTransactions({ direction: 'DEBIT' })
    expect(debits.items.every((tx) => tx.direction === 'DEBIT')).toBe(true)
  })

  it('paginates transactions with a cursor', async () => {
    const plugin = createMockPlugin()
    const firstPage = await plugin.listTransactions({ limit: 1 })
    expect(firstPage.items).toHaveLength(1)
    expect(firstPage.nextCursor).toBeDefined()

    const secondPage = await plugin.listTransactions({
      limit: 1,
      cursor: firstPage.nextCursor,
    })
    expect(secondPage.items[0].id).not.toBe(firstPage.items[0].id)
  })

  it('reports ingestion stats', async () => {
    const plugin = createMockPlugin()
    const stats = await plugin.getIngestionStats()
    expect(stats.transactions).toBe(3)
    expect(stats.ignored).toBe(2)
    expect(stats.needsReview).toBe(0)
  })

  it('dismisses and restores an event', async () => {
    const plugin = createMockPlugin()
    const page = await plugin.listRawEvents()
    const target = page.items.find((event) => event.status === 'PARSED')!

    await plugin.dismissEvent({ id: target.id })
    const afterDismiss = await plugin.listRawEvents()
    expect(afterDismiss.items.find((e) => e.id === target.id)?.status).toBe('DISMISSED')

    await plugin.restoreEvent({ id: target.id })
    const afterRestore = await plugin.listRawEvents()
    expect(afterRestore.items.find((e) => e.id === target.id)?.status).toBe('PARSED')
  })

  it('corrects a transaction', async () => {
    const plugin = createMockPlugin()
    const page = await plugin.listTransactions()
    const target = page.items[0]

    const result = await plugin.correctTransaction({
      id: target.id,
      amountMinor: 12_345,
      categoryId: 'cat_food',
    })

    expect(result.corrected).toBe(true)
    expect(result.transaction?.amountMinor).toBe(12_345)
    expect(result.transaction?.categoryName).toBe('Food')
  })
})
