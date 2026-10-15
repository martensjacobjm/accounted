'use client'

import { useCallback, useState, type DragEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  MAX_CHAT_ATTACHMENTS,
  type ChatAttachmentChip,
} from '@/lib/agent/chat/attachment-block'
import { ChatAttachmentUploadError, uploadChatAttachment } from './chat-attachment-upload'

export interface PendingAttachment {
  localId: string
  fileName: string
  status: 'uploading' | 'ready' | 'error'
  documentId?: string
  error?: string
}

export interface ChatAttachmentsState {
  items: PendingAttachment[]
  /** Uploaded and ready to send with the next turn. */
  ready: ChatAttachmentChip[]
  uploading: boolean
  /** One-line notice for the composer (e.g. too many files). */
  notice: string | null
  dragActive: boolean
  addFiles: (files: FileList | File[]) => void
  remove: (localId: string) => void
  clear: () => void
  /** Put chips back after a turn that never reached the server. */
  restore: (chips: ChatAttachmentChip[]) => void
  dropZoneProps: {
    onDragOver: (e: DragEvent<HTMLElement>) => void
    onDragLeave: (e: DragEvent<HTMLElement>) => void
    onDrop: (e: DragEvent<HTMLElement>) => void
  }
}

const MAX_MB = CHAT_ATTACHMENT_MAX_BYTES / 1024 / 1024

/**
 * Composer state for chat attachments. Each file uploads as soon as it is
 * picked or dropped, so by the time the user presses send only document ids
 * are left to transmit. Removing a chip only drops the reference: the upload
 * is already archived in the document inbox (WORM) and stays there.
 */
export function useChatAttachments(enabled: boolean): ChatAttachmentsState {
  const t = useTranslations('agent_chat')
  const locale = useLocale() === 'en' ? 'en' : 'sv'
  const [items, setItems] = useState<PendingAttachment[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)

  const failureText = useCallback(
    (err: unknown): string => {
      if (err instanceof ChatAttachmentUploadError) {
        if (err.reason === 'unsupported_type') return t('attach_unsupported_type')
        if (err.reason === 'too_large') return t('attach_too_large', { max: MAX_MB })
        if (err.serverMessage) return err.serverMessage
      }
      return t('attach_failed')
    },
    [t],
  )

  const upload = useCallback(
    async (localId: string, file: File) => {
      try {
        const { documentId } = await uploadChatAttachment(file, locale)
        setItems((prev) => {
          // The inbox dedupes on content: the same receipt picked twice
          // resolves to the same document, which only needs one chip.
          if (prev.some((p) => p.localId !== localId && p.documentId === documentId)) {
            return prev.filter((p) => p.localId !== localId)
          }
          return prev.map((p) => (p.localId === localId ? { ...p, status: 'ready', documentId } : p))
        })
      } catch (err) {
        const error = failureText(err)
        setItems((prev) => prev.map((p) => (p.localId === localId ? { ...p, status: 'error', error } : p)))
      }
    },
    [failureText, locale],
  )

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      if (!enabled) return
      const list = Array.from(files)
      if (list.length === 0) return
      const taken = items.filter((p) => p.status !== 'error').length
      const room = Math.max(0, MAX_CHAT_ATTACHMENTS - taken)
      const accepted = list.slice(0, room)
      setNotice(list.length > room ? t('attach_too_many', { max: MAX_CHAT_ATTACHMENTS }) : null)
      if (accepted.length === 0) return
      const entries = accepted.map((file) => ({
        localId: crypto.randomUUID(),
        fileName: file.name,
        status: 'uploading' as const,
        file,
      }))
      setItems((prev) => [
        ...prev,
        ...entries.map(({ localId, fileName, status }) => ({ localId, fileName, status })),
      ])
      for (const entry of entries) void upload(entry.localId, entry.file)
    },
    [enabled, items, t, upload],
  )

  const remove = useCallback((localId: string) => {
    setItems((prev) => prev.filter((p) => p.localId !== localId))
    setNotice(null)
  }, [])

  const clear = useCallback(() => {
    setItems([])
    setNotice(null)
  }, [])

  const restore = useCallback((chips: ChatAttachmentChip[]) => {
    setItems((prev) => [
      ...chips.map((c) => ({
        localId: crypto.randomUUID(),
        fileName: c.fileName,
        status: 'ready' as const,
        documentId: c.documentId,
      })),
      ...prev,
    ])
  }, [])

  const hasFiles = (e: DragEvent<HTMLElement>) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

  const dropZoneProps = {
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!enabled || !hasFiles(e)) return
      e.preventDefault()
      setDragActive(true)
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      // Leaving for a child element is not leaving the drop zone.
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setDragActive(false)
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      if (!enabled || !hasFiles(e)) return
      e.preventDefault()
      setDragActive(false)
      addFiles(e.dataTransfer.files)
    },
  }

  const ready: ChatAttachmentChip[] = items
    .filter((p) => p.status === 'ready' && p.documentId)
    .map((p) => ({ documentId: p.documentId as string, fileName: p.fileName }))

  return {
    items,
    ready,
    uploading: items.some((p) => p.status === 'uploading'),
    notice,
    dragActive,
    addFiles,
    remove,
    clear,
    restore,
    dropZoneProps,
  }
}
