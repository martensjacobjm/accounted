/**
 * Which cost account (and, for the owner, which counter account) an utlägg
 * should land on, decided from what the uploader wrote and what the AI read.
 *
 * Background (bok.dalavs.se fork, Jacob 2026-09-22): the "Bokför utlägget"
 * dialog opened with an empty Kostnadskonto even when the comment on the
 * upload said "5480 mot 2018" and the extraction had classified the receipt.
 * The comment was a dead text field. This module is the single place that
 * turns those two sources into a suggestion, used by the extraction (server)
 * and the dialog (client) alike. Framework-free on purpose.
 *
 * Precedence: an explicit account in the uploader's comment beats the AI's
 * suggestion, because the person who bought the thing knows what it was.
 */

export type ExpenseAccountSource = 'note' | 'extraction'

export interface ExpenseAccountSuggestion {
  account: string | null
  source: ExpenseAccountSource | null
}

/** Cost accounts an utlägg may debit: result classes 4 to 7 (8 is finance). */
const COST_ACCOUNT_RE = /\b([4-7]\d{3})\b/g
/** Counter accounts the owner may pick for a privately paid cost. */
export const OWNER_LIABILITY_CHOICES = ['2893', '2018', '2890'] as const
export type OwnerLiabilityChoice = (typeof OWNER_LIABILITY_CHOICES)[number]
const OWNER_LIABILITY_RE = /\b(2893|2018|2890)\b/

export function isCostAccount(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[4-7]\d{3}$/.test(value)
}

/**
 * The first cost account named in a free-text comment ("5480 mot 2018",
 * "konto 6110"). When a chart is given, only accounts that exist in it count,
 * so a stray four-digit number (a price, an order number) never becomes the
 * account. Amounts with decimals or thousands separators do not match the
 * word boundary on both sides ("1 729,00" yields no 4-digit token in class 4-7
 * followed by a boundary... "1729" would, hence the chart check).
 */
export function accountFromNote(
  note: string | null | undefined,
  chart?: ReadonlySet<string> | null,
): string | null {
  if (!note) return null
  for (const match of note.matchAll(COST_ACCOUNT_RE)) {
    const candidate = match[1]
    if (!chart || chart.has(candidate)) return candidate
  }
  return null
}

/** The owner's counter account named in the comment ("mot 2018"), if any. */
export function liabilityFromNote(note: string | null | undefined): OwnerLiabilityChoice | null {
  if (!note) return null
  const m = OWNER_LIABILITY_RE.exec(note)
  return m ? (m[1] as OwnerLiabilityChoice) : null
}

export function suggestExpenseAccount(
  input: { note?: string | null; extractedAccount?: string | null },
  chart?: ReadonlySet<string> | null,
): ExpenseAccountSuggestion {
  const fromNote = accountFromNote(input.note, chart)
  if (fromNote) return { account: fromNote, source: 'note' }
  const fromAi = input.extractedAccount
  if (isCostAccount(fromAi) && (!chart || chart.has(fromAi))) return { account: fromAi, source: 'extraction' }
  return { account: null, source: null }
}
