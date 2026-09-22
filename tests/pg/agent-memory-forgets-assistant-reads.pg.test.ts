import { describe, it, expect } from 'vitest'
import { getPool, withUserContext } from './setup'
import { seedCompany, insertTransaction } from './fixtures'

/**
 * Covers migration 20260922120000_agent_memory_forgets_assistant_reads (fork):
 *   1. A new rule forgets the company's stored proposals.
 *   2. Changing a rule's text, activity or pin forgets them.
 *   3. Bumping last_accessed_at / relevance (every chat turn) forgets nothing.
 *   4. Another company's proposals are untouched.
 *   5. An end-user session can write a memory (the trigger runs under its RLS).
 */

async function seedRead(companyId: string, userId: string): Promise<string> {
  const txId = await insertTransaction({ companyId, userId })
  await getPool().query(
    `INSERT INTO public.transaction_assistant_reads (company_id, transaction_id, confidence) VALUES ($1, $2, 0.5)`,
    [companyId, txId],
  )
  return txId
}

async function readCount(companyId: string): Promise<number> {
  const r = await getPool().query<{ n: string }>(
    `SELECT count(*)::text AS n FROM public.transaction_assistant_reads WHERE company_id = $1`,
    [companyId],
  )
  return Number(r.rows[0].n)
}

async function insertMemory(companyId: string, content = 'Jula är förbrukningsmaterial'): Promise<string> {
  const r = await getPool().query<{ id: string }>(
    `INSERT INTO public.agent_memory (company_id, kind, content, source) VALUES ($1, 'preference', $2, 'agent_learned') RETURNING id`,
    [companyId, content],
  )
  return r.rows[0].id
}

describe('agent_memory forgets transaction_assistant_reads', () => {
  it('a new rule forgets the company proposals, not another company', async () => {
    const a = await seedCompany()
    const b = await seedCompany()
    await seedRead(a.companyId, a.userId)
    await seedRead(b.companyId, b.userId)
    await insertMemory(a.companyId)
    expect(await readCount(a.companyId)).toBe(0)
    expect(await readCount(b.companyId)).toBe(1)
  })

  it('a changed text, deactivation or pin forgets them', async () => {
    const a = await seedCompany()
    const memId = await insertMemory(a.companyId)
    for (const sql of [
      `UPDATE public.agent_memory SET content = 'ny text' WHERE id = $1`,
      `UPDATE public.agent_memory SET is_pinned = true WHERE id = $1`,
      `UPDATE public.agent_memory SET is_active = false WHERE id = $1`,
    ]) {
      await seedRead(a.companyId, a.userId)
      await getPool().query(sql, [memId])
      expect(await readCount(a.companyId)).toBe(0)
    }
  })

  it('bumping last_accessed_at or relevance forgets nothing', async () => {
    const a = await seedCompany()
    const memId = await insertMemory(a.companyId)
    await seedRead(a.companyId, a.userId)
    await getPool().query(`UPDATE public.agent_memory SET last_accessed_at = now(), relevance_score = 0.9 WHERE id = $1`, [memId])
    expect(await readCount(a.companyId)).toBe(1)
  })

  it('an end-user session can write a memory with the trigger in place', async () => {
    const a = await seedCompany()
    await seedRead(a.companyId, a.userId)
    await withUserContext(a.userId, async (client) => {
      await client.query(
        `INSERT INTO public.agent_memory (company_id, kind, content, source) VALUES ($1, 'fact', 'regel', 'user_taught')`,
        [a.companyId],
      )
      const r = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.transaction_assistant_reads WHERE company_id = $1`,
        [a.companyId],
      )
      expect(Number(r.rows[0].n)).toBe(0)
    })
  })
})
