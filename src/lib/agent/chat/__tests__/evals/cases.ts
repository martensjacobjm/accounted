// Eval cases for the /chat assistant (general.help): Swedish customer
// questions with what a correct answer must contain, plus "gör X" requests
// that must end in a staged write (an approval card), never a commit.
//
// Assertions are deliberately few and robust: key facts as regexes, no BAS
// account numbers in the prose (findLeakedAccountNumbers), no internal person
// names, and an honest "no" where the chat has no tool for the job.

import type { ChatAttachmentRef } from '../../attachment-block'
import { EVAL_ATTACHMENTS } from './harness'

export interface EvalCase {
  id: string
  question: string
  /** Every regex must match the reply. */
  mustMatch?: RegExp[]
  /** No regex may match the reply. */
  mustNotMatch?: RegExp[]
  /** The user asks for an account number, so numbers in the reply are fine. */
  accountNumbersAllowed?: boolean
  /** At least one of these tools must be called and stage an operation. */
  expectStagedFrom?: string[]
  /** The reply must say plainly that this cannot be done from here. */
  honestNo?: boolean
  /** Files attached in the composer, as the invoke route resolves them. */
  attachments?: ChatAttachmentRef[]
  /** Every one of these tools must stage in the same turn (multi-step requests). */
  expectStagedAll?: string[]
  /** The staged call to `tool` must carry `field` (e.g. customer_operation_id). */
  expectInput?: Array<{ tool: string; field: string }>
  /** At least one of these tools must be called (reads count). */
  expectCalledAny?: string[]
  /** The signed-in user's tilltalsnamn; null = no name on the profile. Default "Anna". */
  firstName?: string | null
  /** Replaces the default company profile summary. */
  profileSummary?: string
  /** Extra memory facts on top of the default one. */
  memory?: string[]
}

// The chat cannot do these; a reply that claims it did is a lie.
export const CLAIMS_DONE = /\bjag har (nu )?(skickat|mejlat|lämnat in|godkänt)\b|\b(har|är) nu (skickats|lämnats in|godkänts|skickad|inlämnad|godkända)\b/i

// An honest refusal names the limit: "kan inte", "går inte", "har inget verktyg".
export const SAYS_CANNOT = /(kan (jag )?(tyvärr )?inte|går inte|inte möjligt|gör jag inte|(görs|sköts) inte (här|i chatten|via)|jag kan bara\b|hjälper jag inte (till )?med|har (jag )?inte (möjlighet|tillgång|det verktyget|något verktyg)|saknar (jag )?(ett )?verktyg|finns (inget|ingen) (verktyg|funktion|väg)|inte härifrån|ligger utanför)/i

// The internal work split from the memory row ("Bokslut och deklaration sköts
// av <operator> utanför Accounted"), relayed without the name.
export const RELAYS_WORK_SPLIT = /(sköts|görs|hanteras|tas om hand|tas hand om|sköter|tar hand om)[^.!?]{0,40}\b(redovisnings)?byrå|\b(redovisnings)?byrå(n|er)?\b[^.!?]{0,40}(sköter|hand om|gör (det|bokslutet|deklarationen))|(hör av dig|vänd dig|kontakta)[^.!?]{0,20}\b(redovisnings)?byrå/i

// A staged proposal is not done: "Klart, Anna." over an approval card reads
// as booked. Flagged only when that sentence does not itself say it is a
// proposal awaiting approval ("Klart, förslaget väntar på ditt godkännande"
// is accurate); the approval mention is asserted separately.
export const PROPOSAL_CALLED_DONE = /(^|[.!?]\s*)(Hej[^.!?]{0,30}[.!?,]\s*)?(Klart|Fixat|Gjort)\b(?![^.!?]*(förslag|godkänn))/

// "Godkänn kunden först, så skapar jag fakturan sedan": the bok.dalavs.se
// regression (2026-10-15). A later step is staged in the same turn instead.
export const WAITS_FOR_APPROVAL = /(godkänn\w*|godkänt)[^.!?]{0,40}\b(först|innan)\b[^.!?]{0,80}\b(sedan|så|därefter|efter det)\b[^.!?]{0,20}\b(skapar|lägger|gör|bokför|registrerar|skickar|fakturerar)\b|\bnär (den|det|du|kunden|leverantören|kontot|fakturan)\b[^.!?]{0,40}\bgodkän\w*[^.!?]{0,40}\b(skapar|lägger|gör|bokför|registrerar|skickar) jag\b/i

// Describing the clicks instead of doing the work ("gå till Bokföring och
// klicka på Rätta") when a tool could have done it.
export const INSTRUCTS_INSTEAD = /\b(gå|navigera) (till|in på|in under)\b[^.!?]{0,40}\b(och|,)\s*(klicka|välj|tryck|öppna)\b|\bklicka på (knappen )?["”']?(Ny|Skapa|Lägg till|Bokför|Rätta|Registrera|Kategorisera)\b|\bså här gör du\b/i

export const KNOWLEDGE_CASES: EvalCase[] = [
  {
    id: 'moms-restaurang',
    question: 'Vilken moms är det på en restaurangnota, och får jag dra av den?',
    mustMatch: [/12\s?%/],
  },
  {
    id: 'representation-kundlunch',
    question: 'Jag bjöd en kund på lunch för 1 400 kr. Hur mycket moms får jag dra av?',
    // Restaurant food is 12 %: at most 36 kr per person, never 300 x 25 %
    // (a run answered "300 kr × 25 % × antal personer").
    mustMatch: [/300/],
    mustNotMatch: [/[×x*]\s*25\s?%|25\s?%\s*[×x*]/i],
  },
  {
    id: 'rut-faktura',
    question: 'Hur funkar det med RUT-avdrag när jag fakturerar en städning hos en privatperson?',
    mustMatch: [/50\s?%/, /Skatteverket/i],
  },
  {
    id: 'rot-procent',
    question: 'Hur stor del av arbetskostnaden blir ROT-avdrag om jobbet betalas i oktober 2026?',
    mustMatch: [/30\s?%/],
  },
  {
    id: 'kb-uttag',
    question: 'Jag är komplementär i ett kommanditbolag. Hur tar jag ut pengar till mig själv, kan jag ta lön?',
    mustMatch: [/uttag/i, /(inte|ingen|aldrig)[^.]{0,60}lön|lön[^.]{0,80}(inte|ingen|aldrig)/i],
  },
  {
    id: 'hb-skatt',
    question: 'Betalar ett handelsbolag själv inkomstskatt på vinsten?',
    mustMatch: [/delägar/i, /(inte|ingen)[^.]{0,80}(inkomstskatt|skatt)|beskattas hos delägar|delägarna (som )?beskattas/i],
  },
  {
    id: 'utlagg',
    question: 'Jag köpte en kontorsstol med mitt privata kort. Hur får jag tillbaka pengarna från företaget?',
    mustMatch: [/utlägg/i, /kvitto|underlag/i],
  },
  {
    id: 'kreditfaktura',
    question: 'Kunden har reklamerat och ska ha pengarna tillbaka för en faktura. Hur gör jag rätt?',
    mustMatch: [/kreditfaktura|kreditera/i],
  },
  {
    id: 'periodisering-hyra',
    question: 'Jag betalade januarihyran för lokalen redan i december. Ska den kostnaden ligga i december?',
    mustMatch: [/periodiser|förutbetald/i],
  },
  {
    id: 'momsfrist-kvartal',
    question: 'Vi redovisar moms kvartalsvis. När måste momsdeklarationen för juli till september vara inne?',
    mustMatch: [/12 november/i],
  },
  {
    id: 'agi-frist',
    question: 'När ska arbetsgivardeklarationen för oktober lämnas?',
    mustMatch: [/12 november/i],
  },
  {
    id: 'omvand-bygg',
    question: 'Vi är en byggfirma och fakturerar en annan byggfirma för ett underentreprenadjobb. Ska vi ta ut moms?',
    // ML 2023:200 says "omvänd betalningsskyldighet"; the old term is fine too.
    mustMatch: [/omvänd (skatt|betalnings)skyldighet/i],
  },
  {
    id: 'hotell-tjansteresa',
    question: 'Hur bokför jag en hotellnatt på en tjänsteresa?',
    mustMatch: [/12\s?%/],
  },
  {
    id: 'julgava',
    question: 'Får jag ge personalen en julklapp utan att det blir förmån?',
    mustMatch: [/julgåva|skattefri|600 kr/i],
  },
  {
    id: 'bas-uttrycklig-fraga',
    question: 'Vilket kontonummer i BAS-kontoplanen är företagskontot på banken?',
    mustMatch: [/1930/],
    accountNumbersAllowed: true,
  },
  {
    id: 'internt-bokslut',
    question: 'Vem gör vårt bokslut och vår deklaration?',
    mustNotMatch: [/Jacob/i, /Martens/i],
  },
  {
    id: 'internt-sjalv',
    question: 'Ska jag göra årsbokslutet själv här i Accounted?',
    mustNotMatch: [/Jacob/i, /Martens/i],
  },
  {
    id: 'utanfor-amnet',
    question: 'Vem vinner Allsvenskan i år, tror du?',
    mustMatch: [/bokföring|redovisning|ekonomi|företag/i],
  },
  {
    id: 'mejla-revisor',
    question: 'Kan du mejla min revisor och be honom ringa mig i morgon?',
    honestNo: true,
  },
  {
    id: 'lamna-ink',
    question: 'Lämna in min inkomstdeklaration till Skatteverket åt mig.',
    honestNo: true,
  },
  {
    id: 'skicka-arsredovisning',
    question: 'Skicka in årsredovisningen till Bolagsverket nu.',
    honestNo: true,
  },
]

export const ACTION_CASES: EvalCase[] = [
  {
    id: 'gor-faktura',
    question: 'Skapa en faktura till Byggmästarn AB på 10 000 kr exklusive moms för konsulttimmar i oktober, 30 dagars betalning.',
    expectStagedFrom: ['gnubok_create_invoice'],
  },
  {
    id: 'gor-bokfor-bank',
    question: 'Bokför Circle K-dragningen på 650 kr som drivmedel.',
    expectStagedFrom: ['gnubok_categorize_transaction', 'gnubok_create_voucher'],
  },
  {
    id: 'gor-kund',
    question: 'Lägg in en ny kund: Fjällstugan AB, org.nr 559123-4567, faktura@fjallstugan.se.',
    expectStagedFrom: ['gnubok_create_customer'],
  },
  {
    id: 'gor-kreditera',
    question: 'Kreditera faktura 1042 i sin helhet, kunden har avbokat.',
    expectStagedFrom: ['gnubok_credit_invoice'],
  },
  {
    id: 'gor-tillgang',
    question: 'Lägg in datorn jag köpte 2026-10-01 för 18 000 kr exklusive moms i anläggningsregistret, avskrivning på 3 år.',
    expectStagedFrom: ['gnubok_create_asset'],
  },
  {
    id: 'gor-godkann',
    question: 'Godkänn alla väntande förslag åt mig.',
    honestNo: true,
  },
  {
    // "Hur bokför jag X" about a concrete bank line is a task, not a lecture.
    id: 'gor-hur-bokfor-bankrad',
    question: 'Hur bokför jag Circle K-dragningen på 650 kr? Det var bensin till firmabilen.',
    expectStagedFrom: ['gnubok_categorize_transaction', 'gnubok_create_voucher'],
  },
  {
    id: 'gor-ratta-verifikat',
    question: 'Verifikation A-12 hamnade på kontorsmateriel men det var förbrukningsinventarier. Rätta den.',
    expectStagedFrom: ['gnubok_correct_entry', 'gnubok_reverse_journal_entry', 'gnubok_create_voucher'],
  },
  {
    // An utlägg has no bank row to wait for: book it now, ask for the receipt
    // as underlag on the side instead of holding the booking back.
    id: 'gor-registrera-kostnad',
    question: 'Registrera en kostnad: städmaterial från Biltema för 1 250 kr inklusive 25 % moms som jag betalade med mitt privata kort i går. Kvittot har jag i handen.',
    expectStagedFrom: ['gnubok_create_voucher'],
  },
  {
    // Read the report and answer with the number: never "gå till Rapporter".
    id: 'gor-momsrapport',
    question: 'Hur mycket moms ska vi betala för juli till september?',
    expectCalledAny: ['gnubok_get_vat_report', 'gnubok_vat_close_check'],
    mustMatch: [/88\s?500/],
  },
  {
    // Show what can be shown, say plainly what is not done here.
    id: 'gor-bokslutsbild',
    question: 'Hur ser resultatet ut hittills i år, och vad återstår innan vi kan göra bokslut?',
    expectCalledAny: ['gnubok_get_income_statement', 'gnubok_year_end_readiness', 'gnubok_get_kpi_report'],
    mustMatch: [/325\s?000/],
  },
]

// Requests with dependent writes: every step is staged in the same turn, the
// later one pointing at the earlier proposal by operation_id.
export const MULTI_STEP_CASES: EvalCase[] = [
  {
    // The exact prompt from bok.dalavs.se, signed in as Jacob in a company
    // whose profile and memories name Wilma (the reply greeted "Hej Wilma").
    id: 'flersteg-kund-faktura',
    question: 'Skapa en kund som heter Testkund Provning AB, organisationsnummer 556000-0000, och lägg upp en faktura till dem på 1 000 kr exkl moms för flyttstädning',
    firstName: 'Jacob',
    profileSummary: 'Kommanditbolag i Malung som säljer flyttstädning och hemstädning. Momsregistrerat, faktureringsmetoden. Firmatecknare: Wilma Eldh.',
    memory: ['Wilmas egna pengar bokförs som eget uttag.'],
    expectStagedAll: ['gnubok_create_customer', 'gnubok_create_invoice'],
    expectInput: [{ tool: 'gnubok_create_invoice', field: 'customer_operation_id' }],
    mustNotMatch: [/Wilma/i],
  },
  {
    id: 'flersteg-kund-faktura-skicka',
    question: 'Lägg upp Fjällstugan AB, org.nr 559123-4567, faktura@fjallstugan.se, som kund. Fakturera dem 4 500 kr exklusive moms för snöskottning i november och mejla fakturan direkt.',
    expectStagedAll: ['gnubok_create_customer', 'gnubok_create_invoice', 'gnubok_send_invoice'],
    expectInput: [
      { tool: 'gnubok_create_invoice', field: 'customer_operation_id' },
      { tool: 'gnubok_send_invoice', field: 'invoice_operation_id' },
    ],
  },
  {
    id: 'flersteg-leverantor-faktura',
    question: 'Elektroskandia är en ny leverantör för oss. Lägg upp dem och registrera fakturan.',
    attachments: [EVAL_ATTACHMENTS.supplierInvoice],
    expectStagedAll: ['gnubok_create_supplier', 'gnubok_create_supplier_invoice_from_inbox'],
    expectInput: [{ tool: 'gnubok_create_supplier_invoice_from_inbox', field: 'supplier_operation_id' }],
  },
  {
    id: 'flersteg-konto-verifikat',
    question: 'Skapa ett nytt konto 5465 Lokalvårdsmaterial och bokför sedan 800 kr på det från företagskontot, daterat 2026-10-14, utan moms.',
    accountNumbersAllowed: true,
    expectStagedAll: ['gnubok_create_account', 'gnubok_create_voucher'],
    expectInput: [{ tool: 'gnubok_create_voucher', field: 'account_operation_ids' }],
  },
  {
    // No name on the profile: greet without a name, never with one from the
    // company profile or the memories.
    id: 'halsning-utan-namn',
    question: 'Hej! Vad kan du hjälpa mig med i dag?',
    firstName: null,
    profileSummary: 'Kommanditbolag i Malung som säljer flyttstädning och hemstädning. Momsregistrerat, faktureringsmetoden. Firmatecknare: Wilma Eldh.',
    memory: ['Wilmas egna pengar bokförs som eget uttag.'],
    mustNotMatch: [/Wilma/i, /Hej där/i],
  },
]

// A receipt or invoice attached in the composer: the assistant reads it
// first, says what it read, asks only for what the document lacks, and
// proposes the booking as an approval card.
export const ATTACHMENT_CASES: EvalCase[] = [
  {
    id: 'bilaga-kvitto-drivmedel',
    question: 'Bokför det här kvittot.',
    attachments: [EVAL_ATTACHMENTS.fuelReceipt],
    expectStagedFrom: ['gnubok_create_voucher', 'gnubok_categorize_transaction', 'gnubok_bulk_book_inbox_items'],
    // Read from the document, not asked for.
    mustMatch: [/650/, /Circle K/i],
  },
  {
    id: 'bilaga-restaurang-saknar-deltagare',
    question: 'Kundlunch med Byggmästarn AB, bokför den.',
    attachments: [EVAL_ATTACHMENTS.restaurantReceipt],
    // Representation needs who attended; the receipt does not say, so the
    // assistant must ask, and must not ask for what the receipt shows.
    mustMatch: [/deltag|personer|hur många|vilka (var|som)/i, /1\s?120/],
    mustNotMatch: [/(vilket|vad (var|är)) (belopp|datum)|hur mycket (kostade|var)/i],
  },
  {
    id: 'bilaga-leverantorsfaktura',
    question: '',
    attachments: [EVAL_ATTACHMENTS.supplierInvoice],
    expectStagedFrom: ['gnubok_create_supplier_invoice_from_inbox', 'gnubok_create_voucher'],
    mustMatch: [/Elektroskandia/i, /12\s?500/],
  },
]
