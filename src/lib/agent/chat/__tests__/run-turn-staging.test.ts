import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentTool } from '@/lib/agent/tools/types'
import type { StreamEvent } from '../run-turn'
import { generalHelp } from '@/lib/agent/intents/general-help'

// "Gör X" from /chat must end in a staged pending_operation with an approval
// card, never in a commit. For every write path the 2026-10-15 inventory
// covers, the model issues the tool call, the tool returns its staged envelope
// (the contract the real tool has: mcp-server chat-whitelist-staging.test.ts),
// and the chat loop must emit a staged_operation event and stamp the row with
// the conversation. Batch writers return one envelope per row.

const messagesCreate = vi.fn()
vi.mock('@/lib/agent/composer/client', () => ({
  getAnthropic: () => ({
    messages: {
      create: messagesCreate,
      stream: (args: unknown) => {
        const stream = {
          on: () => stream,
          finalMessage: () => messagesCreate(args),
        }
        return stream
      },
    },
  }),
  SONNET_MODEL: 'claude-sonnet-5',
  EFFORT_STANDARD: 'medium',
  MAX_TOKENS_NO_THINKING: 5400,
  MAX_TOKENS_STANDARD: 16000,
  MAX_TOKENS_DEEP: 24000,
}))

vi.mock('../system-prompt', () => ({
  buildSystemPrompt: vi.fn().mockResolvedValue({
    blocks: [],
    promptHash: 'sha256:test',
    atomsLoaded: [],
  }),
}))

const getMock = vi.fn()
const getManyMock = vi.fn()
vi.mock('@/lib/agent/tools/registry', () => ({
  agentToolRegistry: {
    get: (...args: unknown[]) => getMock(...args),
    getMany: (...args: unknown[]) => getManyMock(...args),
  },
}))

import { runChatTurn } from '../run-turn'

interface Call {
  table: string
  method: string
  args: unknown[]
}

function recordingSupabase() {
  const calls: Call[] = []
  const chain = (table: string): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) => resolve({ data: null, error: null })
          }
          return (...args: unknown[]) => {
            calls.push({ table, method: String(prop), args })
            return chain(table)
          }
        },
      },
    )
  const client = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'from') return (table: string) => chain(table)
        return () => chain('')
      },
    },
  )
  return { client: client as unknown as Parameters<typeof runChatTurn>[0]['supabase'], calls }
}

function envelope(operationId: string) {
  return {
    staged: true as const,
    operation_id: operationId,
    risk_level: 'medium' as const,
    actor: { type: 'agent_chat' },
    message: 'Förslag skapat, väntar på godkännande.',
    preview: {},
  }
}

function tool(name: string, result: unknown): AgentTool {
  return {
    name,
    description: '',
    inputSchema: { type: 'object', properties: {} },
    execute: vi.fn().mockResolvedValue(result),
  }
}

async function runOneToolCall(name: string, input: Record<string, unknown>, t: AgentTool) {
  messagesCreate
    .mockResolvedValueOnce({
      content: [{ type: 'tool_use', id: `tu_${name}`, name, input }],
      stop_reason: 'tool_use',
    })
    .mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Förslaget ligger i kortet nedan.' }],
      stop_reason: 'end_turn',
    })
  getMock.mockImplementation((n: string) => (n === name ? t : undefined))
  getManyMock.mockResolvedValue([t])
  const db = recordingSupabase()
  const events: StreamEvent[] = []
  await runChatTurn({
    supabase: db.client,
    userId: 'user-1',
    companyId: 'company-1',
    companyName: 'Acme AB',
    firstName: 'Anna',
    intent: generalHelp as unknown as Parameters<typeof runChatTurn>[0]['intent'],
    conversationId: 'conv-1',
    userMessage: 'gör det',
    persist: false,
    emit: (e) => {
      events.push(e)
      return true
    },
  })
  return { events, calls: db.calls }
}

function stampedIds(calls: Call[]): string[] {
  const out: string[] = []
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i]
    if (c.table !== 'pending_operations' || c.method !== 'update') continue
    const payload = c.args[0] as { agent_metadata?: { conversation_id?: string } }
    const eq = calls[i + 1]
    if (payload?.agent_metadata?.conversation_id === 'conv-1' && eq?.method === 'eq' && eq.args[0] === 'id') {
      out.push(String(eq.args[1]))
    }
  }
  return out
}

// action, tool, input
const SINGLE_STAGE_ACTIONS: Array<[string, string, Record<string, unknown>]> = [
  ['bokföra banktransaktion', 'gnubok_categorize_transaction', { transaction_id: 'tx-1', category: 'expense_representation' }],
  ['bokföra utlägg, uttag eller periodisering (verifikation)', 'gnubok_create_voucher', { entry_date: '2026-10-15', description: 'Utlägg', lines: [] }],
  ['bokföra kvitton ur inkorgen', 'gnubok_bulk_book_inbox_items', { items: [{ inbox_item_id: 'in-1' }] }],
  ['leverantörsfaktura ur inkorgen', 'gnubok_create_supplier_invoice_from_inbox', { inbox_item_id: 'in-2' }],
  ['skapa faktura', 'gnubok_create_invoice', { customer_id: 'cu-1', items: [] }],
  ['skicka faktura', 'gnubok_send_invoice', { invoice_id: 'inv-1' }],
  ['kreditera faktura', 'gnubok_credit_invoice', { invoice_id: 'inv-1' }],
  ['matcha bank mot faktura', 'gnubok_match_transaction_to_invoice', { transaction_id: 'tx-2', invoice_id: 'inv-2' }],
  ['skapa kund', 'gnubok_create_customer', { name: 'Kund AB' }],
  ['skapa leverantör', 'gnubok_create_supplier', { name: 'Leverantör AB' }],
  ['skapa artikel', 'gnubok_create_article', { name: 'Timme' }],
  ['lämna momsdeklaration', 'gnubok_vat_declaration_submit', { period: '2026-09' }],
  ['skapa lönekörning', 'gnubok_create_salary_run', { period_year: 2026, period_month: 10 }],
  ['bokföra lönekörning', 'gnubok_book_salary_run', { salary_run_id: 'sr-1' }],
  ['ta fram AGI', 'gnubok_generate_agi', { salary_run_id: 'sr-1' }],
  ['lämna AGI', 'gnubok_agi_submit', { salary_run_id: 'sr-1' }],
  ['ROT/RUT-utbetalning mot bank', 'gnubok_settle_rot_rut_payout', { transaction_id: 'tx-3' }],
  ['ROT/RUT-utbetalning mot verifikat (ny)', 'gnubok_link_rot_rut_payout_voucher', { request_id: 'rr-1', journal_entry_id: 'je-1' }],
  ['bokföra årets avskrivningar', 'gnubok_post_annual_depreciation', { fiscal_period_id: 'fp-1' }],
  ['lägga in tillgång (ny)', 'gnubok_create_asset', { name: 'Dator', category: 'computer' }],
  ['ändra tillgång (ny)', 'gnubok_update_asset', { asset_id: 'as-1', notes: 'x' }],
  ['avyttra tillgång (ny)', 'gnubok_dispose_asset', { asset_id: 'as-1', disposal_type: 'sale' }],
  ['bokslut', 'gnubok_run_year_end', { fiscal_period_id: 'fp-1' }],
  ['tagga verifikatrader', 'gnubok_tag_journal_lines', { journal_entry_id: 'je-2' }],
  ['anteckning på verifikat', 'gnubok_set_voucher_note', { journal_entry_id: 'je-2', note: 'Deltagare: 3' }],
  ['bolagsfakta ur arkivet (ny)', 'gnubok_propose_fact', { subject: 'agreement-1' }],
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runChatTurn: every write path from /chat stages, never commits', () => {
  for (const [action, name, input] of SINGLE_STAGE_ACTIONS) {
    it(`${action}: ${name} emits an approval card and stamps the conversation`, async () => {
      expect(generalHelp.tools).toContain(name)
      const t = tool(name, envelope(`op-${name}`))
      const { events, calls } = await runOneToolCall(name, input, t)

      expect(t.execute).toHaveBeenCalledTimes(1)
      const staged = events.filter((e) => e.kind === 'staged_operation')
      expect(staged).toHaveLength(1)
      expect(staged[0]).toMatchObject({
        kind: 'staged_operation',
        tool_name: name,
        staged: { staged: true, operation_id: `op-${name}` },
      })
      expect(stampedIds(calls)).toEqual([`op-${name}`])
      // Nothing in the turn reached the commit tool.
      expect(getMock).not.toHaveBeenCalledWith('gnubok_approve_pending_operation')
      expect(events.at(-1)).toMatchObject({ kind: 'turn_complete' })
    })
  }
})

describe('runChatTurn: batch writers get one card per staged row', () => {
  it('gnubok_create_transactions: operations[] become two cards and two stamps', async () => {
    const name = 'gnubok_create_transactions'
    const t = tool(name, { staged_count: 2, operations: [envelope('op-a'), envelope('op-b')] })
    const { events, calls } = await runOneToolCall(name, { transactions: [] }, t)
    const ids = events
      .filter((e) => e.kind === 'staged_operation')
      .map((e) => (e as { staged: { operation_id: string } }).staged.operation_id)
    expect(ids).toEqual(['op-a', 'op-b'])
    expect(stampedIds(calls)).toEqual(['op-a', 'op-b'])
  })

  it('gnubok_auto_match_period with dry_run=false: the returned operations become cards', async () => {
    const name = 'gnubok_auto_match_period'
    const t = tool(name, {
      dry_run: false,
      scanned_transactions: 3,
      proposed_matches: 2,
      proposals: [],
      staged_count: 2,
      stage_failures: [],
      operations: [envelope('op-m1'), envelope('op-m2')],
    })
    const { events, calls } = await runOneToolCall(name, { date_from: '2026-09-01', date_to: '2026-09-30', dry_run: false }, t)
    expect(events.filter((e) => e.kind === 'staged_operation')).toHaveLength(2)
    expect(stampedIds(calls)).toEqual(['op-m1', 'op-m2'])
  })

  it('a dry run (no operations) emits no card', async () => {
    const name = 'gnubok_auto_match_period'
    const t = tool(name, { dry_run: true, scanned_transactions: 3, proposed_matches: 2, proposals: [] })
    const { events, calls } = await runOneToolCall(name, { date_from: '2026-09-01', date_to: '2026-09-30' }, t)
    expect(events.filter((e) => e.kind === 'staged_operation')).toHaveLength(0)
    expect(stampedIds(calls)).toEqual([])
  })
})

describe('runChatTurn: the commit tool cannot run from chat', () => {
  it('refuses gnubok_approve_pending_operation even if the model names it', async () => {
    const name = 'gnubok_approve_pending_operation'
    expect(generalHelp.tools).not.toContain(name)
    const approve = tool(name, { committed: true })
    const { events } = await runOneToolCall(name, { operation_id: 'op-x' }, approve)
    expect(approve.execute).not.toHaveBeenCalled()
    expect(events.filter((e) => e.kind === 'staged_operation')).toHaveLength(0)
  })
})
