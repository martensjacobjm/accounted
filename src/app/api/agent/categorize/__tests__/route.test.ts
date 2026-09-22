import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { createMockRequest, createMockRouteParams, parseJsonResponse } from '@/tests/helpers'

const requireAuthMock = vi.fn()
vi.mock('@/lib/auth/require-auth', () => ({ requireAuth: () => requireAuthMock() }))
vi.mock('@/lib/company/context', () => ({ getActiveCompanyId: vi.fn().mockResolvedValue('company-1') }))
const checkRate = vi.fn()
vi.mock('@/lib/rate-limits/agent', () => ({
  checkAgentRateLimit: () => checkRate(),
  agentRateLimitResponseBody: () => ({ error: 'rate' }),
}))
vi.mock('@/lib/sandbox/guard', () => ({ guardSandbox: vi.fn().mockResolvedValue(null) }))
const requireCapability = vi.fn()
vi.mock('@/lib/entitlements/has-capability', () => ({ requireCapability: () => requireCapability() }))
vi.mock('@/lib/entitlements/keys', () => ({ CAPABILITY: { ai: 'ai' } }))
const aiStatus = vi.fn()
vi.mock('@/lib/ai', () => ({ getAiStatus: () => aiStatus() }))
const gatherCandidates = vi.fn()
vi.mock('@/lib/agent/categorize/candidates', () => ({ gatherCandidates: (...a: unknown[]) => gatherCandidates(...a) }))
const gatherUnderlag = vi.fn()
vi.mock('@/lib/agent/categorize/underlag', () => ({ gatherUnderlag: (...a: unknown[]) => gatherUnderlag(...a) }))
const selectAccount = vi.fn()
vi.mock('@/lib/agent/categorize/select-account', () => ({ selectAccount: (...a: unknown[]) => selectAccount(...a) }))

import { POST } from '../route'

// supabase router: membership + transactions + companies + company_settings.
function makeSupabase(opts: { tx?: unknown; member?: boolean } = {}) {
  return {
    auth: { getUser: vi.fn() },
    from(table: string) {
      const rows: Record<string, unknown> = {
        company_members: opts.member === false ? null : { user_id: 'user-1' },
        transactions: opts.tx === undefined ? { id: 'tx-1' } : opts.tx,
        companies: { entity_type: 'aktiebolag' },
        company_settings: { vat_registered: true },
      }
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: rows[table] ?? null }),
      }
      return chain
    },
  }
}
const supabase = makeSupabase()

const VALID_TX = '11111111-1111-4111-8111-111111111111'
const body = (o: Record<string, unknown> = {}) => ({ transaction_id: VALID_TX, ...o })

beforeEach(() => {
  vi.clearAllMocks()
  requireAuthMock.mockResolvedValue({ user: { id: 'user-1' }, supabase, error: null })
  checkRate.mockResolvedValue({ ok: true })
  requireCapability.mockResolvedValue(null)
  aiStatus.mockReturnValue({ configured: true })
  gatherCandidates.mockResolvedValue([{ account: '5410', label: 'Material', vatTreatment: 'standard_25', source: 'counterparty_template', confidence: 0.9 }])
  gatherUnderlag.mockResolvedValue('Kvitto: Biltema, totalt 499 SEK.')
  selectAccount.mockResolvedValue({
    account: '5410', category: null, vatTreatment: 'standard_25', reverseCharge: false,
    confidence: 0.86, modelConfidence: 'high', agreement: 1, reasoning: 'r',
    choice: { kind: 'candidate', account: '5410' }, model: 'qwen3.8', fromCandidate: true,
  })
})

describe('POST /api/agent/categorize', () => {
  it('401 when unauthenticated', async () => {
    requireAuthMock.mockResolvedValue({ user: null, supabase, error: NextResponse.json({ error: 'x' }, { status: 401 }) })
    expect((await POST(createMockRequest('/x', { method: 'POST', body: body() }), createMockRouteParams({}))).status).toBe(401)
    expect(selectAccount).not.toHaveBeenCalled()
  })
  it('resolves the session through requireAuth (withRouteContext), never a hand-rolled getUser()', async () => {
    await POST(createMockRequest('/x', { method: 'POST', body: body() }), createMockRouteParams({}))
    expect(requireAuthMock).toHaveBeenCalledTimes(1)
    expect(supabase.auth.getUser).not.toHaveBeenCalled()
  })
  it('403 when the body names a company the caller is not a member of', async () => {
    const other = '22222222-2222-4222-8222-222222222222'
    requireAuthMock.mockResolvedValue({ user: { id: 'user-1' }, supabase: makeSupabase({ member: false }), error: null })
    const res = await POST(createMockRequest('/x', { method: 'POST', body: body({ company_id: other }) }), createMockRouteParams({}))
    expect(res.status).toBe(403)
    expect(selectAccount).not.toHaveBeenCalled()
  })
  it('uses the active company without a membership round trip when no override is given', async () => {
    const res = await POST(createMockRequest('/x', { method: 'POST', body: body() }), createMockRouteParams({}))
    expect(res.status).toBe(200)
    expect(gatherCandidates).toHaveBeenCalledWith(expect.anything(), 'company-1', expect.anything())
  })
  it('429 when rate limited', async () => {
    checkRate.mockResolvedValue({ ok: false })
    expect((await POST(createMockRequest('/x', { method: 'POST', body: body() }), createMockRouteParams({}))).status).toBe(429)
  })
  it('400 on a missing/invalid transaction_id', async () => {
    expect((await POST(createMockRequest('/x', { method: 'POST', body: {} }), createMockRouteParams({}))).status).toBe(400)
    expect((await POST(createMockRequest('/x', { method: 'POST', body: { transaction_id: 'nope' } }), createMockRouteParams({}))).status).toBe(400)
  })
  it('403 without the ai capability', async () => {
    requireCapability.mockResolvedValue(NextResponse.json({ error: 'pay' }, { status: 403 }))
    expect((await POST(createMockRequest('/x', { method: 'POST', body: body() }), createMockRouteParams({}))).status).toBe(403)
  })
  it('503 when no backend is configured', async () => {
    aiStatus.mockReturnValue({ configured: false })
    const res = await POST(createMockRequest('/x', { method: 'POST', body: body() }), createMockRouteParams({}))
    const { status, body: b } = await parseJsonResponse<{ code: string }>(res)
    expect(status).toBe(503)
    expect(b.code).toBe('ai_unconfigured')
    expect(selectAccount).not.toHaveBeenCalled()
  })
  it('404 when the transaction is not found / not this company', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'user-1' }, supabase: makeSupabase({ tx: null }), error: null })
    const res = await POST(createMockRequest('/x', { method: 'POST', body: body() }), createMockRouteParams({}))
    expect(res.status).toBe(404)
    expect(selectAccount).not.toHaveBeenCalled()
  })
  it('returns the selection + candidate slate on the happy path', async () => {
    const res = await POST(createMockRequest('/x', { method: 'POST', body: body({ samples: 3, underlag: 'Biltema AB 499 kr' }) }), createMockRouteParams({}))
    const { status, body: b } = await parseJsonResponse<{
      data: { account: string; confidence: number; candidates: { account: string }[] }
    }>(res)
    expect(status).toBe(200)
    expect(b.data.account).toBe('5410')
    expect(b.data.confidence).toBe(0.86)
    expect(b.data.candidates[0].account).toBe('5410')
    // A caller-supplied underlag is used verbatim (no server gather).
    expect(gatherUnderlag).not.toHaveBeenCalled()
    expect(selectAccount).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'aktiebolag', vatRegistered: true, underlag: 'Biltema AB 499 kr', samples: 3 }),
    )
  })

  it('reads with a dialog-attached document ahead of the row, keyed on it and never stored', async () => {
    const doc = '33333333-3333-4333-8333-333333333333'
    const upsert = vi.fn(async () => ({ error: null }))
    const sb = makeSupabase({ tx: { id: VALID_TX, document_id: null } })
    const from = sb.from.bind(sb)
    sb.from = (table: string) => (table === 'transaction_assistant_reads' ? ({ upsert } as never) : from(table))
    requireAuthMock.mockResolvedValue({ user: { id: 'user-1' }, supabase: sb, error: null })
    const res = await POST(createMockRequest('/x', { method: 'POST', body: body({ document_id: doc }) }), createMockRouteParams({}))
    const { status, body: b } = await parseJsonResponse<{ data: { underlag_key: string | null; has_underlag: boolean } }>(res)
    expect(status).toBe(200)
    expect(gatherUnderlag).toHaveBeenCalledWith(expect.anything(), 'company-1', VALID_TX, doc)
    expect(b.data.underlag_key).toBe(doc)
    expect(b.data.has_underlag).toBe(true)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('400 on a malformed document_id', async () => {
    const res = await POST(createMockRequest('/x', { method: 'POST', body: body({ document_id: 'not-a-uuid' }) }), createMockRouteParams({}))
    expect(res.status).toBe(400)
    expect(selectAccount).not.toHaveBeenCalled()
  })

  it('gathers underlag server-side when the caller did not supply it', async () => {
    await POST(createMockRequest('/x', { method: 'POST', body: body() }), createMockRouteParams({}))
    expect(gatherUnderlag).toHaveBeenCalled()
    expect(selectAccount).toHaveBeenCalledWith(
      expect.objectContaining({ underlag: 'Kvitto: Biltema, totalt 499 SEK.' }),
    )
  })
})

describe('POST /api/agent/categorize: the user can tell the assistant what the row is (fork)', () => {
  function recordingSupabase(tx: Record<string, unknown>) {
    const updates: { table: string; values: unknown; filters: unknown[][] }[] = []
    return {
      updates,
      client: {
        auth: { getUser: vi.fn() },
        from(table: string) {
          const rows: Record<string, unknown> = {
            transactions: tx,
            companies: { entity_type: 'enskild_firma' },
            company_settings: { vat_registered: true },
          }
          let pending: { table: string; values: unknown; filters: unknown[][] } | null = null
          const chain: Record<string, unknown> = {
            select: () => chain,
            eq: (...a: unknown[]) => { pending?.filters.push(['eq', ...a]); return chain },
            is: (...a: unknown[]) => { pending?.filters.push(['is', ...a]); return chain },
            update: (values: unknown) => { pending = { table, values, filters: [] }; updates.push(pending); return chain },
            maybeSingle: async () => ({ data: rows[table] ?? null }),
            then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
          }
          return chain
        },
      },
    }
  }

  it('saves the typed note on the unbooked row and reads again with it', async () => {
    const rec = recordingSupabase({ id: VALID_TX, description: 'JULA AB', notes: null, journal_entry_id: null, document_id: null })
    requireAuthMock.mockResolvedValue({ user: { id: 'user-1' }, supabase: rec.client, error: null })
    const res = await POST(
      createMockRequest('/x', { method: 'POST', body: body({ user_note: '  Moppar till flyttstädningen  ' }) }),
      createMockRouteParams({}),
    )
    expect(res.status).toBe(200)
    const upd = rec.updates.find((u) => u.table === 'transactions')
    expect(upd?.values).toEqual({ notes: 'Moppar till flyttstädningen' })
    expect(upd?.filters).toContainEqual(['is', 'journal_entry_id', null])
    const sel = selectAccount.mock.calls[0][0]
    expect(sel.transaction.userNote).toBe('Moppar till flyttstädningen')
    expect(sel.transaction.notes).toBe('Moppar till flyttstädningen')
    const { body: out } = await parseJsonResponse<{ data: { underlag_key: string | null } }>(res)
    expect(out.data.underlag_key).toMatch(/\|n:/)
  })

  it('does not touch a booked row but still reads with the note', async () => {
    const rec = recordingSupabase({ id: VALID_TX, description: 'JULA AB', notes: null, journal_entry_id: 'je-1', document_id: null })
    requireAuthMock.mockResolvedValue({ user: { id: 'user-1' }, supabase: rec.client, error: null })
    await POST(createMockRequest('/x', { method: 'POST', body: body({ user_note: 'Moppar' }) }), createMockRouteParams({}))
    expect(rec.updates.find((u) => u.table === 'transactions')).toBeUndefined()
    expect(selectAccount.mock.calls[0][0].transaction.userNote).toBe('Moppar')
  })
})
