import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withRouteContext } from '@/lib/api/with-route-context'
import { checkAgentRateLimit, agentRateLimitResponseBody } from '@/lib/rate-limits/agent'
import { guardSandbox } from '@/lib/sandbox/guard'
import { requireCapability } from '@/lib/entitlements/has-capability'
import { CAPABILITY } from '@/lib/entitlements/keys'
import { getAiStatus } from '@/lib/ai'
import { loadReads, readIsFresh, readTransaction, storeRead } from '@/lib/agent/categorize/read'
import { getErrorMessage as getUserErrorMessage } from '@/lib/errors/get-error-message'
import { parseEntityType } from '@/lib/company/entity-type'
import type { Transaction } from '@/types'

/**
 * POST /api/agent/categorize: a provider-agnostic booking proposal for one
 * transaction — the auto-booking cascade end to end (Tier 1 retrieval → Tier 2
 * selector), minus the write.
 *
 * It gathers the deterministic candidate accounts (counterparty templates,
 * rules, history) with NO model call, then has the model SELECT among them
 * (self-consistency sampled). The answer is one AssistantRead, the same row
 * transaction_assistant_reads stores and the transactions list hands to the
 * review, so there is one shape end to end. A fresh stored read answers at
 * once. It never posts anything.
 *
 * Runs on any configured backend (Bedrock or a local model), so it is gated on
 * `configured`, not `assistantAvailable` — same as /api/agent/ask.
 */

const Schema = z.object({
  transaction_id: z.string().uuid(),
  company_id: z.string().uuid().optional(),
  /** Extracted receipt/invoice text, if the caller already has it. */
  underlag: z.string().max(24_000).optional(),
  /** Self-consistency samples (default 3). */
  samples: z.number().int().min(1).max(5).optional(),
  /**
   * Fork (bok.dalavs.se, 2026-09-22): what the user typed in the review dialog
   * ("vad är det här?"). It forces a fresh read with the note weighed first, and
   * is kept as the row's note (unbooked rows only) so the next read, the chat
   * and the verifikat see it too.
   */
  user_note: z.string().trim().max(1000).optional(),
})

// withRouteContext enforces auth (MFA on hosted) and resolves the active
// company; the body may still name another company the caller belongs to.
export const POST = withRouteContext(
  'agent.categorize',
  async (request, { user, supabase, companyId: activeCompanyId }) => {
    const rate = await checkAgentRateLimit(supabase, user.id)
    if (!rate.ok) return NextResponse.json(agentRateLimitResponseBody(rate), { status: 429 })

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = Schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Ogiltig förfrågan.', type: 'validation_error' }, { status: 400 })
    }

    const companyId = parsed.data.company_id ?? activeCompanyId

    // The wrapper already guarantees membership of the active company; an
    // explicit company_id override must be verified the same way.
    if (companyId !== activeCompanyId) {
      const { data: membership } = await supabase
        .from('company_members')
        .select('user_id')
        .eq('company_id', companyId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const blocked = await guardSandbox(supabase, companyId)
    if (blocked) return blocked

    const capBlocked = await requireCapability(supabase, companyId, CAPABILITY.ai)
    if (capBlocked) return capBlocked

    if (!getAiStatus().configured) {
      return NextResponse.json(
        { error: 'Assistenten är inte konfigurerad på den här installationen.', code: 'ai_unconfigured' },
        { status: 503 },
      )
    }

    const { data: tx } = await supabase
      .from('transactions')
      .select('id, merchant_name, description, original_description, notes, reference, counterparty_account, counterparty_iban, amount, date, currency, category, is_business, document_id, journal_entry_id')
      .eq('id', parsed.data.transaction_id)
      .eq('company_id', companyId)
      .maybeSingle()
    if (!tx) return NextResponse.json({ error: 'Transaktionen hittades inte.' }, { status: 404 })

    const [{ data: company }, { data: settings }] = await Promise.all([
      supabase.from('companies').select('entity_type').eq('id', companyId).maybeSingle(),
      supabase.from('company_settings').select('vat_registered').eq('company_id', companyId).maybeSingle(),
    ])

    try {
      let transaction = tx as Transaction
      const userNote = parsed.data.user_note?.trim() || null
      if (userNote && !transaction.journal_entry_id) {
        // Keep it on the row: not räkenskapsinformation until booked (the
        // booking copies it into the verifikat), and the read key includes it.
        const { error: noteErr } = await supabase
          .from('transactions')
          .update({ notes: userNote })
          .eq('id', transaction.id)
          .eq('company_id', companyId)
          .is('journal_entry_id', null)
        if (!noteErr) transaction = { ...transaction, notes: userNote }
      }
      const entityType = parseEntityType(company?.entity_type)
      const vatRegistered = settings?.vat_registered ?? false

      // The read made before anyone opened the row (the ten-minute cron, or
      // an earlier open) answers at once while it is fresh; a caller who
      // brings its own underlag or sample count wants a new one.
      if (parsed.data.underlag == null && parsed.data.samples == null && !userNote) {
        const stored = await loadReads(supabase, companyId, [transaction.id]).catch(() => new Map())
        const read = stored.get(transaction.id)
        if (read && readIsFresh(read, transaction)) return NextResponse.json({ data: read })
      }

      const { read } = await readTransaction(supabase, companyId, transaction, {
        entityType,
        vatRegistered,
        underlag: parsed.data.underlag,
        samples: parsed.data.samples,
        userNote,
      })
      // Keep it for the list and the next open. Best effort: a failed
      // store never costs the caller the answer.
      await storeRead(supabase, companyId, read).catch(() => undefined)
      return NextResponse.json({ data: read })
    } catch (err) {
      return NextResponse.json({ error: getUserErrorMessage(err) }, { status: 500 })
    }
  },
)
