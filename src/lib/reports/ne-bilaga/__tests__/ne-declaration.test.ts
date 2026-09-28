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

describe('generateNEDeclaration: balansposter B1-B16', () => {
  it('fills B1-B16 from class 1-2 and derives B10 as tillgångar minus skulder', async () => {
    // Shape of bok.dalavs.se 2025 after bokslut: the result is already in 2019/2099
    // (excluded), so B10 must come from the balance, not from the 20xx accounts.
    vi.mocked(generateTrialBalance).mockResolvedValue({
      rows: [
        row('1220', 'Inventarier', 188_860.81),
        row('1229', 'Ack avskrivningar inventarier', -24_241.81),
        row('1310', 'Andelar i koncernföretag', 1_700),
        row('1650', 'Momsfordran', 5_332.4),
        row('1930', 'Företagskonto', 88_140.2),
        row('2013', 'Egna uttag', 40_000),
        row('2099', 'Årets resultat', 50_000),
        row('2330', 'Checkräkningskredit', -50_000),
        row('2440', 'Leverantörsskulder', -2_499.6),
        row('2710', 'Personalskatt', -748),
        row('2893', 'Skulder till närstående', -10_000),
        row('3001', 'Försäljning', -149_000),
        row('5010', 'Lokalhyra', 42_454),
      ],
      totalDebit: 0,
      totalCredit: 0,
      isBalanced: true,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await generateNEDeclaration(makeSupabase() as any, COMPANY_ID, PERIOD_ID)

    expect(result.balans.B4).toBe(164_619)
    expect(result.balans.B5).toBe(1_700)
    expect(result.balans.B8).toBe(5_332)
    expect(result.balans.B9).toBe(88_140)
    expect(result.balans.B13).toBe(50_000)
    expect(result.balans.B14).toBe(748)
    expect(result.balans.B15).toBe(2_500)
    expect(result.balans.B16).toBe(10_000)
    expect(result.balans.B1).toBe(0)
    expect(result.balans.B11).toBe(0)
    // B10 = (164 619 + 1 700 + 5 332 + 88 140) - (50 000 + 748 + 2 500 + 10 000)
    expect(result.balans.B10).toBe(259_791 - 63_248)
    expect(result.balansBreakdown.B4.accounts.map((a) => a.accountNumber)).toEqual(['1220', '1229'])
    expect(result.balansBreakdown.B4.accounts.map((a) => a.amount)).toEqual([188_861, -24_242])
    expect(result.balansBreakdown.B15.accounts[0].amount).toBe(2_500)
    expect(result.warnings.some((w) => w.includes('utan NE-post'))).toBe(false)
  })

  it('warns about balance accounts outside B1-B16 but stays silent on 20xx', async () => {
    vi.mocked(generateTrialBalance).mockResolvedValue({
      rows: [
        row('1810', 'Kortfristiga placeringar', 12_000),
        row('1930', 'Företagskonto', 1_000),
        row('2019', 'Omföring föregående år', -13_000),
        row('3001', 'Försäljning', -100),
        row('5010', 'Lokalhyra', 100),
      ],
      totalDebit: 0,
      totalCredit: 0,
      isBalanced: true,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await generateNEDeclaration(makeSupabase() as any, COMPANY_ID, PERIOD_ID)

    const warning = result.warnings.find((w) => w.includes('utan NE-post'))
    expect(warning).toContain('1810 (12000 kr)')
    expect(warning).not.toContain('2019')
    expect(result.balans.B9).toBe(1_000)
    expect(result.balans.B10).toBe(1_000)
  })
})
