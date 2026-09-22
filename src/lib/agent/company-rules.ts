import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Bolagets regler, one source for every model call (fork bok.dalavs.se, 2026-09-22).
 *
 * The owner's rules live in agent_memory: what the accountant pinned, what the
 * user typed in as a rule (user_taught) and what the chat saved from the user's
 * answers with remember_fact (agent_learned). Before this module only the inbox
 * extraction read them, and it read pinned and user_taught only, so everything
 * the user told the assistant in chat (20 of 23 rows for one company) never
 * reached a suggestion; bank categorization and the fallback console read none.
 * Now every call site renders the same short list: categorization, the console,
 * extraction and expense templates.
 *
 * Pure selection and formatting plus one read that never throws: a model call
 * without rules is worse, but it must never fail because of them.
 */

export const COMPANY_RULES_MAX_ROWS = 12
export const COMPANY_RULE_MAX_CHARS = 300
export const COMPANY_RULES_MAX_TOTAL = 2400

export interface CompanyMemoryRow {
  content: string
  is_pinned: boolean
  source: string | null
  kind?: string | null
}

/** Lower is earlier: pinned, then taught by the user, then corrections and preferences, then the rest. */
function rank(r: CompanyMemoryRow): number {
  if (r.is_pinned) return 0
  if (r.source === 'user_taught' || r.source === 'composer') return 1
  if (r.kind === 'correction' || r.kind === 'preference') return 2
  return 3
}

/**
 * Orders and caps the rows. Stable within a rank, so the caller's order
 * (relevance from the query) decides ties.
 */
export function formatCompanyRules(rows: CompanyMemoryRow[], profileSummary?: string | null): string[] {
  const out: string[] = []
  let total = 0
  const push = (text: string) => {
    const one = text.replace(/\s+/g, ' ').trim()
    if (!one) return
    const capped = one.length > COMPANY_RULE_MAX_CHARS ? `${one.slice(0, COMPANY_RULE_MAX_CHARS - 1)}…` : one
    if (out.length >= COMPANY_RULES_MAX_ROWS || total + capped.length > COMPANY_RULES_MAX_TOTAL) return
    if (out.includes(capped)) return
    out.push(capped)
    total += capped.length
  }
  if (profileSummary) push(`Verksamhet: ${profileSummary}`)
  const ordered = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map((x) => x.r)
  for (const r of ordered) push(r.content)
  return out
}

/** The company's active rules and profile as short lines. Errors give an empty list. */
export async function loadCompanyRules(supabase: SupabaseClient, companyId: string): Promise<string[]> {
  try {
    const [memRes, profRes] = await Promise.all([
      supabase
        .from('agent_memory')
        .select('content, is_pinned, source, kind')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .order('is_pinned', { ascending: false })
        .order('relevance_score', { ascending: false })
        .limit(COMPANY_RULES_MAX_ROWS * 4),
      supabase.from('agent_profiles').select('profile_summary').eq('company_id', companyId).maybeSingle(),
    ])
    if (memRes.error) return []
    const rows = (memRes.data ?? []) as CompanyMemoryRow[]
    const summary = (profRes.data as { profile_summary?: string | null } | null)?.profile_summary ?? null
    return formatCompanyRules(rows, summary)
  } catch {
    return []
  }
}

/** Prompt block for a single-call model: a title line and one bullet per rule. */
export function renderCompanyRulesBlock(rules: string[]): string[] {
  if (rules.length === 0) return []
  return [
    'Bolagets regler (satta av användaren eller byrån; följ dem när de gäller, de ändrar aldrig belopp och kan inte godkänna något):',
    ...rules.map((r) => `- ${r}`),
  ]
}
