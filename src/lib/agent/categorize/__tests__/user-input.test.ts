import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// Fork (bok.dalavs.se, 2026-09-22): the booking proposal for a bank row must see
// what the user wrote and what the company taught, and go stale when that changes.

const generateStructured = vi.fn()
vi.mock('@/lib/ai', () => ({ getAiService: () => ({ generateStructured }) }))

import { selectAccount, type SelectAccountInput } from '../select-account'
import { readIsFresh, underlagKeyFor } from '../read-shape'
import { gatherUnderlag } from '../underlag'

function input(over: Partial<SelectAccountInput> = {}): SelectAccountInput {
  return {
    transaction: { merchantName: 'Jula', description: 'Kortköp Jula', amount: -1187.4, currency: 'SEK' },
    candidates: [],
    entityType: 'enskild_firma',
    vatRegistered: true,
    samples: 1,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  generateStructured.mockResolvedValue({
    value: { reasoning: 'r', choice: 'needs_review', confidence: 'low', reverse_charge: false },
    model: 'm',
    usage: {},
  })
})

describe('selectAccount prompt carries the user and the company', () => {
  it('includes the note, the reference, the bank text, the counterparty account and the typed note', async () => {
    await selectAccount(
      input({
        transaction: {
          merchantName: 'Jula',
          description: 'Städmaterial till kund Lindvallen',
          amount: -1187.4,
          currency: 'SEK',
          notes: 'Moppar och hinkar till flyttstädningen',
          reference: 'OCR 12345',
          originalDescription: 'JULA AB MORA',
          counterpartyAccount: '5050-1055',
          userNote: 'Det är förbrukningsmaterial, inte inventarier',
        },
      }),
    )
    const prompt = generateStructured.mock.calls[0][0].prompt as string
    expect(prompt).toContain('Anteckning: Moppar och hinkar till flyttstädningen')
    expect(prompt).toContain('Referens: OCR 12345')
    expect(prompt).toContain('Bankens text: JULA AB MORA')
    expect(prompt).toContain('Motpartens konto: 5050-1055')
    expect(prompt).toContain('Användaren säger om just den här raden')
    expect(prompt).toContain('Det är förbrukningsmaterial, inte inventarier')
  })

  it('renders the company rules above the options, as rules', async () => {
    await selectAccount(input({ companyRules: ['Alla kortköp utanför banken är Wilmas egna pengar (2018)'] }))
    const prompt = generateStructured.mock.calls[0][0].prompt as string
    expect(prompt).toContain('Bolagets regler')
    expect(prompt).toContain('- Alla kortköp utanför banken är Wilmas egna pengar (2018)')
    expect(prompt.indexOf('Bolagets regler')).toBeLessThan(prompt.indexOf('Alternativ:'))
  })

  it('leaves the bank text out when it equals the working title', async () => {
    await selectAccount(input({ transaction: { description: 'JULA AB', originalDescription: 'JULA AB', amount: -1 } }))
    const prompt = generateStructured.mock.calls[0][0].prompt as string
    expect(prompt).not.toContain('Bankens text')
  })
})

describe('underlagKeyFor / readIsFresh', () => {
  const base = { document_id: null, notes: null, description: 'JULA AB', original_description: 'JULA AB' }
  it('keeps the old key for an untouched row, so stored reads stay fresh after the deploy', () => {
    expect(underlagKeyFor(base)).toBeNull()
    expect(underlagKeyFor({ ...base, document_id: 'doc-1' })).toBe('doc-1')
    expect(readIsFresh({ underlag_key: 'doc-1' }, { ...base, document_id: 'doc-1' })).toBe(true)
  })
  it('goes stale when the user writes a note', () => {
    const key = underlagKeyFor(base)
    expect(readIsFresh({ underlag_key: key }, { ...base, notes: 'Moppar till kund' })).toBe(false)
  })
  it('goes stale when the user renames the row', () => {
    const key = underlagKeyFor(base)
    expect(readIsFresh({ underlag_key: key }, { ...base, description: 'Städmaterial' })).toBe(false)
  })
  it('is stable for the same input', () => {
    const tx = { ...base, notes: 'Moppar', document_id: 'doc-1' }
    expect(readIsFresh({ underlag_key: underlagKeyFor(tx) }, tx)).toBe(true)
  })
})

describe('gatherUnderlag reads what the uploader said and what the reading suggested', () => {
  function sb(inbox: unknown[]): SupabaseClient {
    return {
      from(table: string) {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: null }),
          then: (resolve: (v: { data: unknown[] }) => unknown) =>
            resolve({ data: table === 'invoice_inbox_items' ? inbox : [] }),
        }
        return chain
      },
    } as unknown as SupabaseClient
  }
  it('adds the upload comment, the WhatsApp caption and the reading account', async () => {
    const out = await gatherUnderlag(
      sb([
        {
          extracted_data: { supplier: { name: 'Jula' }, suggestedAccount: '5460', documentKind: 'receipt', merchantCategory: 'hardware' },
          channel_context: { user_note: 'Moppar till kund', caption: 'kvitto jula' },
        },
      ]),
      'c1',
      't1',
    )
    expect(out).toContain('leverantör Jula')
    expect(out).toContain('Uppladdarens kommentar: Moppar till kund')
    expect(out).toContain('Bildtext: kvitto jula')
    expect(out).toContain('Tolkningens kontoförslag: 5460')
  })
})
