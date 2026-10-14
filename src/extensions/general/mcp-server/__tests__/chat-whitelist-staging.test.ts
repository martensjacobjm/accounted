import { describe, it, expect } from 'vitest'
import { tools, isStagingTool } from '../server'
import { generalHelp } from '@/lib/agent/intents/general-help'

// The /chat assistant (general.help) may only reach tools that either read
// without side effects or STAGE a pending_operation the user approves in an
// ApprovalCard. This guard reads the real MCP registry, so a direct-commit
// writer added to the whitelist fails here instead of committing from chat.
// (It lives under the extension because core code may not import
// @/extensions/*: see .github/workflows/core-build.yml.)

type Tool = (typeof tools)[number]

// Writers that do not stage, reviewed one by one and kept on purpose:
//   sync_bank: pulls PSD2 bank rows (no booking), Jacob 2026-09-18
//   remember_fact / forget_fact: chat memory, surfaced as a memory chip
const REVIEWED_NON_STAGING_WRITERS = new Set([
  'gnubok_sync_bank',
  'gnubok_remember_fact',
  'gnubok_forget_fact',
])

// Batch writers: they stage one pending_operation per row and return the
// envelopes as `operations` (create_transactions declares it in outputSchema;
// auto_match_period returns it without declaring it, payload budget, and
// auto-match-period.test.ts proves the runtime shape).
const BATCH_STAGING_WRITERS = new Set(['gnubok_create_transactions', 'gnubok_auto_match_period'])

function byName(name: string): Tool | undefined {
  return tools.find((t) => t.name === name)
}

function isReadOnly(t: Tool): boolean {
  return (t as { annotations?: { readOnlyHint?: boolean } }).annotations?.readOnlyHint === true
}

/** A batch writer: `operations` is an array of staged-operation envelopes. */
function stagesPerRow(t: Tool): boolean {
  const items = (t.outputSchema as { properties?: { operations?: { items?: Record<string, unknown> } } } | undefined)
    ?.properties?.operations?.items
  return items !== undefined && isStagingTool({ outputSchema: items })
}

describe('general.help whitelist against the real tool registry', () => {
  it('every whitelisted tool is registered', () => {
    const missing = generalHelp.tools.filter((n) => !byName(n))
    expect(missing).toEqual([])
  })

  it('every whitelisted tool reads, stages, or is a reviewed exception', () => {
    const offenders = generalHelp.tools.filter((n) => {
      const t = byName(n)
      if (!t) return false
      return !isReadOnly(t) && !isStagingTool(t) && !BATCH_STAGING_WRITERS.has(n) && !REVIEWED_NON_STAGING_WRITERS.has(n)
    })
    expect(offenders).toEqual([])
  })

  it('create_transactions declares one staged envelope per row', () => {
    const t = byName('gnubok_create_transactions')
    expect(t).toBeDefined()
    expect(stagesPerRow(t as Tool)).toBe(true)
  })

  it('the batch-writer exception covers only tools that can stage', () => {
    for (const n of BATCH_STAGING_WRITERS) {
      const t = byName(n)
      expect(t, n).toBeDefined()
      expect(isReadOnly(t as Tool), n).toBe(false)
      expect(generalHelp.tools).toContain(n)
    }
  })

  it('the write tools added 2026-10-15 all stage', () => {
    for (const n of ['gnubok_create_asset', 'gnubok_update_asset', 'gnubok_dispose_asset', 'gnubok_link_rot_rut_payout_voucher', 'gnubok_propose_fact']) {
      const t = byName(n)
      expect(t, n).toBeDefined()
      expect(isStagingTool(t as Tool), n).toBe(true)
      expect(generalHelp.tools).toContain(n)
    }
  })

  it('the tools kept off the list really write without staging (the reason they are out)', () => {
    const directWriters = [
      'gnubok_calculate_salary_run',
      'gnubok_generate_rot_rut_file',
      'gnubok_import_rot_rut_beslut',
      'gnubok_audit_package',
      'gnubok_set_quote_status',
      'gnubok_set_inbox_extracted_data',
      'gnubok_upload_document',
      'gnubok_create_document_upload',
      'gnubok_complete_document_upload',
      'gnubok_resolve_missing',
      'gnubok_approve_pending_operation',
    ]
    for (const n of directWriters) {
      const t = byName(n)
      expect(t, n).toBeDefined()
      expect(isReadOnly(t as Tool) || isStagingTool(t as Tool), n).toBe(false)
      expect(generalHelp.tools).not.toContain(n)
    }
  })
})
