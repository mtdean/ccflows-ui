// Deal stack summary: one row per bond, WAL / XIRR / DM / MOIC / CE, with
// green/red delta columns vs the base run when a stress scenario is shown.

import type { TableData } from '../../lib/types';
import { money, num, pct, walMonths } from '../../lib/utils';
import DataTable from '../shared/DataTable';
import type { Column } from '../shared/DataTable';

type Row = Record<string, unknown>;

const FORMATTERS: Record<string, (v: number) => string> = {
  original_balance: money,
  ending_balance: money,
  interest_paid: money,
  principal_paid: money,
  writedown: money,
  size_pct: pct,
  rate: pct,
  xirr: pct,
  credit_enhancement: pct,
  wal_months: walMonths,
  dm_bps: (v) => `${num(v, 0)}bp`,
  moic: (v) => v.toFixed(2),
};

const DELTA_COLS = new Set(['wal_months', 'xirr', 'moic', 'writedown']);

interface Props {
  data: TableData;
  base?: TableData | null; // base-scenario table for delta columns
}

export default function StackSummaryTable({ data, base }: Props) {
  const baseByTranche = new Map<string, Row>(
    (base?.records ?? []).map((r) => [String(r.tranche), r]),
  );
  const showDeltas = base != null && base !== data;

  const columns: Column<Row>[] = data.columns.map((col) => ({
    key: col,
    header: col.replace(/_/g, ' ').toUpperCase(),
    align: col === 'tranche' || col === 'type' ? 'left' : 'right',
    sortValue: (r) => (typeof r[col] === 'number' ? (r[col] as number) : String(r[col] ?? '')),
    render: (r) => {
      const v = r[col];
      if (v == null) return <span className="dim">—</span>;
      if (typeof v !== 'number') {
        return col === 'tranche' ? (
          <span style={{ color: 'var(--text-accent)' }}>{String(v)}</span>
        ) : (
          <span className="dim">{String(v)}</span>
        );
      }
      const fmt = FORMATTERS[col] ?? ((x: number) => num(x, 2));
      let delta = null;
      if (showDeltas && DELTA_COLS.has(col)) {
        const b = baseByTranche.get(String(r.tranche))?.[col];
        if (typeof b === 'number' && b !== v) {
          const d = v - b;
          const good = col === 'writedown' || col === 'wal_months' ? d < 0 : d > 0;
          delta = (
            <span className={good ? 'pos' : 'neg'} style={{ fontSize: 10, marginLeft: 4 }}>
              {d > 0 ? '+' : ''}
              {FORMATTERS[col] ? FORMATTERS[col](d) : num(d, 2)}
            </span>
          );
        }
      }
      return (
        <span className="num mono">
          {fmt(v)}
          {delta}
        </span>
      );
    },
  }));

  return (
    <DataTable
      columns={columns}
      rows={data.records}
      rowKey={(r) => String(r.tranche)}
      emptyMessage="NO RESULTS"
    />
  );
}
