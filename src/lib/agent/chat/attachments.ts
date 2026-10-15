import type { SupabaseClient } from '@supabase/supabase-js'
import { createLogger } from '@/lib/logger'
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MIME_TYPES,
  MAX_CHAT_ATTACHMENTS,
  type ChatAttachmentRef,
} from './attachment-block'

const log = createLogger('agent.chat.attachments')

/**
 * Outcome of resolving a turn's attachment ids. A rejection is a value, not
 * an exception: `message` is a fixed Swedish sentence written here (never a
 * caught error's text) that the composer shows verbatim, in the invoke
 * route's `{ error }` shape.
 */
export type ChatAttachmentResult =
  | { ok: true; attachments: ChatAttachmentRef[] }
  | { ok: false; status: 400 | 404 | 500; message: string }

function reject(status: 400 | 404 | 500, message: string): ChatAttachmentResult {
  return { ok: false, status, message }
}

const READ_FAILED = 'Kunde inte läsa de bifogade filerna. Försök igen.'

interface DocumentRow {
  id: string
  file_name: string | null
  mime_type: string | null
  file_size_bytes: number | null
}

interface InboxRow {
  id: string
  document_id: string | null
  status: string | null
}

/**
 * Resolve the document ids a chat turn references into what the model is
 * told about each file. Every read is scoped to `companyId` (defense in depth
 * beside RLS), and an id that is missing and an id that belongs to another
 * company answer the same 404, so the route never confirms a foreign id.
 *
 * Type and size are checked on the archived row, not on anything the client
 * said: the document service resolved the type from the file's magic bytes.
 */
export async function resolveChatAttachments(
  supabase: SupabaseClient,
  companyId: string,
  documentIds: readonly string[],
): Promise<ChatAttachmentResult> {
  const ids = [...new Set(documentIds)]
  if (ids.length === 0) return { ok: true, attachments: [] }
  if (ids.length > MAX_CHAT_ATTACHMENTS) {
    return reject(400, `Du kan bifoga högst ${MAX_CHAT_ATTACHMENTS} filer per meddelande.`)
  }

  const { data: docs, error: docError } = await supabase
    .from('document_attachments')
    .select('id, file_name, mime_type, file_size_bytes')
    .eq('company_id', companyId)
    .in('id', ids)
  if (docError) {
    log.error('document_attachments read failed', { companyId, code: docError.code, detail: docError.message })
    return reject(500, READ_FAILED)
  }

  const byId = new Map(((docs ?? []) as DocumentRow[]).map((d) => [d.id, d]))
  if (ids.some((id) => !byId.has(id))) {
    return reject(404, 'En bifogad fil hittades inte. Ladda upp den igen.')
  }
  for (const doc of byId.values()) {
    if (!doc.mime_type || !CHAT_ATTACHMENT_MIME_TYPES.has(doc.mime_type)) {
      return reject(400, 'Filtypen stöds inte i chatten. Bifoga en PDF eller en bild (JPEG, PNG, WebP eller HEIC).')
    }
    if ((doc.file_size_bytes ?? 0) > CHAT_ATTACHMENT_MAX_BYTES) {
      return reject(400, 'En bifogad fil är större än 10 MB.')
    }
  }

  const { data: inbox, error: inboxError } = await supabase
    .from('invoice_inbox_items')
    .select('id, document_id, status')
    .eq('company_id', companyId)
    .in('document_id', ids)
    .order('created_at', { ascending: false })
  if (inboxError) {
    log.error('invoice_inbox_items read failed', { companyId, code: inboxError.code, detail: inboxError.message })
    return reject(500, READ_FAILED)
  }

  // Newest first, so a document that was deduplicated onto an older upload
  // points at its most recent inbox row.
  const inboxByDoc = new Map<string, InboxRow>()
  for (const row of (inbox ?? []) as InboxRow[]) {
    if (row.document_id && !inboxByDoc.has(row.document_id)) inboxByDoc.set(row.document_id, row)
  }

  const attachments = ids.map((id) => {
    const doc = byId.get(id) as DocumentRow
    const item = inboxByDoc.get(id)
    return {
      documentId: id,
      inboxItemId: item?.id ?? null,
      fileName: doc.file_name ?? 'dokument',
      mimeType: doc.mime_type,
      inboxStatus: item?.status ?? null,
    }
  })
  return { ok: true, attachments }
}
