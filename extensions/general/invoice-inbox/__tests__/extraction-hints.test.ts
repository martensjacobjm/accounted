import { describe, expect, it } from 'vitest'
import {
  buildHintInstruction,
  formatCompanyRules,
  parseKindHint,
  sanitiseUserNote,
  COMPANY_RULES_MAX_ROWS,
  COMPANY_RULES_MAX_TOTAL,
  USER_NOTE_MAX,
} from '../lib/extraction-hints'

describe('parseKindHint', () => {
  it('accepts only the two kinds a sender can declare', () => {
    expect(parseKindHint('receipt')).toBe('receipt')
    expect(parseKindHint('supplier_invoice')).toBe('supplier_invoice')
    expect(parseKindHint('other')).toBeNull()
    expect(parseKindHint('')).toBeNull()
    expect(parseKindHint(null)).toBeNull()
    expect(parseKindHint(42)).toBeNull()
  })
})

describe('sanitiseUserNote', () => {
  it('trims, strips control characters and caps the length', () => {
    expect(sanitiseUserNote('  städmaterial\u0000 till kund  ')).toBe('städmaterial till kund')
    expect(sanitiseUserNote('')).toBeNull()
    expect(sanitiseUserNote('   ')).toBeNull()
    expect(sanitiseUserNote(undefined)).toBeNull()
    expect(sanitiseUserNote('x'.repeat(USER_NOTE_MAX + 50))).toHaveLength(USER_NOTE_MAX)
  })
  it('keeps Swedish letters and line breaks', () => {
    expect(sanitiseUserNote('Åäö\nrad två')).toBe('Åäö\nrad två')
  })
})

describe('formatCompanyRules', () => {
  it('puts the profile first, then pinned, then user-taught, and caps rows and total length', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      content: `regel ${i} `.repeat(20),
      is_pinned: i % 3 === 0,
      source: i % 2 === 0 ? 'user_taught' : 'agent_learned',
    }))
    const out = formatCompanyRules(rows, 'Städbolag åt privatpersoner')
    expect(out[0]).toBe('Verksamhet: Städbolag åt privatpersoner')
    expect(out.length).toBeLessThanOrEqual(COMPANY_RULES_MAX_ROWS)
    expect(out.join('').length).toBeLessThanOrEqual(COMPANY_RULES_MAX_TOTAL)
    // pinned rows come before unpinned ones
    expect(out[1]).toContain('regel 0')
  })
  it('returns an empty list when there is nothing', () => {
    expect(formatCompanyRules([], null)).toEqual([])
  })
})

describe('buildHintInstruction', () => {
  const base = 'Extract the fields per the schema. JSON only.'
  it('returns the base untouched without hints', () => {
    expect(buildHintInstruction(base)).toBe(base)
    expect(buildHintInstruction(base, null)).toBe(base)
    expect(buildHintInstruction(base, {})).toBe(base)
    expect(buildHintInstruction(base, { companyRules: [] })).toBe(base)
  })
  it('appends kind, note and rules after the base', () => {
    const out = buildHintInstruction(base, {
      kindHint: 'receipt',
      note: 'Fönsterputs "Unger" till kund',
      companyRules: ['Alla utgifter som kan belasta firman bokförs i firman'],
    })
    expect(out.startsWith(base)).toBe(true)
    expect(out).toContain('set documentKind to "receipt"')
    expect(out).toContain("Fönsterputs 'Unger' till kund")
    expect(out).toContain('• Alla utgifter som kan belasta firman bokförs i firman')
  })
})

describe('fork 2026-09-22: every extraction path gets the same hints', () => {
  it('renders other human text as context, never as an account source', async () => {
    const { buildHintInstruction } = await import('../lib/extraction-hints')
    const out = buildHintInstruction('base', { otherText: 'Bildtext: laptop 6995 kr' })
    expect(out).toContain('Bildtext: laptop 6995 kr')
    expect(out).toMatch(/never take an account or an amount from it/i)
  })

  it('tells the model that only a number named as an account is one', async () => {
    const { buildHintInstruction } = await import('../lib/extraction-hints')
    const out = buildHintInstruction('base', { note: 'moppar, konto 5460' })
    expect(out).toContain('prices, order numbers and dates are not accounts')
  })

  it('builds hints from the stored item: kind, typed note, WhatsApp answers, caption, e-mail text, rules and chart', async () => {
    const { buildHintsForItem } = await import('../lib/extraction-hints')
    const calls: string[] = []
    const supabase = {
      from(table: string) {
        calls.push(table)
        const chain: Record<string, unknown> = {
          select: () => chain, eq: () => chain, or: () => chain, order: () => chain, limit: () => chain,
          maybeSingle: async () => ({ data: table === 'agent_profiles' ? { profile_summary: 'Städ' } : null, error: null }),
          then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
            resolve({
              data:
                table === 'agent_memory'
                  ? [{ content: 'Jula är förbrukning', is_pinned: false, source: 'agent_learned', kind: 'preference' }]
                  : table === 'chart_of_accounts'
                    ? [{ account_number: '5460' }, { account_number: '5410' }]
                    : [],
              error: null,
            }),
        }
        return chain
      },
    }
    const hints = await buildHintsForItem(supabase as never, 'c1', {
      kind_hint: 'receipt',
      channel_context: { channel: 'whatsapp', user_note: 'till kund', caption: 'jula kvitto', context_answer: { raw_answer: 'städmaterial', answered_at: 'x' } },
      email_body_text: null,
    })
    expect(hints.kindHint).toBe('receipt')
    expect(hints.note).toBe('till kund')
    expect(hints.otherText).toContain('Svar till kvittoroboten: städmaterial')
    expect(hints.otherText).toContain('Bildtext: jula kvitto')
    expect(hints.companyRules).toContain('Jula är förbrukning')
    expect(hints.accountChart).toEqual(['5460', '5410'])
  })

  it('uses a short e-mail excerpt as other text, never as the note', async () => {
    const { buildHintsForItem } = await import('../lib/extraction-hints')
    const supabase = { from: () => { const c: Record<string, unknown> = { select: () => c, eq: () => c, order: () => c, limit: () => c, maybeSingle: async () => ({ data: null, error: null }), then: (r: (v: { data: unknown[]; error: null }) => unknown) => r({ data: [], error: null }) }; return c } }
    const hints = await buildHintsForItem(supabase as never, 'c1', {
      kind_hint: null,
      channel_context: null,
      email_body_text: 'Hej!\nHär kommer fakturan för städmaterial.\n> tidigare citerad rad\n' + 'x'.repeat(2000),
    })
    expect(hints.note ?? null).toBeNull()
    expect(hints.otherText).toContain('Mejlets text: Hej! Här kommer fakturan för städmaterial.')
    expect(hints.otherText).not.toContain('tidigare citerad rad')
    expect((hints.otherText ?? '').length).toBeLessThanOrEqual(900)
  })
})

describe('mergeUserNote (fork: a re-sent file keeps the new comment)', () => {
  it('keeps both, drops duplicates and caps', async () => {
    const { mergeUserNote, USER_NOTE_MAX: MAX } = await import('../lib/extraction-hints')
    expect(mergeUserNote(null, 'ny')).toBe('ny')
    expect(mergeUserNote('gammal', null)).toBe('gammal')
    expect(mergeUserNote('gammal', 'ny')).toBe('gammal · ny')
    expect(mergeUserNote('moppar till kund', 'moppar till kund')).toBe('moppar till kund')
    expect(mergeUserNote('a'.repeat(MAX), 'b')!.length).toBeLessThanOrEqual(MAX)
  })
})
