import { getBranding } from '@/lib/branding/service'
import { sruAmount as formatAmount, sruDate as formatDate, sruTime as formatTime } from '@/lib/reports/sru/format'
import type { NEBalansposter, NEDeclaration, NEDeclarationRutor, SRUSubmission } from '@/lib/reports/ne-bilaga/types'

/**
 * SRU File Generator for NE-bilaga (enskild näringsidkare)
 *
 * Generates a Skatteverket-compliant SRU submission consisting of two files:
 *   - INFO.SRU:       submitter metadata (who is filing)
 *   - BLANKETTER.SRU: a single NE blankett block with the räkenskapsschema rutor
 *
 * The NE-bilaga is an appendix to Inkomstdeklaration 1 (INK1) filed by a physical
 * person, so the identifier is the owner's PERSONNUMMER (12-digit YYYYMMDDNNNN):
 * NOT a juridisk-person org number with the "16" century prefix used by INK2.
 *
 * Encoding: ISO 8859-1 (applied by the API route via encodeISO88591).
 * Line endings: CRLF. Amounts: integers in hela kronor (öre truncated per SFL 22:1).
 *
 * Field codes are Skatteverket's own fältnamnstabell for NE, file
 * NE_SKV2161-13-02-25-02.xls in "Ändringar från och med 2025P4" (skatteverket.se,
 * Teknisk information om filöverföring), cross-checked with BAS kopplingstabell
 * NE_K1 (bas.se/kontoplaner/sru/):
 *   B1 7200 · B2 7210 · B3 7211 · B4 7212 · B5 7213 · B6 7240 · B7 7250 ·
 *   B8 7260 · B9 7280 · B10 7300 · B11 7320 · B12 7330 · B13 7380 · B14 7381 ·
 *   B15 7382 · B16 7383
 *   R1 7400 · R2 7401 · R3 7402 · R4 7403 · R5 7500 · R6 7501 · R7 7502 ·
 *   R8 7503 · R9 7504 · R10 7505 · R11 7440 · R12 7600 (= R11, sidan 2).
 * Period dates: 7011 (start) / 7012 (end). No #UPPGIFT is mandatory in the table;
 * every amount is Numeriskt_A (signed integer). Teckenkonvention: R5-R10 carry a
 * preprinted "-" and are reported as positive amounts, B-posts and R11/R12 have no
 * preprinted sign and are reported with their own sign.
 *
 * Skatteverket's e-tjänst Inkomstdeklaration 1 imports the single file
 * blanketter.sru (NE only); the INFO.SRU + BLANKETTER.SRU zip is for the separate
 * e-tjänst Filöverföring. Uploading the zip to the NE import is rejected with
 * "Filen ... innehåller fel" (bok.dalavs.se, 2026-09-10).
 */

/** Filename Skatteverket's NE import instruction tells the user to pick. */
export const BLANKETTER_FILENAME = 'blanketter.sru'

const CRLF = '\r\n'
const PROGRAM_VERSION = '1.0'

/** Räkenskapsårets start-/slutdatum (standard period date fält, shared across blanketter). */
const FISCAL_START_CODE = '7011'
const FISCAL_END_CODE = '7012'

/** Authoritative NE-bilaga räkenskapsschema field codes (BAS kopplingstabell NE_EJ_K1). */
const NE_SRU_FIELD_CODES: Record<keyof NEDeclarationRutor, string> = {
  R1: '7400', // Försäljning och utfört arbete samt övriga momspliktiga intäkter
  R2: '7401', // Momsfria intäkter
  R3: '7402', // Bil- och bostadsförmån m.m.
  R4: '7403', // Ränteintäkter m.m.
  R5: '7500', // Varor och legoarbeten
  R6: '7501', // Övriga externa kostnader
  R7: '7502', // Anställd personal
  R8: '7503', // Räntekostnader m.m.
  R9: '7504', // Avskrivningar och nedskrivningar byggnader och markanläggningar
  R10: '7505', // Avskrivningar och nedskrivningar maskiner/inventarier/immateriella tillgångar
  R11: '7440', // Bokfört resultat
}

/** R12 "Bokfört resultat (förs över från R11 sidan 1)": same amount as R11. */
const R12_FIELD_CODE = '7600'

/** Balansposter B1-B16 (NE sidan 1, räkenskapsschema). */
const NE_SRU_BALANCE_CODES: Record<keyof NEBalansposter, string> = {
  B1: '7200', // Immateriella anläggningstillgångar
  B2: '7210', // Byggnader och markanläggningar
  B3: '7211', // Mark och andra tillgångar som inte får skrivas av
  B4: '7212', // Maskiner och inventarier
  B5: '7213', // Övriga anläggningstillgångar
  B6: '7240', // Varulager
  B7: '7250', // Kundfordringar
  B8: '7260', // Övriga fordringar
  B9: '7280', // Kassa och bank
  B10: '7300', // Eget kapital (tillgångar - skulder)
  B11: '7320', // Obeskattade reserver
  B12: '7330', // Avsättningar
  B13: '7380', // Låneskulder
  B14: '7381', // Skatteskulder
  B15: '7382', // Leverantörsskulder
  B16: '7383', // Övriga skulder
}

/**
 * Compute the period suffix for the blankett type string, from the month the
 * fiscal year ENDS in. Enskild firma is almost always calendar-year (-> P4).
 *   P1 = Jan-Apr, P2 = May-Aug, P4 = Sep-Dec. P3 (short first year) is handled manually.
 */
function computePeriodSuffix(fiscalYearEnd: string): string {
  const endMonth = parseInt(fiscalYearEnd.substring(5, 7), 10)
  if (endMonth >= 1 && endMonth <= 4) return 'P1'
  if (endMonth >= 5 && endMonth <= 8) return 'P2'
  return 'P4'
}

/** The income year (inkomstår) is the year the fiscal year ends. */
function getIncomeYear(fiscalYearEnd: string): string {
  return fiscalYearEnd.substring(0, 4)
}

/**
 * Normalize an enskild firma identity (personnummer) to 12 digits YYYYMMDDNNNN.
 * Unlike INK2's juridisk-person formatter, this does NOT prepend "16": for a
 * physical person the century is the birth century.
 *
 * For a 10-digit number (YYMMDDNNNN) the century is inferred from age: a NE-bilaga
 * filer is an adult, so we pick the century that yields a plausible adult age
 * (≥18, <110) at the income year, preferring 1900s. This avoids mapping e.g. a
 * 1924-born filer for income year 2024 (yy=24) to 2024. (Skatteverket's '-'/'+'
 * century separator is lost once non-digits are stripped, so age is used instead.)
 *
 * Returns the all-zero placeholder for missing/unexpected input; callers validate
 * the result and surface a generation error rather than shipping an invalid file.
 */
function formatIdentityNumber12(raw: string | null, incomeYear: number): string {
  const digits = (raw || '').replace(/\D/g, '')
  if (digits.length === 12) return digits
  if (digits.length === 10) {
    const yy = parseInt(digits.substring(0, 2), 10)
    const ageIf2000s = incomeYear - (2000 + yy)
    const century = ageIf2000s >= 18 && ageIf2000s < 110 ? '20' : '19'
    return `${century}${digits}`
  }
  return '000000000000'
}

/** Convert a YYYY-MM-DD string to SRU date format YYYYMMDD. */
function dateStringToSRU(dateStr: string): string {
  return dateStr.replace(/-/g, '')
}

/** Sanitize string for SRU: '#' is reserved, strip newlines, cap at 250 chars (STR_250). */
function sanitizeString(str: string): string {
  return str.replace(/#/g, '').replace(/[\r\n]/g, ' ').substring(0, 250)
}

/** Generate the INFO.SRU file content (submitter metadata). */
function generateInfoSru(declaration: NEDeclaration, now: Date, identity12: string): string {
  const lines: string[] = []

  // DATABESKRIVNING block (required order)
  lines.push('#DATABESKRIVNING_START')
  lines.push('#PRODUKT SRU')
  lines.push(`#SKAPAD ${formatDate(now)} ${formatTime(now)}`)
  lines.push(`#PROGRAM ${sanitizeString(getBranding().appName.toLowerCase())} ${PROGRAM_VERSION}`)
  lines.push('#FILNAMN BLANKETTER.SRU')
  lines.push('#DATABESKRIVNING_SLUT')

  // MEDIELEV block (mandatory: ORGNR, NAMN, POSTNR, POSTORT)
  lines.push('#MEDIELEV_START')
  lines.push(`#ORGNR ${identity12}`)
  lines.push(`#NAMN ${sanitizeString(declaration.companyInfo.companyName)}`)
  if (declaration.companyInfo.addressLine1) {
    lines.push(`#ADRESS ${sanitizeString(declaration.companyInfo.addressLine1)}`)
  }
  lines.push(`#POSTNR ${(declaration.companyInfo.postalCode || '00000').replace(/\s/g, '')}`)
  lines.push(`#POSTORT ${sanitizeString(declaration.companyInfo.city || 'Okänd')}`)
  if (declaration.companyInfo.email) {
    lines.push(`#EMAIL ${sanitizeString(declaration.companyInfo.email)}`)
  }
  lines.push('#MEDIELEV_SLUT')

  return lines.join(CRLF) + CRLF
}

/** Generate the BLANKETTER.SRU file content (a single NE blankett block). */
function generateBlanketterSru(declaration: NEDeclaration, now: Date, identity12: string): string {
  const lines: string[] = []
  const incomeYearStr = getIncomeYear(declaration.fiscalYear.end)
  const periodSuffix = computePeriodSuffix(declaration.fiscalYear.end)
  const taxpayerName = sanitizeString(declaration.companyInfo.companyName)

  lines.push(`#BLANKETT NE-${incomeYearStr}${periodSuffix}`)
  lines.push(`#IDENTITET ${identity12} ${formatDate(now)} ${formatTime(now)}`)
  lines.push(`#NAMN ${taxpayerName}`)

  // Räkenskapsårets datum
  lines.push(`#UPPGIFT ${FISCAL_START_CODE} ${dateStringToSRU(declaration.fiscalYear.start)}`)
  lines.push(`#UPPGIFT ${FISCAL_END_CODE} ${dateStringToSRU(declaration.fiscalYear.end)}`)

  // Balansposter B1-B16, then R1-R11 and R12: emit non-zero values only (a
  // post without a value must be omitted, per Skatteverket's filposter rule).
  const balansOrder: (keyof NEBalansposter)[] = [
    'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12', 'B13', 'B14', 'B15', 'B16',
  ]
  for (const post of balansOrder) {
    const value = declaration.balans?.[post] ?? 0
    if (value !== 0) {
      lines.push(`#UPPGIFT ${NE_SRU_BALANCE_CODES[post]} ${formatAmount(value)}`)
    }
  }

  const rutaOrder: (keyof NEDeclarationRutor)[] = [
    'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11',
  ]
  for (const ruta of rutaOrder) {
    const value = declaration.rutor[ruta]
    if (value !== 0) {
      lines.push(`#UPPGIFT ${NE_SRU_FIELD_CODES[ruta]} ${formatAmount(value)}`)
    }
  }
  if (declaration.rutor.R11 !== 0) {
    lines.push(`#UPPGIFT ${R12_FIELD_CODE} ${formatAmount(declaration.rutor.R11)}`)
  }

  lines.push('#BLANKETTSLUT')
  lines.push('#FIL_SLUT')

  return lines.join(CRLF) + CRLF
}

/** Generate a complete SRU submission (INFO.SRU + BLANKETTER.SRU) for the NE-bilaga. */
export function generateNESRUSubmission(declaration: NEDeclaration): SRUSubmission {
  const now = new Date()
  const incomeYear = parseInt(getIncomeYear(declaration.fiscalYear.end), 10)
  const identity12 = formatIdentityNumber12(declaration.companyInfo.orgNumber, incomeYear)

  // A valid NE filing requires the owner's personnummer. Refuse rather than ship a
  // structurally well-formed file with a placeholder #IDENTITET that Skatteverket
  // would reject at upload: surface it as a generation error the route can show.
  if (!/^\d{12}$/.test(identity12) || identity12 === '000000000000') {
    throw new Error(
      'NE-bilagan kräver ett giltigt personnummer (ÅÅÅÅMMDDNNNN) för den enskilda näringsidkaren. ' +
        'Komplettera personnumret i företagsinställningarna innan du laddar ner SRU-filen.',
    )
  }

  return {
    infoSru: generateInfoSru(declaration, now, identity12),
    blanketterSru: generateBlanketterSru(declaration, now, identity12),
    generatedAt: now.toISOString(),
  }
}

/** Validate the generated BLANKETTER.SRU content for the mandatory NE structure. */
export function validateBlanketterSru(content: string): {
  isValid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (!/^#BLANKETT NE-/m.test(content)) errors.push('Missing #BLANKETT NE- block')
  if (!/^#IDENTITET /m.test(content)) errors.push('Missing #IDENTITET')
  if (!/^#NAMN /m.test(content)) errors.push('Missing #NAMN')
  // Räkenskapsårets datum are mandatory for income declarations; their absence is
  // a level-2 rejection at Skatteverket, so catch it in the pre-flight.
  if (!new RegExp(`^#UPPGIFT ${FISCAL_START_CODE} `, 'm').test(content)) {
    errors.push(`Missing #UPPGIFT ${FISCAL_START_CODE} (räkenskapsårets början)`)
  }
  if (!new RegExp(`^#UPPGIFT ${FISCAL_END_CODE} `, 'm').test(content)) {
    errors.push(`Missing #UPPGIFT ${FISCAL_END_CODE} (räkenskapsårets slut)`)
  }
  if (!/^#FIL_SLUT/m.test(content)) errors.push('Missing #FIL_SLUT terminator')

  const blankettslutCount = (content.match(/^#BLANKETTSLUT/gm) || []).length
  if (blankettslutCount !== 1) {
    errors.push(`Expected 1 #BLANKETTSLUT, found ${blankettslutCount}`)
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}

/** Get the ZIP filename for download. Uses the income year (fiscal year END) so the
 * filename matches the blankett type/identity for broken fiscal years. */
export function getZipFilename(declaration: NEDeclaration): string {
  const year = getIncomeYear(declaration.fiscalYear.end)
  const orgNumber = declaration.companyInfo.orgNumber?.replace(/\D/g, '') || 'unknown'
  return `NE_SRU_${orgNumber}_${year}.zip`
}
