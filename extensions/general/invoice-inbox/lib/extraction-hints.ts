/**
 * Uppgiftslämnarens ledtrådar och bolagets regler in i AI-tolkningen (fork bok.dalavs.se).
 *
 * Bakgrund (Jacob 2026-09-21): inkorgens tolkning fick aldrig veta vad den som laddade upp
 * visste (kvitto eller faktura, vad köpet gällde) och läste inte bolagets minnen
 * (byråns regler om kontering, skatteplanering), så förslagen blev fel utan att kunna rättas
 * på plats. Den här modulen är ren text- och datahantering: ingen modellkontakt.
 *
 *   1. parseKindHint / sanitiseUserNote: validerar formulärfälten från webbuppladdningen.
 *   2. loadCompanyRulesForExtraction: bolagets alla aktiva minnen plus profilen, via
 *      kärnans lib/agent/company-rules.ts (samma lista som konteringen och assistenten).
 *   3. buildHintInstruction: lägger ledtrådarna sist i användarinstruktionen, så att
 *      systemprompten förblir bytestabil (promptcache) medan varje dokument får sin kontext.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadCompanyRules } from '@/lib/agent/company-rules'
import { renderChannelContextForModel } from '@/lib/documents/channel-context-notes'
import type { InboxChannelContext } from '@/types'

export type UploadKindHint = 'receipt' | 'supplier_invoice'

export const USER_NOTE_MAX = 500
// Fork: the rules come from the shared core module (all sources, not only pinned).
export { COMPANY_RULES_MAX_ROWS, COMPANY_RULE_MAX_CHARS, COMPANY_RULES_MAX_TOTAL, formatCompanyRules } from '@/lib/agent/company-rules'

export interface ExtractionHints {
  /** Vad uppgiftslämnaren sa att dokumentet är. Bindande: skriver över modellens documentKind. */
  kindHint?: UploadKindHint | null
  /** Fri kommentar från uppgiftslämnaren ("städmaterial till kund", "privat, ska ej bokföras"). */
  note?: string | null
  /** Bolagets regler ur agent_memory och profilen, redan formaterade som korta rader. */
  companyRules?: string[]
  /**
   * Fork 2026-09-22: annan text från människor om dokumentet (svar till
   * kvittoroboten, bildtext, mejlets text, representation). Sammanhang, aldrig
   * källa till konto eller belopp.
   */
  otherText?: string | null
  /** Bolagets aktiva kontonummer: ett konto i kommentaren gäller bara om det finns här. */
  accountChart?: string[]
}

export function parseKindHint(value: unknown): UploadKindHint | null {
  if (value === 'receipt' || value === 'supplier_invoice') return value
  return null
}

/** Fritext från webbformuläret: tar bort styrtecken och kapar längden innan den når jsonb och prompten. */
export function sanitiseUserNote(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  if (!cleaned) return null
  return cleaned.slice(0, USER_NOTE_MAX)
}

/**
 * Bolagets regler för tolkningen. Delegerar till kärnans loadCompanyRules, som
 * läser alla aktiva minnen (även det assistenten sparat i chatten), inte bara
 * fastnålade. Fel ger en tom lista: uppladdningen stoppas aldrig av reglerna.
 */
export async function loadCompanyRulesForExtraction(
  supabase: SupabaseClient,
  companyId: string,
): Promise<string[]> {
  return loadCompanyRules(supabase, companyId)
}

const KIND_LABEL: Record<UploadKindHint, string> = {
  receipt: 'receipt (kassakvitto/kortkvitto, betalningen är redan gjord)',
  supplier_invoice: 'supplier_invoice (leverantörsfaktura, ska betalas)',
}

/**
 * Bygger användarinstruktionen: basinstruktionen först, sedan ett block med det
 * uppgiftslämnaren och bolaget vet. Utan ledtrådar returneras basen oförändrad, så att
 * mejl- och WhatsApp-vägarna får exakt samma prompt som förut.
 */
export function buildHintInstruction(base: string, hints?: ExtractionHints | null): string {
  if (!hints) return base
  const parts: string[] = []
  if (hints.kindHint) {
    parts.push(
      `- The uploader declared this document is a ${KIND_LABEL[hints.kindHint]}. This is authoritative: set documentKind to "${hints.kindHint}" regardless of what the layout suggests, and read the fields accordingly.`,
    )
  }
  if (hints.note) {
    parts.push(
      `- The uploader's comment about this document (Swedish, trusted context for supplier, purpose, merchantCategory and suggestedAccount; a 4-digit number the uploader names as an account ("konto 5460", "5460 mot 2018") is the account to use, but prices, order numbers and dates are not accounts; never copy it into amounts): "${hints.note.replace(/"/g, "'")}"`,
    )
  }
  if (hints.otherText) {
    parts.push(
      `- Other text people wrote about this document (Swedish; context for purpose and merchantCategory only, never take an account or an amount from it): "${hints.otherText.replace(/"/g, "'")}"`,
    )
  }
  if (hints.companyRules && hints.companyRules.length > 0) {
    parts.push(
      '- Company rules from the accountant (Swedish). Use them when deciding merchantCategory and how to read the document; they do not change amounts:',
      ...hints.companyRules.map((r) => `  • ${r}`),
    )
  }
  if (parts.length === 0) return base
  return `${base}\n\nContext supplied by the uploader and the company:\n${parts.join('\n')}`
}

/** How much of an e-mail body travels as context. */
export const EMAIL_EXCERPT_MAX = 400
/** Cap on all other human text together. */
export const OTHER_TEXT_MAX = 900

/**
 * The sender's own words from an e-mail body: quoted history, signatures after
 * a "--" line and forwarded headers are dropped, whitespace collapsed, capped.
 */
export function emailExcerpt(body: string | null | undefined): string | null {
  if (typeof body !== 'string' || !body.trim()) return null
  const kept: string[] = []
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    if (/^(--\s*$|-{3,}\s*(original|ursprungligt)|från:|from:|skickat:|sent:)/i.test(line)) break
    if (line.startsWith('>')) continue
    if (line) kept.push(line)
  }
  const one = sanitiseUserNote(kept.join(' ').replace(/\s+/g, ' '))
  if (!one) return null
  return one.length > EMAIL_EXCERPT_MAX ? `${one.slice(0, EMAIL_EXCERPT_MAX - 1)}…` : one
}

/** The company's active account numbers. Errors give an empty list (no override then). */
export async function loadAccountChart(supabase: SupabaseClient, companyId: string): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('chart_of_accounts')
      .select('account_number')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .limit(3000)
    if (error) return []
    return ((data ?? []) as Array<{ account_number: string | number | null }>)
      .map((r) => (r.account_number == null ? '' : String(r.account_number)))
      .filter((n) => /^\d{4}$/.test(n))
  } catch {
    return []
  }
}

/** The fields of an inbox item the hints are built from. */
export interface InboxItemHintSource {
  kind_hint?: string | null
  channel_context?: InboxChannelContext | null
  email_body_text?: string | null
}

/**
 * Other human text on an item, for the model: everything renderChannelContextForModel
 * prints except the typed comment (that one is the authoritative note), plus
 * the e-mail excerpt.
 */
export function otherTextForItem(item: InboxItemHintSource): string | null {
  const lines = renderChannelContextForModel(item.channel_context ?? null).filter(
    (l) => !l.startsWith('Uppladdarens kommentar:'),
  )
  const mail = emailExcerpt(item.email_body_text)
  if (mail) lines.push(`Mejlets text: ${mail}`)
  if (lines.length === 0) return null
  const joined = lines.join(' · ')
  return joined.length > OTHER_TEXT_MAX ? `${joined.slice(0, OTHER_TEXT_MAX - 1)}…` : joined
}

/**
 * Fork 2026-09-22, the one place hints are built from what is STORED on an item.
 * Upstream built them only on the web upload from the form fields, so "Tolka om",
 * WhatsApp, e-mail, a re-sent duplicate and every later path read the document
 * blind. Used on upload (after the row exists) and on retry.
 */
export async function buildHintsForItem(
  supabase: SupabaseClient,
  companyId: string,
  item: InboxItemHintSource,
): Promise<ExtractionHints> {
  const [companyRules, accountChart] = await Promise.all([
    loadCompanyRulesForExtraction(supabase, companyId),
    loadAccountChart(supabase, companyId),
  ])
  return {
    kindHint: parseKindHint(item.kind_hint),
    note: sanitiseUserNote(item.channel_context?.user_note),
    otherText: otherTextForItem(item),
    companyRules,
    accountChart,
  }
}

/**
 * A new comment on an item that already has one (the same file uploaded again
 * with a new comment): keep both, newest last, never duplicate, capped.
 */
export function mergeUserNote(existing: string | null | undefined, incoming: string | null | undefined): string | null {
  const a = sanitiseUserNote(existing)
  const b = sanitiseUserNote(incoming)
  if (!b) return a
  if (!a) return b
  if (a === b || a.includes(b)) return a
  return `${a} · ${b}`.slice(0, USER_NOTE_MAX)
}
