/**
 * Fork (bok.dalavs.se, 2026-09-22): the user's note on a bank row
 * (transactions.notes) reaches the verifikat when no caller passes notes, so
 * "vad var det här" is not lost between the review dialog and the booking.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createQueuedMockSupabase } from '@/tests/helpers'
import { eventBus } from '@/lib/events'

const mockCreateJE = vi.fn()
vi.mock('@/lib/bookkeeping/transaction-entries', () => ({
  createTransactionJournalEntry: (...args: unknown[]) => mockCreateJE(...args),
}))
vi.mock('@/lib/bookkeeping/cancel-orphaned-entry', () => ({ reverseOrphanedJournalEntry: vi.fn() }))
vi.mock('@/lib/transactions/booking-duplicate-detection', () => ({ detectBookingDuplicate: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/transactions/inbox-underlag', () => ({ propagateUnderlagForBookedTransaction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/bookkeeping/counterparty-templates', () => ({ upsertCounterpartyTemplate: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/transactions/link-journal-entry', () => ({ hasLiveJournalEntryLink: vi.fn().mockResolvedValue(false) }))
vi.mock('@/lib/processing-history/append', () => ({ appendProcessingHistory: vi.fn().mockResolvedValue(undefined) }))

import { categorizeMatchedTransaction } from '../categorize-core'

const TX_ID = '00000000-0000-4000-8000-0000000000dd'
const txRow = (over: Record<string, unknown> = {}) => ({
  id: TX_ID, company_id: 'company-1', date: '2026-07-10', amount: -479, currency: 'SEK', amount_sek: -479,
  exchange_rate: 1, description: 'JULA AB', merchant_name: null, cash_account_id: null, document_id: null,
  journal_entry_id: null, ...over,
})

function queue(enqueue: (r: { data?: unknown }) => void, row: Record<string, unknown>) {
  enqueue({ data: row })
  enqueue({ data: { entity_type: 'aktiebolag', fiscal_year_start_month: 1 } })
  enqueue({ data: [] })
  enqueue({ data: [{ id: 'fp-1' }] })
  enqueue({ data: { bookkeeping_locked_through: null } })
  enqueue({ data: { id: 'fp-1', is_closed: false, locked_at: null } })
  enqueue({ data: [{ ...row, is_business: false, category: 'private', journal_entry_id: 'je-1' }] })
}

beforeEach(() => {
  vi.clearAllMocks()
  eventBus.clear()
  mockCreateJE.mockResolvedValue({ id: 'je-1' })
})

describe('categorizeMatchedTransaction: the row note', () => {
  it('uses the row note when the caller passes none', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    queue(enqueue, txRow({ notes: '  Moppar till kund  ' }))
    const res = await categorizeMatchedTransaction(supabase as never, 'user-1', 'company-1', TX_ID, { category: 'private' })
    expect(res.error).toBeUndefined()
    expect(mockCreateJE.mock.calls[0][5]).toBe('Moppar till kund')
  })

  it('keeps the caller notes when given', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    queue(enqueue, txRow({ notes: 'radens anteckning' }))
    await categorizeMatchedTransaction(supabase as never, 'user-1', 'company-1', TX_ID, { category: 'private', notes: 'uttryckligt' })
    expect(mockCreateJE.mock.calls[0][5]).toBe('uttryckligt')
  })

  it('passes nothing when neither exists', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    queue(enqueue, txRow({ notes: null }))
    await categorizeMatchedTransaction(supabase as never, 'user-1', 'company-1', TX_ID, { category: 'private' })
    expect(mockCreateJE.mock.calls[0][5]).toBeUndefined()
  })
})
