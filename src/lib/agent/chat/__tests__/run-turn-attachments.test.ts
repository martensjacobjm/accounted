import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentTool } from '@/lib/agent/tools/types'
import type { StreamEvent } from '../run-turn'
import { generalHelp } from '@/lib/agent/intents/general-help'
import type { ChatAttachmentRef } from '../attachment-block'

// A receipt attached in the composer reaches the model as a block of ids in
// the user message, is persisted with it (so later turns still know the
// file), and the booking the model proposes from it is staged as an approval
// card, never committed.

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
  buildSystemPrompt: vi.fn().mockResolvedValue({ blocks: [], promptHash: 'sha256:test', atomsLoaded: [] }),
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
          if (prop === 'then') return (resolve: (v: unknown) => void) => resolve({ data: null, error: null })
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

function tool(name: string, result: unknown): AgentTool {
  return {
    name,
    description: '',
    inputSchema: { type: 'object', properties: {} },
    execute: vi.fn().mockResolvedValue(result),
  }
}

const DOC_ID = '11111111-1111-4111-8111-111111111111'
const INBOX_ID = '22222222-2222-4222-8222-222222222222'
const RECEIPT: ChatAttachmentRef = {
  documentId: DOC_ID,
  inboxItemId: INBOX_ID,
  fileName: 'circle-k.jpg',
  mimeType: 'image/jpeg',
  inboxStatus: 'ready',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runChatTurn with an attached receipt', () => {
  it('shows the model the ids, persists them, and stages the booking it proposes', async () => {
    const readInbox = tool('gnubok_get_inbox_item', {
      id: INBOX_ID,
      document_id: DOC_ID,
      status: 'ready',
      extracted_data: { supplier_name: 'Circle K', invoice_date: '2026-10-10', total: 650, vat_amount: 130 },
    })
    const voucher = tool('gnubok_create_voucher', {
      staged: true,
      operation_id: 'op-voucher-1',
      risk_level: 'high',
      actor: { type: 'agent_chat' },
      message: 'Förslag skapat, väntar på godkännande.',
      preview: {},
    })
    const tools: Record<string, AgentTool> = { gnubok_get_inbox_item: readInbox, gnubok_create_voucher: voucher }
    getMock.mockImplementation((n: string) => tools[n])
    getManyMock.mockResolvedValue(Object.values(tools))

    messagesCreate
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tu_read', name: 'gnubok_get_inbox_item', input: { inbox_item_id: INBOX_ID } }],
        stop_reason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 'tu_voucher',
            name: 'gnubok_create_voucher',
            input: { entry_date: '2026-10-10', description: 'Drivmedel Circle K', inbox_item_id: INBOX_ID, lines: [] },
          },
        ],
        stop_reason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Kvittot från Circle K: 650 kr, varav 130 kr moms. Förslaget väntar på ditt godkännande.' }],
        stop_reason: 'end_turn',
      })

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
      userMessage: 'Bokför kvittot',
      attachments: [RECEIPT],
      persist: true,
      emit: (e) => {
        events.push(e)
        return true
      },
    })

    // The model saw the typed text followed by the block with both ids.
    const firstCall = messagesCreate.mock.calls[0]![0] as { messages: Array<{ role: string; content: unknown }> }
    const userTurn = firstCall.messages.find((m) => m.role === 'user' && typeof m.content === 'string')
    expect(userTurn?.content).toContain('Bokför kvittot\n\n<bifogade_dokument>')
    expect(userTurn?.content).toContain(`document_id=${DOC_ID} inbox_item_id=${INBOX_ID}`)
    expect(userTurn?.content).toContain('filnamn="circle-k.jpg"')

    // The same text is what was persisted, visible (not hidden).
    const userInsert = db.calls.find(
      (c) => c.table === 'agent_messages' && c.method === 'insert' && (c.args[0] as { role?: string }).role === 'user',
    )
    const row = userInsert?.args[0] as { content: Array<{ type: string; text: string }>; hidden: boolean }
    expect(row.hidden).toBe(false)
    expect(row.content[0].text).toBe(userTurn?.content)

    // Read first, then the booking is staged as a card.
    expect(readInbox.execute).toHaveBeenCalledTimes(1)
    expect(voucher.execute).toHaveBeenCalledTimes(1)
    const staged = events.filter((e) => e.kind === 'staged_operation')
    expect(staged).toHaveLength(1)
    expect(staged[0]).toMatchObject({ tool_name: 'gnubok_create_voucher', staged: { operation_id: 'op-voucher-1' } })
    expect(events.at(-1)).toMatchObject({ kind: 'turn_complete' })
  })

  it('leaves a turn without attachments byte-identical', async () => {
    getManyMock.mockResolvedValue([])
    messagesCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Hej!' }], stop_reason: 'end_turn' })
    await runChatTurn({
      supabase: recordingSupabase().client,
      userId: 'user-1',
      companyId: 'company-1',
      companyName: 'Acme AB',
      firstName: 'Anna',
      intent: generalHelp as unknown as Parameters<typeof runChatTurn>[0]['intent'],
      conversationId: 'conv-1',
      userMessage: 'Hur gick juli?',
      persist: false,
      emit: () => true,
    })
    const firstCall = messagesCreate.mock.calls[0]![0] as { messages: Array<{ role: string; content: unknown }> }
    expect(firstCall.messages.filter((m) => m.role === 'user')).toEqual([{ role: 'user', content: 'Hur gick juli?' }])
  })
})
