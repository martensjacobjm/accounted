/**
 * Output checks on the assistant's final reply text.
 *
 * The chat rule is: talk in account NAMES, never BAS account numbers. The
 * number belongs in tool-call parameters and in the approval card, where the
 * accountant sees it. Production replies still carried "6072", "2641",
 * "1511/1513". findLeakedAccountNumbers is the detector used by run-turn (a
 * warning in the logs, never a blocked reply) and by the eval suite.
 *
 * A bare four-digit number is not enough: amounts ("6072 kr"), years
 * ("inkomstår 2026", "2025/2026"), dates, times, verifikat and invoice numbers
 * are all four digits too. A number is reported only when its context marks it
 * as an account: an account word right before it ("konto 6072"), inline code
 * (`2641`), a booking verb ("debet 2013"), a capitalised account name right
 * after it ("6072 Representation"), a bracket after a name ("Kassa (1910)"),
 * or a preposition ("mot 2641") outside the year range. A number joined to an
 * already reported account ("1511/1513", "1511 och 1513") is reported too.
 */

export interface AccountNumberLeak {
  account: string
  index: number
  reason: AccountLeakReason
}

export type AccountLeakReason =
  | 'account_word'
  | 'inline_code'
  | 'booking_verb'
  | 'account_name_after'
  | 'bracket_after_name'
  | 'preposition'
  | 'joined'

const BAS_MIN = 1000
const BAS_MAX = 8999
// Years a reply plausibly mentions; inside this range only strong signals count.
const YEAR_MIN = 1900
const YEAR_MAX = 2099
const LOOKBEHIND_CHARS = 40

// JavaScript's \b is ASCII-only even with the u flag, so "år" or "på" never
// start a word for it. These are the Unicode-aware word edges.
const WORD_START = '(?<![\\p{L}\\p{N}])'
const WORD_END = '(?![\\p{L}\\p{N}])'

function wordsBefore(alternatives: string, tail = ''): RegExp {
  return new RegExp(`${WORD_START}(?:${alternatives})${WORD_END}${tail}\\s*$`, 'iu')
}

// Four digits not glued to other digits, letters (A12, SE5566...), decimals,
// dates, times, ranges or identifiers. \u2013 is the en dash of "2025\u20132026".
// A slash is allowed before: "1511/1513" is two accounts, and "2025/2026"
// is handled by the year rules.
const CANDIDATE = /(?<![\p{L}\p{N}.,:\-\u2013])(\d{4})(?![\p{L}\p{N}]|[.,:]\d|[-\u2013]\d)/gu

const UNIT_AFTER = new RegExp(
  `^\\s*(?::-|%|(?:kr|kronor|sek|tkr|mkr|procent|st|h|timmar|tim|eur|euro|usd|dollar|år|månader|dagar)${WORD_END})`,
  'iu',
)

const ACCOUNT_WORD_BEFORE = wordsBefore(
  // Not a bare "BAS": "BAS 2026" names the kontoplan's edition, not an account.
  'bas-?konto|bas-?kontot|konto|kontot|konton|kontona|kontonummer|kontonumret|kontonr',
  '(?:\\s*(?:nr\\.?|nummer|nr:))?\\s*[:#]?',
)

const BOOKING_VERB_BEFORE = wordsBefore(
  'debet|kredit|debiteras|krediteras|debitera|kreditera|debiterar|krediterar',
  '(?:\\s+(?:på|mot|till))?',
)

const PREPOSITION_BEFORE = wordsBefore('mot|på|till|från')

const IDENTIFIER_BEFORE = wordsBefore(
  [
    'ver', 'verifikat', 'verifikation', 'verifikationen', 'verifikatet', 'vernr',
    'faktura', 'fakturan', 'fakturanummer', 'fakturanr', 'order', 'ordernummer', 'ocr',
    'serie', 'löpnummer', 'kundnummer', 'kundnr', 'leverantörsnummer', 'postnummer',
    'id', 'nr', 'nummer', 'år', 'året', 'inkomstår', 'inkomståret', 'räkenskapsår',
    'räkenskapsåret', 'taxeringsår', 'sedan', 'före', 'efter', 'kl', 'klockan',
    'januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti',
    'september', 'oktober', 'november', 'december',
  ].join('|'),
  '\\.?',
)

const NAME_AFTER = /^\s+([A-ZÅÄÖ][a-zåäöé]+)(?=\s|[,.;:)]|$)/u
const JOIN_GAP = /^(?:\s*\/\s*|\s*,\s*|\s+och\s+|\s+eller\s+)$/u
const LETTER_THEN_OPEN_BRACKET = /\p{L}\s*\($/u

function isYearLike(n: number): boolean {
  return n >= YEAR_MIN && n <= YEAR_MAX
}

// Capitalised words that follow a year or a number without making it an account.
const NAME_AFTER_STOPWORDS = new Set([
  'Det', 'Den', 'De', 'Du', 'Vi', 'Ni', 'Jag', 'Han', 'Hon', 'Om', 'När', 'Men', 'Och', 'Så', 'Skatteverket', 'Bolagsverket',
])

function classify(text: string, index: number, digits: string, previous: AccountNumberLeak | null): AccountLeakReason | null {
  const n = Number(digits)
  if (n < BAS_MIN || n > BAS_MAX) return null
  const before = text.slice(Math.max(0, index - LOOKBEHIND_CHARS), index)
  const after = text.slice(index + digits.length, index + digits.length + 40)

  if (UNIT_AFTER.test(after)) return null
  if (before.endsWith('`') && after.startsWith('`')) return 'inline_code'
  if (ACCOUNT_WORD_BEFORE.test(before)) return 'account_word'
  if (BOOKING_VERB_BEFORE.test(before)) return 'booking_verb'
  if (IDENTIFIER_BEFORE.test(before)) return null

  if (previous && JOIN_GAP.test(text.slice(previous.index + previous.account.length, index))) {
    return 'joined'
  }

  const yearLike = isYearLike(n)
  if (LETTER_THEN_OPEN_BRACKET.test(before) && after.startsWith(')') && !yearLike) return 'bracket_after_name'

  const nameMatch = NAME_AFTER.exec(after)
  // Years included: a capitalised word straight after a year, with no
  // punctuation between, is rare in Swedish prose but is how an account is named.
  if (nameMatch && !NAME_AFTER_STOPWORDS.has(nameMatch[1])) return 'account_name_after'

  if (PREPOSITION_BEFORE.test(before) && !yearLike) return 'preposition'
  return null
}

/** Every BAS account number the reply exposes to the user, in order of appearance. */
export function findLeakedAccountNumbers(text: string): AccountNumberLeak[] {
  if (!text) return []
  const leaks: AccountNumberLeak[] = []
  let previous: AccountNumberLeak | null = null
  for (const m of text.matchAll(CANDIDATE)) {
    const digits = m[1]
    const index = m.index ?? 0
    const reason = classify(text, index, digits, previous)
    if (reason) {
      const leak = { account: digits, index, reason }
      leaks.push(leak)
      previous = leak
    }
  }
  return leaks
}
