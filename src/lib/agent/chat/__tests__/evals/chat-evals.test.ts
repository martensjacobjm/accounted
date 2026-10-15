import { describe, it, beforeAll, vi, type ExpectStatic } from 'vitest'
import { join } from 'node:path'
import { appendFile } from 'node:fs/promises'
import type { AgentTool } from '@/lib/agent/tools/types'
import type { StreamEvent } from '../../run-turn'
import { ATTACHMENT_ONLY_MESSAGE } from '../../attachment-block'
import { findLeakedAccountNumbers } from '../../output-guards'
import { KNOWLEDGE_CASES, ACTION_CASES, ATTACHMENT_CASES, MULTI_STEP_CASES, CLAIMS_DONE, SAYS_CANNOT, RELAYS_WORK_SPLIT, PROPOSAL_CALLED_DONE, WAITS_FOR_APPROVAL, INSTRUCTS_INSTEAD, type EvalCase } from './cases'
import { fakeSupabase, stubTool, EVAL_COMPANY_ID, EVAL_USER_ID, type AtomRow, type EvalFixtures } from './harness'

// Chat evals against the REAL model: the production system prompt, the real
// general.help intent and the real tool definitions, with stubbed tool
// executors and an in-memory database. Costs money and is nondeterministic,
// so it runs only on request:
//
//   EVAL=1 ANTHROPIC_API_KEY=... npm run eval:chat
//
// (Bedrock works too: AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY.) A plain
// `vitest run` skips the whole suite. EVAL_REPORT=<file> appends one JSON line
// per case (reply, tools called, staged count) for reading a run afterwards.

const ENABLED = process.env.EVAL === '1'
const TURN_TIMEOUT_MS = 240_000

const INTERNAL_NAMES = 'Jacob,Jacob Martens'
const LEAKY_MEMORY = 'Bokslut och deklaration sköts av Jacob utanför Accounted.'

interface TurnResult {
  text: string
  events: StreamEvent[]
}

let runTurn: (c: EvalCase) => Promise<TurnResult>

const DEFAULT_PROFILE =
  'Fjällbygg AB är ett aktiebolag i Dalarna som bygger och renoverar åt privatpersoner och företag. Momsregistrerat, redovisar moms kvartalsvis, faktureringsmetoden, kalenderår. Två anställda.'

const internalNames = INTERNAL_NAMES.split(',').map((n) => n.trim().toLowerCase())

describe.skipIf(!ENABLED)('chat evals (real model)', () => {
  beforeAll(async () => {
    const hasCreds = !!process.env.ANTHROPIC_API_KEY || !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
    if (!hasCreds) throw new Error('EVAL=1 needs ANTHROPIC_API_KEY or AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY')
    // Set before the model client module is imported: it resolves the model id
    // and provider once, at import time.
    process.env.AGENT_INTERNAL_PERSON_NAMES = INTERNAL_NAMES
    process.env.AGENT_INTERNAL_PERSON_ROLE = 'byrån'

    const { discoverAtoms } = await import('@/scripts/lib/atom-discovery')
    const discovered = await discoverAtoms(join(process.cwd()))
    const atoms: AtomRow[] = discovered
      .filter((a) => a.audience === 'agent')
      .map((a) => ({ id: a.id, slug: a.slug, tier: a.tier, title: a.title, description: a.description, body: a.body, parent_atom_id: a.parent_atom_id }))

    // Populates the real tool registry, as ensureInitialized() does in the route.
    await import('@/lib/extensions/_generated/extension-list')
    const { agentToolRegistry } = await import('@/lib/agent/tools/registry')
    const realGet = agentToolRegistry.get.bind(agentToolRegistry)
    vi.spyOn(agentToolRegistry, 'get').mockImplementation((name: string) => {
      const real = realGet(name)
      return real ? stubTool(real, atoms) : undefined
    })
    vi.spyOn(agentToolRegistry, 'getMany').mockImplementation((names: string[]) =>
      names.map((n) => realGet(n)).filter((t): t is AgentTool => !!t).map((t) => stubTool(t, atoms)),
    )

    const { generalHelp } = await import('@/lib/agent/intents/general-help')
    const { runChatTurn } = await import('../../run-turn')

    runTurn = async (c: EvalCase) => {
      const { question, attachments } = c
      const fixtures: EvalFixtures = {
        atoms,
        profileSummary: c.profileSummary ?? DEFAULT_PROFILE,
        memory: [
          { id: 'mem-1', content: LEAKY_MEMORY, kind: 'fact' },
          ...(c.memory ?? []).map((content, i) => ({ id: `mem-${i + 2}`, content, kind: 'fact' })),
        ],
      }
      const events: StreamEvent[] = []
      await runChatTurn({
        supabase: fakeSupabase(fixtures),
        userId: EVAL_USER_ID,
        companyId: EVAL_COMPANY_ID,
        companyName: 'Fjällbygg AB',
        firstName: c.firstName === undefined ? 'Anna' : c.firstName,
        // Same cast as the route: the registry stores intents type-erased.
        intent: generalHelp as unknown as Parameters<typeof runChatTurn>[0]['intent'],
        conversationId: `eval-${Math.random().toString(36).slice(2)}`,
        // As the route: an attachment-only turn gets the default sentence.
        userMessage: question.trim() === '' && attachments?.length ? ATTACHMENT_ONLY_MESSAGE : question,
        attachments,
        persist: false,
        emit: (e) => {
          events.push(e)
          return true
        },
      })
      const done = events.find((e) => e.kind === 'turn_complete') as { assistant_text?: string } | undefined
      return { text: done?.assistant_text ?? '', events }
    }
  }, 120_000)

  // Concurrent tests must assert through their own context's expect.
  const check = async (c: EvalCase, expect: ExpectStatic) => {
    const { text, events } = await runTurn(c)
    const toolUses = events.filter((e) => e.kind === 'tool_use') as Array<{ name: string }>
    const staged = events.filter((e) => e.kind === 'staged_operation') as Array<{ tool_name: string; params: Record<string, unknown> }>
    if (process.env.EVAL_REPORT) {
      const line = { id: c.id, tools: toolUses.map((t) => t.name), staged: staged.map((s) => s.tool_name), reply: text }
      await appendFile(process.env.EVAL_REPORT, `${JSON.stringify(line)}\n`, 'utf8')
    }

    expect(text.length, 'empty reply').toBeGreaterThan(0)
    for (const re of c.mustMatch ?? []) expect(text, `missing ${re}`).toMatch(re)
    for (const re of c.mustNotMatch ?? []) expect(text, `forbidden ${re}`).not.toMatch(re)
    if (!c.accountNumbersAllowed) {
      expect(findLeakedAccountNumbers(text).map((l) => l.account), 'BAS account number in reply').toEqual([])
    }
    // The signed-in user's own name is not an internal name for that user.
    if (!internalNames.includes(String(c.firstName ?? '').toLowerCase())) {
      expect(text, 'internal person name').not.toMatch(/\bJacob\b/i)
    }
    expect(text, '"approve first, then I do the next step"').not.toMatch(WAITS_FOR_APPROVAL)
    expect(text, 'relays the internal work split').not.toMatch(RELAYS_WORK_SPLIT)
    // The commit tool is never offered to /chat; it must never run.
    expect(toolUses.map((t) => t.name)).not.toContain('gnubok_approve_pending_operation')
    if (c.honestNo) {
      expect(text, 'no honest "cannot"').toMatch(SAYS_CANNOT)
      expect(text, 'claims it was done').not.toMatch(CLAIMS_DONE)
    }
    if (c.expectStagedFrom) {
      const hit = staged.filter((s) => c.expectStagedFrom!.includes(s.tool_name))
      expect(hit.length, `no staged ${c.expectStagedFrom.join('|')}`).toBeGreaterThan(0)
    }
    for (const tool of c.expectStagedAll ?? []) {
      expect(staged.map((s) => s.tool_name), `${tool} not staged in the same turn`).toContain(tool)
    }
    for (const { tool, field } of c.expectInput ?? []) {
      const call = staged.find((s) => s.tool_name === tool)
      expect(call?.params?.[field], `${tool} staged without ${field}`).toBeDefined()
    }
    if (c.expectCalledAny) {
      const called = toolUses.map((t) => t.name).filter((n) => c.expectCalledAny!.includes(n))
      expect(called.length, `none of ${c.expectCalledAny.join('|')} called`).toBeGreaterThan(0)
    }
    if (c.expectStagedFrom || c.expectStagedAll || c.expectCalledAny) {
      expect(text, 'describes the clicks instead of doing it').not.toMatch(INSTRUCTS_INSTEAD)
    }
    if (c.expectStagedFrom || c.expectStagedAll) {
      expect(text, 'reply should point at the approval card').toMatch(/godkänn|väntar[^.!?]{0,20}\bi kortet/i)
      expect(text, 'calls a pending proposal done').not.toMatch(PROPOSAL_CALLED_DONE)
    }
  }

  describe('knowledge questions', () => {
    for (const c of KNOWLEDGE_CASES) {
      it.concurrent(c.id, ({ expect }) => check(c, expect), TURN_TIMEOUT_MS)
    }
  })

  describe('"gör X": the chat stages the write, the user approves', () => {
    for (const c of ACTION_CASES) {
      it.concurrent(c.id, ({ expect }) => check(c, expect), TURN_TIMEOUT_MS)
    }
  })

  describe('attached receipts and invoices: read first, then propose', () => {
    for (const c of ATTACHMENT_CASES) {
      it.concurrent(c.id, ({ expect }) => check(c, expect), TURN_TIMEOUT_MS)
    }
  })

  describe('multi-step requests: every card in one turn, greeting by the signed-in user', () => {
    for (const c of MULTI_STEP_CASES) {
      it.concurrent(c.id, ({ expect }) => check(c, expect), TURN_TIMEOUT_MS)
    }
  })
})
