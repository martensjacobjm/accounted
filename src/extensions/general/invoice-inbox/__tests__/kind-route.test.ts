import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoiceInboxExtension } from '@/extensions/general/invoice-inbox'
import { createQueuedMockSupabase, createMockRequest, parseJsonResponse } from '@/tests/helpers'
import type { ExtensionContext } from '@/lib/extensions/types'

vi.mock('@/lib/rate-limits/inbox', () => ({
  checkInboxUploadRateLimit: vi.fn().mockResolvedValue({ ok: true }),
}))

function findRoute(method: string, path: string) {
  return invoiceInboxExtension.apiRoutes!.find((r) => r.method === method && r.path === path)!
}

const kindRoute = findRoute('PATCH', '/items/:id/kind')

function buildCtx(supabase: unknown): ExtensionContext {
  return {
    userId: 'user-1',
    companyId: 'company-1',
    extensionId: 'invoice-inbox',
    supabase: supabase as ExtensionContext['supabase'],
    emit: vi.fn(),
    settings: { get: vi.fn(), set: vi.fn() },
    storage: { from: vi.fn() } as unknown as ExtensionContext['storage'],
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as ExtensionContext['log'],
    services: {},
  } as ExtensionContext
}

function makeReq(body: unknown) {
  return createMockRequest('/items/item-1/kind', {
    method: 'PATCH',
    searchParams: { _id: 'item-1' },
    body,
  })
}

describe('PATCH /items/:id/kind (fork: override the AI kind)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 without context', async () => {
    const res = await kindRoute.handler(makeReq({ kind_hint: 'receipt' }), undefined)
    expect(res.status).toBe(401)
  })

  it('rejects an unknown kind with 400', async () => {
    const mock = createQueuedMockSupabase()
    const res = await kindRoute.handler(makeReq({ kind_hint: 'government_letter' }), buildCtx(mock.supabase))
    expect(res.status).toBe(400)
  })

  it('returns 404 when the item is not in the company', async () => {
    const mock = createQueuedMockSupabase()
    mock.enqueue({ data: null })
    const res = await kindRoute.handler(makeReq({ kind_hint: 'receipt' }), buildCtx(mock.supabase))
    expect(res.status).toBe(404)
  })

  it('refuses to relabel a booked item (409)', async () => {
    const mock = createQueuedMockSupabase()
    mock.enqueue({ data: { id: 'item-1', created_supplier_invoice_id: null, created_journal_entry_id: 'je-1' } })
    const res = await kindRoute.handler(makeReq({ kind_hint: 'receipt' }), buildCtx(mock.supabase))
    expect(res.status).toBe(409)
  })

  it('stores the chosen kind in kind_hint and scopes the update to the company', async () => {
    const mock = createQueuedMockSupabase()
    mock.enqueue({ data: { id: 'item-1', created_supplier_invoice_id: null, created_journal_entry_id: null } })
    mock.enqueue({ data: { id: 'item-1', kind_hint: 'supplier_invoice' } })
    const res = await kindRoute.handler(makeReq({ kind_hint: 'supplier_invoice' }), buildCtx(mock.supabase))
    expect(res.status).toBe(200)
    const { body } = await parseJsonResponse<{ data: { kind_hint: string } }>(res)
    expect(body.data.kind_hint).toBe('supplier_invoice')

    const update = mock.calls.find((c) => c.method === 'update')
    expect(update?.args?.[0]).toEqual({ kind_hint: 'supplier_invoice' })
    const companyFilter = mock.calls.find(
      (c) => c.method === 'eq' && c.args?.[0] === 'company_id' && c.args?.[1] === 'company-1',
    )
    expect(companyFilter).toBeDefined()
  })

  it('clears the override with null so the AI classification shows again', async () => {
    const mock = createQueuedMockSupabase()
    mock.enqueue({ data: { id: 'item-1', created_supplier_invoice_id: null, created_journal_entry_id: null } })
    mock.enqueue({ data: { id: 'item-1', kind_hint: null } })
    const res = await kindRoute.handler(makeReq({ kind_hint: null }), buildCtx(mock.supabase))
    expect(res.status).toBe(200)
    const update = mock.calls.find((c) => c.method === 'update')
    expect(update?.args?.[0]).toEqual({ kind_hint: null })
  })
})
