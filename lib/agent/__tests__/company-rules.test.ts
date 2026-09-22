import { describe, expect, it } from 'vitest'
import { createQueuedMockSupabase } from '@/tests/helpers'
import {
  formatCompanyRules,
  loadCompanyRules,
  renderCompanyRulesBlock,
  COMPANY_RULES_MAX_ROWS,
  COMPANY_RULES_MAX_TOTAL,
} from '../company-rules'

describe('formatCompanyRules (fork: one source of company rules for every model call)', () => {
  it('puts the profile first, then pinned, then what the user taught, then corrections and preferences', () => {
    const out = formatCompanyRules(
      [
        { content: 'fakta om bilen', is_pinned: false, source: 'agent_learned', kind: 'fact' },
        { content: 'rättelse: Jula är förbrukning', is_pinned: false, source: 'agent_learned', kind: 'correction' },
        { content: 'fastnålad regel', is_pinned: true, source: 'agent_learned', kind: 'fact' },
        { content: 'användarens regel', is_pinned: false, source: 'user_taught', kind: 'preference' },
      ],
      'Städbolag',
    )
    expect(out).toEqual([
      'Verksamhet: Städbolag',
      'fastnålad regel',
      'användarens regel',
      'rättelse: Jula är förbrukning',
      'fakta om bilen',
    ])
  })

  it('keeps what the assistant learned in chat (agent_learned), which extraction used to drop', () => {
    const out = formatCompanyRules([{ content: 'Alla betalningar utanför banken är Wilmas egna pengar (2018)', is_pinned: false, source: 'agent_learned', kind: 'preference' }])
    expect(out).toEqual(['Alla betalningar utanför banken är Wilmas egna pengar (2018)'])
  })

  it('caps rows and total length and collapses whitespace', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ content: `regel ${i}\n`.repeat(40), is_pinned: false, source: 'agent_learned', kind: 'fact' }))
    const out = formatCompanyRules(rows)
    expect(out.length).toBeLessThanOrEqual(COMPANY_RULES_MAX_ROWS)
    expect(out.join('').length).toBeLessThanOrEqual(COMPANY_RULES_MAX_TOTAL)
    expect(out.every((r) => !r.includes('\n'))).toBe(true)
  })
})

describe('loadCompanyRules', () => {
  it('reads every active memory of the company, not only pinned ones', async () => {
    const mock = createQueuedMockSupabase()
    mock.enqueue({ data: [{ content: 'regel från chatten', is_pinned: false, source: 'agent_learned', kind: 'fact' }] })
    mock.enqueue({ data: { profile_summary: 'Flyttstäd' } })
    const out = await loadCompanyRules(mock.supabase as never, 'company-1')
    expect(out).toEqual(['Verksamhet: Flyttstäd', 'regel från chatten'])
    expect(mock.calls.some((c) => c.table === 'agent_memory' && c.method === 'or')).toBe(false)
    expect(mock.findCalls('agent_memory', 'eq')).toContainEqual(['company_id', 'company-1'])
    expect(mock.findCalls('agent_memory', 'eq')).toContainEqual(['is_active', true])
  })

  it('never blocks the caller: a failed read gives no rules', async () => {
    const mock = createQueuedMockSupabase()
    mock.enqueue({ error: { message: 'boom' } })
    mock.enqueue({ data: null })
    expect(await loadCompanyRules(mock.supabase as never, 'company-1')).toEqual([])
  })
})

describe('renderCompanyRulesBlock', () => {
  it('renders nothing without rules and a titled list with them', () => {
    expect(renderCompanyRulesBlock([])).toEqual([])
    const block = renderCompanyRulesBlock(['A', 'B'])
    expect(block[0]).toMatch(/Bolagets regler/)
    expect(block.slice(1)).toEqual(['- A', '- B'])
  })
})
