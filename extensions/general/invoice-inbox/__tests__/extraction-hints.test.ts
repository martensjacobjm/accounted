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
