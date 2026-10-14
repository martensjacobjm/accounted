import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentTool } from '@/lib/agent/tools/types'

// Test doubles for the chat evals: an in-memory Supabase that answers the
// handful of reads runChatTurn makes, and stub executors that wrap the REAL
// registered tool definitions (name, description, input schema) so the model
// sees exactly what production offers. Nothing here touches a database.

export const EVAL_COMPANY_ID = '00000000-0000-4000-8000-0000000e7a11'
export const EVAL_USER_ID = '00000000-0000-4000-8000-0000000e7a12'

export interface AtomRow {
  id: string
  slug: string
  tier: string
  title: string
  description: string
  body: string
  parent_atom_id: string | null
}

export interface EvalFixtures {
  atoms: AtomRow[]
  profileSummary: string
  memory: { id: string; content: string; kind: string }[]
}

type Row = Record<string, unknown>

/** Minimal PostgREST-shaped builder: every filter is a no-op, the table decides the rows. */
export function fakeSupabase(fx: EvalFixtures): SupabaseClient {
  const rowsFor = (table: string, filters: Array<[string, unknown[]]>): Row[] | Row | null => {
    switch (table) {
      case 'agent_atom_registry': {
        const parentNull = filters.some(([m, a]) => m === 'is' && a[0] === 'parent_atom_id')
        return fx.atoms
          .filter((a) => (parentNull ? a.parent_atom_id === null : true))
          .map((a) => ({ id: a.id, title: a.title, description: a.description, body: a.body, is_active: true }))
      }
      case 'agent_profiles':
        return { profile_summary: fx.profileSummary, vertical_atoms: [], modifier_atoms: [] }
      case 'agent_memory':
        return fx.memory.map((m) => ({ ...m, is_pinned: true, relevance_score: 1, source: 'user', last_accessed_at: null }))
      case 'company_settings':
        return { vat_registered: true, vat_number: 'SE559900000101' }
      case 'fiscal_periods':
        return [{ id: 'fp-2026', name: '2026', period_start: '2026-01-01', period_end: '2026-12-31', is_closed: false }]
      default:
        return []
    }
  }

  const builder = (table: string) => {
    const filters: Array<[string, unknown[]]> = []
    let single = false
    const proxy: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            const rows = rowsFor(table, filters)
            const data = single ? (Array.isArray(rows) ? (rows[0] ?? null) : rows) : rows
            return (resolve: (v: unknown) => void) => resolve({ data, error: null })
          }
          return (...args: unknown[]) => {
            if (prop === 'maybeSingle' || prop === 'single') single = true
            filters.push([String(prop), args])
            return proxy
          }
        },
      },
    )
    return proxy
  }

  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'from') return (table: string) => builder(table)
        if (prop === 'rpc') return () => builder('rpc')
        return () => builder('')
      },
    },
  ) as unknown as SupabaseClient
}

// Canned read results: enough company data for the "gör X" cases to resolve
// a customer, a bank line and an invoice without asking the user.
const READ_FIXTURES: Record<string, unknown> = {
  gnubok_get_agent_briefing: {
    company: { name: 'Fjällbygg AB', entity_type: 'aktiebolag', vat_registered: true, accounting_method: 'faktureringsmetoden' },
    pending_operations: 0,
    uncategorized_transactions: 1,
  },
  gnubok_list_customers: {
    customers: [{ id: 'cu-1', name: 'Byggmästarn AB', org_number: '556677-8899', email: 'ekonomi@byggmastarn.se', payment_terms_days: 30 }],
  },
  gnubok_list_uncategorized_transactions: {
    transactions: [{ id: 'tx-1', date: '2026-10-10', description: 'CIRCLE K BORLANGE', amount: -650, currency: 'SEK' }],
  },
  gnubok_list_transactions: {
    transactions: [{ id: 'tx-1', date: '2026-10-10', description: 'CIRCLE K BORLANGE', amount: -650, currency: 'SEK', categorized: false }],
  },
  gnubok_suggest_categories: {
    suggestions: [{ transaction_id: 'tx-1', category: 'expense_vehicle_fuel', label: 'Drivmedel', vat_rate: 25, confidence: 0.92 }],
  },
  gnubok_list_invoices: {
    invoices: [{ id: 'inv-1042', invoice_number: '1042', customer_name: 'Byggmästarn AB', total: 12500, currency: 'SEK', status: 'sent', invoice_date: '2026-09-15' }],
  },
  gnubok_list_pending_operations: {
    operations: [{ id: 'op-waiting-1', title: 'Bokför CIRCLE K BORLANGE 650 kr', status: 'pending' }],
  },
  gnubok_list_assets: { assets: [] },
  gnubok_list_articles: { articles: [] },
}

let stagedCounter = 0

function isReadOnly(tool: AgentTool): boolean {
  return (tool as { annotations?: { readOnlyHint?: boolean } }).annotations?.readOnlyHint === true
}

function loadSkill(atoms: AtomRow[], input: Record<string, unknown>) {
  const slug = String(input.slug ?? input.skill_id ?? '').trim()
  const atom = atoms.find((a) => a.id === slug || a.slug === slug || a.id.endsWith(`/${slug}`))
  if (!atom) {
    throw new Error(`Skill not found: "${slug}". Available skills: ${atoms.filter((a) => !a.parent_atom_id).map((a) => a.id).join(', ')}`)
  }
  return { slug: atom.id, name: atom.title, tier: atom.tier, body: atom.body }
}

/**
 * Same definition, stub executor. Reads return fixtures; any non-read-only tool
 * returns a staged envelope, which is what every whitelisted writer does
 * (mcp-server chat-whitelist-staging.test.ts guards that contract).
 */
export function stubTool(real: AgentTool, atoms: AtomRow[]): AgentTool {
  return {
    ...real,
    execute: async (input: Record<string, unknown>) => {
      if (real.name === 'gnubok_load_skill') return loadSkill(atoms, input)
      if (isReadOnly(real)) {
        return READ_FIXTURES[real.name] ?? { items: [], note: 'Inga poster i testdatan.' }
      }
      stagedCounter += 1
      return {
        staged: true,
        operation_id: `op-eval-${real.name}-${stagedCounter}`,
        risk_level: 'medium',
        actor: { type: 'agent_chat' },
        message: 'Förslaget är skapat och väntar på användarens godkännande.',
        preview: { tool: real.name, input },
      }
    },
  } as AgentTool
}
