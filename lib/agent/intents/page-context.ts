/**
 * What page the person is on, said in words the assistant can act on.
 *
 * bok.dalavs.se fork (Jacob 2026-09-22: "den ska kunna vara med överallt").
 * Upstream's floating "Fråga" pill opened general.help with nothing but the
 * URL string on ~85 of 92 pages, so the assistant started blind. This module
 * turns a pathname (+ query) into: a Swedish title, the entity in focus, the
 * tools to call first and the tasks people usually want there. Pure function,
 * no React, no database: general.help renders it into its prompt, the pill
 * uses it for its label, and row-level buttons pass a `focus` on top.
 */

export interface PageFocus {
  /** Entity kind in the app's own vocabulary (transaction, customer, skattekonto_row, ...). */
  kind: string
  id: string
  /** Optional human label the caller already has (row text, name, amount). */
  label?: string | null
}

export interface PageContext {
  route: string
  /** Swedish page name as the user sees it in the menu. */
  title: string
  /** Suffix for the pill: "Fråga <namn> om transaktionerna". null = plain. */
  labelSuffix: string | null
  /** Entity read from the path ([id] pages). */
  entity: PageFocus | null
  /** Tools to call before saying anything, in order. */
  toolsFirst: string[]
  /** What people usually want here, as short Swedish lines. */
  tasks: string[]
  contextRef: string | null
  /** Query string parameters, for list filters (period, status, account). */
  params: Record<string, string>
}

interface PageRule {
  title: string
  suffix: string | null
  entityKind?: string
  toolsFirst: string[]
  tasks: string[]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Keyed by first path segment; a second-level key "seg/sub" wins over "seg". */
const RULES: Record<string, PageRule> = {
  '': { title: 'Hem', suffix: null, toolsFirst: ['gnubok_get_agent_briefing'], tasks: ['Säg vad som väntar (inkorg, omatchade transaktioner, deadlines) och erbjud att ta det första.'] },
  transactions: {
    title: 'Transaktioner (bankhändelser)',
    suffix: 'om transaktionerna',
    entityKind: 'transaction',
    toolsFirst: ['gnubok_list_uncategorized_transactions', 'gnubok_query_journal'],
    tasks: ['Förklara en rad ("vad är det här?"), bokföra den (gnubok_categorize_transaction, gnubok_match_transaction_to_invoice, gnubok_link_transaction_to_journal_entry), hitta underlaget i inkorgen (gnubok_receipt_matcher), eller ignorera privata rader.'],
  },
  reconciliation: {
    title: 'Avstämning (bank mot bokföring)',
    suffix: 'om avstämningen',
    toolsFirst: ['gnubok_get_reconciliation_status', 'gnubok_list_reconciliation_items'],
    tasks: ['Förklara differensen på 1930 per konto och period, para ihop rader (gnubok_reconcile_match, gnubok_auto_match_period), lägga restpost (gnubok_reconcile_residual) och signera perioden (gnubok_reconcile_signoff).'],
  },
  skattekonto: {
    title: 'Skattekonto',
    suffix: 'om skattekontot',
    entityKind: 'skattekonto_row',
    toolsFirst: ['gnubok_search_tools'],
    tasks: ['Förklara raderna (moms, förseningsavgift 6992, kostnadsränta 8423, kvittning av RUT) och bokföra dem mot 1630 (gnubok_book_skattekonto_row / gnubok_book_skattekonto_rows). Skatteverkets kvittning av RUT är en RUT-inbetalning som betalar skulden.'],
  },
  reports: {
    title: 'Rapporter',
    suffix: 'om rapporten',
    toolsFirst: ['gnubok_get_income_statement', 'gnubok_get_balance_sheet', 'gnubok_get_trial_balance'],
    tasks: ['Förklara en siffra på rapporten med konton och verifikat bakom (gnubok_get_general_ledger, gnubok_query_journal), jämföra perioder, peka på avvikelser.'],
  },
  'reports/moms': { title: 'Momsrapport', suffix: 'om momsen', toolsFirst: ['gnubok_get_vat_report', 'gnubok_vat_close_check', 'gnubok_vat_declaration_status'], tasks: ['Granska rutorna mot bokföringen, hitta poster som saknar moms eller ligger i fel ruta, förbered och lämna deklarationen (gnubok_vat_declaration_validate, gnubok_vat_declaration_submit).'] },
  'reports/vat': { title: 'Momsrapport', suffix: 'om momsen', toolsFirst: ['gnubok_get_vat_report', 'gnubok_vat_close_check', 'gnubok_vat_declaration_status'], tasks: ['Granska rutorna mot bokföringen, hitta poster som saknar moms eller ligger i fel ruta, förbered och lämna deklarationen (gnubok_vat_declaration_validate, gnubok_vat_declaration_submit).'] },
  bookkeeping: {
    title: 'Bokföring (verifikationer)',
    suffix: 'om verifikationen',
    entityKind: 'journal_entry',
    toolsFirst: ['gnubok_query_journal'],
    tasks: ['Förklara en verifikation, rätta den (gnubok_correct_entry), makulera (gnubok_reverse_journal_entry), koppla underlag (gnubok_link_document_to_voucher), skriva notering (gnubok_set_voucher_note), förklara luckor i serien (gnubok_list_voucher_gaps).'],
  },
  'bookkeeping/periodiseringar': { title: 'Periodiseringar', suffix: 'om periodiseringarna', toolsFirst: ['gnubok_list_accrual_schedules', 'gnubok_propose_accruals'], tasks: ['Föreslå och boka periodiseringar av försäkringar, hyror och abonnemang.'] },
  'invoices/rot-rut': {
    title: 'RUT och ROT (begäran om utbetalning)',
    suffix: 'om RUT-begäran',
    toolsFirst: ['gnubok_list_rot_rut_payout_requests', 'gnubok_list_invoices'],
    tasks: ['Vilka fakturor väntar på begäran, vad Skatteverket betalat eller kvittat, avslag och kundens restskuld (kunden är skyldig RUT-delen om Skatteverket säger nej), boka utbetalningen (gnubok_settle_rot_rut_payout). Begäran ska vara inne senast 31 januari året efter kundens betalning.'],
  },
  invoices: { title: 'Kundfakturor', suffix: 'om fakturorna', entityKind: 'invoice', toolsFirst: ['gnubok_list_invoices', 'gnubok_get_ar_ledger'], tasks: ['Obetalda fakturor, påminnelser, kreditera (gnubok_credit_invoice), markera betald, skapa ny (gnubok_create_invoice).'] },
  'invoices/recurring': { title: 'Återkommande fakturor', suffix: 'om de återkommande fakturorna', toolsFirst: ['gnubok_list_recurring_schedules'], tasks: ['Skapa eller ändra scheman (gnubok_create_recurring_schedule, gnubok_update_recurring_schedule).'] },
  'supplier-invoices': { title: 'Leverantörsfakturor', suffix: 'om leverantörsfakturorna', entityKind: 'supplier_invoice', toolsFirst: ['gnubok_list_supplier_invoices', 'gnubok_get_supplier_ledger'], tasks: ['Vad som är obetalt och förfallet, attestera (gnubok_approve_supplier_invoice), kreditera, koppla betalning till verifikat.'] },
  suppliers: { title: 'Leverantörer', suffix: 'om leverantören', entityKind: 'supplier', toolsFirst: ['gnubok_list_suppliers', 'gnubok_query_journal'], tasks: ['Vad vi köpt av leverantören, hur det bokförts, uppdatera uppgifter (gnubok_create_supplier).'] },
  customers: { title: 'Kunder', suffix: 'om kunden', entityKind: 'customer', toolsFirst: ['gnubok_list_customers', 'gnubok_list_invoices'], tasks: ['Kundens fakturor och betalningar, obetalt, uppdatera uppgifter (gnubok_update_customer).'] },
  expenses: { title: 'Utlägg', suffix: 'om utläggen', entityKind: 'expense_claim', toolsFirst: ['gnubok_query_journal'], tasks: ['Vilka utlägg som är obetalda till ägaren eller anställda (2893/2820/2018), hur de bokförts, vad som ska betalas ut.'] },
  pending: { title: 'Väntande godkännanden', suffix: 'om förslagen', toolsFirst: ['gnubok_list_pending_operations'], tasks: ['Förklara varje förslag i klartext (konto, moms, motkonto, varför) så att användaren kan godkänna eller avvisa med rätt underlag. Godkännandet gör användaren själv.'] },
  salary: { title: 'Lön', suffix: 'om lönen', entityKind: 'employee', toolsFirst: ['gnubok_list_employees', 'gnubok_get_salary_journal'], tasks: ['Lönekörningar, arbetsgivaravgifter, AGI (gnubok_generate_agi), semester.'] },
  deadlines: { title: 'Deadlines', suffix: 'om deadlines', toolsFirst: ['gnubok_get_agent_briefing', 'gnubok_vat_declaration_status'], tasks: ['Vad som ska lämnas när (moms, AGI, inkomstdeklaration) och vad som saknas för att lämna det.'] },
  kpi: { title: 'Nyckeltal', suffix: 'om nyckeltalen', toolsFirst: ['gnubok_get_kpi_report'], tasks: ['Förklara nyckeltalen.'] },
  articles: { title: 'Artiklar', suffix: 'om artiklarna', entityKind: 'article', toolsFirst: ['gnubok_list_articles'], tasks: ['Priser, moms per artikel, skapa och ändra (gnubok_create_article, gnubok_update_article).'] },
  quotes: { title: 'Offerter', suffix: 'om offerterna', toolsFirst: ['gnubok_list_invoices'], tasks: ['Vilka offerter som väntar, omvandla till faktura (gnubok_convert_invoice).'] },
  'sales-orders': { title: 'Order', suffix: 'om ordern', entityKind: 'sales_order', toolsFirst: ['gnubok_list_sales_orders'], tasks: ['Orderns status, leverans (gnubok_register_sales_order_delivery), fakturera (gnubok_create_invoice_from_sales_order).'] },
  assets: { title: 'Anläggningstillgångar', suffix: 'om anläggningarna', entityKind: 'asset', toolsFirst: ['gnubok_propose_annual_depreciation'], tasks: ['Avskrivningar (gnubok_post_annual_depreciation), avyttring, vad som ska aktiveras.'] },
  'chart-of-accounts': { title: 'Kontoplan', suffix: 'om kontoplanen', toolsFirst: ['gnubok_list_accounts'], tasks: ['Vilket konto som passar, skapa konto (gnubok_create_account), momskod per konto.'] },
  accounts: { title: 'Konton', suffix: 'om kontona', toolsFirst: ['gnubok_list_accounts', 'gnubok_get_trial_balance'], tasks: ['Saldo och rörelser per konto (gnubok_get_general_ledger).'] },
  import: { title: 'Import', suffix: 'om importen', toolsFirst: ['gnubok_sie_preflight', 'gnubok_list_fiscal_periods'], tasks: ['SIE-import, kontomappning, bankfiler, ångra import (gnubok_undo_sie_import).'] },
  rules: { title: 'Bokföringsregler (automatik)', suffix: 'om reglerna', toolsFirst: ['gnubok_get_counterparty_templates'], tasks: ['Vilka regler som styr automatisk kontering och hur de ändras.'] },
  mileage: { title: 'Milersättning', suffix: 'om körjournalen', toolsFirst: ['gnubok_list_mileage_trips'], tasks: ['Registrera resor (gnubok_log_mileage_trip) och boka perioden (gnubok_book_mileage_period).'] },
  purchases: { title: 'Inköp', suffix: 'om inköpen', toolsFirst: ['gnubok_list_supplier_invoices'], tasks: ['Inköp och leverantörsskulder.'] },
  dimensions: { title: 'Dimensioner (kostnadsställe, projekt)', suffix: 'om dimensionerna', toolsFirst: ['gnubok_list_dimensions', 'gnubok_get_dimension_pnl'], tasks: ['Resultat per projekt, tagga rader (gnubok_tag_journal_lines).'] },
  byra: { title: 'Byrå', suffix: 'om klienterna', toolsFirst: ['gnubok_list_companies'], tasks: ['Läget per klientbolag; byt bolag med company_id i verktygen.'] },
  clients: { title: 'Klienter', suffix: 'om klienterna', toolsFirst: ['gnubok_list_companies'], tasks: ['Läget per klientbolag.'] },
  parties: { title: 'Motparter', suffix: 'om motparten', toolsFirst: ['gnubok_get_party'], tasks: ['Allt om en motpart: fakturor, betalningar, bokföring.'] },
  e: { title: 'Tillägg', suffix: null, toolsFirst: ['gnubok_list_inbox_items'], tasks: ['Dokumentinkorgen: underlag som väntar.'] },
  extensions: { title: 'Tillägg', suffix: null, toolsFirst: [], tasks: [] },
  help: { title: 'Hjälp', suffix: null, toolsFirst: [], tasks: ['Förklara var saker finns och hur de görs (appkartan i minnena).'] },
  'agent-knowledge': { title: 'Assistentens kunskap', suffix: 'om det du lärt dig', toolsFirst: [], tasks: ['Vilka regler och minnen som styr dig (gnubok_remember_fact, gnubok_forget_fact).'] },
}

function parseParams(search: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!search) return out
  const qs = search.startsWith('?') ? search.slice(1) : search
  for (const part of qs.split('&')) {
    if (!part) continue
    const [k, v = ''] = part.split('=')
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v).slice(0, 200)
    } catch {
      out[k] = v.slice(0, 200)
    }
    if (Object.keys(out).length >= 12) break
  }
  return out
}

export function describePage(pathname: string | null | undefined, search?: string | null): PageContext {
  const route = pathname && pathname.startsWith('/') ? pathname : '/'
  const segs = route.split('/').filter(Boolean)
  const [first = '', second] = segs
  const rule = (second && RULES[`${first}/${second}`]) || RULES[first] || null
  const params = parseParams(search)

  // Entity in focus: an [id] segment on a page whose rule names an entity kind.
  // "new", "edit", "credit" and the named sub-pages are not ids.
  let entity: PageFocus | null = null
  if (rule?.entityKind && second && (UUID_RE.test(second) || /^\d+$/.test(second))) {
    entity = { kind: rule.entityKind, id: second, label: null }
  }
  // Extension pages (/e/<sector>/<slug>) are named by their slug.
  const title = first === 'e' && segs[2] ? `Tillägg: ${segs[2]}` : rule ? rule.title : `Sidan ${route}`

  return {
    route,
    title,
    labelSuffix: rule?.suffix ?? null,
    entity,
    toolsFirst: rule?.toolsFirst ?? [],
    tasks: rule?.tasks ?? [],
    contextRef: entity ? `${entity.kind}:${entity.id}` : `page:${route}`,
    params,
  }
}

/** Swedish lines for the prompt: page, focus, params, tools, tasks. */
export function renderPageContext(ctx: PageContext, focus?: PageFocus | null): string[] {
  const lines: string[] = []
  lines.push(`SIDAN ANVÄNDAREN ÄR PÅ: ${ctx.title} (${ctx.route})`)
  const f = focus ?? ctx.entity
  if (f) lines.push(`I FOKUS: ${f.kind} id=${f.id}${f.label ? ` (${f.label})` : ''}. Hämta den posten först och utgå från den.`)
  const p = Object.entries(ctx.params)
  if (p.length > 0) lines.push(`Filter i adressen: ${p.map(([k, v]) => `${k}=${v}`).join(', ')}`)
  if (ctx.toolsFirst.length > 0) lines.push(`Verktyg att anropa FÖRST, innan du säger något: ${ctx.toolsFirst.join(', ')}.`)
  if (ctx.tasks.length > 0) {
    lines.push('Vad folk brukar vilja här:')
    for (const t of ctx.tasks) lines.push(`  • ${t}`)
  }
  lines.push('ÖPPNING: hämta sidans data med verktygen ovan, säg i två meningar vad du ser (siffror ur verktygssvaret, inte gissningar) och erbjud de två eller tre troligaste åtgärderna. Ställ sedan högst en fråga.')
  return lines
}
