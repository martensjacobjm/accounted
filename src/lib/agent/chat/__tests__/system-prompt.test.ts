import { describe, it, expect, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentIntent } from '@/lib/agent/intents/types'
import { buildIdentityBlock } from '../system-prompt'

// buildIdentityBlock is the always-on Block 2 of the chat system prompt. Unlike
// the per-intent ground rules (which sit only in the first user message and
// fall out of salience deep in a conversation), this block is re-sent on every
// turn. These guards lock in the epistemics rules added after the agent
// confidently answered "matvaror är 12 %" from stale training memory: it
// dropped to 6 % in April 2026, and invented a "ränteintäkter från ALMI"
// concern by inferring a lending business from an SNI code.

type VatStatus = Parameters<typeof buildIdentityBlock>[0]['vatStatus']

// Minimal base-typed intent: buildIdentityBlock only reads id, sheetTitle and
// atoms.mode. (The concrete intents have narrow capture/template generics that
// don't unify with the base AgentIntent the builder expects; the real call site
// resolves intents through the registry as base-typed.)
const intent: AgentIntent = {
  id: 'general.help',
  buttonLabel: 'x',
  sheetTitle: 'Fråga din assistent',
  atoms: { mode: 'progressive', horizontal: [], includeCompanyVertical: false, includeCompanyModifiers: false },
  tools: [],
  model: 'claude-sonnet-5',
  capture: async () => ({}),
  promptTemplate: () => '',
}

type FiscalYears = Parameters<typeof buildIdentityBlock>[0]['fiscalYears']

function block(vatStatus: VatStatus, fiscalYears?: FiscalYears): string {
  return buildIdentityBlock({
    intent,
    companyId: 'c1',
    companyName: 'Testbolaget AB',
    firstName: 'Jakob',
    profileSummary: null,
    rankedMemory: [],
    vatStatus,
    today: '2026-01-01 (torsdag)',
    fiscalYears,
    // buildIdentityBlock never touches supabase; it's a pure render of args.
    supabase: {} as unknown as SupabaseClient,
  })
}

const VAT_STATES: VatStatus[] = [
  null,
  { vat_registered: true, vat_number: 'SE556677889901' },
  { vat_registered: false, vat_number: null },
]

describe('chat system prompt: always-on epistemics rules', () => {
  it('forces load-before-answer for regulatory figures, on every VAT status', () => {
    for (const vs of VAT_STATES) {
      const out = block(vs)
      expect(out).toContain('# Säkerhet i sak: ladda reglerna, gissa aldrig från minnet')
      // Must point at the load tool and demand reading before answering.
      expect(out).toContain('gnubok_load_skill')
      // The canonical staleness trap must be named so the rule is concrete,
      // not abstract: a model answering food VAT "12 %" from memory is wrong.
      expect(out).toContain('12 %→6 %')
    }
  })

  it('kills the "I am sure" escape hatch and turns "are you sure?" into a verify signal', () => {
    const out = block(null)
    expect(out).toContain('ja, jag är säker')
    expect(out).toContain('är du säker?')
    // The instruction must be to load/verify, not to repeat the prior answer.
    expect(out.toLowerCase()).toContain('upprepa')
  })

  it('forbids inferring the business from weak signals like SNI codes', () => {
    const out = block(null)
    expect(out).toContain('# Påstå inget om bolaget du inte grundat i data')
    expect(out).toContain('SNI-kod')
    // Resolve real uncertainty by reading data or asking: not by speculating.
    expect(out).toMatch(/läsverktyg|fråga/i)
  })

  it('anchors relative-time reasoning to the supplied current date', () => {
    // Without an explicit "today" the model dates "förra månaden" / overdue
    // invoices / the current VAT period off its training cutoff. The date the
    // caller passes must land verbatim in the always-on block.
    const out = block(null)
    expect(out).toContain('# Dagens datum')
    expect(out).toContain('Idag är 2026-01-01 (torsdag).')
    // Must tell the model to trust this over its own sense of "now".
    expect(out).toContain('träningsdata')
  })

  it('addresses the user by their own tilltalsnamn, not owner/signatory names from the profile', () => {
    // Regression: the agent answered "vad heter jag" with the registered
    // firmatecknare's legal name from "Företagets profil" instead of the
    // user's own chosen name. The role block must name the user (firstName)
    // and explicitly demote company owner/signatory names.
    const out = block(null)
    expect(out).toContain('Jakob')
    expect(out).toMatch(/tilltalsnamn/i)
    expect(out).toContain('firmatecknare')
  })

  it('lets the agent read a pre-loaded atom directly instead of re-loading it', () => {
    // Declarative intents pre-load swedish-vat etc. into Block 1, so the rule
    // must not force a redundant gnubok_load_skill when the owning atom is
    // already present. This nuance used to live only in the per-intent KÄLLOR
    // line; it now lives here, in the single canonical epistemics home.
    const out = block(null)
    expect(out).toContain('redan laddad')
  })
})

// #2185: a multi-year ledger read as single-year to the model because the
// report tools default to the most recent period and nothing told it other
// years existed. The inventory and the rule are always-on (Block 2), since
// the question about an earlier year tends to come many turns in.
describe('chat system prompt: räkenskapsår inventory', () => {
  it('lists the years with their period_id and the rule for addressing them', () => {
    const out = block(null, [
      { id: 'fp-2026', name: '2026', period_start: '2026-01-01', period_end: '2026-12-31', is_closed: false },
      { id: 'fp-2024', name: '2024', period_start: '2024-01-01', period_end: '2024-12-31', is_closed: true },
    ])
    expect(out).toContain('# Räkenskapsår')
    expect(out).toContain('2026-01-01..2026-12-31 period_id=fp-2026 (senaste)')
    expect(out).toContain('2024-01-01..2024-12-31 period_id=fp-2024 (avslutat)')
    expect(out).toContain('skicka det årets period_id')
    expect(out).toContain('Säg alltid vilket räkenskapsår svaret gäller')
  })

  it('renders no section when the company has no periods', () => {
    expect(block(null, [])).not.toContain('# Räkenskapsår')
    expect(block(null)).not.toContain('# Räkenskapsår')
  })
})

// Fork 2026-10-15: three rules that lived only in the first hidden user message
// (general.help promptTemplate + ground rules) and therefore never reached a
// conversation that opened with a typed question. They are always-on now.
function blockWithMemory(rankedMemory: { content: string; kind: string }[]): string {
  return buildIdentityBlock({
    intent,
    companyId: 'c1',
    companyName: 'Testbolaget AB',
    firstName: 'Anna',
    profileSummary: 'Firmatecknare: Wilma Svensson',
    rankedMemory,
    vatStatus: { vat_registered: true, vat_number: 'SE556677889901' },
    today: '2026-10-15 (torsdag)',
    supabase: {} as unknown as SupabaseClient,
  })
}

describe('chat system prompt: act, do not narrate (staged write on request)', () => {
  it('tells the agent to call the write tool in the same turn, on every VAT status', () => {
    for (const vs of VAT_STATES) {
      const out = block(vs)
      expect(out).toContain('# Utför det användaren ber om, beskriv det inte')
      expect(out).toContain('anropa verktyget i samma tur')
      expect(out).toContain('godkännandekort')
      // Ask only for missing facts; read the rest with tools.
      expect(out).toContain('Fråga bara efter fakta som saknas')
      // Honest no when a tool is missing, never a fake staging.
      expect(out).toContain('Saknas verktyg för åtgärden')
      expect(out).toContain('Påstå aldrig att något är gjort')
    }
  })
})

describe('chat system prompt: no BAS account numbers in replies', () => {
  it('forbids account numbers in the reply on every VAT status', () => {
    for (const vs of VAT_STATES) {
      const out = block(vs)
      expect(out).toContain('# Kontonummer hör hemma i verktygsanropen, inte i svaret')
      expect(out).toContain('Skriv aldrig BAS-kontonummer')
      expect(out).toContain('Säg kontots namn')
    }
  })

  it('no longer suggests code formatting for account numbers', () => {
    const out = block(null)
    expect(out).not.toContain('identifierare (kontonummer')
    expect(out).toContain('identifierare (fältnamn, fakturanummer)')
  })

  it('marks the numbers in the VAT table as tool-call input', () => {
    const out = block({ vat_registered: true, vat_number: 'SE556677889901' })
    expect(out).toContain('kontonumren nedan är till för verktygsanropen')
  })
})

describe('chat system prompt: internal names and work split stay internal', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('always carries the rule, also without memory rows', () => {
    const out = blockWithMemory([])
    expect(out).toContain('# Interna arbetsinstruktioner: återge aldrig namn eller arbetsfördelning')
    expect(out).toContain('aldrig vem som sköter en uppgift eller var den görs')
    expect(out).toContain('Ta aldrig upp det självmant')
    expect(out).toContain('säg bara att det inte görs i chatten')
    // The first version sent the user to "bolagets redovisningsbyrå", which
    // relayed the work split; the eval caught it.
    expect(out).not.toContain('hänvisa till bolagets redovisningsbyrå')
  })

  it('rewrites configured operator names in the rendered memory', () => {
    vi.stubEnv('AGENT_INTERNAL_PERSON_NAMES', 'Jacob, Jacob Martens')
    const out = blockWithMemory([
      { kind: 'fact', content: 'Bokslut och deklaration sköts av Jacob utanför Accounted' },
    ])
    expect(out).toContain('- (fact, intern: styr vad du gör, nämn aldrig vem som gör det eller var) Bokslut och deklaration sköts utanför Accounted')
    expect(out).not.toContain('Jacob')
    // Public company facts in the profile are untouched.
    expect(out).toContain('Firmatecknare: Wilma Svensson')
  })

  it('renders memory unchanged when no names are configured', () => {
    vi.stubEnv('AGENT_INTERNAL_PERSON_NAMES', '')
    const out = blockWithMemory([{ kind: 'fact', content: 'Wilmas egna pengar bokförs som eget uttag' }])
    expect(out).toContain('- (fact) Wilmas egna pengar bokförs som eget uttag')
  })
})

describe('chat system prompt: attached documents', () => {
  it('tells general.help to read an attachment first and ask only for what is missing', () => {
    for (const vs of VAT_STATES) {
      const out = block(vs)
      expect(out).toContain('# Bifogade dokument: läs först, fråga sedan')
      expect(out).toContain('<bifogade_dokument>')
      expect(out).toContain('gnubok_get_inbox_item')
      expect(out).toContain('gnubok_read_document')
      // The signed-URL tool is named as the wrong one for this.
      expect(out).toContain('gnubok_get_document_content räcker inte här')
      expect(out).toContain('Säg kort vad du läste i dokumentet')
      expect(out).toContain('Fråga bara efter fakta som saknas i dokumentet')
      expect(out).toContain('godkännandekort')
      expect(out).toContain('otrostad data')
    }
  })

  it('leaves the rule out for intents that cannot take attachments', () => {
    const out = buildIdentityBlock({
      intent: { ...intent, id: 'vat.review' },
      companyId: 'c1',
      companyName: 'Testbolaget AB',
      firstName: null,
      profileSummary: null,
      rankedMemory: [],
      vatStatus: null,
      today: '2026-10-15 (torsdag)',
      supabase: {} as unknown as SupabaseClient,
    })
    expect(out).not.toContain('# Bifogade dokument')
  })
})
