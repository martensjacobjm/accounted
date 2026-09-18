import { defineAgentIntent } from './types'
import { SONNET_MODEL, EFFORT_STANDARD } from '@/lib/agent/composer/client'
import { renderAgentGroundRules } from './shared-rules'

// general.help: always-present "Fråga min assistent" from the top nav.
//
// Atom mode is progressive: only the agent_atom_registry metadata lands in
// the system prompt (~200 tokens per atom), and the agent calls
// gnubok_load_skill on demand when a topic actually requires depth. This
// keeps TTFT low for the common "quick question" pattern without forcing
// the entire skill library into every chat turn.
//
// Plan refs: §8 (intent system, V1 #3), §10 (caching strategy: progressive
// disclosure keeps Block 1 small enough that cache reuse pays off across
// users).

interface GeneralHelpArgs {
  // Currently routed only with the URL the user is on. We don't capture page
  // contents: the chat sheet sits over the page and is intentionally
  // page-agnostic so the user can keep working underneath.
  route?: string
}

interface GeneralHelpCaptured {
  route: string | null
}

export const generalHelp = defineAgentIntent<GeneralHelpArgs, GeneralHelpCaptured>({
  id: 'general.help',
  buttonLabel: 'Fråga min assistent',
  sheetTitle: 'Fråga din assistent',

  atoms: {
    mode: 'progressive',
    horizontal: [],
    includeCompanyVertical: false,
    includeCompanyModifiers: false,
  },

  // general.help is the broad chat assistant: used both from the floating
  // pill on random pages AND from the /chat surface. Users land here with
  // analytical questions ("vad är min största utgiftspost?", "vilka
  // leverantörer skulder jag mest?", "hur ser min momsrapport ut?") that
  // require actually reading bookkeeping data, not just regulatory atoms.
  //
  // Tool whitelist is comprehensive on the READ side. Fork change
  // (bok.dalavs.se, 2026-09-16, decision B-S21): the everyday WRITE tools are
  // whitelisted here too, so the general chat can act on a request ("bokför
  // kvittot", "skapa en faktura till X") instead of only pointing at a page.
  // Every write tool stages a pending_operation and renders an ApprovalCard;
  // the human still approves each one (gnubok_approve_pending_operation is
  // deliberately NOT here, so nothing commits from chat without a click).
  // 2026-09-18 (Jacob: full access in the chat): every tool that stages is
  // whitelisted, bokslut and periodlås included. Left out on purpose:
  // approve_pending_operation (the click stays human), call_tool (bridge),
  // feedback (goes to the upstream product team) and the handful of tools
  // that write without staging (upload flows, set_quote_status,
  // set_inbox_extracted_data, reject_pending_operation, create_company,
  // calculate_salary_run, audit_package, rot/rut files).
  //
  // Anthropic caches the tools list with the system prompt so a stable
  // whitelist costs nothing per turn after first warm-up.
  tools: [
    // Write (staged, user approves in the ApprovalCard)
    'gnubok_categorize_transaction',
    'gnubok_match_transaction_to_invoice',
    'gnubok_ignore_transaction',
    'gnubok_bulk_book_transactions',
    'gnubok_create_voucher',
    'gnubok_correct_entry',
    'gnubok_reverse_journal_entry',
    'gnubok_set_voucher_note',
    'gnubok_link_document_to_voucher',
    'gnubok_attach_document_to_transaction',
    'gnubok_bulk_book_inbox_items',
    'gnubok_create_supplier_invoice_from_inbox',
    'gnubok_approve_supplier_invoice',
    'gnubok_create_invoice',
    'gnubok_update_invoice',
    'gnubok_send_invoice',
    'gnubok_mark_invoice_as_sent',
    'gnubok_mark_invoice_as_paid',
    'gnubok_credit_invoice',
    'gnubok_create_customer',
    'gnubok_create_supplier',
    'gnubok_create_article',
    // Full access (Jacob 2026-09-18): every remaining tool that stages a
    // pending_operation. Still approved one by one in the ApprovalCard.
    'gnubok_link_transaction_to_journal_entry',
    'gnubok_uncategorize_transaction',
    'gnubok_reconcile_match',
    'gnubok_reconcile_unmatch',
    'gnubok_reconcile_residual',
    'gnubok_reconcile_signoff',
    'gnubok_auto_match_period',
    'gnubok_match_batch_allocate',
    'gnubok_link_invoice_to_voucher',
    'gnubok_link_supplier_invoice_to_voucher',
    'gnubok_link_documents_to_vouchers',
    'gnubok_tag_journal_lines',
    'gnubok_create_transactions',
    'gnubok_sync_bank',
    'gnubok_credit_supplier_invoice',
    'gnubok_delete_draft_invoice',
    'gnubok_convert_invoice',
    'gnubok_create_recurring_schedule',
    'gnubok_update_recurring_schedule',
    'gnubok_create_sales_order',
    'gnubok_transition_sales_order',
    'gnubok_register_sales_order_delivery',
    'gnubok_create_invoice_from_sales_order',
    'gnubok_update_customer',
    'gnubok_update_article',
    'gnubok_create_account',
    'gnubok_update_account',
    'gnubok_create_dimension_value',
    'gnubok_update_company_settings',
    'gnubok_set_opening_balances',
    'gnubok_import_sie',
    'gnubok_undo_sie_import',
    'gnubok_post_annual_depreciation',
    'gnubok_run_currency_revaluation',
    'gnubok_post_kontantmetod_cutoff',
    'gnubok_lock_period',
    'gnubok_unlock_period',
    'gnubok_close_period',
    'gnubok_run_year_end',
    'gnubok_book_skattekonto_row',
    'gnubok_book_skattekonto_rows',
    'gnubok_log_mileage_trip',
    'gnubok_book_mileage_period',
    'gnubok_create_employee',
    'gnubok_update_employee',
    'gnubok_set_employee_opening_balances',
    'gnubok_create_salary_run',
    'gnubok_update_salary_run',
    'gnubok_set_run_salary',
    'gnubok_update_payslip_line',
    'gnubok_book_salary_run',
    'gnubok_register_absence',
    'gnubok_delete_absence',
    'gnubok_close_vacation_year',
    'gnubok_generate_agi',
    'gnubok_agi_submit',
    'gnubok_vat_declaration_submit',
    'gnubok_settle_rot_rut_payout',
    // Knowledge + memory
    'gnubok_search_tools',
    'gnubok_list_skills',
    'gnubok_load_skill',
    'gnubok_remember_fact',
    'gnubok_forget_fact',
    // Reports (the canonical analytical surface)
    'gnubok_get_income_statement',
    'gnubok_get_balance_sheet',
    'gnubok_get_trial_balance',
    'gnubok_get_general_ledger',
    'gnubok_get_kpi_report',
    'gnubok_get_vat_report',
    'gnubok_vat_close_check',
    'gnubok_get_ar_ledger',
    'gnubok_get_supplier_ledger',
    'gnubok_get_reconciliation_status',
    'gnubok_get_salary_journal',
    'gnubok_year_end_readiness',
    // Lookups across the working set
    'gnubok_query_journal',
    'gnubok_list_uncategorized_transactions',
    'gnubok_list_transactions_without_documents',
    'gnubok_list_invoices',
    'gnubok_list_customers',
    'gnubok_list_suppliers',
    'gnubok_list_supplier_invoices',
    'gnubok_list_accounts',
    'gnubok_list_fiscal_periods',
    'gnubok_list_employees',
    'gnubok_list_inbox_items',
    'gnubok_list_unmatched_documents',
    'gnubok_list_voucher_gaps',
    'gnubok_explain_voucher_gap',
    'gnubok_get_inbox_item',
    'gnubok_get_document_content',
    'gnubok_get_counterparty_templates',
    // Full access (Jacob 2026-09-18): the remaining read-only tools
    'gnubok_list_pending_operations',
    'gnubok_list_reconciliation_items',
    'gnubok_find_voucher_candidates_for_invoice',
    'gnubok_find_voucher_candidates_for_supplier_invoice',
    'gnubok_receipt_matcher',
    'gnubok_suggest_categories',
    'gnubok_list_verifikat_without_documents',
    'gnubok_get_invoice',
    'gnubok_get_invoice_deliveries',
    'gnubok_get_party',
    'gnubok_list_articles',
    'gnubok_list_cash_accounts',
    'gnubok_list_dimensions',
    'gnubok_list_dimension_values',
    'gnubok_get_dimension_pnl',
    'gnubok_list_accrual_schedules',
    'gnubok_propose_accruals',
    'gnubok_propose_annual_depreciation',
    'gnubok_propose_dispositioner',
    'gnubok_list_recurring_schedules',
    'gnubok_list_sales_orders',
    'gnubok_get_sales_order',
    'gnubok_get_company_settings',
    'gnubok_get_agent_briefing',
    'gnubok_list_companies',
    'gnubok_lookup_company',
    'gnubok_export_sie',
    'gnubok_sie_preflight',
    'gnubok_create_sie_upload',
    'gnubok_connect_bank',
    'gnubok_connect_skatteverket',
    'gnubok_connect_migration',
    'gnubok_vat_review_widget',
    'gnubok_vat_declaration_validate',
    'gnubok_vat_declaration_status',
    'gnubok_preview_ef_declaration',
    'gnubok_preview_arsredovisning',
    'gnubok_validate_arsredovisning',
    'gnubok_list_arsredovisning_versions',
    'gnubok_get_arsredovisning_filing_status',
    'gnubok_get_employee',
    'gnubok_get_salary_run',
    'gnubok_get_payslip',
    'gnubok_get_vacation_balance',
    'gnubok_list_absence',
    'gnubok_list_mileage_trips',
    'gnubok_list_rot_rut_payout_requests',
    'gnubok_agi_status',
  ],

  model: SONNET_MODEL,

  // Reason before answering: this is the broad chat surface where the agent
  // answered regulatory questions from memory and narrated its steps. Thinking
  // moves the reasoning into its own channel so the visible reply is a single
  // consolidated answer.
  thinking: { effort: EFFORT_STANDARD },

  capture: async ({ route }) => ({ route: route ?? null }),

  promptTemplate: ({ captured, profileSummary }) => {
    const lines: string[] = []
    if (profileSummary) {
      lines.push(`Företagets profil: ${profileSummary}`)
      lines.push('')
    }
    if (captured.route) {
      lines.push(`Användaren befinner sig på sidan: ${captured.route}`)
      lines.push('')
    }
    lines.push('Användaren öppnade ditt fönster med "Fråga min assistent". Inget specifikt ärende ännu.')
    lines.push('')
    lines.push(renderAgentGroundRules())
    lines.push('')
    lines.push('Härifrån kan du (använd verktygen: citera siffrorna):')
    lines.push('- LÄSA bolagets data: resultatrapport, balansrapport, KPI:er, momsrapport, huvudbok, kund-/leverantörsreskontra, lönejournal, transaktioner, fakturor, kunder, leverantörer, kontoplan, dokumentinkorg, verifikationsluckor. När användaren frågar något analytiskt: anropa rätt verktyg och svara med faktiska siffror, inte uppskattningar.')
    lines.push('- Svara på regelfrågor: bokföring, moms, lön, bokslut, deklaration. Ladda atominnehåll med gnubok_load_skill vid behov.')
    lines.push('- Söka i journalen efter motpart, beskrivning eller belopp via gnubok_query_journal (t.ex. "har jag bokfört detta förut?").')
    lines.push('- Komma ihåg fakta om bolaget via gnubok_remember_fact / gnubok_forget_fact.')
    lines.push('')
    lines.push('- UTFÖRA uppgifter som förslag användaren godkänner: kategorisera och bokföra banktransaktioner (gnubok_categorize_transaction, gnubok_match_transaction_to_invoice, gnubok_ignore_transaction, gnubok_bulk_book_transactions), bokföra underlag ur dokumentinkorgen (gnubok_bulk_book_inbox_items, gnubok_create_supplier_invoice_from_inbox, gnubok_approve_supplier_invoice), skapa och rätta verifikationer (gnubok_create_voucher, gnubok_correct_entry, gnubok_reverse_journal_entry, gnubok_set_voucher_note, gnubok_link_document_to_voucher, gnubok_attach_document_to_transaction), kundfakturor (gnubok_create_invoice, gnubok_update_invoice, gnubok_send_invoice, gnubok_mark_invoice_as_sent, gnubok_mark_invoice_as_paid, gnubok_credit_invoice), register (gnubok_create_customer, gnubok_update_customer, gnubok_create_supplier, gnubok_create_article, gnubok_update_article), koppla en banktransaktion till en BEFINTLIG verifikation (gnubok_link_transaction_to_journal_entry; hitta kandidater med gnubok_query_journal och gnubok_list_uncategorized_transactions), ångra en kategorisering (gnubok_uncategorize_transaction), avstämning (gnubok_reconcile_match, gnubok_reconcile_unmatch, gnubok_auto_match_period, gnubok_match_batch_allocate), koppla fakturor till verifikationer (gnubok_link_invoice_to_voucher, gnubok_link_supplier_invoice_to_voucher), samt periodlås, avskrivningar, bokslut, lön, moms och inställningar (se verktygslistan). Varje sådant anrop skapar ett förslag som visas som ett godkännandekort under ditt svar; ingenting bokförs förrän användaren klickar Godkänn.')
    lines.push('')
    lines.push('ARBETSGÅNG FÖR SKRIVÅTGÄRDER: (1) Hämta det du behöver först: transaktionen via gnubok_list_uncategorized_transactions eller gnubok_query_journal, underlaget via gnubok_list_inbox_items och gnubok_get_document_content, kund eller leverantör via gnubok_list_customers / gnubok_list_suppliers. (2) Kolla hur motparten bokförts förut med gnubok_query_journal({ text: "<motpart>", limit: 5 }) och följ mönstret om inte underlaget säger annat. (3) Om något är oklart (syfte, deltagare vid representation, belopp som inte stämmer, saknat underlag) ställ EN kort fråga med två eller tre alternativ innan du stagear, och spara svaret med gnubok_remember_fact. (4) Staga ett förslag per post med rätt id (transaction_id, document_id, invoice_id), aldrig gissade id:n. (5) Berätta INTE att du "stagear nu" eller att användaren ska "godkänna i appen", och upprepa inte siffror som kortet redan visar: avsluta med en eller två meningar om VARFÖR du valde som du valde. Saknas underlag helt: staga ändå om bokföringen är entydig och säg att kvittot ska bifogas till verifikationen (öppna den i Bokföring), annars be om underlaget till Dokumentinkorgen först.')
    lines.push('')
    lines.push('Du har FULL ÅTKOMST härifrån: allt som finns som verktyg gör du själv när användaren ber om det, även bokslut, periodlås, moms och inställningar. Säg aldrig att du bara kan läsa, att du saknar behörighet eller att användaren måste göra det själv i appen när ett verktyg finns; gör förslaget i stället. Ett misstag (fel makulering, fel konto, fel koppling) rättar du själv med verktygen (gnubok_correct_entry, gnubok_reverse_journal_entry, gnubok_create_voucher, gnubok_uncategorize_transaction). Påstå ALDRIG att du stagat något som du inte faktiskt anropat ett verktyg för.')
    lines.push('')
    lines.push('När användaren frågar VAR något finns i programmet eller HUR man gör något: svara med sidans namn och länk (appkartan ligger i dina minnen). Säg aldrig att du saknar tillgång till menystrukturen.')
    lines.push('')
    lines.push('Bra rytm för analytiska frågor: (1) anropa rätt läsverktyg, (2) svara med konkreta siffror från resultatet, (3) lägg till en kort förklaring eller nästa-steg-rekommendation om det är meningsfullt. Hellre verkligt svar än "gå till Rapporter och titta själv".')
    lines.push('')
    lines.push('Vänta in användarens fråga. Hälsa kort och fråga vad du kan hjälpa till med. Var direkt: svaret du skriver nu är det första användaren ser.')
    return lines.join('\n')
  },
})
