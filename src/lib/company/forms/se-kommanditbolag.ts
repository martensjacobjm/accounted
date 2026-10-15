import type { LegalFormProfile } from './types'

/**
 * Kommanditbolag: a partnership (lag (1980:1102) om handelsbolag och enkla
 * bolag) with at least one komplementär and one kommanditdelägare. The bolag
 * is not an income tax subject: each delägare is taxed for their share of the
 * result (INK4 for the bolag, N3A/N3B for the delägare), so the year-end books
 * no tax and no corporate dispositions.
 *
 * The profile assumes every delägare is a fysisk person, which is the common
 * case and the one the product supports:
 * - BFL 3 kap 1 §: a handelsbolag where a fysisk person is taxed for part of
 *   the income has the calendar year as its räkenskapsår.
 * - BFL 6 kap 1 §: with a juridisk person as delägare the bolag must prepare
 *   an årsredovisning, which the product does not offer this form.
 * - BFN: a handelsbolag (kommanditbolag included) with only fysiska delägare
 *   closes with an årsbokslut under BFNAR 2017:3 (K2), or K3.
 *
 * Equity follows the BAS 2010-2049 delägare groups: uttag 2013, insättningar
 * 2018, årets resultat 2019, carried to 2010 at the next year start. The
 * product books the whole result on delägare 1; splitting it per the
 * bolagsavtal (e.g. 2029 delägare 2) is a manual entry until it is modelled.
 * INK4 is not modelled, so `incomeReturn` stays null.
 */
export const SE_KOMMANDITBOLAG: LegalFormProfile = {
  jurisdiction: 'SE',
  code: 'kommanditbolag',
  label: 'Kommanditbolag',
  creationFlag: 'NEXT_PUBLIC_KOMMANDITBOLAG_ENABLED',
  identity: { orgId: 'organisationsnummer' },
  fiscalYear: { calendarOnly: true },
  bookkeeping: {
    defaultMethod: 'accrual',
    // BFNAR 2017:3 (årsbokslut, K2 rules).
    simplifiedRegelverk: 'K2',
    templateColumn: 'base',
  },
  equity: {
    closing: '2019',
    closingName: 'Årets resultat, delägare 1',
    priorYearCarry: '2010',
    hasOwners: true,
    settlement: { withdrawal: '2013', contribution: '2018' },
  },
  filings: {
    incomeReturn: null,
    booksCurrentTax: false,
    corporateTaxDispositions: false,
    arsredovisning: false,
    frameworks: ['K2', 'K3'],
  },
  glossary: { entity: 'bolaget', owner: 'Delägare', meeting: null },
}
