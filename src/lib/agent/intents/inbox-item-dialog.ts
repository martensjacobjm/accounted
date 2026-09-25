import { defineAgentIntent } from './types'
import { SONNET_MODEL, EFFORT_STANDARD } from '@/lib/agent/composer/client'
import { accountFromNote, liabilityFromNote } from '@/lib/expenses/suggest-expense-account'
import type { InboxChannelContext, InvoiceExtractionResult } from '@/types'
import { renderChannelContextForModel } from '@/lib/documents/channel-context-notes'
import { ACCOUNT_NUMBER_RE } from '@/lib/invariants'

// inbox.item-dialog: "Prata med assistenten om underlaget" on ONE item in the
// Underlag pane (bok.dalavs.se fork, Jacob 2026-09-22: "man ska kunna prata med
// den direkt där. Den frågar vad det är eller vad den nu behöver veta, man
// svarar och får förslag på vad och vart den ska bokföras").
//
// Unlike transaction.categorization it needs no bank transaction: a receipt
// paid with the owner's own money has none. The assistant opens the
// conversation, asks only for what it cannot read (what was bought, who
// paid), proposes the cost account and the counter account, and on a "ja"
// stages a voucher WITH the underlag attached (gnubok_create_voucher with
// inbox_item_id, BFL 5 kap 6 §), which the approval card then commits.

interface InboxItemDialogArgs {
  item_id: string
  /** Fork 2026-09-25: the pane's "Vem betalade?" choice, so the assistant does not ask it again. */
  payer?: PaneChoice
}

type PaneChoice = 'company' | 'owner' | 'employee' | 'unpaid'
const PAYER_TEXT: Record<PaneChoice, string> = {
  company: 'företagskontot',
  owner: 'egna pengar (utlägg av ägaren)',
  employee: 'en anställd (utlägg, skuld 2820)',
  unpaid: 'obetald, ska betalas (2440)',
}
function paneChoice(v: unknown): PaneChoice | null {
  return typeof v === 'string' && v in PAYER_TEXT ? (v as PaneChoice) : null
}

type MatchedTx = { id: string; date: string | null; amount: number | null; description: string | null } | null

interface CapturedInboxItem {
  item: {
    item_id: string
    status: 'open' | 'matched' | 'already_booked'
    document_id: string | null
    kind: string | null
    merchant_name: string | null
    invoice_date: string | null
    total: number | null
    vat_amount: number | null
    currency: string | null
    suggested_account: string | null
    merchant_category: string | null
    line_items: string[]
    /** The comment typed at upload (web) or in the WhatsApp intake. */
    uploader_note: string | null
    /** Fork: other human text on the item (WhatsApp answers, caption, representation, mail subject). */
    other_text: string[]
    note_account: string | null
    note_liability: string | null
    matched_tx: MatchedTx
  } | null
  entity_type: string | null
  /** Fork: what the person picked under "Vem betalade?" in the pane, when opened from there. */
  payer: PaneChoice | null
}

export const inboxItemDialog = defineAgentIntent<InboxItemDialogArgs, CapturedInboxItem>({
  id: 'inbox.item-dialog',
  buttonLabel: 'Prata om underlaget',
  sheetTitle: 'Underlaget',

  atoms: {
    mode: 'declarative',
    horizontal: ['swedish-vat', 'swedish-accounting-compliance'],
    includeCompanyVertical: true,
    includeCompanyModifiers: true,
  },

  tools: [
    'gnubok_get_inbox_item',
    'gnubok_get_document_content',
    'gnubok_query_journal',
    'gnubok_list_accounts',
    'gnubok_suggest_categories',
    'gnubok_create_voucher',
    // Fork 2026-09-22: a matched item is booked through its bank row, so the
    // row and the underlag end up on one verifikat instead of two.
    'gnubok_categorize_transaction',
    'gnubok_load_skill',
    'gnubok_search_tools',
    'gnubok_remember_fact',
    'gnubok_forget_fact',
  ],

  model: SONNET_MODEL,
  thinking: { effort: EFFORT_STANDARD },

  capture: async ({ item_id, payer: rawPayer }, { supabase, companyId }) => {
    const payer = paneChoice(rawPayer)
    const { data: company } = await supabase.from('companies').select('entity_type').eq('id', companyId).maybeSingle()
    const entityType = (company as { entity_type?: string | null } | null)?.entity_type ?? null
    if (typeof item_id !== 'string' || !item_id) return { item: null, entity_type: entityType, payer }

    const { data: row } = await supabase
      .from('invoice_inbox_items')
      .select(
        'id, document_id, kind_hint, matched_transaction_id, created_journal_entry_id, created_supplier_invoice_id, extracted_data, channel_context',
      )
      .eq('company_id', companyId)
      .eq('id', item_id)
      .maybeSingle()
    if (!row) return { item: null, entity_type: entityType, payer }

    const ex = (row.extracted_data ?? null) as InvoiceExtractionResult | null
    const ctx = (row.channel_context ?? null) as InboxChannelContext | null
    const note = ctx?.user_note?.trim() || null

    let matchedTx: MatchedTx = null
    if (row.matched_transaction_id) {
      const { data: tx } = await supabase
        .from('transactions')
        .select('id, date, amount, description')
        .eq('company_id', companyId)
        .eq('id', row.matched_transaction_id as string)
        .maybeSingle()
      if (tx) {
        matchedTx = {
          id: (tx.id as string | null) ?? (row.matched_transaction_id as string),
          date: (tx.date as string | null) ?? null,
          amount: tx.amount == null ? null : Number(tx.amount),
          description: (tx.description as string | null) ?? null,
        }
      }
    }

    // A number in the comment is an account only if the company has it (fork
    // 2026-09-22): "laptop 6995 kr" is a price. No chart read, no account.
    const { data: chartRows } = await supabase
      .from('chart_of_accounts')
      .select('account_number')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .limit(3000)
    const chart = new Set(
      ((chartRows ?? []) as Array<{ account_number: string | number | null }>)
        .map((r) => (r.account_number == null ? '' : String(r.account_number)))
        .filter((n) => ACCOUNT_NUMBER_RE.test(n)),
    )

    const status: NonNullable<CapturedInboxItem['item']>['status'] =
      row.created_journal_entry_id || row.created_supplier_invoice_id
        ? 'already_booked'
        : row.matched_transaction_id
          ? 'matched'
          : 'open'

    return {
      entity_type: entityType,
      payer,
      item: {
        item_id: row.id as string,
        status,
        document_id: (row.document_id as string | null) ?? null,
        kind: (row.kind_hint as string | null) ?? ex?.documentKind ?? null,
        merchant_name: ex?.supplier?.name ?? null,
        invoice_date: ex?.invoice?.invoiceDate ?? null,
        total: ex?.totals?.total ?? null,
        vat_amount: ex?.totals?.vatAmount ?? null,
        currency: ex?.invoice?.currency ?? null,
        suggested_account: ex?.suggestedAccount ?? null,
        merchant_category: ex?.merchantCategory ?? null,
        line_items: (ex?.lineItems ?? [])
          .map((l) => (l?.description ?? '').trim())
          .filter((d) => d.length > 0)
          .slice(0, 12),
        uploader_note: note,
        other_text: renderChannelContextForModel(ctx).filter((l) => !l.startsWith('Uppladdarens kommentar:')),
        note_account: chart.size > 0 ? accountFromNote(note, chart) : null,
        note_liability: liabilityFromNote(note),
        matched_tx: matchedTx,
      },
    }
  },

  promptTemplate: ({ captured, profileSummary, activeMemory }) => {
    const lines: string[] = []
    if (profileSummary) lines.push(`Företagets profil: ${profileSummary}`, '')
    if (activeMemory.length > 0) {
      lines.push('Företagets regler (byråns minnen, följ dem):')
      for (const m of activeMemory.slice(0, 8)) lines.push(`  • ${m.content}`)
      lines.push('')
    }

    const it = captured.item
    if (!it) {
      return [
        ...lines,
        'Användaren öppnade samtalet från ett underlag i Dokumentinkorgen, men underlaget kunde inte läsas.',
        'Be användaren välja underlaget igen.',
      ].join('\n')
    }

    const money = it.total != null ? `${it.total.toLocaleString('sv-SE')} ${it.currency ?? 'SEK'}` : 'belopp okänt'
    const vat = it.vat_amount != null ? `${it.vat_amount.toLocaleString('sv-SE')} ${it.currency ?? 'SEK'}` : 'moms okänd'
    lines.push('Användaren vill prata om ETT underlag i Dokumentinkorgen och få det bokfört.')
    lines.push('')
    lines.push('UNDERLAGET:')
    lines.push(`  item_id=${it.item_id}`)
    lines.push(`  typ=${it.kind ?? 'okänd'} (kvitto = redan betalt, leverantörsfaktura = ska betalas)`)
    lines.push(`  motpart=${it.merchant_name ?? 'okänd'}, datum=${it.invoice_date ?? 'okänt'}, belopp=${money}, moms=${vat}`)
    if (it.merchant_category) lines.push(`  kategori enligt tolkningen=${it.merchant_category}`)
    if (it.line_items.length > 0) lines.push(`  rader: ${it.line_items.join('; ')}`)
    if (it.suggested_account) lines.push(`  kostnadskonto föreslaget av tolkningen=${it.suggested_account}`)
    if (it.uploader_note) {
      lines.push(`  KOMMENTAR FRÅN DEN SOM LADDADE UPP (verifierad människa, väger tyngre än tolkningen): "${it.uploader_note}"`)
      if (it.note_account) lines.push(`  kontonummer i kommentaren=${it.note_account} (använd det)`)
      if (it.note_liability) lines.push(`  motkonto i kommentaren=${it.note_liability} (använd det)`)
    }
    for (const l of it.other_text ?? []) lines.push(`  ${l} (sagt av en människa om underlaget; sammanhang, inte konto eller belopp)`)
    if (it.status === 'already_booked') lines.push('  STATUS: redan bokfört. Bokför inte igen; svara på frågor om det.')
    else if (it.matched_tx)
      lines.push(
        `  STATUS: matchat mot banktransaktion transaction_id=${it.matched_tx.id} ${it.matched_tx.date ?? ''} ${it.matched_tx.amount != null ? it.matched_tx.amount.toLocaleString('sv-SE') + ' SEK' : ''} "${it.matched_tx.description ?? ''}": betalt från företagskontot. Bokför det genom banktransaktionen med gnubok_categorize_transaction({ transaction_id: "${it.matched_tx.id}", category, account_override: kostnadskontot, vat_treatment, notes: vad som köpts }); underlaget följer då med till verifikationen. Använd INTE gnubok_create_voucher här: då blir banktransaktionen obokad och händelsen bokförs två gånger.`,
      )
    else lines.push('  STATUS: ingen banktransaktion är matchad. Då är det antingen betalt med egna pengar (motkonto 2018 egna insättningar i enskild firma och handels-/kommanditbolag, 2893 skuld till ägaren i aktiebolag, om inte företagets regler säger annat) eller en obetald faktura (2440).')
    lines.push(`  bolagsform enligt registret=${captured.entity_type ?? 'okänd'}`)
    if (captured.payer && it.status !== 'already_booked') {
      lines.push(`  VEM BETALADE (valt av användaren i rutan): ${PAYER_TEXT[captured.payer]}. Fråga inte hur det betalades; utgå från det valet i förslaget.`)
    }
    lines.push('')
    lines.push('Arbetssätt:')
    lines.push('- DU BÖRJAR samtalet. Säg i en mening vad du ser (motpart, belopp, vad som köpts) och ställ BARA de frågor du inte kan besvara ur underlaget och kommentaren: vad köptes/vad ska det användas till, och vem betalade (företagskontot, egna pengar, obetalt). Finns svaren redan i kommentaren eller reglerna: fråga inte, föreslå direkt.')
    lines.push('- Läs dokumentet med gnubok_get_document_content om raderna ovan inte räcker. Kolla hur motparten bokförts förut med gnubok_query_journal({ text: "<motpart>", limit: 5 }) och följ mönstret om underlaget inte motsäger det.')
    lines.push('- FÖRSLAGET ska alltid innehålla: kostnadskonto (BAS 4-siffrigt, t.ex. 5460 förbrukningsmaterial, 5480 arbetskläder, 5611 drivmedel, 5800 resekostnader, 6110 kontorsmaterial, 6540 IT-tjänster), momskonto 2641 med beloppet från underlaget (ingen moms på utländska kvitton utan svensk moms), motkonto (1930 / 2018 / 2893 / 2440) och datum = underlagets datum. Visa raderna som en kort tabell och fråga "Ska jag bokföra så?".')
    if (it.matched_tx) {
      lines.push('- När användaren säger ja: anropa gnubok_categorize_transaction för transaction_id=' + it.matched_tx.id + ' (se STATUS ovan). Godkännandekortet visar beloppen; upprepa dem inte och säg inte att något är "stagat".')
    } else {
      lines.push('- När användaren säger ja: anropa gnubok_create_voucher med inbox_item_id=' + it.item_id + ' och raderna, så att underlaget blir verifikationen (BFL 5 kap 6 §). Godkännandekortet visar beloppen; upprepa dem inte och säg inte att något är "stagat".')
    }
    lines.push('- Lär dig: när användaren rättar dig eller ger en regel som gäller framåt ("allt som är privat betalt går på 2018"), spara den med gnubok_remember_fact.')
    lines.push('- Svara på svenska, kort och direkt. Inga kontonummer i löptext utom i förslagstabellen.')
    return lines.join('\n')
  },
})
