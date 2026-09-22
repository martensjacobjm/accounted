-- Migration: a change to the company's rules forgets its stored assistant reads
-- (fork bok.dalavs.se, 2026-09-22).
--
-- transaction_assistant_reads caches the model's booking proposal per bank row
-- and was only refreshed when the row got a new document, so a rule the user
-- taught the assistant ("Jula är förbrukningsmaterial", "betalt med egna pengar
-- går mot 2018") never reached a proposal that had already been made. The
-- rules live in agent_memory and are written from several places (MCP
-- remember/forget_fact, /api/agent/memory, the chat, onboarding), so the
-- invalidation sits on the table itself instead of in each writer.
--
-- The cache is proposals only, never bookkeeping: deleting it is safe, and the
-- ten-minute categorize cron (or the next open of the row) reads again.
-- Touching only last_accessed_at / relevance (every chat turn does) forgets
-- nothing: the UPDATE trigger fires only on content, is_active or is_pinned.
-- SECURITY INVOKER: an end user deletes under the existing own-company DELETE
-- policy on transaction_assistant_reads; the service role bypasses RLS.

CREATE OR REPLACE FUNCTION public.forget_assistant_reads_for_company()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.transaction_assistant_reads
   WHERE company_id = COALESCE(NEW.company_id, OLD.company_id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER agent_memory_forget_assistant_reads_ins_del
  AFTER INSERT OR DELETE ON public.agent_memory
  FOR EACH ROW EXECUTE FUNCTION public.forget_assistant_reads_for_company();

CREATE TRIGGER agent_memory_forget_assistant_reads_upd
  AFTER UPDATE OF content, is_active, is_pinned ON public.agent_memory
  FOR EACH ROW
  WHEN (
    OLD.content IS DISTINCT FROM NEW.content
    OR OLD.is_active IS DISTINCT FROM NEW.is_active
    OR OLD.is_pinned IS DISTINCT FROM NEW.is_pinned
  )
  EXECUTE FUNCTION public.forget_assistant_reads_for_company();
