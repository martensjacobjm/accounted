/**
 * Uppgiftslämnarens ledtrådar och bolagets regler in i AI-tolkningen (fork bok.dalavs.se).
 *
 * Bakgrund (Jacob 2026-09-21): inkorgens tolkning fick aldrig veta vad den som laddade upp
 * visste (kvitto eller faktura, vad köpet gällde) och läste inte bolagets minnen
 * (byråns regler om kontering, skatteplanering), så förslagen blev fel utan att kunna rättas
 * på plats. Den här modulen är ren text- och datahantering: ingen modellkontakt.
 *
 *   1. parseKindHint / sanitiseUserNote: validerar formulärfälten från webbuppladdningen.
 *   2. loadCompanyRulesForExtraction: läser fastnålade och användarlärda minnen plus
 *      profilsammanfattningen (samma tabeller som chatten) och gör dem till korta rader.
 *   3. buildHintInstruction: lägger ledtrådarna sist i användarinstruktionen, så att
 *      systemprompten förblir bytestabil (promptcache) medan varje dokument får sin kontext.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type UploadKindHint = 'receipt' | 'supplier_invoice'

export const USER_NOTE_MAX = 500
export const COMPANY_RULES_MAX_ROWS = 8
export const COMPANY_RULE_MAX_CHARS = 300
export const COMPANY_RULES_MAX_TOTAL = 1600

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

interface MemoryRow {
  content: string
  is_pinned: boolean
  source: string | null
}

/**
 * Väljer och kapar minnesrader: fastnålade först, sedan användarlärda, aldrig fler än
 * COMPANY_RULES_MAX_ROWS och aldrig mer än COMPANY_RULES_MAX_TOTAL tecken sammanlagt.
 * Ren funktion så att urvalet kan testas utan databas.
 */
export function formatCompanyRules(
  rows: MemoryRow[],
  profileSummary?: string | null,
): string[] {
  const out: string[] = []
  let total = 0
  const push = (text: string) => {
    const one = text.replace(/\s+/g, ' ').trim()
    if (!one) return
    const capped = one.length > COMPANY_RULE_MAX_CHARS ? `${one.slice(0, COMPANY_RULE_MAX_CHARS - 1)}…` : one
    if (out.length >= COMPANY_RULES_MAX_ROWS || total + capped.length > COMPANY_RULES_MAX_TOTAL) return
    out.push(capped)
    total += capped.length
  }
  if (profileSummary) push(`Verksamhet: ${profileSummary}`)
  const ordered = [...rows].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1
    const ra = a.source === 'user_taught' ? 0 : 1
    const rb = b.source === 'user_taught' ? 0 : 1
    return ra - rb
  })
  for (const r of ordered) push(r.content)
  return out
}

/**
 * Läser bolagets regler för tolkningen. Fel sväljs till en tom lista: en tolkning utan
 * regler är sämre än ingen tolkning alls, men den ska aldrig stoppa uppladdningen.
 */
export async function loadCompanyRulesForExtraction(
  supabase: SupabaseClient,
  companyId: string,
): Promise<string[]> {
  try {
    const [memRes, profRes] = await Promise.all([
      supabase
        .from('agent_memory')
        .select('content, is_pinned, source')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .or('is_pinned.eq.true,source.in.(user_taught,composer)')
        .order('is_pinned', { ascending: false })
        .order('relevance_score', { ascending: false })
        .limit(COMPANY_RULES_MAX_ROWS * 2),
      supabase
        .from('agent_profiles')
        .select('profile_summary')
        .eq('company_id', companyId)
        .maybeSingle(),
    ])
    if (memRes.error) return []
    const rows = (memRes.data ?? []) as MemoryRow[]
    const summary = (profRes.data as { profile_summary?: string | null } | null)?.profile_summary ?? null
    return formatCompanyRules(rows, summary)
  } catch {
    return []
  }
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
      `- The uploader's comment about this document (Swedish, trusted context for supplier, purpose and merchantCategory; never copy it into amounts): "${hints.note.replace(/"/g, "'")}"`,
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
