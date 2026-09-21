import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createQueuedMockSupabase } from '@/tests/helpers'
import { inboxItemDialog } from '../inbox-item-dialog'

// Fork (bok.dalavs.se): the one-item conversation must hand the assistant what
// the uploader wrote, the account named in it, and the payment situation, or
// it asks questions the person already answered.

const ITEM_ID = '11111111-1111-1111-1111-111111111111'

function ctx(supabase: unknown) {
  return { supabase: supabase as SupabaseClient, userId: 'user-1', companyId: 'company-1' }
}

describe('inbox.item-dialog', () => {
  it('captures the uploader note, its account and counter account, and says the item is unmatched', async () => {
    const { supabase, enqueueMany } = createQueuedMockSupabase()
    enqueueMany([
      { data: { entity_type: 'aktiebolag' } },
      {
        data: {
          id: ITEM_ID,
          document_id: 'doc-1',
          kind_hint: 'receipt',
          matched_transaction_id: null,
          created_journal_entry_id: null,
          created_supplier_invoice_id: null,
          extracted_data: {
            supplier: { name: 'Cubus AB' },
            invoice: { invoiceDate: '2026-03-11', currency: 'SEK' },
            totals: { total: 228.25, vatAmount: 45.65 },
            merchantCategory: 'other',
            suggestedAccount: '5460',
            lineItems: [{ description: 'Byxor' }],
          },
          channel_context: { channel: 'web', user_note: 'Arbetskläder. Rätt kontering: 5480 mot 2018.' },
        },
      },
    ])
    const captured = await inboxItemDialog.capture({ item_id: ITEM_ID }, ctx(supabase))
    expect(captured.item).toMatchObject({
      status: 'open',
      merchant_name: 'Cubus AB',
      total: 228.25,
      suggested_account: '5460',
      note_account: '5480',
      note_liability: '2018',
      line_items: ['Byxor'],
    })
    const prompt = inboxItemDialog.promptTemplate({
      captured,
      profileSummary: null,
      activeMemory: [{ content: 'Privat betalt bokförs mot 2018.' }],
    })
    expect(prompt).toContain('kontonummer i kommentaren=5480')
    expect(prompt).toContain('motkonto i kommentaren=2018')
    expect(prompt).toContain('ingen banktransaktion är matchad')
    expect(prompt).toContain('Privat betalt bokförs mot 2018.')
    expect(prompt).toContain(`inbox_item_id=${ITEM_ID}`)
  })

  it('reports a matched bank transaction as paid from the company account', async () => {
    const { supabase, enqueueMany } = createQueuedMockSupabase()
    enqueueMany([
      { data: { entity_type: 'enskild_firma' } },
      {
        data: {
          id: ITEM_ID,
          document_id: null,
          kind_hint: null,
          matched_transaction_id: 'tx-1',
          created_journal_entry_id: null,
          created_supplier_invoice_id: null,
          extracted_data: { supplier: { name: 'Jula' }, invoice: {}, totals: { total: 1187.4, vatAmount: 237.48 }, lineItems: [] },
          channel_context: null,
        },
      },
      { data: { date: '2026-08-07', amount: -1187.4, description: 'JULA MORA' } },
    ])
    const captured = await inboxItemDialog.capture({ item_id: ITEM_ID }, ctx(supabase))
    expect(captured.item?.status).toBe('matched')
    const prompt = inboxItemDialog.promptTemplate({ captured, profileSummary: null, activeMemory: [] })
    expect(prompt).toContain('betalt från företagskontot, motkonto 1930')
    expect(prompt).toContain('JULA MORA')
  })

  it('tells the assistant to pick the item again when it cannot be read', async () => {
    const { supabase, enqueueMany } = createQueuedMockSupabase()
    enqueueMany([{ data: { entity_type: 'aktiebolag' } }, { data: null }])
    const captured = await inboxItemDialog.capture({ item_id: ITEM_ID }, ctx(supabase))
    expect(captured.item).toBeNull()
    expect(inboxItemDialog.promptTemplate({ captured, profileSummary: null, activeMemory: [] })).toContain('välja underlaget igen')
  })
})
