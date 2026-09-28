/**
 * Integration tests for generateNEDeclaration against a CLOSED fiscal year.
 *
 * R1-R11 are an income statement. The resultatavslut zeroes every P&L account
 * at year-end, and NE-bilaga is always filed after bokslut, so a raw journal
 * scan reported an empty näringsverksamhet. The old test file only exercised
 * the mapping table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/reports/trial-balance', () => ({
  generateTrialBalance: vi.fn(),
}))

import { generateNEDeclaration } from '../ne-engine'
import { generateTrialBalance } from '@/lib/reports/trial-balance'
import type { TrialBalanceRow } from '@/types'

const COMPANY_ID = 'company-1'
const PERIOD_ID = 'period-1'

function row(accountNumber: string, accountName: string, balance: number): TrialBalanceRow {
  const debit = balance > 0 ? balance : 0
  const credit = balance < 0 ? -balance : 0
  return {
    account_number: accountNumber,
    account_name: accountName,
    account_class: Number(accountNumber[0]),
    opening_debit: 0,
    opening_credit: 0,
    period_debit: debit,
    period_credit: credit,
    closing_debit: debit,
    closing_credit: credit,
  }
}

/** Pre-closing books: revenue 400 000, costs 150 000, result 250 000. */
const PRE_CLOSING_ROWS: TrialBalanceRow[] = [
  row('1930', 'Företagskonto', 250_000),
  row('3001', 'Försäljning', -400_000),
  row('5010', 'Lokalhyra', 120_000),
  row('6110', 'Kontorsmateriel', 30_000),
]

function makeSupabase() {
  return {
    from: (table: string) => {
      if (table === 'fiscal_periods') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: PERIOD_ID,
                    name: 'Räkenskapsår 2025',
                    period_start: '2025-01-01',
                    period_end: '2025-12-31',
                    is_closed: true,
                    closing_entry_id: 'closing-entry-1',
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'company_settings') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  company_name: 'Testfirman',
                  org_number: '199001010000',
                  entity_type: 'enskild_firma',
                  address_line1: 'Testgatan 1',
                  postal_code: '11122',
                  city: 'Stockholm',
                  email: 'test@example.com',
                },
                error: null,
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(generateTrialBalance).mockResolvedValue({
    rows: PRE_CLOSING_ROWS,
    totalDebit: 0,
    totalCredit: 0,
    isBalanced: true,
  })
})

describe('generateNEDeclaration: closed fiscal year', () => {
  it('requests the pre-closing trial balance', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await generateNEDeclaration(makeSupabase() as any, COMPANY_ID, PERIOD_ID)

    expect(vi.mocked(generateTrialBalance)).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_ID,
      PERIOD_ID,
      { closingEntry: 'exclude-final' },
    )
  })

  it('reports the year the resultatavslut would have zeroed', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await generateNEDeclaration(makeSupabase() as any, COMPANY_ID, PERIOD_ID)

    expect(result.rutor.R1).toBe(400_000)
    expect(result.rutor.R6).toBe(150_000)
    expect(result.rutor.R11).toBe(250_000)
    expect(result.warnings.some((w) => w.includes('Inga bokförda intäkter'))).toBe(false)
  })
})

describe('generateNEDeclaration: nothing on the income statement is dropped silently', () => {
  it('puts 6991 and 7960 in R6 and warns about result accounts without a ruta', async () => {
    // bok.dalavs.se 2024: 7960 kursförluster 2 052,08 fell out of R6, so the app
    // showed R11 -68 069 while the books (and the filed NE) said -70 121.
    vi.mocked(generateTrialBalance).mockResolvedValue({
      rows: [
        row('1930', 'Företagskonto', 0),
        row('3231', 'Försäljning omvänd byggmoms', -375_454.1),
        row('5120', 'El', 64_155.44),
        row('6991', 'Inkassoavgifter', 3_420),
        row('7960', 'Valutakursförluster', 2_052.08),
        row('8020', 'Utdelning på andelar', -500),
      ],
      totalDebit: 0,
      totalCredit: 0,
      isBalanced: true,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await generateNEDeclaration(makeSupabase() as any, COMPANY_ID, PERIOD_ID)

    expect(result.rutor.R6).toBe(69_628)
    expect(result.rutor.R11).toBe(375_454 - 69_628)
    expect(result.breakdown.R6.accounts.map((a) => a.accountNumber)).toEqual(['5120', '6991', '7960'])
    const unmappedWarning = result.warnings.find((w) => w.includes('utan NE-ruta'))
    expect(unmappedWarning).toContain('8020 (-500 kr)')
    expect(unmappedWarning).not.toContain('7960')
  })
})
