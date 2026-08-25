// Monthly ledger for one tranche: interest due/paid/shortfall, principal,
// balances. Range-toggled, CSV-copyable via the exports tab.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTrancheCashflows } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { moneyFull, pct } from '../../lib/utils';
import type { TableData } from '../../lib/types';
import DataTable from '../shared/DataTable';
import type { Column } from '../shared/DataTable';
import LoadingCursor from '../shared/LoadingCursor';
import RangeToggle from '../shared/RangeToggle';

type Row = Record<string, unknown>;
const RANGES = { '1Y': 12, '5Y': 60, '10Y': 120, ALL: Infinity } as const;
type RangeKey = keyof typeof RANGES;

interface Props {
  runId: string;
  tranche: string;
}

export default function TrancheCashflowView({ runId, tranche }: Props) {
  const [range, setRange] = useState<RangeKey>('5Y');

  const query = useQuery<TableData>({
    queryKey: qk.runData(runId, 'trancheCf', tranche),
    queryFn: () => getTrancheCashflows(runId, tranche) as unknown as Promise<TableData>,
    staleTime: Infinity,
  });

  if (query.isLoading) return <LoadingCursor />;
  if (!query.data) return null;

  const limit = RANGES[range];
  const rows: Row[] = query.data.records
    .map((r, i): Row => ({ ...r, month: i }))
    .filter((r) => (r.month as number) < limit)
    .filter((r) => {
      // hide dead tail rows where everything is zero
      const bal = Number(r.balance_start ?? 0) + Number(r.balance_end ?? 0);
      const cf = Number(r.cashflow ?? 0);
      return bal !== 0 || cf !== 0 || (r.month as number) < 12;
    });

  const numCols = query.data.columns.filter((c) => c !== 'date');
  const columns: Column<Row>[] = [
    {
      key: 'month',
      header: 'M',
      align: 'right',
      render: (r) => <span className="num mono dim">{String(r.month)}</span>,
      sortValue: (r) => r.month as number,
    },
    {
      key: 'date',
      header: 'DATE',
      render: (r) => <span className="mono dim">{String(r.date ?? '').slice(0, 10)}</span>,
      sortable: false,
    },
    ...numCols.map(
      (col): Column<Row> => ({
        key: col,
        header: col.replace(/_/g, ' ').toUpperCase(),
        align: 'right',
        sortable: false,
        render: (r) => {
          const v = r[col];
          if (typeof v !== 'number') return <span className="dim">—</span>;
          if (col === 'rate') return <span className="num mono">{pct(v)}</span>;
          return (
            <span className={`num mono${col === 'interest_shortfall' && v > 0 ? ' neg' : ''}`}>
              {moneyFull(v)}
            </span>
          );
        },
      }),
    ),
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
        <RangeToggle options={Object.keys(RANGES) as RangeKey[]} value={range} onChange={setRange} />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => String(r.month)} emptyMessage="NO CASHFLOWS" />
      </div>
    </div>
  );
}
