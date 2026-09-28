import type { SupabaseClient } from '@supabase/supabase-js'
import { generateTrialBalance } from '@/lib/reports/trial-balance'
import type { FiscalPeriod } from '@/types'
import type {
  NEAccountMapping,
  NEAccountRange,
  NEBalanceMapping,
  NEBalansposter,
  NEDeclaration,
  NEDeclarationRutor,
  NEPostBreakdown,
} from './types'

/**
 * NE-bilaga (Enskild Firma / Sole Proprietorship Declaration)
 *
 * Maps BAS account balances to NE declaration rutor (R1-R11) for
 * tax reporting to Skatteverket.
 *
 * Account mappings:
 * R1:  Försäljning med moms (3000-3599 excl 3100, 3700-3799)
 * R2:  Momsfria intäkter (3100, 3900-3969, 3970-3980, 3981-3999) - inkl gåvor utan motprestation
 * R3:  Bil/bostadsförmån (3200)
 * R4:  Ränteintäkter (8310-8330)
 * R5:  Varuinköp (4000-4990)
 * R6:  Övriga kostnader (5000-6999, 7900-7999) - inkl avdragsgilla gåvor (5460)
 * R7:  Lönekostnader (7000-7699)
 * R8:  Räntekostnader (8400-8499)
 * R9:  Avskrivningar fastighet (7820)
 * R10: Avskrivningar övrigt (7700-7899 excl 7820)
 * R11: Årets resultat (calculated)
 *
 * Balansposter B1-B16 (NE_BALANCE_MAPPINGS): closing balances of class 1-2 per
 * BAS kopplingstabell NE (förenklat årsbokslut); B10 eget kapital is derived as
 * tillgångar minus skulder, so the 20xx accounts and the result transfer never
 * enter the form. Fältkoder: Skatteverket NE_SKV2161-13-02-25-02 (2025P4).
 *
 * Gift handling:
 * - Gåvor MED motprestation: R1 (momspliktig bytestransaktion)
 * - Gåvor UTAN motprestation: R2 via konto 3900
 * - Avdragsgilla gåvor: R6 via konto 5460
 */

/**
 * Account mapping configuration for NE declaration
 */
export const NE_ACCOUNT_MAPPINGS: NEAccountMapping[] = [
  {
    ruta: 'R1',
    description: 'Försäljning med moms (25%)',
    accountRanges: [
      { start: '3000', end: '3599', exclude: ['3100'] },
      { start: '3700', end: '3799' },
    ],
    isExpense: false,
  },
  {
    ruta: 'R2',
    description: 'Momsfria intäkter',
    accountRanges: [
      { start: '3100', end: '3100' },
      { start: '3900', end: '3969' }, // Övriga rörelseintäkter (inkl gåvor utan motprestation)
      { start: '3970', end: '3980' },
      { start: '3981', end: '3999' },
    ],
    isExpense: false,
  },
  {
    ruta: 'R3',
    description: 'Bil/bostadsförmån',
    accountRanges: [
      { start: '3200', end: '3299' },
    ],
    isExpense: false,
  },
  {
    ruta: 'R4',
    description: 'Ränteintäkter',
    accountRanges: [
      { start: '8310', end: '8330' },
    ],
    isExpense: false,
  },
  {
    ruta: 'R5',
    description: 'Varuinköp',
    accountRanges: [
      { start: '4000', end: '4990' },
    ],
    isExpense: true,
  },
  {
    ruta: 'R6',
    description: 'Övriga kostnader',
    // Hela klass 5-6 (6991-6999 är underkonton till 6990) och hela klass 79
    // (övriga rörelsekostnader: 7960 kursförluster på rörelseskulder, 797x
    // förlust vid avyttring, 7990 övrigt). Intervallet 5000-6990 + 7970 tappade
    // 6991 och 7960 utan varning, så R11 blev fel (bok.dalavs.se 2024, 2025).
    accountRanges: [
      { start: '5000', end: '6999' },
      { start: '7900', end: '7999' },
    ],
    isExpense: true,
  },
  {
    ruta: 'R7',
    description: 'Lönekostnader',
    accountRanges: [
      { start: '7000', end: '7699' },
    ],
    isExpense: true,
  },
  {
    ruta: 'R8',
    description: 'Räntekostnader',
    accountRanges: [
      { start: '8400', end: '8499' },
    ],
    isExpense: true,
  },
  {
    ruta: 'R9',
    description: 'Avskrivningar fastighet',
    accountRanges: [
      { start: '7820', end: '7820' },
    ],
    isExpense: true,
  },
  {
    ruta: 'R10',
    description: 'Avskrivningar övrigt',
    accountRanges: [
      { start: '7700', end: '7899', exclude: ['7820'] },
    ],
    isExpense: true,
  },
]

/**
 * Resultatkonton (klass 3-8) utom 89xx (årets resultat och skatt), som
 * medvetet inte hör hemma i R1-R11.
 */
export function isResultAccount(accountNumber: string): boolean {
  return accountNumber >= '3000' && accountNumber <= '8899'
}

/**
 * Balansposter B1-B16 per BAS kopplingstabell "NE - Enskilda näringsidkare,
 * förenklat årsbokslut" (bas.se/kontoplaner/sru, NE_K1). Eget kapital (B10)
 * har ingen mappning: det beräknas som tillgångar minus skulder.
 */
export const NE_BALANCE_MAPPINGS: NEBalanceMapping[] = [
  { post: 'B1', description: 'Immateriella anläggningstillgångar', accountRanges: [{ start: '1000', end: '1099' }], isDebitNormal: true },
  {
    post: 'B2',
    description: 'Byggnader och markanläggningar',
    accountRanges: [{ start: '1100', end: '1129' }, { start: '1140', end: '1179' }, { start: '1190', end: '1199' }],
    isDebitNormal: true,
  },
  {
    post: 'B3',
    description: 'Mark och andra tillgångar som inte får skrivas av',
    accountRanges: [{ start: '1130', end: '1139' }, { start: '1180', end: '1189' }],
    isDebitNormal: true,
  },
  { post: 'B4', description: 'Maskiner och inventarier', accountRanges: [{ start: '1200', end: '1299' }], isDebitNormal: true },
  { post: 'B5', description: 'Övriga anläggningstillgångar', accountRanges: [{ start: '1300', end: '1399' }], isDebitNormal: true },
  { post: 'B6', description: 'Varulager', accountRanges: [{ start: '1400', end: '1499' }], isDebitNormal: true },
  { post: 'B7', description: 'Kundfordringar', accountRanges: [{ start: '1500', end: '1599' }], isDebitNormal: true },
  { post: 'B8', description: 'Övriga fordringar', accountRanges: [{ start: '1600', end: '1799' }], isDebitNormal: true },
  { post: 'B9', description: 'Kassa och bank', accountRanges: [{ start: '1900', end: '1999' }], isDebitNormal: true },
  { post: 'B11', description: 'Obeskattade reserver', accountRanges: [{ start: '2100', end: '2199' }], isDebitNormal: false },
  { post: 'B12', description: 'Avsättningar', accountRanges: [{ start: '2200', end: '2299' }], isDebitNormal: false },
  { post: 'B13', description: 'Låneskulder', accountRanges: [{ start: '2300', end: '2399' }], isDebitNormal: false },
  { post: 'B14', description: 'Skatteskulder', accountRanges: [{ start: '2500', end: '2799' }], isDebitNormal: false },
  { post: 'B15', description: 'Leverantörsskulder', accountRanges: [{ start: '2440', end: '2449' }], isDebitNormal: false },
  {
    post: 'B16',
    description: 'Övriga skulder',
    accountRanges: [{ start: '2400', end: '2439' }, { start: '2450', end: '2499' }, { start: '2800', end: '2999' }],
    isDebitNormal: false,
  },
]

const NE_BALANS_KEYS: (keyof NEBalansposter)[] = [
  'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12', 'B13', 'B14', 'B15', 'B16',
]
const NE_RUTA_KEYS: (keyof NEDeclarationRutor)[] = [
  'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11',
]

/**
 * Balanskonton (klass 1-2) utom eget kapital 20xx, som medvetet saknar
 * NE-post: B10 beräknas som tillgångar minus skulder.
 */
export function isBalanceAccount(accountNumber: string): boolean {
  if (accountNumber >= '2000' && accountNumber <= '2099') return false
  return accountNumber >= '1000' && accountNumber <= '2999'
}

/**
 * Check if an account number falls within a mapping's ranges
 */
function isAccountInRanges(accountNumber: string, ranges: NEAccountRange[]): boolean {
  for (const range of ranges) {
    if (accountNumber >= range.start && accountNumber <= range.end) {
      // Check exclusions
      if (range.exclude && range.exclude.includes(accountNumber)) {
        continue
      }
      return true
    }
  }
  return false
}

interface UnmatchedAccount {
  accountNumber: string
  balance: number
}

/**
 * Sum account balances into posts by the first matching mapping. Debit-normal
 * posts keep the net balance (debit minus credit), credit-normal posts negate
 * it, so every post reads as a positive amount in its natural direction.
 * Accounts with a balance that match no mapping come back as `unmatched`; the
 * caller decides which of them deserve a warning. Shared by R1-R10 and B1-B16
 * so the two tables can never drift in how they treat sign or rounding.
 */
function sumAccountsByMapping<K extends string>(
  mappings: ReadonlyArray<{ key: K; accountRanges: NEAccountRange[]; isDebitNormal: boolean }>,
  keys: readonly K[],
  accountBalances: Map<string, number>,
  accountNameMap: Map<string, string>,
): { totals: Record<K, number>; breakdown: Record<K, NEPostBreakdown>; unmatched: UnmatchedAccount[] } {
  const totals = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>
  const breakdown = Object.fromEntries(
    keys.map((k) => [k, { accounts: [], total: 0 }]),
  ) as Record<K, NEPostBreakdown>
  const unmatched: UnmatchedAccount[] = []

  for (const [accountNumber, balance] of accountBalances) {
    if (Math.abs(balance) < 0.01) continue
    const mapping = mappings.find((m) => isAccountInRanges(accountNumber, m.accountRanges))
    if (!mapping) {
      unmatched.push({ accountNumber, balance })
      continue
    }
    const amount = mapping.isDebitNormal ? balance : -balance
    totals[mapping.key] += amount
    breakdown[mapping.key].accounts.push({
      accountNumber,
      accountName: accountNameMap.get(accountNumber) || `Konto ${accountNumber}`,
      amount: roundToKrona(amount),
    })
  }

  for (const key of keys) {
    totals[key] = roundToKrona(totals[key])
    breakdown[key].total = totals[key]
  }
  return { totals, breakdown, unmatched }
}

function formatUnmatched(accounts: UnmatchedAccount[]): string {
  return accounts.map((a) => `${a.accountNumber} (${roundToKrona(a.balance)} kr)`).join(', ')
}

/**
 * Round to nearest krona (whole number) for NE declaration
 */
function roundToKrona(value: number): number {
  return Math.round(value)
}

/**
 * Generate NE declaration for a fiscal period
 */
export async function generateNEDeclaration(
  supabase: SupabaseClient,
  companyId: string,
  fiscalPeriodId: string
): Promise<NEDeclaration> {

  // Fetch fiscal period
  const { data: period, error: periodError } = await supabase
    .from('fiscal_periods')
    .select('*')
    .eq('id', fiscalPeriodId)
    .eq('company_id', companyId)
    .single()

  if (periodError || !period) {
    throw new Error('Fiscal period not found')
  }

  // Fetch company settings
  const { data: settings } = await supabase
    .from('company_settings')
    .select('company_name, org_number, entity_type, address_line1, postal_code, city, email')
    .eq('company_id', companyId)
    .single()

  // Resolve entity_type: prefer company_settings, fall back to companies table (NOT NULL, always reliable)
  let entityType = settings?.entity_type
  if (!entityType) {
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('entity_type')
      .eq('id', companyId)
      .single()
    if (companyError) throw new Error(`Failed to resolve entity type: ${companyError.message}`)
    entityType = company?.entity_type
  }

  if (entityType !== 'enskild_firma') {
    throw new Error('NE declaration is only for enskild firma (sole proprietorship)')
  }

  // R1-R11 are an income statement, so read the PRE-CLOSING books. The
  // resultatavslut zeroes every P&L account against 2019/2099 at year-end, and
  // NE-bilaga is always filed after bokslut, so including it would report an
  // empty näringsverksamhet. 'exclude-final' drops only the result transfer
  // into equity (ours, or one booked in the previous system or by hand):
  // avskrivningar and other bokslut entries also carry source_type 'year_end'
  // and belong on the form.
  const trialBalance = await generateTrialBalance(supabase, companyId, fiscalPeriodId, {
    closingEntry: 'exclude-final',
  })

  const accountNameMap = new Map<string, string>()
  const accountBalances = new Map<string, number>()
  for (const row of trialBalance.rows) {
    accountNameMap.set(row.account_number, row.account_name)
    accountBalances.set(
      row.account_number,
      (Number(row.closing_debit) || 0) - (Number(row.closing_credit) || 0),
    )
  }

  // Resultaträkning R1-R10 (R11 derived) and balansräkning B1-B16 (B10 derived)
  const resultat = sumAccountsByMapping(
    NE_ACCOUNT_MAPPINGS.map((m) => ({ key: m.ruta, accountRanges: m.accountRanges, isDebitNormal: m.isExpense })),
    NE_RUTA_KEYS,
    accountBalances,
    accountNameMap,
  )
  const rutor = resultat.totals
  const breakdown = resultat.breakdown

  // Calculate R11 (Årets resultat)
  // Result = Revenue (R1+R2+R3+R4) - Expenses (R5+R6+R7+R8+R9+R10)
  const totalRevenue = rutor.R1 + rutor.R2 + rutor.R3 + rutor.R4
  const totalExpenses = rutor.R5 + rutor.R6 + rutor.R7 + rutor.R8 + rutor.R9 + rutor.R10
  rutor.R11 = totalRevenue - totalExpenses
  breakdown.R11.total = rutor.R11

  const balansSum = sumAccountsByMapping(
    NE_BALANCE_MAPPINGS.map((m) => ({ key: m.post, accountRanges: m.accountRanges, isDebitNormal: m.isDebitNormal })),
    NE_BALANS_KEYS,
    accountBalances,
    accountNameMap,
  )
  const balans = balansSum.totals
  const balansBreakdown = balansSum.breakdown

  // B10 Eget kapital = tillgångar (B1-B9) minus skulder (B11-B16). Derived, so it
  // holds whether or not the year's result has been transferred into 20xx.
  const totalAssets = balans.B1 + balans.B2 + balans.B3 + balans.B4 + balans.B5 +
    balans.B6 + balans.B7 + balans.B8 + balans.B9
  const totalLiabilities = balans.B11 + balans.B12 + balans.B13 + balans.B14 + balans.B15 + balans.B16
  balans.B10 = totalAssets - totalLiabilities
  balansBreakdown.B10.total = balans.B10

  const warnings: string[] = []
  const unmappedResult = resultat.unmatched.filter((a) => isResultAccount(a.accountNumber))
  const unmappedBalance = balansSum.unmatched.filter((a) => isBalanceAccount(a.accountNumber))

  // Add warnings
  if (!(period as FiscalPeriod).is_closed) {
    warnings.push('Räkenskapsåret är inte stängt; deklarationen kan genereras, men siffrorna kan ändras om fler bokföringar görs.')
  }

  if (rutor.R11 === 0 && totalRevenue === 0) {
    warnings.push('Inga bokförda intäkter eller kostnader hittades för perioden.')
  }

  if (unmappedResult.length > 0) {
    warnings.push(
      `Resultatkonton utan NE-ruta, ingår inte i R1-R11: ${formatUnmatched(unmappedResult)}. ` +
        'Kontrollera konteringen eller komplettera NE-bilagan för hand.',
    )
  }

  if (unmappedBalance.length > 0) {
    warnings.push(
      `Balanskonton utan NE-post, ingår inte i B1-B16: ${formatUnmatched(unmappedBalance)}. ` +
        'Kontrollera konteringen eller komplettera balansräkningen för hand.',
    )
  }

  return {
    fiscalYear: {
      id: period.id,
      name: period.name,
      start: period.period_start,
      end: period.period_end,
      isClosed: period.is_closed,
    },
    rutor,
    breakdown,
    balans,
    balansBreakdown,
    companyInfo: {
      companyName: settings?.company_name || 'Okänt företag',
      orgNumber: settings?.org_number || null,
      addressLine1: settings?.address_line1 || null,
      postalCode: settings?.postal_code || null,
      city: settings?.city || null,
      email: settings?.email || null,
    },
    warnings,
  }
}
