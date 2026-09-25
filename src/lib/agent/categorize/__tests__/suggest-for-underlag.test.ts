import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// Fork (bok.dalavs.se): a receipt with no bank row (an utlägg) gets its cost
// account from the same engine the bank rows use, so the dialog is not empty.

const selectAccount = vi.fn()
const gatherCandidates = vi.fn()
const loadCompanyRules = vi.fn()
vi.mock('../select-account', () => ({ selectAccount: (...a: unknown[]) => selectAccount(...a) }))
vi.mock('../candidates', () => ({ gatherCandidates: (...a: unknown[]) => gatherCandidates(...a) }))
vi.mock('@/lib/agent/company-rules', () => ({ loadCompanyRules: (...a: unknown[]) => loadCompanyRules(...a) }))

import { suggestAccountForUnderlag } from '../suggest-for-underlag'

const supabase = {} as SupabaseClient
const LIDL = {
  supplier: { name: 'Lidl' },
  invoice: { invoiceDate: '2026-02-06', currency: 'SEK' },
  totals: { total: 379.2, vatAmount: 75.84 },
  lineItems: [{ description: 'Akrylfärg' }, { description: 'Canvas FSC' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  gatherCandidates.mockResolvedValue([{ account: '5460', label: 'Förbrukningsmaterial', vatTreatment: null, source: 'history', confidence: 0.6 }])
  loadCompanyRules.mockResolvedValue(['Allt som kan belasta firman bokförs i firman.'])
})

describe('suggestAccountForUnderlag', () => {
  it('reads the receipt as an expense and returns the engine cost account', async () => {
    selectAccount.mockResolvedValue({ account: '5460', confidence: 0.8, reasoning: 'Material', choice: { kind: 'candidate', account: '5460' } })
    const out = await suggestAccountForUnderlag(supabase, 'co-1', { extracted: LIDL, entityType: 'enskild_firma', vatRegistered: true, userNote: null })
    expect(out).toEqual({ account: '5460', confidence: 0.8, reasoning: 'Material' })
    const input = selectAccount.mock.calls[0][0]
    expect(input.transaction).toMatchObject({ merchantName: 'Lidl', amount: -379.2, date: '2026-02-06', currency: 'SEK' })
    expect(input.underlag).toContain('Akrylfärg')
    expect(input.companyRules).toEqual(['Allt som kan belasta firman bokförs i firman.'])
    expect(input.candidates).toHaveLength(1)
  })

  it('never returns a non-cost account and answers null when the engine has nothing', async () => {
    selectAccount.mockResolvedValue({ account: '1930', confidence: 0.9, reasoning: '', choice: { kind: 'candidate', account: '1930' } })
    expect((await suggestAccountForUnderlag(supabase, 'co-1', { extracted: LIDL, entityType: 'enskild_firma', vatRegistered: true })).account).toBeNull()
    selectAccount.mockResolvedValue({ account: null, confidence: 0, reasoning: '', choice: { kind: 'needs_review' } })
    expect((await suggestAccountForUnderlag(supabase, 'co-1', { extracted: LIDL, entityType: 'enskild_firma', vatRegistered: true })).account).toBeNull()
  })

  it('asks nothing of the engine when there is no reading at all', async () => {
    expect(await suggestAccountForUnderlag(supabase, 'co-1', { extracted: null, entityType: 'enskild_firma', vatRegistered: true })).toEqual({ account: null, confidence: 0, reasoning: '' })
    expect(selectAccount).not.toHaveBeenCalled()
  })
})
