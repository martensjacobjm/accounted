import { describe, it, expect } from 'vitest'
import { findLeakedAccountNumbers } from '../output-guards'

// The chat rule is account NAMES in replies, numbers only in tool calls and the
// approval card. These cases come from the production replies that broke it
// (6072, 2641, 1511, 1513) plus the four-digit numbers that must pass: amounts,
// years, dates, verifikat and invoice numbers.

const accounts = (text: string) => findLeakedAccountNumbers(text).map((l) => l.account)

describe('findLeakedAccountNumbers: account numbers are caught', () => {
  const cases: Array<[string, string[]]> = [
    ['Jag bokför det på konto 6072.', ['6072']],
    ['Kostnaden hamnar på 6072 Representation, ej avdragsgill.', ['6072']],
    ['Momsen går mot 2641.', ['2641']],
    ['Kundfordran ligger på 1511/1513 tills betalningen kommer.', ['1511', '1513']],
    ['Kontona 1511 och 1513 påverkas.', ['1511', '1513']],
    ['Använd `2641` för ingående moms.', ['2641']],
    ['Representation (6072) är rätt här.', ['6072']],
    ['Debet 2013 och kredit 1930.', ['2013', '1930']],
    ['Kontot 1930 är företagskontot.', ['1930']],
    ['BAS-konto 2614 används för omvänd moms.', ['2614']],
    ['Bokför uttaget som 2013 Övriga egna uttag.', ['2013']],
    ['Lägg det på kontonummer: 5410.', ['5410']],
  ]
  for (const [text, expected] of cases) {
    it(`flags ${expected.join(', ')} in "${text}"`, () => {
      expect(accounts(text)).toEqual(expected)
    })
  }
})

describe('findLeakedAccountNumbers: amounts, years, dates and ids pass', () => {
  const clean = [
    'Beloppet är 6072 kr inklusive moms.',
    'Totalt 1 250 kr, varav moms 250 kr.',
    'Det blir 6072,50 kronor.',
    'Gäller inkomstår 2026.',
    'Räkenskapsåret 2025/2026 slutar i juni.',
    'Fakturan förföll 2026-10-15.',
    'Verifikat A12 och ver 1511 är kopplade.',
    'Se verifikation nr 1511 i serie A.',
    'Faktura 1513 är betald.',
    'Mötet är kl 14:30.',
    'Organisationsnummer 556677-8899.',
    'Sänkt till 6 % från april 2026 (Prop. 2025/26:55).',
    'Från 2026 gäller nya regler.',
    'Enligt SFS 1999:1229 och BAS 2026.',
    'Gränsen är 2000 kr per person och 300 kr exklusive moms.',
    'Ni har 1200 timmar registrerade och 4500 st artiklar.',
    'Sedan 2017 är måltidsrepresentation inte avdragsgill.',
    'Bokför det som Representation, ej avdragsgill, och momsen som Ingående moms.',
  ]
  for (const text of clean) {
    it(`passes "${text}"`, () => {
      expect(accounts(text)).toEqual([])
    })
  }

  it('reports the reason and position for the log line', () => {
    const [leak] = findLeakedAccountNumbers('Momsen går mot 2641.')
    expect(leak).toMatchObject({ account: '2641', reason: 'preposition', index: 15 })
  })
})
