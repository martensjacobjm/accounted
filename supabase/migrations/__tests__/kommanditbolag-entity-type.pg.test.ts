import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { insertAuthUser, insertCompany } from '@/tests/pg/fixtures'
import { getPool } from '@/tests/pg/setup'

/**
 * 20261015120000_kommanditbolag_entity_type.sql: the fourth legal form is
 * accepted by the CHECK constraints, the create RPCs and the chart seed, the
 * seed gives a KB the delägare 1 equity block (2010/2013/2018/2019) and no
 * aktiebolag or förening accounts, and an unknown form still fails loud.
 */

async function constraintDef(table: string, name: string): Promise<string> {
  const res = await getPool().query<{ def: string }>(
    `SELECT pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = $1 AND c.conname = $2`,
    [table, name],
  )
  return res.rows[0]?.def ?? ''
}

async function accountNumbers(companyId: string): Promise<string[]> {
  const res = await getPool().query<{ account_number: string }>(
    `SELECT account_number FROM public.chart_of_accounts WHERE company_id = $1 ORDER BY account_number`,
    [companyId],
  )
  return res.rows.map((r) => r.account_number)
}

describe('kommanditbolag: CHECK constraints', () => {
  it('companies, company_settings and booking_template_library accept the value', async () => {
    expect(await constraintDef('companies', 'companies_entity_type_check')).toContain('kommanditbolag')
    expect(await constraintDef('company_settings', 'company_settings_entity_type_check')).toContain(
      'kommanditbolag',
    )
    const library = await constraintDef('booking_template_library', 'booking_template_library_entity_type_check')
    expect(library).toContain('kommanditbolag')
    expect(library).toContain("'all'")
  })

  it('still rejects handelsbolag, which has no profile', async () => {
    const userId = await insertAuthUser()
    await expect(
      getPool().query(
        `INSERT INTO public.companies (id, name, entity_type, created_by) VALUES ($1, 'HB', 'handelsbolag', $2)`,
        [randomUUID(), userId],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('supported_entity_types() lists the four forms', async () => {
    const res = await getPool().query<{ list: string[] }>(`SELECT public.supported_entity_types() AS list`)
    expect(res.rows[0].list).toEqual(['enskild_firma', 'aktiebolag', 'ideell_forening', 'kommanditbolag'])
  })
})

describe('kommanditbolag: create_company_for_user', () => {
  it('creates a KB and seeds its 1930 cash account', async () => {
    const userId = await insertAuthUser()
    const res = await getPool().query<{ id: string }>(
      `SELECT public.create_company_for_user($1::uuid, $2::text, $3::text, NULL::uuid) AS id`,
      [userId, 'Test Kommanditbolag', 'kommanditbolag'],
    )
    const companyId = res.rows[0].id
    const company = await getPool().query<{ entity_type: string }>(
      `SELECT entity_type FROM public.companies WHERE id = $1`,
      [companyId],
    )
    expect(company.rows[0].entity_type).toBe('kommanditbolag')
    const cash = await getPool().query(
      `SELECT 1 FROM public.cash_accounts WHERE company_id = $1 AND ledger_account = '1930' AND is_primary`,
      [companyId],
    )
    expect(cash.rowCount).toBe(1)
  })
})

describe('kommanditbolag: seed_chart_of_accounts', () => {
  it('seeds the delägare 1 equity block and no AB, förening or bolagsskatt accounts', async () => {
    const userId = await insertAuthUser()
    const companyId = await insertCompany({ createdBy: userId, entityType: 'kommanditbolag', name: 'KB' })
    await getPool().query(`SELECT public.seed_chart_of_accounts($1::uuid, $2::text)`, [companyId, 'kommanditbolag'])
    const numbers = await accountNumbers(companyId)

    for (const expected of ['2010', '2013', '2018', '2019', '1930', '2440', '2611', '3100', '6991']) {
      expect(numbers).toContain(expected)
    }
    for (const absent of ['2067', '2069', '2081', '2091', '2099', '2510', '2890', '2893', '8910']) {
      expect(numbers).not.toContain(absent)
    }

    const equity = await getPool().query<{ account_number: string; account_name: string; sru_code: string | null }>(
      `SELECT account_number, account_name, sru_code FROM public.chart_of_accounts
        WHERE company_id = $1 AND account_number IN ('2010', '2013', '2018', '2019')
        ORDER BY account_number`,
      [companyId],
    )
    expect(equity.rows).toEqual([
      { account_number: '2010', account_name: 'Eget kapital', sru_code: null },
      { account_number: '2013', account_name: 'Övriga egna uttag', sru_code: null },
      { account_number: '2018', account_name: 'Övriga egna insättningar', sru_code: null },
      { account_number: '2019', account_name: 'Årets resultat, delägare 1', sru_code: null },
    ])
  })

  it('leaves the enskild firma and aktiebolag seeds unchanged', async () => {
    const userId = await insertAuthUser()
    const ef = await insertCompany({ createdBy: userId, entityType: 'enskild_firma', name: 'EF' })
    await getPool().query(`SELECT public.seed_chart_of_accounts($1::uuid, $2::text)`, [ef, 'enskild_firma'])
    const efNumbers = await accountNumbers(ef)
    for (const expected of ['2010', '2013', '2018']) expect(efNumbers).toContain(expected)
    expect(efNumbers).not.toContain('2019')

    const ab = await insertCompany({ createdBy: userId, entityType: 'aktiebolag', name: 'AB' })
    await getPool().query(`SELECT public.seed_chart_of_accounts($1::uuid, $2::text)`, [ab, 'aktiebolag'])
    const abNumbers = await accountNumbers(ab)
    for (const expected of ['2081', '2091', '2099', '2893', '7010', '7210', '7510']) {
      expect(abNumbers).toContain(expected)
    }
    for (const absent of ['2010', '2013', '2018', '2019']) expect(abNumbers).not.toContain(absent)
  })
})
