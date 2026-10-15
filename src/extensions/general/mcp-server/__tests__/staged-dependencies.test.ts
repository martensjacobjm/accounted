/**
 * Flerstegsärenden: ett skrivverktyg kan bygga på ett förslag som stagades
 * tidigare i samma ärende (*_operation_id) i stället för ett riktigt id.
 * Regression bok.dalavs.se 2026-10-15: "skapa kunden och lägg upp en faktura"
 * gav bara kundkortet och "godkänn den först, sedan skapar jag fakturan".
 * Nu stagas fakturan direkt med params.depends_on och får sitt customer_id när
 * den godkänns (lib/pending-operations/dependencies.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createQueuedMockSupabase } from '@/tests/helpers'

vi.mock('@/lib/email/service', () => ({
  getEmailService: vi.fn().mockReturnValue({ isConfigured: () => true, sendInvoice: vi.fn() }),
}))

vi.mock('@/lib/bookkeeping/engine', async () => {
  const actual = await vi.importActual<typeof import('@/lib/bookkeeping/engine')>('@/lib/bookkeeping/engine')
  return { ...actual, findFiscalPeriod: vi.fn() }
})

import { tools } from '../server'
import { getBASReference } from '@/lib/bookkeeping/bas-reference'

const tool = (name: string) => tools.find((t) => t.name === name)!
const createInvoice = tool('gnubok_create_invoice')
const sendInvoice = tool('gnubok_send_invoice')
const createVoucher = tool('gnubok_create_voucher')
const fromInbox = tool('gnubok_create_supplier_invoice_from_inbox')

const CUSTOMER_OP = '22222222-2222-4222-8222-222222222222'
const INVOICE_OP = '33333333-3333-4333-8333-333333333333'
const SUPPLIER_OP = '44444444-4444-4444-8444-444444444444'
const ACCOUNT_OP = '55555555-5555-4555-8555-555555555555'
const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111'

const flyttstad = [{ description: 'Flyttstädning', quantity: 1, unit: 'st', unit_price: 1000 }]

function customerOp(overrides: Record<string, unknown> = {}) {
  return {
    id: CUSTOMER_OP,
    status: 'pending',
    operation_type: 'create_customer',
    title: 'Ny kund: Testkund Provning AB',
    params: {
      name: 'Testkund Provning AB',
      customer_type: 'swedish_business',
      org_number: '556000-0000',
      email: 'faktura@testkund.example',
      payment_terms: 30,
    },
    preview_data: {},
    result_data: null,
    ...overrides,
  }
}

type Staged = {
  staged: boolean
  operation_id?: string
  preview: Record<string, unknown>
}

function insertedRow(findCalls: (t: string, m: string) => unknown[][]): Record<string, unknown> {
  const inserts = findCalls('pending_operations', 'insert')
  expect(inserts).toHaveLength(1)
  return inserts[0][0] as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('gnubok_create_invoice with customer_operation_id', () => {
  it('stages the invoice at once against a customer that awaits approval', async () => {
    const { supabase, enqueue, findCalls } = createQueuedMockSupabase()
    enqueue({ data: customerOp() }) // the staged create_customer
    enqueue({ data: null }) // resolvePeriodStatusForDate layer 1
    enqueue({ data: null }) // resolvePeriodStatusForDate layer 2
    enqueue({ data: { id: 'op-invoice' } }) // pending_operations insert

    const result = (await createInvoice.execute(
      { customer_operation_id: CUSTOMER_OP, invoice_date: '2026-10-15', items: flyttstad },
      'company-1',
      'user-1',
      supabase as never,
    )) as Staged

    expect(result.staged).toBe(true)
    // Swedish business: 25 % on 1 000 kr exkl moms, from the staged customer's type.
    expect(result.preview.total).toBe(1250)
    expect(result.preview.depends_on).toEqual([{ operation_id: CUSTOMER_OP, title: 'Ny kund: Testkund Provning AB' }])
    const row = insertedRow(findCalls)
    const params = row.params as Record<string, unknown>
    expect(params.customer_id).toBeNull()
    expect(params.depends_on).toEqual([
      { operation_id: CUSTOMER_OP, operation_type: 'create_customer', result_field: 'customer_id', param: 'customer_id' },
    ])
    expect(String(row.title)).toContain('Testkund Provning AB')
    // No customers lookup: the customer row does not exist yet.
    expect(findCalls('customers', 'select')).toHaveLength(0)
  })

  it('uses the created customer directly once the customer proposal is approved', async () => {
    const { supabase, enqueue, findCalls } = createQueuedMockSupabase()
    enqueue({ data: customerOp({ status: 'committed', result_data: { customer_id: CUSTOMER_ID } }) })
    enqueue({ data: { id: CUSTOMER_ID, name: 'Testkund Provning AB', customer_type: 'swedish_business', vat_number_validated: false, default_payment_terms: 30 } })
    enqueue({ data: null })
    enqueue({ data: null })
    enqueue({ data: { id: 'op-invoice' } })

    const result = (await createInvoice.execute(
      { customer_operation_id: CUSTOMER_OP, invoice_date: '2026-10-15', items: flyttstad },
      'company-1',
      'user-1',
      supabase as never,
    )) as Staged

    expect(result.staged).toBe(true)
    expect(result.preview.depends_on).toBeUndefined()
    const params = insertedRow(findCalls).params as Record<string, unknown>
    expect(params.customer_id).toBe(CUSTOMER_ID)
    expect(params.depends_on).toBeUndefined()
  })

  it('flags that VAT is recomputed at approval for an EU customer still awaiting VIES', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: customerOp({ params: { name: 'Muster GmbH', customer_type: 'eu_business', vat_number: 'DE123456789', country: 'Germany' } }) })
    enqueue({ data: null })
    enqueue({ data: null })
    enqueue({ data: { id: 'op-invoice' } })

    const result = (await createInvoice.execute(
      { customer_operation_id: CUSTOMER_OP, invoice_date: '2026-10-15', items: flyttstad },
      'company-1',
      'user-1',
      supabase as never,
    )) as Staged

    expect(result.staged).toBe(true)
    expect(String(result.preview.vat_note)).toMatch(/VIES/)
  })

  it('refuses both customer_id and customer_operation_id, and an id that is not a UUID', async () => {
    const { supabase } = createQueuedMockSupabase()
    await expect(
      createInvoice.execute({ customer_id: CUSTOMER_ID, customer_operation_id: CUSTOMER_OP, items: flyttstad }, 'company-1', 'user-1', supabase as never),
    ).rejects.toThrow(/either customer_id or customer_operation_id/)
    await expect(
      createInvoice.execute({ customer_operation_id: 'op-eval-1', items: flyttstad }, 'company-1', 'user-1', supabase as never),
    ).rejects.toThrow(/customer_operation_id must be the operation_id/)
  })

  it('still requires a customer of some kind', async () => {
    const { supabase } = createQueuedMockSupabase()
    await expect(
      createInvoice.execute({ items: flyttstad }, 'company-1', 'user-1', supabase as never),
    ).rejects.toThrow(/customer_id or customer_operation_id is required/)
  })
})

describe('gnubok_send_invoice with invoice_operation_id', () => {
  it('stages the send for an invoice that awaits approval, mailing the new customer', async () => {
    const { supabase, enqueue, findCalls } = createQueuedMockSupabase()
    enqueue({
      data: {
        id: INVOICE_OP,
        status: 'pending',
        operation_type: 'create_invoice',
        title: 'Ny faktura: Testkund Provning AB 1250 SEK',
        params: {
          customer_id: null,
          depends_on: [{ operation_id: CUSTOMER_OP, operation_type: 'create_customer', result_field: 'customer_id', param: 'customer_id' }],
        },
        preview_data: { customer_name: 'Testkund Provning AB', total: 1250, currency: 'SEK' },
        result_data: null,
      },
    })
    enqueue({ data: customerOp() }) // the customer the invoice builds on: its email
    enqueue({ data: { id: 'op-send' } })

    const result = (await sendInvoice.execute({ invoice_operation_id: INVOICE_OP }, 'company-1', 'user-1', supabase as never)) as Staged

    expect(result.staged).toBe(true)
    expect(result.preview.customer_email).toBe('faktura@testkund.example')
    const row = insertedRow(findCalls)
    expect(row.operation_type).toBe('send_invoice')
    expect(row.params).toEqual({
      invoice_id: null,
      depends_on: [{ operation_id: INVOICE_OP, operation_type: 'create_invoice', result_field: 'invoice_id', param: 'invoice_id' }],
    })
  })

  it('refuses when the customer has no email, before staging anything', async () => {
    const { supabase, enqueue, findCalls } = createQueuedMockSupabase()
    enqueue({
      data: {
        id: INVOICE_OP,
        status: 'pending',
        operation_type: 'create_invoice',
        title: 'Ny faktura',
        params: { customer_id: CUSTOMER_ID },
        preview_data: {},
        result_data: null,
      },
    })
    enqueue({ data: { email: null } })

    await expect(
      sendInvoice.execute({ invoice_operation_id: INVOICE_OP }, 'company-1', 'user-1', supabase as never),
    ).rejects.toThrow(/no email/)
    expect(findCalls('pending_operations', 'insert')).toHaveLength(0)
  })

  it('refuses a reference to a proposal of another kind', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueue({ data: customerOp() })
    await expect(
      sendInvoice.execute({ invoice_operation_id: CUSTOMER_OP }, 'company-1', 'user-1', supabase as never),
    ).rejects.toThrow(/expected create_invoice/)
  })
})

describe('gnubok_create_voucher with account_operation_ids', () => {
  // An account the BAS reference does not know: without the staged
  // create_account the voucher is refused at staging.
  const customAccount = ['6993', '6994', '6997', '3996', '7999', '8399'].find((n) => !getBASReference(n))!

  const lines = [
    { account_number: customAccount, debit_amount: 500, credit_amount: 0 },
    { account_number: '1930', debit_amount: 0, credit_amount: 500 },
  ]

  function enqueueVoucherReads(enqueue: (r: { data?: unknown; error?: unknown }) => void) {
    enqueue({ data: { id: 'fp-1', is_closed: false, period_start: '2026-01-01', period_end: '2026-12-31', name: '2026' } })
    enqueue({ data: [{ account_number: '1930', account_name: 'Företagskonto', is_active: true }] })
  }

  it('counts a staged account as known and stages the voucher behind it', async () => {
    expect(customAccount).toBeDefined()
    const { supabase, enqueue, findCalls } = createQueuedMockSupabase()
    enqueueVoucherReads(enqueue)
    enqueue({
      data: {
        id: ACCOUNT_OP,
        status: 'pending',
        operation_type: 'create_account',
        title: `Nytt konto: ${customAccount}`,
        params: { account_number: customAccount, account_name: 'Egen kostnad' },
        preview_data: {},
        result_data: null,
      },
    })
    enqueue({ data: null })
    enqueue({ data: null })
    enqueue({ data: { id: 'op-voucher' } })

    const result = (await createVoucher.execute(
      { entry_date: '2026-10-15', description: 'Egen kostnad', fiscal_period_id: 'fp-1', lines, account_operation_ids: [ACCOUNT_OP] },
      'company-1',
      'user-1',
      supabase as never,
    )) as Staged

    expect(result.staged).toBe(true)
    const params = insertedRow(findCalls).params as Record<string, unknown>
    // Ordering lock only: nothing is copied into the voucher.
    expect(params.depends_on).toEqual([{ operation_id: ACCOUNT_OP, operation_type: 'create_account' }])
  })

  it('still refuses the unknown account without the staged create_account', async () => {
    const { supabase, enqueue } = createQueuedMockSupabase()
    enqueueVoucherReads(enqueue)
    await expect(
      createVoucher.execute(
        { entry_date: '2026-10-15', description: 'Egen kostnad', fiscal_period_id: 'fp-1', lines },
        'company-1',
        'user-1',
        supabase as never,
      ),
    ).rejects.toThrow(new RegExp(customAccount))
  })
})

describe('gnubok_create_supplier_invoice_from_inbox with supplier_operation_id', () => {
  const extracted = {
    supplier: { name: 'Ny Leverantör AB', organizationNumber: '5569999999' },
    invoice: { invoiceNumber: 'F-77', invoiceDate: '2026-10-01', dueDate: '2026-10-31', currency: 'SEK' },
    totals: { subtotal: 1000, vat: 250, total: 1250 },
    lineItems: [{ description: 'Städmaterial', quantity: 1, unit_price: 1000, line_total: 1000, vat_rate: 25, vat_amount: 250 }],
    suggestedAccount: '5460',
  }

  function routedMock(supplierOp: Record<string, unknown>) {
    const inserts: Array<Record<string, unknown>> = []
    const tables: string[] = []
    let pendingCalls = 0
    const chain = (result: { data: unknown; error: unknown }, onInsert?: (p: Record<string, unknown>) => void): unknown =>
      new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result)
            if (prop === 'single' || prop === 'maybeSingle') return () => Promise.resolve(result)
            if (prop === 'insert' && onInsert) {
              return (payload: Record<string, unknown>) => {
                onInsert(payload)
                return chain(result)
              }
            }
            return () => chain(result, onInsert)
          },
        },
      )
    const inbox = { id: 'inbox-1', status: 'received', extracted_data: extracted, matched_supplier_id: null, created_supplier_invoice_id: null, document_id: 'doc-1' }
    const supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        tables.push(table)
        if (table === 'invoice_inbox_items') return chain({ data: inbox, error: null })
        if (table === 'pending_operations') {
          pendingCalls += 1
          return pendingCalls === 1
            ? chain({ data: supplierOp, error: null })
            : chain({ data: { id: 'op-supplier-invoice' }, error: null }, (p) => inserts.push(p))
        }
        return chain({ data: null, error: null })
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    return { supabase, inserts, tables }
  }

  it('stages the supplier invoice at once against a supplier that awaits approval', async () => {
    const { supabase, inserts, tables } = routedMock({
      id: SUPPLIER_OP,
      status: 'pending',
      operation_type: 'create_supplier',
      title: 'Ny leverantör: Ny Leverantör AB',
      params: { name: 'Ny Leverantör AB', default_payment_terms: 30 },
      preview_data: {},
      result_data: null,
    })

    const result = (await fromInbox.execute(
      { inbox_item_id: 'inbox-1', supplier_operation_id: SUPPLIER_OP },
      'company-1',
      'user-1',
      supabase as never,
    )) as Staged

    expect(result.staged).toBe(true)
    expect(result.preview.supplier_resolution).toBe('pending_operation')
    expect(inserts).toHaveLength(1)
    const params = inserts[0].params as Record<string, unknown>
    expect(params.supplier_id).toBeNull()
    expect(params.depends_on).toEqual([
      { operation_id: SUPPLIER_OP, operation_type: 'create_supplier', result_field: 'supplier_id', param: 'supplier_id' },
    ])
    // No supplier row to look up, match against or backfill yet.
    expect(tables).not.toContain('suppliers')
  })

  it('refuses supplier_operation_id together with supplier_id_override', async () => {
    const { supabase } = routedMock({})
    await expect(
      fromInbox.execute(
        { inbox_item_id: 'inbox-1', supplier_operation_id: SUPPLIER_OP, supplier_id_override: CUSTOMER_ID },
        'company-1',
        'user-1',
        supabase as never,
      ),
    ).rejects.toThrow(/either supplier_id_override or supplier_operation_id/)
  })
})
