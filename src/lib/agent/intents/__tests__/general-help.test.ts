import { describe, it, expect } from 'vitest'
import { generalHelp } from '../general-help'

// Fork change (bok.dalavs.se, 2026-09-16, decision B-S21): general.help is no
// longer read-only. These guards lock in:
//   1. the everyday write tools ARE whitelisted (so /chat can stage a booking),
//   2. the commit tool is NOT (nothing commits from chat without a click),
//   3. year-end / period locks / settings stay off this intent, and
//   4. the prompt describes the staged-approval workflow and forbids
//      claiming a staging that never happened.

const WRITE_TOOLS_EXPECTED = [
  'gnubok_categorize_transaction',
  'gnubok_match_transaction_to_invoice',
  'gnubok_bulk_book_transactions',
  'gnubok_bulk_book_inbox_items',
  'gnubok_create_voucher',
  'gnubok_correct_entry',
  'gnubok_reverse_journal_entry',
  'gnubok_approve_supplier_invoice',
  'gnubok_create_invoice',
  'gnubok_mark_invoice_as_paid',
  'gnubok_create_customer',
  'gnubok_create_supplier',
]

const NEVER_FROM_CHAT = [
  'gnubok_approve_pending_operation',
  'gnubok_run_year_end',
  'gnubok_close_period',
  'gnubok_lock_period',
  'gnubok_unlock_period',
  'gnubok_update_company_settings',
  'gnubok_create_company',
]

function renderPrompt() {
  return generalHelp.promptTemplate({
    captured: { route: '/transactions' },
    profileSummary: null,
    activeMemory: [],
  })
}

describe('general.help: the /chat assistant with staged write tools', () => {
  it('exposes the everyday write tools (so /chat can stage a booking)', () => {
    for (const t of WRITE_TOOLS_EXPECTED) {
      expect(generalHelp.tools).toContain(t)
    }
  })

  it('never exposes the commit tool, year-end, period locks or settings', () => {
    for (const t of NEVER_FROM_CHAT) {
      expect(generalHelp.tools).not.toContain(t)
    }
  })

  it('keeps the read side intact', () => {
    for (const t of ['gnubok_query_journal', 'gnubok_get_income_statement', 'gnubok_list_inbox_items', 'gnubok_load_skill']) {
      expect(generalHelp.tools).toContain(t)
    }
  })

  it('describes the staged-approval workflow instead of a read-only disclaimer', () => {
    const out = renderPrompt()
    expect(out).toContain('godkännandekort')
    expect(out).toContain('ARBETSGÅNG FÖR SKRIVÅTGÄRDER')
    expect(out).toContain('gnubok_categorize_transaction')
    expect(out).not.toContain('INGA skrivverktyg')
    expect(out).not.toContain('kan inte stagea')
  })

  it('still points year-end and settings to their pages and forbids fake staging', () => {
    const out = renderPrompt()
    expect(out).toContain('/bookkeeping/year-end')
    expect(out).toContain('/settings')
    expect(out).toMatch(/Påstå ALDRIG att du stagat/i)
  })

  it('tells the agent to answer navigation questions from the app map', () => {
    expect(renderPrompt()).toContain('menystrukturen')
  })
})
