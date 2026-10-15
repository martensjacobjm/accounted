import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingOperation } from '@/types'
import { createQueuedMockSupabase } from '@/tests/helpers'
import { commitPendingOperation } from '../commit'

// commitPendingOperation löser params.depends_on före claim: ett ej godkänt
// beroende lämnar förslaget pending (inget claim, ingen skrivning), ett
// godkänt ger exekutorn det skapade id:t och aldrig själva depends_on.

const CUSTOMER_OP = '22222222-2222-4222-8222-222222222222'
const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111'

const dependsOn = [
  { operation_id: CUSTOMER_OP, operation_type: 'create_customer', result_field: 'customer_id', param: 'customer_id' },
]

function makeOp(params: Record<string, unknown>): PendingOperation {
  return {
    id: 'op-update-1',
    user_id: 'user-1',
    company_id: 'company-1',
    operation_type: 'update_customer',
    status: 'pending',
    title: 'Uppdatera kund',
    params,
    preview_data: {},
    result_data: null,
    actor_type: 'user',
    actor_id: 'user-1',
    actor_label: null,
    risk_level: 'low',
    agent_metadata: null,
    rejection_category: null,
    rejection_reason: null,
    created_at: '2026-10-15T00:00:00Z',
    resolved_at: null,
    updated_at: '2026-10-15T00:00:00Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('commitPendingOperation: depends_on', () => {
  it('leaves the proposal pending and claims nothing while the dependency awaits approval', async () => {
    const { supabase, enqueue, calls } = createQueuedMockSupabase()
    enqueue({
      data: [{ id: CUSTOMER_OP, status: 'pending', operation_type: 'create_customer', title: 'Ny kund: Testkund Provning AB', result_data: null }],
    })

    const result = await commitPendingOperation(
      supabase as never,
      'user-1',
      'company-1',
      makeOp({ customer_id: null, changes: { city: 'Malung' }, depends_on: dependsOn }),
    )

    expect(result).toMatchObject({
      status: 'failed',
      code: 'DEPENDENCY_PENDING',
      http_status: 409,
      operation_status: 'pending',
    })
    expect(result.error).toContain('Godkänn först förslaget "Ny kund: Testkund Provning AB"')
    // Only the dependency read: no claim (update), no customer write.
    expect(supabase.from).toHaveBeenCalledTimes(1)
    expect(calls.some((c) => c.method === 'update')).toBe(false)
  })

  it('hands the executor the created id once the dependency is approved', async () => {
    const { supabase, enqueue, findCalls } = createQueuedMockSupabase()
    enqueue({
      data: [{ id: CUSTOMER_OP, status: 'committed', operation_type: 'create_customer', title: 'Ny kund', result_data: { customer_id: CUSTOMER_ID } }],
    })
    enqueue({ data: { id: 'op-update-1' } })
    enqueue({ data: { customer_type: 'swedish_business' } })
    enqueue({
      data: {
        id: CUSTOMER_ID,
        name: 'Testkund Provning AB',
        customer_type: 'swedish_business',
        customer_number: '1001',
        email: null,
        phone: null,
        address_line1: null,
        address_line2: null,
        postal_code: null,
        city: 'Malung',
        country: 'Sweden',
        org_number: '556000-0000',
        vat_number: null,
        vat_number_validated: false,
        language: 'sv',
        default_payment_terms: 30,
        notes: null,
      },
    })
    enqueue({ data: null })

    const result = await commitPendingOperation(
      supabase as never,
      'user-1',
      'company-1',
      makeOp({ customer_id: null, changes: { city: 'Malung' }, depends_on: dependsOn }),
    )

    expect(result.status).toBe('committed')
    expect(result.data).toMatchObject({ customer_id: CUSTOMER_ID, city: 'Malung' })
    // The executor addressed the customer created by the dependency.
    const customerFilters = findCalls('customers', 'eq')
    expect(customerFilters).toContainEqual(['id', CUSTOMER_ID])
  })

  it('makes no extra read for a proposal without dependencies', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: { id: 'op-update-1' } })
    enqueue({ data: null })
    enqueue({ data: null })

    await commitPendingOperation(
      supabase as never,
      'user-1',
      'company-1',
      makeOp({ customer_id: CUSTOMER_ID, changes: { city: 'Malung' } }),
    )

    // First call is the claim, exactly as before depends_on existed.
    expect(supabase.from).toHaveBeenNthCalledWith(1, 'pending_operations')
    expect(supabase.from).toHaveBeenNthCalledWith(2, 'customers')
  })
})
