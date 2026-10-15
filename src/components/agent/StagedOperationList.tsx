'use client'

import { useState } from 'react'
import { CheckCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getErrorMessage as getUserErrorMessage } from '@/lib/errors/get-error-message'
import ApprovalCard, { type ExternalCommitResult } from './ApprovalCard'

// Korten som assistenten lade fram i ett svar, i stagningsordning. Ett ärende
// i flera steg (kund och faktura, leverantör och leverantörsfaktura) ger flera
// kort där ett senare bygger på ett tidigare. "Godkänn alla" skickar dem till
// massgodkännandet, som godkänner i beroendeordning; varje kort godkänns
// fortfarande för sig på servern. Hög risk kräver att man skriver "godkänn" i
// kortet och ingår därför aldrig i "Godkänn alla" (samma regel som /pending).

export interface StagedCardItem {
  tool_use_id: string
  operation_id?: string
  risk_level: 'low' | 'medium' | 'high'
  message: string
  tool_name?: string
  operation_type?: string
  params?: Record<string, unknown>
  preview?: unknown
  period_status?: {
    period_id?: string | null
    status: 'open' | 'locked' | 'closed'
    lock_date?: string | null
  }
}

interface Props {
  staged: StagedCardItem[]
  onRequestCorrection?: (correctionMessage: string) => void
}

interface BulkResponse {
  data?: { results?: Array<{ id: string } & ExternalCommitResult> }
}

export const MIN_CARDS_FOR_APPROVE_ALL = 2

export function approvableIds(
  staged: StagedCardItem[],
  results: Record<string, ExternalCommitResult>,
): string[] {
  return staged
    .filter((s) => s.operation_id && s.risk_level !== 'high' && results[s.operation_id]?.status !== 'committed')
    .map((s) => s.operation_id as string)
}

export default function StagedOperationList({ staged, onRequestCorrection }: Props) {
  const [results, setResults] = useState<Record<string, ExternalCommitResult>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ids = approvableIds(staged, results)
  const hasHighRisk = staged.some((s) => s.operation_id && s.risk_level === 'high')
  const showApproveAll = ids.length >= MIN_CARDS_FOR_APPROVE_ALL

  async function handleApproveAll() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/pending-operations/bulk-commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const body = (await res.json().catch(() => ({}))) as BulkResponse
      if (!res.ok) {
        setError(getUserErrorMessage(body, { statusCode: res.status }))
        return
      }
      const next: Record<string, ExternalCommitResult> = { ...results }
      for (const r of body.data?.results ?? []) {
        next[r.id] = { status: r.status, ...(r.error ? { error: r.error } : {}), ...(r.data ? { data: r.data } : {}) }
      }
      setResults(next)
    } catch (err) {
      setError(err instanceof Error ? getUserErrorMessage(err) : 'Kunde inte godkänna förslagen.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full max-w-[85%] space-y-2">
      {staged.map((s) =>
        s.operation_id ? (
          // One tool call can stage several operations (batch writers), so
          // the operation id, not the tool_use_id, keys the card.
          <ApprovalCard
            key={s.operation_id}
            operationId={s.operation_id}
            riskLevel={s.risk_level}
            message={s.message}
            toolName={s.tool_name}
            operationType={s.operation_type}
            params={s.params}
            preview={s.preview}
            periodStatus={s.period_status}
            onRequestCorrection={onRequestCorrection}
            externalResult={results[s.operation_id]}
          />
        ) : (
          <div
            key={s.tool_use_id}
            className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground"
          >
            Förslag stageat men ingen operation-id mottagen. Granska i accounted under <em>Förslag</em>.
          </div>
        ),
      )}
      {showApproveAll && (
        <div className="space-y-1">
          <Button size="sm" onClick={handleApproveAll} loading={busy} disabled={busy} className="w-full">
            <CheckCheck className="h-4 w-4" /> Godkänn alla ({ids.length})
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Godkänns i rätt ordning, ett förslag i taget.
            {hasHighRisk ? ' Förslag med hög risk godkänner du i kortet.' : ''}
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  )
}
