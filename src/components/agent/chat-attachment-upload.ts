import { exceedsHostedUploadLimit } from '@/lib/documents/upload-size'
import { shrinkImageForUpload } from '@/lib/documents/shrink-image'
import { uploadViaSignedUrl } from '@/lib/documents/direct-upload'
import { getResponseErrorMessage, type ErrorLocale } from '@/lib/errors/get-error-message'
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MIME_TYPES,
} from '@/lib/agent/chat/attachment-block'

// Chat attachments go through the document inbox's own upload route, by URL
// (core never imports an extension): same server-side type, size and
// magic-byte checks, the same per-company rate limit, and the same WORM
// archive. The file lands as a normal inbox item, so it is also there for the
// user on the inbox page, and its extraction starts right away.
const INBOX_UPLOAD_URL = '/api/extensions/ext/invoice-inbox/upload'

export type ChatAttachmentUploadFailure = 'unsupported_type' | 'too_large' | 'failed'

export class ChatAttachmentUploadError extends Error {
  constructor(
    readonly reason: ChatAttachmentUploadFailure,
    /** The server's own sentence, when it gave one. */
    readonly serverMessage: string | null = null,
  ) {
    super(serverMessage ?? reason)
    this.name = 'ChatAttachmentUploadError'
  }
}

export interface UploadedChatAttachment {
  documentId: string
  inboxItemId: string | null
}

/** Client-side pre-check; the server checks again on the stored bytes. */
export function chatAttachmentRejection(file: File): ChatAttachmentUploadFailure | null {
  if (!CHAT_ATTACHMENT_MIME_TYPES.has(file.type)) return 'unsupported_type'
  return null
}

/**
 * Upload one attachment. A phone photo above the hosted request-body limit is
 * shrunk first; what still does not fit (a scanned PDF) goes straight to
 * Storage through a signed URL, exactly as the inbox page does it.
 */
export async function uploadChatAttachment(
  original: File,
  locale: ErrorLocale,
): Promise<UploadedChatAttachment> {
  const rejection = chatAttachmentRejection(original)
  if (rejection) throw new ChatAttachmentUploadError(rejection)

  const file = exceedsHostedUploadLimit(original.size)
    ? await shrinkImageForUpload(original)
    : original
  if (file.size > CHAT_ATTACHMENT_MAX_BYTES) throw new ChatAttachmentUploadError('too_large')

  let res: Response
  try {
    if (exceedsHostedUploadLimit(file.size)) {
      res = await uploadViaSignedUrl(file)
    } else {
      const form = new FormData()
      form.append('file', file)
      res = await fetch(INBOX_UPLOAD_URL, { method: 'POST', body: form })
    }
  } catch {
    throw new ChatAttachmentUploadError('failed')
  }

  if (!res.ok) {
    throw new ChatAttachmentUploadError('failed', await getResponseErrorMessage(res, undefined, locale))
  }
  const json = (await res.json().catch(() => null)) as {
    data?: { document_id?: unknown; inbox_item_id?: unknown }
  } | null
  const documentId = json?.data?.document_id
  if (typeof documentId !== 'string' || documentId.length === 0) {
    throw new ChatAttachmentUploadError('failed')
  }
  const inboxItemId = json?.data?.inbox_item_id
  return { documentId, inboxItemId: typeof inboxItemId === 'string' ? inboxItemId : null }
}
