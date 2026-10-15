import type { SupabaseClient } from '@supabase/supabase-js'
import type { CustomerType } from '@/types'
import {
  dependencyPreview,
  loadDependencyOperation,
  type OperationDependency,
  type StagedDependencyOperation,
} from '@/lib/pending-operations/dependencies'

// Stagningssidan av beroenden mellan förslag (se pending-operations/
// dependencies.ts). Ett skrivverktyg som får *_operation_id i stället för ett
// riktigt id läser det tidigare förslaget här: är det redan godkänt används
// det skapade id:t direkt, annars stagas det nya förslaget med depends_on och
// id:t sätts in när det godkänns.

export interface DependencyStaging {
  /** Läggs i params.depends_on. Tom när beroendet redan är godkänt. */
  dependsOn: OperationDependency[]
  /** Visas på godkännandekortet: "Bygger på: <titel>". */
  preview: Array<{ operation_id: string; title: string }>
}

const NO_DEPENDENCY: DependencyStaging = { dependsOn: [], preview: [] }

/** Kunden som fakturan räknar moms mot, i den form create_invoice läser kundraden. */
export interface InvoiceCustomer {
  id: string | null
  name: string
  customer_type: CustomerType
  vat_number: string | null
  vat_number_validated: boolean
  country: string | null
  default_payment_terms: number | null
}

export interface ResolvedInvoiceCustomer {
  customerId: string | null
  customer: InvoiceCustomer
  dependency: DependencyStaging
  /** Satt när momsen kan ändras vid godkännandet (EU-kund som VIES-prövas då). */
  vatNote?: string
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function committedId(op: StagedDependencyOperation, field: string): string | null {
  const value = op.resultData?.[field]
  return op.status === 'committed' && typeof value === 'string' && value ? value : null
}

function pendingDependency(
  op: StagedDependencyOperation,
  operationType: string,
  resultField?: string,
  param?: string,
): DependencyStaging {
  const dep: OperationDependency = resultField && param
    ? { operation_id: op.id, operation_type: operationType, result_field: resultField, param }
    : { operation_id: op.id, operation_type: operationType }
  return { dependsOn: [dep], preview: [dependencyPreview(op)] }
}

/**
 * Fakturans kund: ett befintligt customer_id eller ett stagat create_customer
 * (customer_operation_id). Den stagade kundens uppgifter ger momsförhandsvisningen;
 * commitCreateInvoice räknar om mot den riktiga kundraden vid godkännandet.
 */
export async function resolveInvoiceCustomerArg(
  supabase: SupabaseClient,
  companyId: string,
  args: Record<string, unknown>,
): Promise<ResolvedInvoiceCustomer | null> {
  const operationId = args.customer_operation_id
  if (operationId === undefined || operationId === null || operationId === '') return null
  if (args.customer_id) {
    throw new Error('Pass either customer_id or customer_operation_id, not both.')
  }
  const op = await loadDependencyOperation(supabase, companyId, operationId, 'create_customer', 'customer_operation_id')
  const existingId = committedId(op, 'customer_id')
  if (existingId) {
    // Redan godkänd: anroparen läser den riktiga kundraden som vanligt.
    return {
      customerId: existingId,
      customer: { ...customerFromParams(op.params), id: existingId },
      dependency: NO_DEPENDENCY,
    }
  }
  const customer = customerFromParams(op.params)
  return {
    customerId: null,
    customer,
    dependency: pendingDependency(op, 'create_customer', 'customer_id', 'customer_id'),
    ...(customer.customer_type === 'eu_business'
      ? { vatNote: 'Kunden är ett EU-företag vars momsnummer prövas mot VIES när kundförslaget godkänns. Momsen på fakturan räknas om vid godkännandet och kan bli omvänd skattskyldighet (0 %).' }
      : {}),
  }
}

function customerFromParams(params: Record<string, unknown>): InvoiceCustomer {
  const name = stringOrNull(params.name)
  const customerType = stringOrNull(params.customer_type)
  if (!name || !customerType) {
    throw new Error('customer_operation_id points at a create_customer operation without name or customer_type.')
  }
  const terms = Number(params.payment_terms)
  return {
    id: null,
    name,
    customer_type: customerType as CustomerType,
    vat_number: stringOrNull(params.vat_number),
    // VIES-prövningen sker när kundförslaget godkänns, inte vid stagning.
    vat_number_validated: false,
    country: stringOrNull(params.country),
    default_payment_terms: Number.isFinite(terms) && terms > 0 ? terms : null,
  }
}

export interface ResolvedSupplierOperation {
  supplierId: string | null
  defaultExpenseAccount: string | null
  defaultPaymentTerms: unknown
  name: string | null
  dependency: DependencyStaging
}

/** Leverantören för en leverantörsfaktura: ett stagat create_supplier (supplier_operation_id). */
export async function resolveSupplierOperationArg(
  supabase: SupabaseClient,
  companyId: string,
  args: Record<string, unknown>,
): Promise<ResolvedSupplierOperation | null> {
  const operationId = args.supplier_operation_id
  if (operationId === undefined || operationId === null || operationId === '') return null
  if (args.supplier_id_override) {
    throw new Error('Pass either supplier_id_override or supplier_operation_id, not both.')
  }
  const op = await loadDependencyOperation(supabase, companyId, operationId, 'create_supplier', 'supplier_operation_id')
  const existingId = committedId(op, 'supplier_id')
  return {
    supplierId: existingId,
    defaultExpenseAccount: stringOrNull(op.params.default_expense_account),
    defaultPaymentTerms: op.params.default_payment_terms,
    name: stringOrNull(op.params.name),
    dependency: existingId ? NO_DEPENDENCY : pendingDependency(op, 'create_supplier', 'supplier_id', 'supplier_id'),
  }
}

export interface PendingAccount {
  account_number: string
  account_name: string
}

export interface ResolvedAccountOperations {
  accounts: PendingAccount[]
  dependency: DependencyStaging
}

/**
 * Konton som ett verifikat använder men som bara finns som stagade
 * create_account. De räknas som kända vid stagning, och verifikatet kan inte
 * godkännas förrän kontona är godkända (ren ordningsspärr, inget värde kopieras).
 */
export async function resolveAccountOperationArgs(
  supabase: SupabaseClient,
  companyId: string,
  args: Record<string, unknown>,
): Promise<ResolvedAccountOperations> {
  const raw = args.account_operation_ids
  if (raw === undefined || raw === null) return { accounts: [], dependency: NO_DEPENDENCY }
  if (!Array.isArray(raw)) throw new Error('account_operation_ids must be an array of operation_id values from gnubok_create_account.')
  const ids = [...new Set(raw)]
  const accounts: PendingAccount[] = []
  const dependsOn: OperationDependency[] = []
  const preview: DependencyStaging['preview'] = []
  for (const id of ids) {
    const op = await loadDependencyOperation(supabase, companyId, id, 'create_account', 'account_operation_ids')
    const accountNumber = stringOrNull(op.params.account_number)
    if (!accountNumber) throw new Error(`account_operation_ids: operation ${op.id} has no account_number.`)
    accounts.push({ account_number: accountNumber, account_name: stringOrNull(op.params.account_name) ?? '' })
    if (op.status !== 'committed') {
      const staged = pendingDependency(op, 'create_account')
      dependsOn.push(...staged.dependsOn)
      preview.push(...staged.preview)
    }
  }
  return { accounts, dependency: { dependsOn, preview } }
}

export interface ResolvedInvoiceOperation {
  /** Satt när fakturaförslaget redan är godkänt: då går utskicket den vanliga vägen. */
  invoiceId: string | null
  customerName: string | null
  customerEmail: string | null
  total: unknown
  currency: unknown
  dependency: DependencyStaging
}

async function customerEmailFor(
  supabase: SupabaseClient,
  companyId: string,
  invoiceParams: Record<string, unknown>,
): Promise<string | null> {
  const customerId = stringOrNull(invoiceParams.customer_id)
  if (customerId) {
    const { data, error } = await supabase
      .from('customers')
      .select('email')
      .eq('id', customerId)
      .eq('company_id', companyId)
      .maybeSingle()
    if (error) throw new Error(`Could not read the invoice customer: ${error.message}`)
    return stringOrNull((data as { email?: unknown } | null)?.email)
  }
  // Fakturan bygger själv på ett stagat kundförslag: mejladressen står där.
  const deps = Array.isArray(invoiceParams.depends_on) ? (invoiceParams.depends_on as OperationDependency[]) : []
  const customerDep = deps.find((d) => d.operation_type === 'create_customer')
  if (!customerDep) return null
  const op = await loadDependencyOperation(supabase, companyId, customerDep.operation_id, 'create_customer', 'invoice customer')
  return stringOrNull(op.params.email)
}

/** Fakturan att skicka: ett stagat create_invoice (invoice_operation_id). */
export async function resolveInvoiceOperationArg(
  supabase: SupabaseClient,
  companyId: string,
  args: Record<string, unknown>,
): Promise<ResolvedInvoiceOperation | null> {
  const operationId = args.invoice_operation_id
  if (operationId === undefined || operationId === null || operationId === '') return null
  if (args.invoice_id) throw new Error('Pass either invoice_id or invoice_operation_id, not both.')
  const op = await loadDependencyOperation(supabase, companyId, operationId, 'create_invoice', 'invoice_operation_id')
  const existingId = committedId(op, 'invoice_id')
  return {
    invoiceId: existingId,
    customerName: stringOrNull(op.previewData.customer_name),
    customerEmail: existingId ? null : await customerEmailFor(supabase, companyId, op.params),
    total: op.previewData.total,
    currency: op.previewData.currency,
    dependency: existingId ? NO_DEPENDENCY : pendingDependency(op, 'create_invoice', 'invoice_id', 'invoice_id'),
  }
}

/** params- och preview-tillägg för ett förslag som bygger på andra. Tomt utan beroenden. */
export function dependencyFields(dependency: DependencyStaging): {
  params: { depends_on?: OperationDependency[] }
  preview: { depends_on?: DependencyStaging['preview'] }
} {
  if (dependency.dependsOn.length === 0) return { params: {}, preview: {} }
  return { params: { depends_on: dependency.dependsOn }, preview: { depends_on: dependency.preview } }
}
