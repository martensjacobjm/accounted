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
      `- The uploader's comment about this document (Swedish, trusted context for supplier, purpose, merchantCategory and suggestedAccount; a 4-digit account named here is the account to use; never copy it into amounts): "${hints.note.replace(/"/g, "'")}"`,
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
