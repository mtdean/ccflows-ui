// Mark the whole deal: one method, per-tranche values, full mark table.

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { getAnalysisTranches, markDeal } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { apiErrorMessage, money, num, walMonths } from '../../lib/utils';
import type { TrancheMark } from '../../lib/types';
import DataTable from '../shared/DataTable';
import type { Column } from '../shared/DataTable';
import LoadingCursor from '../shared/LoadingCursor';

interface Props {
  runId: string;
}

export default function MarksPanel({ runId }: Props) {
  const [method, setMethod] = useState<'spread' | 'yield' | 'dm'>('spread');
  const [values, setValues] = useState<Record<string, number>>({});
  const [asOf, setAsOf] = useState(0);
  const [rows, setRows] = useState<TrancheMark[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tranches = useQuery({
    queryKey: qk.analysis(runId, 'tranches'),
    queryFn: () => getAnalysisTranches(runId),
    staleTime: Infinity,
  });

  const names = useMemo(
    () => (tranches.data?.tranches ?? []).map((t) => t.name),
    [tranches.data],
  );
  const defaultValue = method === 'yield' ? 0.08 : 200;

  const mark = useMutation({
    mutationFn: () =>
      markDeal(runId, {
        method,
        values: Object.fromEntries(names.map((n) => [n, values[n] ?? defaultValue])),
        as_of_month: asOf,
      }),
    onSuccess: (data) => {
      setRows(data.rows);
      setError(null);
    },
    onError: (err) => setError(apiErrorMessage(err, 'Mark failed')),
  });

  const columns: Column<TrancheMark>[] = [
    { key: 'tranche', header: 'TRANCHE', render: (r) => <span style={{ color: 'var(--text-accent)' }}>{String(r.tranche)}</span> },
    { key: 'price', header: 'PRICE', align: 'right', render: (r) => <span className="num mono">{r.price != null ? num(r.price, 3) : '—'}</span> },
    { key: 'dirty_price', header: 'DIRTY', align: 'right', render: (r) => <span className="num mono">{r.dirty_price != null ? num(r.dirty_price as number, 3) : '—'}</span> },
    { key: 'par_value', header: 'PAR', align: 'right', render: (r) => <span className="num mono">{money(r.par_value as number)}</span> },
    { key: 'market_value', header: 'MARKET VALUE', align: 'right', render: (r) => <span className="num mono">{money(r.market_value as number)}</span> },
    { key: 'accrued_interest', header: 'ACCRUED', align: 'right', render: (r) => <span className="num mono">{money(r.accrued_interest as number)}</span> },
    { key: 'wal_remaining', header: 'WAL', align: 'right', render: (r) => <span className="num mono">{r.wal_remaining != null ? walMonths(r.wal_remaining as number) : '—'}</span> },
    { key: 'modified_duration', header: 'DUR', align: 'right', render: (r) => <span className="num mono">{r.modified_duration != null ? `${num(r.modified_duration as number, 2)}y` : '—'}</span> },
    { key: 'spread_dv01', header: 'DV01', align: 'right', render: (r) => <span className="num mono">{r.spread_dv01 != null ? num(r.spread_dv01 as number, 4) : '—'}</span> },
  ];

  if (tranches.isLoading) return <LoadingCursor />;

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 8 }}>
        <div className="field-row">
          <label>method</label>
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="spread">SPREAD (bps over index)</option>
            <option value="dm">DM (bps)</option>
            <option value="yield">YIELD (decimal)</option>
          </select>
        </div>
        <div className="field-row">
          <label>as-of month</label>
          <input className="input num" type="number" min={0} value={asOf}
            onChange={(e) => setAsOf(Math.max(0, Math.trunc(Number(e.target.value))))} />
        </div>
        {names.map((n) => (
          <div key={n} className="field-row">
            <label>{n}</label>
            <input
              className="input num"
              style={{ width: 80 }}
              type="number"
              step={method === 'yield' ? 0.005 : 25}
              value={values[n] ?? defaultValue}
              onChange={(e) => setValues((v) => ({ ...v, [n]: Number(e.target.value) }))}
            />
          </div>
        ))}
        <button className="btn" disabled={mark.isPending} onClick={() => mark.mutate()}>
          <Play size={11} /> MARK DEAL
        </button>
      </div>
      {error && <div className="field-error-msg" style={{ textAlign: 'left' }}>{error}</div>}
      {mark.isPending && <LoadingCursor label="MARKING" />}
      {rows && (
        <div style={{ overflowX: 'auto' }}>
          <DataTable columns={columns} rows={rows} rowKey={(r) => String(r.tranche)} emptyMessage="—" />
        </div>
      )}
    </div>
  );
}
