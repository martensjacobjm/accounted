'use client'

import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DeclarationRutaRow, formatWholeKronor } from '@/components/reports/DeclarationRutaRow'
import type { NEBalansposter, NEDeclaration } from '@/lib/reports/ne-bilaga/types'

const assetPosts: (keyof NEBalansposter)[] = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9']
const equityAndLiabilityPosts: (keyof NEBalansposter)[] = ['B10', 'B11', 'B12', 'B13', 'B14', 'B15', 'B16']

const balansLabels: Record<keyof NEBalansposter, string> = {
  B1: 'Immateriella anläggningstillgångar',
  B2: 'Byggnader och markanläggningar',
  B3: 'Mark och andra tillgångar som inte får skrivas av',
  B4: 'Maskiner och inventarier',
  B5: 'Övriga anläggningstillgångar',
  B6: 'Varulager',
  B7: 'Kundfordringar',
  B8: 'Övriga fordringar',
  B9: 'Kassa och bank',
  B10: 'Eget kapital (tillgångar minus skulder)',
  B11: 'Obeskattade reserver',
  B12: 'Avsättningar',
  B13: 'Låneskulder',
  B14: 'Skatteskulder',
  B15: 'Leverantörsskulder',
  B16: 'Övriga skulder',
}

function sumPosts(balans: NEBalansposter, posts: (keyof NEBalansposter)[]): number {
  return posts.reduce((sum, post) => sum + balans[post], 0)
}

interface BalanceTableProps {
  title: string
  posts: (keyof NEBalansposter)[]
  sumLabel: string
  data: NEDeclaration
}

function BalanceTable({ title, posts, sumLabel, data }: BalanceTableProps) {
  return (
    <section>
      <div className="mb-1 flex items-center gap-2 px-1">
        <h3 className="font-sans text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
        <div className="h-px flex-1 bg-border/60" />
      </div>
      <div className="px-1 pt-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-0">Post</TableHead>
              <TableHead className="px-0 text-right">Belopp</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {posts.map((post) => (
              <DeclarationRutaRow
                key={post}
                code={post}
                label={balansLabels[post]}
                amount={data.balans[post]}
                accounts={data.balansBreakdown[post]?.accounts || []}
              />
            ))}
          </TableBody>
          <tfoot>
            <tr className="border-t font-medium">
              <td className="py-2">{sumLabel}</td>
              <td className="py-2 text-right tabular-nums">
                {formatWholeKronor(sumPosts(data.balans, posts))}
              </td>
            </tr>
          </tfoot>
        </Table>
      </div>
    </section>
  )
}

/**
 * NE sidan 1, balansräkningen B1-B16. Tillgångar and eget kapital + skulder
 * balance by construction: B10 is derived as tillgångar minus skulder.
 */
export function NEBalanceSection({ data }: { data: NEDeclaration }) {
  return (
    <>
      <BalanceTable title="Tillgångar" posts={assetPosts} sumLabel="Summa tillgångar" data={data} />
      <BalanceTable
        title="Eget kapital och skulder"
        posts={equityAndLiabilityPosts}
        sumLabel="Summa eget kapital och skulder"
        data={data}
      />
    </>
  )
}
