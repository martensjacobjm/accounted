import { describe, it, expect } from 'vitest'
import { routeToIntent, contextRefToTarget } from '../route-mapping'

describe('routeToIntent without the tool-loop runtime', () => {
  // getAiStatus().assistantAvailable is false on an OpenAI-compatible or
  // unconfigured deployment (#2204): the trigger keeps working on the
  // single-call console, so every route collapses onto general.help.
  it('dispatches every specialized route to general.help', () => {
    for (const route of [
      '/invoices/new',
      '/invoices/3f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b',
      '/supplier-invoices/5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d',
      '/bookkeeping/year-end',
      '/kpi',
      '/settings/invoicing',
    ]) {
      const out = routeToIntent(route, { assistantAvailable: false })
      expect(out.intentId).toBe('general.help')
      expect(out.intentArgs.route).toBe(route)
      // Fork: the fallback is page-aware, so it anchors to the page or entity.
      expect(out.contextRef).toMatch(/^(page:|invoice:|supplier_invoice:|journal_entry:)/)
    }
  })

  it('leaves the specialized dispatch alone when the option is omitted or true', () => {
    expect(routeToIntent('/kpi').intentId).toBe('kpi.explain')
    expect(routeToIntent('/kpi', { assistantAvailable: true }).intentId).toBe('kpi.explain')
  })
})

describe('routeToIntent', () => {
  it('falls back to general.help when pathname is null/undefined/empty', () => {
    for (const input of [null, undefined, '']) {
      const out = routeToIntent(input as string | null | undefined)
      expect(out.intentId).toBe('general.help')
      expect(out.labelSuffix).toBeNull()
    }
  })

  it('routes the root and list pages to general.help', () => {
    for (const route of ['/', '/transactions', '/invoices', '/customers', '/reports']) {
      const out = routeToIntent(route)
      expect(out.intentId).toBe('general.help')
      expect(out.intentArgs.route).toBe(route)
      expect(out.contextRef).toBe(`page:${route}`)
    }
    // Fork: list pages say what they are about in the pill label.
    expect(routeToIntent('/transactions').labelSuffix).toBe('om transaktionerna')
    expect(routeToIntent('/').labelSuffix).toBeNull()
  })

  it('routes /invoices/new to invoice.draft without an id', () => {
    const out = routeToIntent('/invoices/new')
    expect(out.intentId).toBe('invoice.draft')
    expect(out.intentArgs).toEqual({})
    expect(out.contextRef).toBeUndefined()
    expect(out.labelSuffix).toBe('om denna faktura')
  })

  it('routes /invoices/[id] to invoice.draft with the id', () => {
    const out = routeToIntent('/invoices/3f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b')
    expect(out.intentId).toBe('invoice.draft')
    expect(out.intentArgs).toEqual({ invoice_id: '3f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b' })
    expect(out.contextRef).toBe('invoice:3f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b')
    expect(out.labelSuffix).toBe('om denna faktura')
  })

  it('routes /invoices/[id]/credit to invoice.draft with the parent id', () => {
    // The credit-note form is still an invoice context: same intent, same
    // captured entity. The :credit suffix isn't its own intent.
    const out = routeToIntent('/invoices/3f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b/credit')
    expect(out.intentId).toBe('invoice.draft')
    expect(out.intentArgs).toEqual({ invoice_id: '3f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b' })
    expect(out.contextRef).toBe('invoice:3f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b')
  })

  it('routes /supplier-invoices/[id] to supplier_invoice.review', () => {
    const out = routeToIntent('/supplier-invoices/5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d')
    expect(out.intentId).toBe('supplier_invoice.review')
    expect(out.intentArgs).toEqual({ supplier_invoice_id: '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d' })
    expect(out.contextRef).toBe('supplier_invoice:5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d')
    expect(out.labelSuffix).toBe('om denna leverantörsfaktura')
  })

  it('does NOT route /supplier-invoices/new to supplier_invoice.review (no entity yet)', () => {
    // There's no invoice to review yet: fall through so the Opus intent
    // doesn't fire on an empty capture.
    const out = routeToIntent('/supplier-invoices/new')
    expect(out.intentId).toBe('general.help')
  })

  it('falls through /bookkeeping/[id] to general.help (FAB is suppressed on the verifikation editor)', () => {
    // The verifikation editor is a dense regulatory surface; AgentTrigger
    // hides the FAB on /bookkeeping/[id] entirely. routeToIntent still
    // returns a sensible default in case anything else queries it.
    const out = routeToIntent('/bookkeeping/je-7')
    expect(out.intentId).toBe('general.help')
    expect(out.intentArgs.route).toBe('/bookkeeping/je-7')
    // Fork: the pill is back on the editor and knows the page (the id here is
    // not a uuid, so no entity is read from it).
    expect(out.labelSuffix).toBe('om verifikationen')
    expect(out.contextRef).toBe('page:/bookkeeping/je-7')
  })

  it('routes /bookkeeping/year-end to bokslut.step (matches the page button: no two-agents-on-one-page)', () => {
    const out = routeToIntent('/bookkeeping/year-end')
    expect(out.intentId).toBe('bokslut.step')
    expect(out.intentArgs).toEqual({ step_id: null })
    expect(out.contextRef).toBe('bokslut:overview')
    expect(out.labelSuffix).toBe('om bokslutet')
  })

  it('routes /kpi to kpi.explain (matches the page button)', () => {
    const out = routeToIntent('/kpi')
    expect(out.intentId).toBe('kpi.explain')
    expect(out.intentArgs).toEqual({ kpi_key: 'översikt' })
    expect(out.contextRef).toBe('kpi:översikt')
    expect(out.labelSuffix).toBe('om nyckeltalen')
  })

  it('does NOT route bare /bookkeeping list page to verifikation.draft', () => {
    const out = routeToIntent('/bookkeeping')
    expect(out.intentId).toBe('general.help')
  })

  it('routes /settings/<panel> to settings.help with the panel slug', () => {
    const out = routeToIntent('/settings/invoicing')
    expect(out.intentId).toBe('settings.help')
    expect(out.intentArgs).toEqual({ panel: 'invoicing' })
    expect(out.labelSuffix).toBeNull()
  })

  it('takes the first segment after /settings as the panel slug (ignores deeper paths)', () => {
    const out = routeToIntent('/settings/invoicing/templates/new')
    expect(out.intentId).toBe('settings.help')
    expect(out.intentArgs).toEqual({ panel: 'invoicing' })
  })

  it('routes bare /settings without a panel slug to general.help', () => {
    const out = routeToIntent('/settings')
    expect(out.intentId).toBe('general.help')
  })
})

describe('contextRefToTarget', () => {
  /**
   * Every shape the app actually writes. Collected by grepping the call sites
   * rather than invented, so a new intent that writes a ref this cannot read
   * shows up as a chip that never renders, not as a wrong link.
   */
  it('resolves each ref the app writes today', () => {
    expect(contextRefToTarget('invoice:3f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b')).toEqual({
      label: 'Faktura',
      href: '/invoices/3f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    })
    expect(contextRefToTarget('supplier_invoice:3f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b')).toEqual({
      label: 'Leverantörsfaktura',
      href: '/supplier-invoices/3f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    })
    expect(contextRefToTarget('transaction:3f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b')).toEqual({
      label: 'Transaktion',
      href: '/transactions',
    })
    expect(contextRefToTarget('verifikation:new')).toEqual({
      label: 'Verifikation',
      href: '/bookkeeping',
    })
    expect(contextRefToTarget('bokslut:overview')).toEqual({
      label: 'Bokslut',
      href: '/bookkeeping/year-end',
    })
    expect(contextRefToTarget('kpi:översikt')).toEqual({ label: 'Nyckeltal', href: '/kpi' })
  })

  it('names the document inbox without linking it', () => {
    // It is an extension route under /e/[sector]; core cannot hardcode a path
    // that only exists when the extension is enabled.
    expect(contextRefToTarget('inbox:bulk')).toEqual({
      label: 'Dokumentinkorgen',
      href: null,
    })
  })

  it('returns nothing rather than a broken chip for refs it cannot read', () => {
    expect(contextRefToTarget(null)).toBeNull()
    expect(contextRefToTarget(undefined)).toBeNull()
    expect(contextRefToTarget('')).toBeNull()
    expect(contextRefToTarget('invoice')).toBeNull()
    expect(contextRefToTarget('invoice:')).toBeNull()
    expect(contextRefToTarget(':abc')).toBeNull()
    expect(contextRefToTarget('flow_run:abc')).toBeNull()
  })

  it('keeps ids that need escaping out of the path', () => {
    // Ids reach this from the database, not from the router.
    expect(contextRefToTarget('invoice:a b/c')?.href).toBe('/invoices/a%20b%2Fc')
  })

  it('keeps the id intact when it contains a colon', () => {
    // Split on the FIRST colon. Asserted on a kind that PUTS the id in the
    // href: kpi discards its id, so the same assertion there would pass even
    // if the parser dropped everything after the second colon.
    expect(contextRefToTarget('invoice:abc:2026')?.href).toBe('/invoices/abc%3A2026')
  })

  it('fork: page segments are not entity ids (rot-rut, recurring, payment-files)', () => {
    for (const path of ['/invoices/rot-rut', '/invoices/recurring', '/supplier-invoices/payment-files']) {
      expect(routeToIntent(path).intentId).toBe('general.help')
    }
    expect(routeToIntent('/invoices/3f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b').intentId).toBe('invoice.draft')
  })
})
