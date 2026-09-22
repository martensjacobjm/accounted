import { CHAT_INTENT_ID } from './persist'

/**
 * Which runtime a conversation runs on (fork bok.dalavs.se, 2026-09-22).
 *
 * Upstream moved general.help onto the single-call console (#1762, #1769) so it
 * runs on any provider, including a local model. The console only sends the
 * typed question: no page, no row in focus, no company memories and no write
 * tools. On a deployment that has the tool-loop runtime (assistantAvailable),
 * that made every "Fråga"/"Prata med assistenten" entry point blind while the
 * general.help intent (page context, write tools, memories via run-turn) sat
 * unused. The console is now the fallback it was meant to be: it is used only
 * when the tool loop cannot run. One decision, used by every surface that
 * opens a conversation (the sheet, /chat/new, /chat/[id]).
 */
export function runsOnSingleCallConsole(intentId: string, assistantAvailable: boolean): boolean {
  return intentId === CHAT_INTENT_ID && !assistantAvailable
}
