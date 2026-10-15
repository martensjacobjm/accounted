import type { SupabaseClient } from '@supabase/supabase-js'
import { isUuid } from '@/lib/invariants/uuid'
import type { PendingOperationStatus } from '@/types'

// Beroenden mellan stagade förslag (fork bok.dalavs.se 2026-10-15).
//
// Ett ärende i flera steg ("skapa kunden och fakturera den") gav tidigare bara
// det första kortet: fakturan kräver ett customer_id som inte finns förrän
// kundförslaget är godkänt, så assistenten svarade "godkänn kunden först, sedan
// skapar jag fakturan". Nu får det senare förslaget en referens till det
// tidigare i params.depends_on, och värdet (customer_id, supplier_id) hämtas ur
// det tidigare förslagets result_data när det senare godkänns.
//
// Varje förslag godkänns fortfarande av en människa, ett i taget: ett beroende
// som inte är godkänt stoppar commit med DEPENDENCY_PENDING och förslaget
// ligger kvar som pending. Inget godkänns i kaskad. params är frysta efter
// insert (triggern pending_operations_input_frozen, BFL 7 kap.), så upplösningen
// skrivs aldrig tillbaka: den är deterministisk ur två oföränderliga rader, det
// här förslagets depends_on och beroendets result_data.

export const DEPENDS_ON_PARAM = 'depends_on'

export interface OperationDependency {
  /** Id för det stagade förslag som måste vara godkänt först. */
  operation_id: string
  /** Förväntad operation_type, så att en referens till fel sorts förslag avvisas. */
  operation_type: string
  /** Fält i beroendets result_data som ska kopieras, till exempel customer_id. */
  result_field?: string
  /** Param i det här förslaget som får värdet. Saknas båda är beroendet bara en ordningsspärr. */
  param?: string
}

export type DependencyErrorCode = 'DEPENDENCY_PENDING' | 'DEPENDENCY_FAILED' | 'DEPENDENCY_INVALID'

export type DependencyResolution =
  | { ok: true; params: Record<string, unknown>; resolvedCount: number }
  | { ok: false; code: DependencyErrorCode; message: string; httpStatus: number }

interface DependencyRow {
  id: string
  status: PendingOperationStatus
  operation_type: string
  title: string | null
  params?: Record<string, unknown> | null
  preview_data?: Record<string, unknown> | null
  result_data: Record<string, unknown> | null
}

const OPEN_STATUSES: ReadonlySet<string> = new Set(['pending', 'committing'])

function isDependency(value: unknown): value is OperationDependency {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  if (!isUuid(v.operation_id) || typeof v.operation_type !== 'string' || !v.operation_type) return false
  const hasField = typeof v.result_field === 'string' && v.result_field.length > 0
  const hasParam = typeof v.param === 'string' && v.param.length > 0
  // Antingen båda (värdet kopieras) eller ingen (ren ordningsspärr).
  return hasField === hasParam
}

/**
 * Läser params.depends_on. Saknas fältet blir det en tom lista; ett fält med
 * fel form ger null, så att anroparen kan vägra i stället för att tyst
 * ignorera ett beroende.
 */
export function parseDependencies(params: Record<string, unknown> | null | undefined): OperationDependency[] | null {
  const raw = params?.[DEPENDS_ON_PARAM]
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw) || !raw.every(isDependency)) return null
  return raw
}

/** params utan depends_on: det exekutorerna får, eftersom flera validerar med strikta scheman. */
export function withoutDependencies(params: Record<string, unknown>): Record<string, unknown> {
  if (!(DEPENDS_ON_PARAM in params)) return params
  const { [DEPENDS_ON_PARAM]: _deps, ...rest } = params
  return rest
}

function quoteTitle(row: DependencyRow): string {
  return row.title ? `"${row.title}"` : 'som det här bygger på'
}

function failure(code: DependencyErrorCode, message: string): DependencyResolution {
  // 409 när användaren kan godkänna i rätt ordning, 422 när det aldrig går.
  return { ok: false, code, message, httpStatus: code === 'DEPENDENCY_PENDING' ? 409 : 422 }
}

function checkRow(dep: OperationDependency, row: DependencyRow | undefined): DependencyResolution | null {
  if (!row) {
    return failure('DEPENDENCY_FAILED', 'Förslaget som det här bygger på finns inte i bolaget. Avvisa det här förslaget och be assistenten om ett nytt.')
  }
  if (row.operation_type !== dep.operation_type) {
    return failure('DEPENDENCY_INVALID', 'Förslaget pekar på ett förslag av fel sort. Avvisa det och be assistenten om ett nytt.')
  }
  if (OPEN_STATUSES.has(row.status)) {
    return failure('DEPENDENCY_PENDING', `Godkänn först förslaget ${quoteTitle(row)}. Det här förslaget bygger på det och kan godkännas direkt efteråt.`)
  }
  if (row.status !== 'committed') {
    return failure('DEPENDENCY_FAILED', `Förslaget ${quoteTitle(row)} som det här bygger på är avvisat eller genomfördes inte, så det här kan inte godkännas. Avvisa det och be assistenten om ett nytt.`)
  }
  return null
}

/**
 * Löser params.depends_on mot de förslag de pekar på. Gör inget databasanrop
 * när förslaget saknar beroenden, så alla vanliga commit-vägar är orörda.
 * Returnerar params utan depends_on och med de kopierade värdena insatta.
 */
export async function resolveOperationDependencies(
  supabase: SupabaseClient,
  companyId: string,
  params: Record<string, unknown>,
): Promise<DependencyResolution> {
  const deps = parseDependencies(params)
  if (deps === null) {
    return failure('DEPENDENCY_INVALID', 'Förslagets beroenden har fel form. Avvisa det och be assistenten om ett nytt.')
  }
  if (deps.length === 0) return { ok: true, params: withoutDependencies(params), resolvedCount: 0 }

  const ids = [...new Set(deps.map((d) => d.operation_id))]
  const { data, error } = await supabase
    .from('pending_operations')
    .select('id, status, operation_type, title, result_data')
    .eq('company_id', companyId)
    .in('id', ids)
  if (error) {
    return { ok: false, code: 'DEPENDENCY_FAILED', message: 'Förslaget som det här bygger på kunde inte läsas. Försök igen.', httpStatus: 500 }
  }
  const rows = new Map(((data ?? []) as DependencyRow[]).map((r) => [r.id, r]))

  let resolved = withoutDependencies(params)
  for (const dep of deps) {
    const row = rows.get(dep.operation_id)
    const problem = checkRow(dep, row)
    if (problem) return problem
    if (!dep.result_field || !dep.param) continue
    const value = row!.result_data?.[dep.result_field]
    if (typeof value !== 'string' || value.length === 0) {
      return failure('DEPENDENCY_FAILED', `Förslaget ${quoteTitle(row!)} gav inget resultat som det här förslaget kan bygga på. Avvisa det och be assistenten om ett nytt.`)
    }
    resolved = { ...resolved, [dep.param]: value }
  }
  return { ok: true, params: resolved, resolvedCount: deps.length }
}

/**
 * Sorterar förslag så att beroenden inom samma urval kommer först, med
 * ursprunglig ordning i övrigt. Används av massgodkännandet: där kan
 * användaren ha markerat fakturan före kunden.
 */
export function orderByDependencies<T extends { id: string; params?: Record<string, unknown> | null }>(ops: T[]): T[] {
  const byId = new Map(ops.map((op) => [op.id, op]))
  const placed = new Set<string>()
  const visiting = new Set<string>()
  const out: T[] = []
  const place = (op: T) => {
    if (placed.has(op.id) || visiting.has(op.id)) return
    visiting.add(op.id)
    for (const dep of parseDependencies(op.params) ?? []) {
      const inBatch = byId.get(dep.operation_id)
      if (inBatch) place(inBatch)
    }
    visiting.delete(op.id)
    placed.add(op.id)
    out.push(op)
  }
  for (const op of ops) place(op)
  return out
}

export interface StagedDependencyOperation {
  id: string
  status: PendingOperationStatus
  title: string
  params: Record<string, unknown>
  previewData: Record<string, unknown>
  resultData: Record<string, unknown> | null
}

/**
 * Stagningssidan: hämtar ett förslag som ett nytt förslag ska bygga på.
 * Felen är engelska, som övriga verktygsfel till modellen.
 */
export async function loadDependencyOperation(
  supabase: SupabaseClient,
  companyId: string,
  operationId: unknown,
  expectedType: string,
  argName: string,
): Promise<StagedDependencyOperation> {
  if (!isUuid(operationId)) {
    throw new Error(`${argName} must be the operation_id (UUID) that ${expectedType} returned when it staged.`)
  }
  const { data, error } = await supabase
    .from('pending_operations')
    .select('id, status, operation_type, title, params, preview_data, result_data')
    .eq('id', operationId)
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) throw new Error(`Could not read ${argName}: ${error.message}`)
  const row = data as DependencyRow | null
  if (!row) throw new Error(`${argName} ${operationId} is not a staged operation in this company.`)
  if (row.operation_type !== expectedType) {
    throw new Error(`${argName} ${operationId} is a ${row.operation_type} operation, expected ${expectedType}.`)
  }
  if (!OPEN_STATUSES.has(row.status) && row.status !== 'committed') {
    throw new Error(`${argName} ${operationId} was ${row.status}: stage a new ${expectedType} first.`)
  }
  return {
    id: row.id,
    status: row.status,
    title: row.title ?? '',
    params: row.params ?? {},
    previewData: row.preview_data ?? {},
    resultData: row.result_data,
  }
}

/** Det som visas på kortet för ett förslag som bygger på ett annat. */
export function dependencyPreview(op: StagedDependencyOperation): { operation_id: string; title: string } {
  return { operation_id: op.id, title: op.title }
}
