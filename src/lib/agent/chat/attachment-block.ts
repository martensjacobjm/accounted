/**
 * Receipts and invoices attached in the assistant chat.
 *
 * The file itself never travels with the turn. The chat uploads it through
 * the document inbox (same route, limits, rate limit and WORM archive as the
 * inbox page), and the turn carries only the archived document's id. The
 * server resolves that id against the active company and renders the block
 * below into the user message, so the reference is part of the persisted
 * history: a later turn ("bokför den som representation i stället") still
 * knows which document it is about.
 *
 * Pure module on purpose: the composer (client) and the invoke route and
 * chat loop (server) share these limits and the block format.
 */

/** At most this many files per turn. */
export const MAX_CHAT_ATTACHMENTS = 5

/** Same ceiling as the document inbox (`MAX_FILE_SIZE` there). */
export const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

/** The file picker filter: photos (also straight from a phone camera) and PDFs. */
export const CHAT_ATTACHMENT_ACCEPT = 'image/*,application/pdf'

/**
 * Types the chat accepts. A subset of what the inbox stores: the formats a
 * receipt or an invoice arrives in. The server checks the archived row's
 * type, which the document service resolved from the file's magic bytes.
 */
export const CHAT_ATTACHMENT_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

/**
 * Intents whose tool loadout can read an attached document (both
 * gnubok_get_inbox_item and gnubok_read_document). The composer shows the
 * attach button only here and the invoke route rejects attachments elsewhere;
 * a test pins every id to that loadout.
 */
export const CHAT_ATTACHMENT_INTENTS: ReadonlySet<string> = new Set(['general.help'])

/**
 * Sent to the model when the user attaches files without typing anything. An
 * empty user message would otherwise take the invoke route's first-turn path
 * (the intent's capture and prompt template) and drop the attachments.
 */
export const ATTACHMENT_ONLY_MESSAGE = 'Jag har bifogat underlag.'

const BLOCK_OPEN = '<bifogade_dokument>'
const BLOCK_CLOSE = '</bifogade_dokument>'
const MAX_FILE_NAME_CHARS = 80
const UUID_PATTERN = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

/** One attachment as the chat loop needs it, resolved server-side. */
export interface ChatAttachmentRef {
  documentId: string
  /** The inbox row created for the upload; null when the document has none. */
  inboxItemId: string | null
  fileName: string
  /** Stored type, resolved from magic bytes at upload. */
  mimeType: string | null
  /** invoice_inbox_items.status ('processing' while extraction runs). */
  inboxStatus: string | null
}

/** What the timeline shows for an attachment. */
export interface ChatAttachmentChip {
  documentId: string
  fileName: string
}

/**
 * A file name the user chose, made safe to embed in the block: no control
 * characters or line breaks (one line per attachment), no quotes or angle
 * brackets (the value is quoted, the block is tag-delimited), bounded length.
 */
export function sanitizeAttachmentFileName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/["<>`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length === 0) return 'dokument'
  return cleaned.length > MAX_FILE_NAME_CHARS ? `${cleaned.slice(0, MAX_FILE_NAME_CHARS - 3)}...` : cleaned
}

function renderLine(a: ChatAttachmentRef): string {
  const parts = [
    `document_id=${a.documentId}`,
    `inbox_item_id=${a.inboxItemId ?? 'saknas'}`,
    `typ=${a.mimeType ?? 'okänd'}`,
  ]
  if (a.inboxStatus) parts.push(`status=${a.inboxStatus}`)
  parts.push(`filnamn="${sanitizeAttachmentFileName(a.fileName)}"`)
  return `- ${parts.join(' ')}`
}

/**
 * The user's text followed by the attachment block. Returns the text
 * unchanged when there are no attachments, so a plain turn is byte-identical
 * to what it was before this feature.
 */
export function composeUserMessageWithAttachments(
  text: string,
  attachments: readonly ChatAttachmentRef[] | null | undefined,
): string {
  if (!attachments || attachments.length === 0) return text
  const body = text.trim().length > 0 ? text : ATTACHMENT_ONLY_MESSAGE
  const lines = attachments.map(renderLine)
  return `${body}\n\n${BLOCK_OPEN}\n${lines.join('\n')}\n${BLOCK_CLOSE}`
}

const BLOCK_RE = new RegExp(`\\n*${BLOCK_OPEN}\\n([\\s\\S]*?)\\n${BLOCK_CLOSE}\\s*$`)
const LINE_RE = new RegExp(`^- document_id=(${UUID_PATTERN}) .*filnamn="([^"\\n]*)"$`)

/**
 * The inverse of composeUserMessageWithAttachments, for rendering a stored
 * user message: the typed text plus the attached files as chips. A message
 * without a well-formed trailing block comes back as plain text.
 */
export function splitAttachmentBlock(stored: string): {
  text: string
  attachments: ChatAttachmentChip[]
} {
  const match = BLOCK_RE.exec(stored)
  if (!match) return { text: stored, attachments: [] }
  const attachments: ChatAttachmentChip[] = []
  for (const line of match[1].split('\n')) {
    const m = LINE_RE.exec(line.trim())
    if (!m) return { text: stored, attachments: [] }
    attachments.push({ documentId: m[1], fileName: m[2] })
  }
  const text = stored.slice(0, match.index).trimEnd()
  return { text: text === ATTACHMENT_ONLY_MESSAGE ? '' : text, attachments }
}
