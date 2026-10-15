import { describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createQueuedMockSupabase } from '@/tests/helpers'
import { resolveChatAttachments, type ChatAttachmentResult } from '../attachments'

const { supabase, enqueue, reset, findCall, findCalls } = createQueuedMockSupabase()
const db = supabase as unknown as SupabaseClient

const DOC_1 = '11111111-1111-4111-8111-111111111111'
const DOC_2 = '22222222-2222-4222-8222-222222222222'

function doc(id: string, overrides: Record<string, unknown> = {}) {
  return { id, file_name: `${id.slice(0, 4)}.pdf`, mime_type: 'application/pdf', file_size_bytes: 120_000, ...overrides }
}

async function rejection(promise: Promise<ChatAttachmentResult>) {
  const result = await promise
  if (result.ok) throw new Error('expected a rejection')
  return result
}

beforeEach(() => {
  reset()
})

describe('resolveChatAttachments', () => {
  it('resolves each document with its newest inbox row, scoped to the company', async () => {
    enqueue({ data: [doc(DOC_2), doc(DOC_1, { mime_type: 'image/jpeg', file_name: 'kvitto.jpg' })] })
    enqueue({
      data: [
        { id: 'in-new', document_id: DOC_1, status: 'processing' },
        { id: 'in-old', document_id: DOC_1, status: 'ready' },
      ],
    })

    const out = await resolveChatAttachments(db, 'company-1', [DOC_1, DOC_2, DOC_1])

    expect(out.ok && out.attachments).toEqual([
      { documentId: DOC_1, inboxItemId: 'in-new', fileName: 'kvitto.jpg', mimeType: 'image/jpeg', inboxStatus: 'processing' },
      { documentId: DOC_2, inboxItemId: null, fileName: `${DOC_2.slice(0, 4)}.pdf`, mimeType: 'application/pdf', inboxStatus: null },
    ])
    // Both reads filter on the active company, beside RLS.
    expect(findCall('document_attachments', 'eq')).toEqual(['company_id', 'company-1'])
    expect(findCall('document_attachments', 'in')).toEqual(['id', [DOC_1, DOC_2]])
    expect(findCalls('invoice_inbox_items', 'eq')).toContainEqual(['company_id', 'company-1'])
  })

  it('answers 404 for an id the company cannot see, without saying why', async () => {
    enqueue({ data: [doc(DOC_1)] }) // DOC_2 belongs to another company: RLS + filter drop it
    const err = await rejection(resolveChatAttachments(db, 'company-1', [DOC_1, DOC_2]))
    expect(err.status).toBe(404)
    expect(findCalls('invoice_inbox_items', 'select')).toHaveLength(0)
  })

  it('rejects a stored type the chat does not read', async () => {
    enqueue({ data: [doc(DOC_1, { mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })] })
    const err = await rejection(resolveChatAttachments(db, 'company-1', [DOC_1]))
    expect(err.status).toBe(400)
    expect(err.message).toMatch(/Filtypen stöds inte/)
  })

  it('rejects a document without a resolved type', async () => {
    enqueue({ data: [doc(DOC_1, { mime_type: null })] })
    expect((await rejection(resolveChatAttachments(db, 'company-1', [DOC_1]))).status).toBe(400)
  })

  it('rejects a file above the 10 MB ceiling', async () => {
    enqueue({ data: [doc(DOC_1, { file_size_bytes: 10 * 1024 * 1024 + 1 })] })
    expect((await rejection(resolveChatAttachments(db, 'company-1', [DOC_1]))).status).toBe(400)
  })

  it('rejects more than five files before reading anything', async () => {
    const ids = Array.from({ length: 6 }, (_, i) => `${i}1111111-1111-4111-8111-111111111111`)
    expect((await rejection(resolveChatAttachments(db, 'company-1', ids))).status).toBe(400)
    expect(findCalls('document_attachments', 'select')).toHaveLength(0)
  })

  it('answers 500 with a fixed sentence, not the database text, when a read fails', async () => {
    enqueue({ error: { message: 'relation "document_attachments" does not exist', code: '42P01' } })
    const err = await rejection(resolveChatAttachments(db, 'company-1', [DOC_1]))
    expect(err.status).toBe(500)
    expect(err.message).toBe('Kunde inte läsa de bifogade filerna. Försök igen.')
  })

  it('answers 500 when the inbox read fails after the documents resolved', async () => {
    enqueue({ data: [doc(DOC_1)] })
    enqueue({ error: { message: 'timeout', code: '57014' } })
    expect((await rejection(resolveChatAttachments(db, 'company-1', [DOC_1]))).status).toBe(500)
  })

  it('reads nothing for an empty list', async () => {
    expect(await resolveChatAttachments(db, 'company-1', [])).toEqual({ ok: true, attachments: [] })
    expect(findCalls('document_attachments', 'select')).toHaveLength(0)
  })
})
