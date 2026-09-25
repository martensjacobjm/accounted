import type { SupabaseClient } from '@supabase/supabase-js'
import { gatherCandidates } from './candidates'
import { renderExtraction } from './underlag'
import { selectAccount, type AccountCandidate } from './select-account'
import { loadCompanyRules } from '@/lib/agent/company-rules'
import { isCostAccount } from '@/lib/expenses/suggest-expense-account'
import type { EntityType, Transaction } from '@/types'

/**
 * Fork bok.dalavs.se (2026-09-25): the cost account for an underlag that has
 * no bank row, typically an utlägg paid with the owner's own money. The inbox
 * reading proposes no account by design, so the utlägg dialog opened empty
 * while the bank rows got a read from selectAccount. This asks the same engine
 * with the same evidence: the reading as underlag text, what the person wrote,
 * the company's rules and the account candidates its history yields.
 */
export interface UnderlagAccountInput {
  extracted: Record<string, unknown> | null
  entityType: EntityType
  vatRegistered: boolean
  /** What the person wrote about the underlag (upload comment or the dialog). */
  userNote?: string | null
}

export interface UnderlagAccountSuggestion {
  /** A BAS cost account (4xxx-7xxx), or null when the engine has nothing to offer. */
  account: string | null
  confidence: number
  reasoning: string
}

const NONE: UnderlagAccountSuggestion = { account: null, confidence: 0, reasoning: '' }

export async function suggestAccountForUnderlag(
  supabase: SupabaseClient,
  companyId: string,
  input: UnderlagAccountInput,
): Promise<UnderlagAccountSuggestion> {
  const ex = input.extracted
  if (!ex) return NONE

  const supplier = (ex.supplier as { name?: string | null } | undefined)?.name ?? null
  const invoice = (ex.invoice as { invoiceDate?: string | null; currency?: string | null } | undefined) ?? null
  const total = (ex.totals as { total?: number | null } | undefined)?.total ?? null
  const lines = ((ex.lineItems as Array<{ description?: string | null }> | undefined) ?? [])
    .map((l) => (l?.description ?? '').trim())
    .filter(Boolean)
  const description = [supplier, ...lines.slice(0, 6)].filter(Boolean).join(', ') || 'underlag'
  // Money out: an utlägg is a cost to the company whichever account pays it.
  const amount = total != null ? -Math.abs(total) : 0

  // Candidates come from the same history the bank rows use, looked up by the
  // merchant. A shape gatherCandidates reads; the id is never stored.
  const pseudo = {
    id: 'underlag',
    company_id: companyId,
    merchant_name: supplier,
    description,
    original_description: description,
    amount,
    date: invoice?.invoiceDate ?? null,
    currency: invoice?.currency ?? 'SEK',
    notes: input.userNote ?? null,
  } as unknown as Transaction
  let candidates: AccountCandidate[] = []
  try {
    candidates = await gatherCandidates(supabase, companyId, pseudo)
  } catch {
    candidates = []
  }

  const selection = await selectAccount({
    transaction: {
      merchantName: supplier,
      description,
      amount,
      date: invoice?.invoiceDate ?? null,
      currency: invoice?.currency ?? 'SEK',
      userNote: input.userNote ?? null,
    },
    underlag: renderExtraction(ex, 'Kvitto/faktura (inkorg, ingen banktransaktion)'),
    companyRules: await loadCompanyRules(supabase, companyId),
    candidates,
    entityType: input.entityType,
    vatRegistered: input.vatRegistered,
    samples: 1,
  })

  if (!isCostAccount(selection.account)) return NONE
  return { account: selection.account, confidence: selection.confidence, reasoning: selection.reasoning }
}
