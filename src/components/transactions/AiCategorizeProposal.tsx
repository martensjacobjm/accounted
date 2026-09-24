'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { QUIET_LINK_CLASS } from '@/components/ui/dry-table'
import AgentAvatar from '@/components/agent/AgentAvatar'
import { useAgentSheet } from '@/components/agent/AgentSheetProvider'
import { getAccountName } from '@/lib/bookkeeping/client-account-names'
import { firstSentence, type AssistantRead } from '@/lib/agent/categorize/read-shape'
import type { TransactionCategory, VatTreatment } from '@/types'

/**
 * The assistant's verdict inside the recommendation header of the review
 * dialog: one line, not a box. It reads the assistant's stored read of this
 * transaction (POST /api/agent/categorize answers with one, fetching only
 * when the list did not already hand it over) and says one of three things:
 * it agrees with the current pick, it suggests another booking with why and
 * one click to take it, or it found nothing that fits. Nothing books here.
 */
export interface AiProposalMeta {
  account: string
  confidence: number
  agreement: number | null
  modelConfidence: string | null
  source: string
}

/** What the assistant wants booked, complete enough to open a review on. */
export interface AssistantPick {
  account: string
  vat: VatTreatment | 'none'
  category: TransactionCategory | null
  label: string
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; read: AssistantRead }
  /** No AI backend, a failed call, or a read that found nothing: the header stands alone. */
  | { status: 'silent' }

interface Props {
  transactionId: string
  /** Fetch when the dialog is open. */
  open: boolean
  /** Whether a receipt or invoice is matched: it changes what the loading line says. */
  hasUnderlag?: boolean
  /** Fork: an underlag attached in the dialog and read; "fråga igen" sends it with the note. */
  documentId?: string | null
  /** The business account the dialog currently books to, for the agree check. */
  currentAccount?: string | null
  /** Take the pick as soon as it lands; off when the dialog already has a template of its own. */
  autoApply?: boolean
  /** Take the pick into the dialog: `auto` when it landed on its own, false when the person clicked Använd. */
  onTake: (pick: AssistantPick, opts: { auto: boolean }) => void
  /** Surface the read so the dialog can log a calibration sample on book. */
  onProposal?: (meta: AiProposalMeta) => void
  /** The stored read the list already has: shown at once, no fetch. */
  initial?: AssistantRead | null
  /** Fork: the row's saved note, prefilled in the "tell the assistant" field. */
  initialNote?: string | null
}

/** The pick a read carries, complete enough to open a review on; null when the assistant found nothing. */
export function pickFromRead(read: AssistantRead): AssistantPick | null {
  if (!read.account) return null
  const label = read.candidates.find((c) => c.account === read.account)?.label ?? getAccountName(read.account)
  return { account: read.account, vat: read.vat_treatment ?? 'none', category: read.category, label }
}

/** Where the read came from, for the calibration sample logged on book. */
export function proposalMetaFromRead(read: AssistantRead, pick: AssistantPick): AiProposalMeta {
  const source = read.from_candidate
    ? (read.candidates.find((c) => c.account === read.account)?.source ?? 'candidate')
    : 'category'
  return {
    account: pick.account,
    confidence: read.confidence,
    agreement: read.agreement,
    modelConfidence: read.model_confidence,
    source,
  }
}

const LINE_CLASS = 'flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground'

/** The assistant's one-line "working" status (avatar, spinner, text). Shared with the review dialog's own document read. */
export function AiStatusLine({ text }: { text: string }) {
  const { identity } = useAgentSheet()
  return (
    <p className={LINE_CLASS}>
      <AgentAvatar avatarId={identity.avatarId} size="xs" className="h-4 w-4 flex-none" alt="" />
      <Loader2 className="h-3.5 w-3.5 flex-none animate-spin" aria-hidden="true" />
      {text}
    </p>
  )
}

export default function AiCategorizeProposal({
  transactionId,
  open,
  hasUnderlag = false,
  documentId = null,
  currentAccount,
  autoApply = true,
  onTake,
  onProposal,
  initial = null,
  initialNote = null,
}: Props) {
  const t = useTranslations('tx_quick_review')
  const { identity } = useAgentSheet()
  const [state, setState] = useState<State>(() => (initial ? { status: 'ready', read: initial } : { status: 'loading' }))
  const [expanded, setExpanded] = useState(false)
  // Fork (bok.dalavs.se, 2026-09-22): the person can say what the row is and get
  // a new read on the spot. Upstream's line could only be taken or ignored: the
  // model never saw a word the person wrote.
  const [note, setNote] = useState(initialNote ?? '')
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  // The pick is handed to the dialog once per read, so the person's later
  // edits are never clobbered by a re-render.
  const takenRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open || initial) return
    let alive = true
    takenRef.current = null
    ;(async () => {
      try {
        const res = await fetch('/api/agent/categorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transaction_id: transactionId }),
        })
        if (!alive) return
        if (res.status === 503) setUnavailable(true)
        const body = res.ok ? ((await res.json()) as { data?: AssistantRead }) : null
        if (!alive) return
        setState(body?.data ? { status: 'ready', read: body.data } : { status: 'silent' })
      } catch {
        if (alive) setState({ status: 'silent' })
      }
    })()
    return () => {
      alive = false
    }
  }, [open, transactionId, initial])

  const reportedRef = useRef(false)
  useEffect(() => {
    if (state.status !== 'ready') return
    const read = state.read
    const pick = pickFromRead(read)
    if (!pick) return
    if (!reportedRef.current) {
      reportedRef.current = true
      onProposal?.(proposalMetaFromRead(read, pick))
    }
    // Only a pick with something behind it (a candidate, or a confident model
    // read) fills the dialog on its own; a low guess waits for the person.
    if (!autoApply || takenRef.current === pick.account || read.confidence < 0.5) return
    takenRef.current = pick.account
    onTake(pick, { auto: true })
  }, [state, autoApply, onTake, onProposal])

  const askAgain = async () => {
    const text = note.trim()
    if (!text || asking) return
    setAsking(true)
    setAskError(null)
    try {
      const res = await fetch('/api/agent/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: transactionId,
          user_note: text,
          ...(documentId ? { document_id: documentId } : {}),
        }),
      })
      const body = res.ok ? ((await res.json()) as { data?: AssistantRead }) : null
      if (!body?.data) {
        setAskError(t('ai_note_failed'))
        return
      }
      // A new read: let it fill the dialog again and report a fresh sample.
      takenRef.current = null
      reportedRef.current = false
      setExpanded(true)
      setState({ status: 'ready', read: body.data })
    } catch {
      setAskError(t('ai_note_failed'))
    } finally {
      setAsking(false)
    }
  }

  const noteForm = unavailable ? null : (
    <form
      className="mt-1.5 flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void askAgain()
      }}
    >
      <input
        type="text"
        value={note}
        maxLength={1000}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('ai_note_placeholder')}
        aria-label={t('ai_note_placeholder')}
        className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-[12.5px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <button
        type="submit"
        disabled={asking || note.trim().length === 0}
        className={cn(QUIET_LINK_CLASS, 'text-[12.5px] font-medium disabled:opacity-50')}
      >
        {asking ? t('ai_note_asking') : t('ai_note_ask')}
      </button>
      {askError ? <span className="text-[12.5px] text-destructive">{askError}</span> : null}
    </form>
  )

  const line = LINE_CLASS
  const mark = <AgentAvatar avatarId={identity.avatarId} size="xs" className="h-4 w-4 flex-none" alt="" />

  if (state.status === 'silent') return noteForm
  if (state.status === 'loading' || asking) {
    return (
      <div>
        <AiStatusLine text={asking ? t('ai_note_asking') : hasUnderlag ? t('ai_reading') : t('ai_looking')} />
        {noteForm}
      </div>
    )
  }

  const read = state.read
  const pick = pickFromRead(read)
  const why = read.reasoning ? (expanded ? read.reasoning : firstSentence(read.reasoning)) : ''
  const hasMore = !!read.reasoning && why !== read.reasoning.trim()
  const more = hasMore ? (
    <button type="button" className={cn(QUIET_LINK_CLASS, 'text-[12.5px]')} onClick={() => setExpanded((v) => !v)}>
      {expanded ? t('ai_less') : t('ai_more')}
    </button>
  ) : null

  if (!pick) {
    return (
      <div>
        <p className={line}>
          {mark}
          <span>
            {t('ai_none')}
            {why ? <span className="ml-1">{why}</span> : null}
          </span>
          {more}
        </p>
        {noteForm}
      </div>
    )
  }

  const agrees = !!currentAccount && pick.account === currentAccount

  return (
    <div>
    <p className={line}>
      {mark}
      {agrees ? (
        <span>
          {t('ai_agrees')}
          {why ? <span className="ml-1">{why}</span> : null}
        </span>
      ) : (
        <span>
          {t('ai_instead')} <span className="font-mono text-foreground">{pick.account}</span>
          <span className="text-foreground"> {pick.label}</span>
          {pick.vat === 'reverse_charge' ? <span className="text-foreground"> {t('ai_reverse_charge')}</span> : null}
          {why ? <span className="ml-1">· {why}</span> : null}
        </span>
      )}
      {more}
      {!agrees && (
        <button
          type="button"
          className={cn(QUIET_LINK_CLASS, 'text-[12.5px] font-medium')}
          onClick={() => {
            takenRef.current = pick.account
            onTake(pick, { auto: false })
          }}
        >
          {t('ai_use')}
        </button>
      )}
    </p>
    {noteForm}
    </div>
  )
}
