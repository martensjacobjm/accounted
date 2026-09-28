// NE-bilaga rutor (NE appendix boxes)
export interface NEDeclarationRutor {
  R1: number   // Försäljning med 25% moms (3000-3499 excl 3100)
  R2: number   // Momsfria intäkter (3100, 3970, 3980)
  R3: number   // Bil/bostadsförmån (3200)
  R4: number   // Ränteintäkter (8310-8330)
  R5: number   // Varuinköp (4000-4990)
  R6: number   // Övriga kostnader (5000-6999, 7900-7999)
  R7: number   // Lönekostnader (7000-7699)
  R8: number   // Räntekostnader (8400-8499)
  R9: number   // Avskrivningar fastighet (7820)
  R10: number  // Avskrivningar övrigt (7700-7899 excl 7820)
  R11: number  // Årets resultat (beräknat)
}

// NE-bilaga balansposter B1-B16 (sidan 1, förenklat årsbokslut). Fältkoder och
// kontokopplingar: Skatteverkets fältnamnstabell NE_SKV2161-13-02-25-02 (2025P4)
// och BAS kopplingstabell "NE - Enskilda näringsidkare, förenklat årsbokslut".
export interface NEBalansposter {
  B1: number   // Immateriella anläggningstillgångar (1000-1099)
  B2: number   // Byggnader och markanläggningar (1100-1129, 1140-1179, 1190-1199)
  B3: number   // Mark och andra tillgångar som inte får skrivas av (1130-1139, 1180-1189)
  B4: number   // Maskiner och inventarier (1200-1299)
  B5: number   // Övriga anläggningstillgångar (1300-1399)
  B6: number   // Varulager (1400-1499)
  B7: number   // Kundfordringar (1500-1599)
  B8: number   // Övriga fordringar (1600-1799)
  B9: number   // Kassa och bank (1900-1999)
  B10: number  // Eget kapital = tillgångar minus skulder (beräknat, inte ur 20xx)
  B11: number  // Obeskattade reserver (2100-2199)
  B12: number  // Avsättningar (2200-2299)
  B13: number  // Låneskulder (2300-2399)
  B14: number  // Skatteskulder inkl. moms och personalskatt (2500-2799)
  B15: number  // Leverantörsskulder (2440-2449)
  B16: number  // Övriga skulder (2400-2439, 2450-2499, 2800-2999)
}

export interface NEAccountRange {
  start: string
  end: string
  exclude?: string[]
}

// Balance mapping configuration (B10 is derived, so it has no mapping)
export interface NEBalanceMapping {
  post: Exclude<keyof NEBalansposter, 'B10'>
  description: string
  accountRanges: NEAccountRange[]
  isDebitNormal: boolean  // true = tillgång (debetsaldo), false = skuld (kreditsaldo)
}

// Per-post breakdown of the accounts behind a ruta or balanspost
export interface NEPostBreakdown {
  accounts: Array<{
    accountNumber: string
    accountName: string
    amount: number
  }>
  total: number
}

// NE account mapping configuration
export interface NEAccountMapping {
  ruta: keyof NEDeclarationRutor
  description: string
  accountRanges: Array<{
    start: string
    end: string
    exclude?: string[]
  }>
  isExpense: boolean  // true = debit normal, false = credit normal
}

// NE declaration response
export interface NEDeclaration {
  fiscalYear: {
    id: string
    name: string
    start: string
    end: string
    isClosed: boolean
  }
  rutor: NEDeclarationRutor
  // Detailed breakdown per ruta
  breakdown: Record<keyof NEDeclarationRutor, NEPostBreakdown>
  // Balansposter B1-B16 (sidan 1) med breakdown per konto
  balans: NEBalansposter
  balansBreakdown: Record<keyof NEBalansposter, NEPostBreakdown>
  // Company info for SRU (orgNumber for enskild firma is the owner's personnummer)
  companyInfo: {
    companyName: string
    orgNumber: string | null
    addressLine1: string | null
    postalCode: string | null
    city: string | null
    email: string | null
  }
  // Warnings
  warnings: string[]
}

// A complete SRU submission: two files (INFO.SRU + BLANKETTER.SRU), ISO 8859-1 encoded by the route.
export interface SRUSubmission {
  infoSru: string
  blanketterSru: string
  generatedAt: string
}

