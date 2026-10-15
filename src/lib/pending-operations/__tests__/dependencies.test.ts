import { describe, expect, it } from 'vitest'
import { createQueuedMockSupabase } from '@/tests/helpers'
import {
  loadDependencyOperation,
  orderByDependencies,
  parseDependencies,
  resolveOperationDependencies,
  withoutDependencies,
} from '../dependencies'

// Beroenden mellan stagade förslag: ett senare förslag (fakturan) pekar på
// ett tidigare (kunden) och får dess id när det godkänns. Varje förslag
// godkänns fortfarande av en människa; ett ej godkänt beroende stoppar.

const CUSTOMER_OP = '22222222-2222-4222-8222-222222222222'
const ACCOUNT_OP = '33333333-3333-4333-8333-333333333333'
const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111'

const customerDep = {
  operation_id: CUSTOMER_OP,
  operation_type: 'create_customer',
  result_field: 'customer_id',
  param: 'customer_id',
}

function depRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CUSTOMER_OP,
    status: 'committed',
    operation_type: 'create_customer',
    title: 'Ny kund: Testkund Provning AB',
    result_data: { customer_id: CUSTOMER_ID },
    ...overrides,
  }
}

describe('parseDependencies', () => {
  it('returns an empty list when the field is absent', () => {
    expect(parseDependencies({ customer_id: 'x' })).toEqual([])
    expect(parseDependencies(null)).toEqual([])
  })

  it('accepts a value-copying and an ordering-only dependency', () => {
    const ordering = { operation_id: ACCOUNT_OP, operation_type: 'create_account' }
    expect(parseDependencies({ depends_on: [customerDep, ordering] })).toEqual([customerDep, ordering])
  })

  it('rejects malformed shapes instead of ignoring them', () => {
    expect(parseDependencies({ depends_on: 'op-1' })).toBeNull()
    expect(parseDependencies({ depends_on: [{ operation_id: 'not-a-uuid', operation_type: 'create_customer' }] })).toBeNull()
    // result_field without param (or the reverse) is neither a copy nor an ordering lock.
    expect(parseDependencies({ depends_on: [{ ...customerDep, param: undefined }] })).toBeNull()
  })
})

describe('withoutDependencies', () => {
  it('strips depends_on and leaves other params untouched', () => {
    expect(withoutDependencies({ depends_on: [customerDep], items: [1] })).toEqual({ items: [1] })
  })

  it('returns the same object when there is nothing to strip', () => {
    const params = { items: [1] }
    expect(withoutDependencies(params)).toBe(params)
  })
})

describe('resolveOperationDependencies', () => {
  it('makes no database call when the proposal has no dependencies', async () => {
    const { supabase } = createQueuedMockSupabase()
    const params = { customer_id: CUSTOMER_ID }
    const result = await resolveOperationDependencies(supabase as never, 'company-1', params)
    expect(result).toEqual({ ok: true, params, resolvedCount: 0 })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('copies the committed result into the param and drops depends_on', async () => {
    const { supabase, enqueue, findCall } = createQueuedMockSupabase()
    enqueue({ data: [depRow()] })
    const result = await resolveOperationDependencies(supabase as never, 'company-1', {
      customer_id: null,
      items: [{ description: 'Flyttstädning' }],
      depends_on: [customerDep],
    })
    expect(result).toEqual({
      ok: true,
      params: { customer_id: CUSTOMER_ID, items: [{ description: 'Flyttstädning' }] },
      resolvedCount: 1,
    })
    // Tenant-scoped read: never resolve against another company's proposals.
    expect(findCall('pending_operations', 'eq')).toEqual(['company_id', 'company-1'])
    expect(findCall('pending_operations', 'in')).toEqual(['id', [CUSTOMER_OP]])
  })

  it('stops with DEPENDENCY_PENDING (409) while the dependency awaits approval', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: [depRow({ status: 'pending', result_data: null })] })
    const result = await resolveOperationDependencies(supabase as never, 'company-1', { depends_on: [customerDep] })
    expect(result).toMatchObject({ ok: false, code: 'DEPENDENCY_PENDING', httpStatus: 409 })
    if (!result.ok) expect(result.message).toContain('Ny kund: Testkund Provning AB')
  })

  it('fails permanently (422) when the dependency was rejected', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: [depRow({ status: 'rejected', result_data: null })] })
    const result = await resolveOperationDependencies(supabase as never, 'company-1', { depends_on: [customerDep] })
    expect(result).toMatchObject({ ok: false, code: 'DEPENDENCY_FAILED', httpStatus: 422 })
  })

  it('fails when the dependency is missing from the company', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: [] })
    const result = await resolveOperationDependencies(supabase as never, 'company-1', { depends_on: [customerDep] })
    expect(result).toMatchObject({ ok: false, code: 'DEPENDENCY_FAILED' })
  })

  it('refuses a dependency of the wrong operation type', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: [depRow({ operation_type: 'create_supplier' })] })
    const result = await resolveOperationDependencies(supabase as never, 'company-1', { depends_on: [customerDep] })
    expect(result).toMatchObject({ ok: false, code: 'DEPENDENCY_INVALID' })
  })

  it('fails when the committed dependency has no value to copy', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: [depRow({ result_data: {} })] })
    const result = await resolveOperationDependencies(supabase as never, 'company-1', { depends_on: [customerDep] })
    expect(result).toMatchObject({ ok: false, code: 'DEPENDENCY_FAILED' })
  })

  it('treats an ordering-only dependency as a lock without copying anything', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: [depRow({ id: ACCOUNT_OP, operation_type: 'create_account', result_data: { account_number: '6991' } })] })
    const result = await resolveOperationDependencies(supabase as never, 'company-1', {
      lines: [],
      depends_on: [{ operation_id: ACCOUNT_OP, operation_type: 'create_account' }],
    })
    expect(result).toEqual({ ok: true, params: { lines: [] }, resolvedCount: 1 })
  })

  it('refuses a malformed depends_on without reading the database', async () => {
    const { supabase } = createQueuedMockSupabase()
    const result = await resolveOperationDependencies(supabase as never, 'company-1', { depends_on: 'x' })
    expect(result).toMatchObject({ ok: false, code: 'DEPENDENCY_INVALID' })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('reports a read error as retryable server error, not as a missing dependency', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ error: { message: 'timeout' } })
    const result = await resolveOperationDependencies(supabase as never, 'company-1', { depends_on: [customerDep] })
    expect(result).toMatchObject({ ok: false, httpStatus: 500 })
  })
})

describe('orderByDependencies', () => {
  const invoice = { id: 'inv', params: { depends_on: [{ ...customerDep, operation_id: '44444444-4444-4444-8444-444444444444' }] } }
  const customer = { id: '44444444-4444-4444-8444-444444444444', params: {} }
  const other = { id: 'other', params: {} }

  it('moves a dependency ahead of the proposal that builds on it', () => {
    expect(orderByDependencies([invoice, other, customer]).map((o) => o.id)).toEqual([
      customer.id,
      'inv',
      'other',
    ])
  })

  it('keeps the original order when nothing depends on anything', () => {
    expect(orderByDependencies([other, customer]).map((o) => o.id)).toEqual(['other', customer.id])
  })

  it('ignores dependencies outside the batch and survives a cycle', () => {
    const a = { id: '55555555-5555-4555-8555-555555555555', params: { depends_on: [{ operation_id: '66666666-6666-4666-8666-666666666666', operation_type: 'x' }] } }
    const b = { id: '66666666-6666-4666-8666-666666666666', params: { depends_on: [{ operation_id: a.id, operation_type: 'x' }] } }
    const out = orderByDependencies([a, b, invoice])
    expect(out).toHaveLength(3)
    expect(new Set(out.map((o) => o.id)).size).toBe(3)
  })
})

describe('loadDependencyOperation', () => {
  it('rejects an id that is not a UUID before reading anything', async () => {
    const { supabase } = createQueuedMockSupabase()
    await expect(
      loadDependencyOperation(supabase as never, 'company-1', 'op-1', 'create_customer', 'customer_operation_id'),
    ).rejects.toThrow(/customer_operation_id must be the operation_id/)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns a pending proposal with its params', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: { ...depRow({ status: 'pending', result_data: null }), params: { name: 'Testkund Provning AB' }, preview_data: null } })
    const op = await loadDependencyOperation(supabase as never, 'company-1', CUSTOMER_OP, 'create_customer', 'customer_operation_id')
    expect(op).toMatchObject({ id: CUSTOMER_OP, status: 'pending', params: { name: 'Testkund Provning AB' }, previewData: {} })
  })

  it('refuses the wrong operation type and a rejected proposal', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: { ...depRow({ operation_type: 'create_supplier' }), params: {} } })
    await expect(
      loadDependencyOperation(supabase as never, 'company-1', CUSTOMER_OP, 'create_customer', 'customer_operation_id'),
    ).rejects.toThrow(/expected create_customer/)
    enqueue({ data: { ...depRow({ status: 'rejected' }), params: {} } })
    await expect(
      loadDependencyOperation(supabase as never, 'company-1', CUSTOMER_OP, 'create_customer', 'customer_operation_id'),
    ).rejects.toThrow(/was rejected/)
  })

  it('refuses an id from another company (no row)', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: null })
    await expect(
      loadDependencyOperation(supabase as never, 'company-1', CUSTOMER_OP, 'create_customer', 'customer_operation_id'),
    ).rejects.toThrow(/not a staged operation in this company/)
  })
})
