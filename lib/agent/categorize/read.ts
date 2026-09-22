import type { SupabaseClient } from '@supabase/supabase-js'
import { gatherCandidates } from './candidates'
import { gatherUnderlag } from './underlag'
import { loadCompanyRules } from '@/lib/agent/company-rules'
import { selectAccount, type AccountCandidate, type AccountSelection } from './select-account'
import { getAccountName } from '@/lib/bookkeeping/client-account-names'
import { accountProposal, categoryForAccount, type BookingProposal } from '@/lib/bookkeeping/proposal'
export { categoryForAccount }
import { isSandboxCompany } from '@/lib/sandbox/guard'
import { hasCapability } from '@/lib/entitlements/has-capability'
import { CAPABILITY } from '@/lib/entitlements/keys'
import type { EntityType, Transaction } from '@/types'
import { readIsFresh, underlagKeyFor, firstSentence, type AssistantRead } from './read-shape'
import { ASSISTANT_LIKELY } from '@/lib/transactions/direct-booking'

/**
 * The assistant's read of one transaction, done before anyone opens it.
 *
 * `readTransaction` is the categorize cascade end to end (underlag, the
 * deterministic candidates, the model's pick) minus the write; `storeRead`
 * keeps the result in transaction_assistant_reads, one row per transaction,
 * so the list and the review open with it instead of fetching it while the
 * person waits. A read is fresh while the transaction's document_id is the
 * one it was made with; a receipt matched later makes it stale.
 */

export type { AssistantRead } from './read-shape'
export { underlagKeyFor, readIsFresh, firstSentence } from './read-shape'
export { ASSISTANT_SURE, ASSISTANT_LIKELY } from '@/lib/transactions/direct-booking'

export interface ReadOptions {
  entityType: EntityType
  vatRegistered: boolean
  /** Extracted receipt/invoice text when the caller already has it. */
  underlag?: string
  samples?: number
  /** Fork: typed in the review dialog for this read; weighed above everything but the law. */
  userNote?: string | null
  /** Fork: the company's rules when the caller already loaded them (the cron, per company). */
  companyRules?: string[]
}

export async function readTransaction(
  supabase: SupabaseClient,
  companyId: string,
  tx: Transaction,
  opts: ReadOptions,
): Promise<{ selection: AccountSelection; candidates: AccountCandidate[]; read: AssistantRead }> {
  const [underlag, candidates, companyRules] = await Promise.all([
    opts.underlag != null ? Promise.resolve(opts.underlag) : gatherUnderlag(supabase, companyId, tx.id, tx.document_id),
    gatherCandidates(supabase, companyId, tx),
    opts.companyRules ? Promise.resolve(opts.companyRules) : loadCompanyRules(supabase, companyId),
  ])
  const selection = await selectAccount({
    transaction: {
      merchantName: tx.merchant_name,
      description: tx.description,
      amount: tx.amount,
      date: tx.date,
      currency: tx.currency,
      // Fork: what the user wrote and what the bank said about the row.
      notes: tx.notes,
      reference: tx.reference,
      originalDescription: tx.original_description,
      counterpartyAccount: tx.counterparty_account ?? (tx as { counterparty_iban?: string | null }).counterparty_iban ?? null,
      userNote: opts.userNote ?? null,
    },
    companyRules,
    underlag,
    candidates,
    entityType: opts.entityType,
    vatRegistered: opts.vatRegistered,
    samples: opts.samples,
  })
  const read: AssistantRead = {
    transaction_id: tx.id,
    underlag_key: underlagKeyFor(tx),
    has_underlag: underlag.trim().length > 0,
    account: selection.account,
    category: selection.category,
    vat_treatment: selection.vatTreatment,
    reverse_charge: selection.reverseCharge,
    confidence: selection.confidence,
    model_confidence: selection.modelConfidence,
    agreement: selection.agreement,
    from_candidate: selection.fromCandidate,
    reasoning: selection.reasoning,
    candidates,
    model: selection.model,
  }
  return { selection, candidates, read }
}

export async function storeRead(supabase: SupabaseClient, companyId: string, read: AssistantRead): Promise<void> {
  const { error } = await supabase.from('transaction_assistant_reads').upsert(
    {
      company_id: companyId,
      transaction_id: read.transaction_id,
      underlag_key: read.underlag_key,
      has_underlag: read.has_underlag,
      account: read.account,
      category: read.category,
      vat_treatment: read.vat_treatment,
      reverse_charge: read.reverse_charge,
      confidence: read.confidence,
      model_confidence: read.model_confidence,
      agreement: read.agreement,
      from_candidate: read.from_candidate,
      reasoning: read.reasoning,
      candidates: read.candidates,
      model: read.model,
    },
    { onConflict: 'transaction_id' },
  )
  if (error) throw new Error(error.message)
}

/** The stored reads for these transactions, keyed by transaction id. */
export async function loadReads(
  supabase: SupabaseClient,
  companyId: string,
  transactionIds: string[],
): Promise<Map<string, AssistantRead>> {
  const out = new Map<string, AssistantRead>()
  if (transactionIds.length === 0) return out
  const { data } = await supabase
    .from('transaction_assistant_reads')
    .select(
      'transaction_id, underlag_key, has_underlag, account, category, vat_treatment, reverse_charge, confidence, model_confidence, agreement, from_candidate, reasoning, candidates, model, updated_at',
    )
    .eq('company_id', companyId)
    .in('transaction_id', transactionIds)
  for (const row of (data ?? []) as unknown as AssistantRead[]) {
    out.set(row.transaction_id, { ...row, confidence: Number(row.confidence), candidates: row.candidates ?? [] })
  }
  return out
}

/**
 * The read as a row proposal: the account with its name, booked as one
 * account with an explicit VAT, the first sentence of the reasoning as
 * the description. Null when the assistant found nothing that fits.
 */
export function assistantSuggestionFromRead(
  read: AssistantRead,
  tx: Pick<Transaction, 'id' | 'amount'>,
  entityType?: EntityType,
): BookingProposal | null {
  if (!read.account) return null
  const account = read.account
  const label = read.candidates.find((c) => c.account === account)?.label ?? getAccountName(account)
  const category = categoryForAccount(account, entityType, read.category)
  return accountProposal({
    id: `assistant:${tx.id}`,
    source: 'assistant',
    account,
    label,
    category,
    vat_treatment: read.vat_treatment,
    amount: tx.amount,
    confidence: read.confidence,
    description: firstSentence(read.reasoning),
    has_underlag: read.has_underlag,
  })
}

/**
 * Where the assistant's suggestion sits among the row's others: a rule and
 * a counterpart come first, then the assistant when it is at least likely,
 * then the catalog's keyword matches, then an unsure assistant last.
 */
export function mergeAssistantSuggestion(list: BookingProposal[], s: BookingProposal): BookingProposal[] {
  const rest = list.filter((x) => x.source !== 'assistant')
  if (s.confidence < ASSISTANT_LIKELY) return [...rest, s]
  const firstCatalog = rest.findIndex((x) => x.source !== 'rule' && x.source !== 'counterparty')
  if (firstCatalog === -1) return [...rest, s]
  return [...rest.slice(0, firstCatalog), s, ...rest.slice(firstCatalog)]
}

export interface PlannedRead {
  companyId: string
  entityType: EntityType
  vatRegistered: boolean
  tx: Transaction
}

export interface PlanOptions {
  /** Reads per run, fleet-wide. */
  perRun: number
  /** Reads per company per run, so one backlog cannot starve the rest. */
  perCompany: number
  /** How far back an unbooked transaction is still worth a read. */
  windowDays: number
  now?: Date
}

const TX_COLUMNS =
  'id, company_id, document_id, merchant_name, description, original_description, notes, reference, counterparty_account, counterparty_iban, amount, amount_sek, date, currency, category, is_business, is_ignored, mcc_code, cash_account_id, journal_entry_id'

/**
 * The next unbooked transactions worth a read: newest first, without a
 * fresh read, in companies that are not sandboxes and have the AI
 * capability. Service-role client: this crosses companies.
 */
export async function planAssistantReads(supabase: SupabaseClient, opts: PlanOptions): Promise<PlannedRead[]> {
  const now = opts.now ?? new Date()
  const since = new Date(now.getTime() - opts.windowDays * 86_400_000).toISOString().slice(0, 10)
  const { data: rows } = await supabase
    .from('transactions')
    .select(TX_COLUMNS)
    .is('is_business', null)
    .is('journal_entry_id', null)
    .eq('is_ignored', false)
    .gte('date', since)
    .order('date', { ascending: false })
    .limit(Math.max(opts.perRun * 8, 50))
  const txs = ((rows ?? []) as unknown as Transaction[]).filter((t) => t.amount !== 0)
  if (txs.length === 0) return []

  const { data: readRows } = await supabase
    .from('transaction_assistant_reads')
    .select('transaction_id, underlag_key')
    .in('transaction_id', txs.map((t) => t.id))
  const fresh = new Set<string>()
  for (const r of (readRows ?? []) as Array<{ transaction_id: string; underlag_key: string | null }>) {
    const tx = txs.find((t) => t.id === r.transaction_id)
    if (tx && readIsFresh(r, tx)) fresh.add(r.transaction_id)
  }

  const perCompany = new Map<string, Transaction[]>()
  for (const tx of txs) {
    if (fresh.has(tx.id)) continue
    const list = perCompany.get(tx.company_id) ?? []
    if (list.length >= opts.perCompany) continue
    list.push(tx)
    perCompany.set(tx.company_id, list)
  }

  const planned: PlannedRead[] = []
  for (const [companyId, list] of perCompany) {
    if (planned.length >= opts.perRun) break
    if (await isSandboxCompany(supabase, companyId)) continue
    if (!(await hasCapability(supabase, companyId, CAPABILITY.ai))) continue
    const [{ data: company }, { data: settings }] = await Promise.all([
      supabase.from('companies').select('entity_type').eq('id', companyId).maybeSingle(),
      supabase.from('company_settings').select('vat_registered').eq('company_id', companyId).maybeSingle(),
    ])
    const entityType = ((company?.entity_type as EntityType | undefined) ?? 'enskild_firma')
    const vatRegistered = settings?.vat_registered ?? false
    for (const tx of list) {
      if (planned.length >= opts.perRun) break
      planned.push({ companyId, entityType, vatRegistered, tx })
    }
  }
  return planned
}

/**
 * Fork (bok.dalavs.se, 2026-09-22): forget the company's stored reads so the
 * next open (or the ten-minute cron) reads again. Called when what a read
 * depends on changes outside the row itself: a rule the user taught, a
 * counterparty template or mapping rule created by a booking. The table is a
 * cache of proposals, never bookkeeping, so deleting is safe; best effort.
 */
export async function invalidateAssistantReads(supabase: SupabaseClient, companyId: string): Promise<void> {
  try {
    await supabase.from('transaction_assistant_reads').delete().eq('company_id', companyId)
  } catch {
    // A stale proposal is the worst case; never fail the caller over it.
  }
}
