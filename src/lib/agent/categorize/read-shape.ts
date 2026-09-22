import type { AccountCandidate } from './select-account'
import type { Transaction, TransactionCategory, VatTreatment } from '@/types'

/**
 * The stored shape of the assistant's read and the pure helpers on it.
 * Client-safe: no database, no model. The server half is ./read.ts.
 */
export interface AssistantRead {
  transaction_id: string
  underlag_key: string | null
  has_underlag: boolean
  account: string | null
  category: TransactionCategory | null
  vat_treatment: VatTreatment | null
  reverse_charge: boolean
  confidence: number
  model_confidence: string | null
  agreement: number | null
  from_candidate: boolean
  reasoning: string
  candidates: AccountCandidate[]
  model: string | null
  updated_at?: string
}

/** What the read depends on besides the document: the user's note and a renamed title. */
export type ReadInputs = Pick<Transaction, 'document_id'> &
  Partial<Pick<Transaction, 'notes' | 'description' | 'original_description'>>

/** Small stable string hash (djb2, base 36). Client-safe; only detects change. */
function fingerprint(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/**
 * The key a read was made with. Fork (bok.dalavs.se, 2026-09-22): upstream keyed
 * on document_id only, so a note or a new title never made the read stale and
 * the proposal the user argued with never changed. An untouched row keeps the
 * old key (document_id or null), so stored reads stay fresh across the deploy;
 * a note, or a title the user changed, adds a fingerprint.
 */
export function underlagKeyFor(tx: ReadInputs): string | null {
  const notes = (tx.notes ?? '').trim()
  const title = (tx.description ?? '').trim()
  const bank = (tx.original_description ?? '').trim()
  const renamed = !!bank && !!title && title !== bank
  if (!notes && !renamed) return tx.document_id ?? null
  const extra = [notes ? `n:${fingerprint(notes)}` : '', renamed ? `t:${fingerprint(title)}` : ''].filter(Boolean).join('|')
  return `${tx.document_id ?? ''}|${extra}`
}

/** A read is fresh while the row still has the document, note and title it was read with. */
export function readIsFresh(read: Pick<AssistantRead, 'underlag_key'>, tx: ReadInputs): boolean {
  return (read.underlag_key ?? null) === underlagKeyFor(tx)
}

/** The first sentence of the model's reasoning; the rest waits behind "Mer". */
export function firstSentence(text: string): string {
  const m = text.trim().match(/^.*?[.!?](?=\s|$)/)
  return m ? m[0] : text.trim()
}
