'use client'

import { useRef } from 'react'
import { useTranslations } from 'next-intl'
import { FileText, Paperclip, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CHAT_ATTACHMENT_ACCEPT, type ChatAttachmentChip } from '@/lib/agent/chat/attachment-block'
import type { PendingAttachment } from './useChatAttachments'

interface AttachButtonProps {
  onFiles: (files: FileList) => void
  disabled?: boolean
}

/**
 * Paperclip button plus the hidden file input. No `capture` attribute on
 * purpose: on a phone the picker then offers the camera AND the photo library
 * and files, instead of forcing the camera.
 */
export function ChatAttachButton({ onFiles, disabled }: AttachButtonProps) {
  const t = useTranslations('agent_chat')
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={CHAT_ATTACHMENT_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) onFiles(e.target.files)
          // Reset so picking the same file again still fires onChange.
          e.target.value = ''
        }}
      />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        aria-label={t('attach_button')}
        title={t('attach_button')}
      >
        <Paperclip className="h-4 w-4" />
      </Button>
    </>
  )
}

interface ComposerListProps {
  items: PendingAttachment[]
  notice: string | null
  onRemove: (localId: string) => void
}

/** The attachments waiting in the composer, above the text field. */
export function ComposerAttachmentList({ items, notice, onRemove }: ComposerListProps) {
  const t = useTranslations('agent_chat')
  if (items.length === 0 && !notice) return null
  const errors = items.filter((p) => p.status === 'error' && p.error)
  return (
    <div className="mb-2 space-y-1">
      {items.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t('attach_list_label')}>
          {items.map((p) => (
            <li
              key={p.localId}
              className={cn(
                'inline-flex max-w-full items-center gap-1 rounded-full border border-border pl-3 text-[12.5px]',
                p.status === 'error' ? 'text-destructive' : 'text-foreground',
              )}
            >
              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate max-w-48">{p.fileName}</span>
              {p.status === 'uploading' && (
                <span className="text-muted-foreground">{t('attach_uploading')}</span>
              )}
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => onRemove(p.localId)}
                aria-label={t('attach_remove', { name: p.fileName })}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div role="status" aria-live="polite" className="space-y-1">
        {errors.map((p) => (
          <p key={p.localId} className="text-[11px] text-destructive">
            {p.fileName}: {p.error}
          </p>
        ))}
        {notice && <p className="text-[11px] text-muted-foreground">{notice}</p>}
      </div>
    </div>
  )
}

/** Read-only chips on a sent user message. */
export function MessageAttachmentList({ attachments }: { attachments: ChatAttachmentChip[] }) {
  const t = useTranslations('agent_chat')
  return (
    <ul className="flex max-w-[85%] flex-wrap justify-end gap-2" aria-label={t('attach_list_label')}>
      {attachments.map((a) => (
        <li
          key={a.documentId}
          className="inline-flex max-w-full items-center gap-2 rounded-full border border-border px-3 py-1 text-[12.5px] text-foreground"
        >
          <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate max-w-48">{a.fileName}</span>
        </li>
      ))}
    </ul>
  )
}
