'use client'

import { usePathname } from 'next/navigation'
import { MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAgentSheet } from '@/components/agent/AgentSheetProvider'
import { useAssistantAvailable } from '@/contexts/CompanyContext'
import type { PageFocus } from '@/lib/agent/intents/page-context'

// Fork (bok.dalavs.se, Jacob 2026-09-22: "den ska kunna vara med överallt").
// One button any list or dialog can drop next to a row: opens the assistant on
// THAT row. Default intent is the page-aware general.help with a `focus`
// (kind + id + label) so the assistant fetches the record first; a page that
// has a dedicated intent (transactions → transaction.categorization) passes it
// instead. Hidden until the agent profile is verified and the tool-loop
// runtime exists, same gates as the floating pill.
interface Props {
  focus: PageFocus
  intentId?: string
  intentArgs?: Record<string, unknown>
  label?: string
  className?: string
  size?: 'sm' | 'default'
  variant?: 'secondary' | 'outline' | 'ghost'
}

export default function AskAssistantRowButton({
  focus,
  intentId,
  intentArgs,
  label = 'Prata med assistenten',
  className,
  size = 'sm',
  variant = 'outline',
}: Props) {
  const pathname = usePathname()
  const { openAgentSheet, identity } = useAgentSheet()
  const assistantAvailable = useAssistantAvailable()
  if (!identity.isVerified || !assistantAvailable) return null
  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      data-agent-ui
      onClick={() =>
        openAgentSheet({
          intentId: intentId ?? 'general.help',
          intentArgs: intentArgs ?? { route: pathname ?? undefined, focus },
          contextRef: `${focus.kind}:${focus.id}`,
        })
      }
    >
      <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
      {label}
    </Button>
  )
}
