import { describe, expect, it } from 'vitest'
import { describePage, renderPageContext } from '../page-context'

describe('describePage', () => {
  it('names the transactions page and points at the tools to call first', () => {
    const ctx = describePage('/transactions', '?status=uncategorized&period=2026-08')
    expect(ctx.title).toContain('Transaktioner')
    expect(ctx.labelSuffix).toBe('om transaktionerna')
    expect(ctx.toolsFirst[0]).toBe('gnubok_list_uncategorized_transactions')
    expect(ctx.params).toEqual({ status: 'uncategorized', period: '2026-08' })
    expect(ctx.contextRef).toBe('page:/transactions')
  })
  it('reads the entity id from [id] pages but not from named sub-pages', () => {
    const id = '11111111-1111-1111-1111-111111111111'
    expect(describePage(`/customers/${id}`).entity).toEqual({ kind: 'customer', id, label: null })
    expect(describePage(`/customers/${id}`).contextRef).toBe(`customer:${id}`)
    expect(describePage('/invoices/new').entity).toBeNull()
    expect(describePage('/invoices/rot-rut').title).toContain('RUT')
    expect(describePage('/bookkeeping/periodiseringar').entity).toBeNull()
  })
  it('falls back to a generic description for unknown routes and the root', () => {
    expect(describePage('/something-new').title).toBe('Sidan /something-new')
    expect(describePage(null).title).toBe('Hem')
    expect(describePage('/e/general/invoice-inbox').title).toBe('Tillägg: invoice-inbox')
  })
  it('renders the prompt block with focus and the opening instruction', () => {
    const ctx = describePage('/skattekonto')
    const out = renderPageContext(ctx, { kind: 'skattekonto_row', id: 'row-1', label: '2026-02-12 Moms okt-dec 2025 -3 913' }).join('\n')
    expect(out).toContain('SIDAN ANVÄNDAREN ÄR PÅ: Skattekonto')
    expect(out).toContain('I FOKUS: skattekonto_row id=row-1 (2026-02-12 Moms okt-dec 2025 -3 913)')
    expect(out).toContain('gnubok_book_skattekonto_row')
    expect(out).toContain('ÖPPNING:')
  })
})
