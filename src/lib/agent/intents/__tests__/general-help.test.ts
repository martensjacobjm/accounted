import { describe, it, expect } from 'vitest'
import { generalHelp } from '../general-help'

// Fork change (bok.dalavs.se, 2026-09-16, decision B-S21): general.help is no
// longer read-only. These guards lock in:
//   1. the everyday write tools ARE whitelisted (so /chat can stage a booking),
//   2. the commit tool is NOT (nothing commits from chat without a click),
//   3. tools that write WITHOUT staging stay off this intent, and
//   4. the prompt describes the staged-approval workflow and forbids
//      claiming a staging that never happened.
// 2026-09-18 (Jacob: full access in the chat): bokslut, periodlås,
// avstämning, lön and settings are whitelisted too, since every one of them
// stages a pending_operation. Only the commit tool and the non-staging
// writers stay out.

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
  // full access 2026-09-18
  'gnubok_link_transaction_to_journal_entry',
  'gnubok_uncategorize_transaction',
  'gnubok_reconcile_match',
  'gnubok_link_invoice_to_voucher',
  'gnubok_lock_period',
  'gnubok_run_year_end',
  'gnubok_update_company_settings',
]

const NEVER_FROM_CHAT = [
  // the click stays human
  'gnubok_approve_pending_operation',
  // bridge / goes to the upstream product team
  'gnubok_call_tool',
  'gnubok_feedback',
  // write without staging a pending_operation
  'gnubok_create_company',
  'gnubok_reject_pending_operation',
  'gnubok_set_quote_status',
  'gnubok_set_inbox_extracted_data',
  'gnubok_upload_document',
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

  it('never exposes the commit tool or tools that write without staging', () => {
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

  it('claims full access, forbids read-only disclaimers and fake staging', () => {
    const out = renderPrompt()
    expect(out).toContain('FULL ÅTKOMST')
    expect(out).toContain('gnubok_link_transaction_to_journal_entry')
    expect(out).not.toContain('Det som INTE görs härifrån')
    expect(out).toMatch(/Påstå ALDRIG att du stagat/i)
  })

  it('lists every tool once', () => {
    expect(new Set(generalHelp.tools).size).toBe(generalHelp.tools.length)
  })

  it('tells the agent to answer navigation questions from the app map', () => {
    expect(renderPrompt()).toContain('menystrukturen')
  })
})
