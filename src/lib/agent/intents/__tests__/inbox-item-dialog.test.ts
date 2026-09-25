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
      { data: [{ account_number: '5480' }, { account_number: '5460' }] },
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
      { data: { id: 'tx-1', date: '2026-08-07', amount: -1187.4, description: 'JULA MORA' } },
      { data: [] },
    ])
    const captured = await inboxItemDialog.capture({ item_id: ITEM_ID }, ctx(supabase))
    expect(captured.item?.status).toBe('matched')
    const prompt = inboxItemDialog.promptTemplate({ captured, profileSummary: null, activeMemory: [] })
    expect(prompt).toContain('betalt från företagskontot')
    expect(prompt).toContain('JULA MORA')
    // Fork 2026-09-22: a matched item is booked through the bank row, never as a
    // separate voucher (that left the bank row unbooked: double booking).
    expect(prompt).toContain('gnubok_categorize_transaction')
    expect(prompt).toContain('transaction_id=tx-1')
    expect(prompt).toMatch(/INTE gnubok_create_voucher/)
    expect(inboxItemDialog.tools).toContain('gnubok_categorize_transaction')
  })

  it('never turns a price in the comment into an account, and shows the other human text', async () => {
    const { supabase, enqueueMany } = createQueuedMockSupabase()
    enqueueMany([
      { data: { entity_type: 'enskild_firma' } },
      {
        data: {
          id: ITEM_ID, document_id: 'doc-1', kind_hint: null, matched_transaction_id: null,
          created_journal_entry_id: null, created_supplier_invoice_id: null,
          extracted_data: { supplier: { name: 'Elgiganten' }, invoice: {}, totals: { total: 6995 }, lineItems: [] },
          channel_context: { channel: 'whatsapp', user_note: 'laptop 6995 kr', caption: 'dator till kontoret' },
        },
      },
      { data: [{ account_number: '5410' }, { account_number: '6540' }] },
    ])
    const captured = await inboxItemDialog.capture({ item_id: ITEM_ID }, ctx(supabase))
    expect(captured.item?.note_account).toBeNull()
    const prompt = inboxItemDialog.promptTemplate({ captured, profileSummary: null, activeMemory: [] })
    expect(prompt).not.toContain('kontonummer i kommentaren')
    expect(prompt).toContain('Bildtext: dator till kontoret')
  })

  it('tells the assistant to pick the item again when it cannot be read', async () => {
    const { supabase, enqueueMany } = createQueuedMockSupabase()
    enqueueMany([{ data: { entity_type: 'aktiebolag' } }, { data: null }])
    const captured = await inboxItemDialog.capture({ item_id: ITEM_ID }, ctx(supabase))
    expect(captured.item).toBeNull()
    expect(inboxItemDialog.promptTemplate({ captured, profileSummary: null, activeMemory: [] })).toContain('välja underlaget igen')
  })

  it("carries the pane's 'Vem betalade?' choice so the assistant does not ask it again (fork)", async () => {
    const { supabase, enqueueMany } = createQueuedMockSupabase()
    enqueueMany([
      { data: { entity_type: 'enskild_firma' } },
      {
        data: {
          id: ITEM_ID,
          document_id: 'doc-1',
          kind_hint: 'receipt',
          matched_transaction_id: null,
          created_journal_entry_id: null,
          created_supplier_invoice_id: null,
          extracted_data: { supplier: { name: 'Lidl' }, totals: { total: 379.2, vatAmount: 75.84 } },
          channel_context: null,
        },
      },
      { data: [{ account_number: '5460' }] },
    ])
    const captured = await inboxItemDialog.capture({ item_id: ITEM_ID, payer: 'owner' }, ctx(supabase))
    expect(captured.payer).toBe('owner')
    const prompt = inboxItemDialog.promptTemplate({ captured, profileSummary: null, activeMemory: [] })
    expect(prompt).toContain('VEM BETALADE (valt av användaren i rutan): egna pengar')
    expect(prompt).toContain('Fråga inte hur det betalades')

    const unknown = await inboxItemDialog.capture({ item_id: '', payer: 'nonsense' as never }, ctx(createQueuedMockSupabase().supabase))
    expect(unknown.payer).toBeNull()
  })
})

