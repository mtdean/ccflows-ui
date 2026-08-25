// Collateral view: per-repline unit economics + whole-loan pricing.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { client, getLoanPricing } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { money, moneyFull, num, pct, walMonths } from '../../lib/utils';
import type { LoanPricingRow } from '../../lib/types';
import DataTable from '../shared/DataTable';
import type { Column } from '../shared/DataTable';
import LoadingCursor from '../shared/LoadingCursor';

interface Props {
  runId: string;
}

type EconRow = Record<string, number | string | null> & { repline_id: string };

function UnitEconomicsTable({ runId }: { runId: string }) {
  const query = useQuery({
    queryKey: qk.analysis(runId, 'unitEcon'),
    queryFn: () =>
      client
        .get<{ rows: EconRow[] }>(`/runs/${runId}/analysis/unit-economics`)
        .then((r) => r.data.rows),
    staleTime: Infinity,
  });

  if (query.isLoading) return <LoadingCursor />;
  const rows = query.data ?? [];

  const numCell = (fmt: (v: number) => string) => (v: unknown) =>
    typeof v === 'number' ? <span className="num mono">{fmt(v)}</span> : <span className="dim">—</span>;

  const columns: Column<EconRow>[] = [
    { key: 'repline_id', header: 'REPLINE', render: (r) => <span style={{ color: 'var(--text-accent)' }}>{r.repline_id}</span> },
    { key: 'upb', header: 'UPB', align: 'right', render: (r) => numCell(money)(r.upb), sortValue: (r) => Number(r.upb) },
    { key: 'accounts', header: 'UNITS', align: 'right', render: (r) => numCell((v) => num(v, 0))(r.accounts) },
    { key: 'avg_balance', header: 'AVG BAL', align: 'right', render: (r) => numCell(moneyFull)(r.avg_balance) },
    { key: 'gross_wac', header: 'WAC', align: 'right', render: (r) => numCell(pct)(r.gross_wac) },
    { key: 'term', header: 'TERM', align: 'right', render: (r) => numCell((v) => `${num(v, 0)}mo`)(r.term) },
    { key: 'wal_months', header: 'WAL', align: 'right', render: (r) => numCell(walMonths)(r.wal_months) },
    { key: 'interest_revenue', header: 'LIFE INT', align: 'right', render: (r) => numCell(money)(r.interest_revenue) },
    { key: 'gross_chargeoffs', header: 'GROSS C/O', align: 'right', render: (r) => numCell(money)(r.gross_chargeoffs) },
    { key: 'recoveries', header: 'RECOV', align: 'right', render: (r) => numCell(money)(r.recoveries) },
    { key: 'cum_loss_rate', header: 'CNL', align: 'right', render: (r) => numCell(pct)(r.cum_loss_rate) },
    { key: 'servicing_cost', header: 'SVC COST', align: 'right', render: (r) => numCell(money)(r.servicing_cost) },
    { key: 'net_cash', header: 'NET CASH', align: 'right', render: (r) => numCell(money)(r.net_cash), sortValue: (r) => Number(r.net_cash) },
    { key: 'revenue_per_unit', header: 'REV/UNIT', align: 'right', render: (r) => numCell(moneyFull)(r.revenue_per_unit) },
    { key: 'net_cash_per_unit', header: 'NET/UNIT', align: 'right', render: (r) => numCell(moneyFull)(r.net_cash_per_unit) },
    { key: 'xirr', header: 'XIRR', align: 'right', render: (r) => numCell(pct)(r.xirr) },
    { key: 'moic', header: 'MOIC', align: 'right', render: (r) => numCell((v) => num(v, 2))(r.moic) },
  ];

  return (
    <div style={{ overflowX: 'auto' }}>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.repline_id} emptyMessage="NO REPLINES" />
    </div>
  );
}

export default function LoanPricingPanel({ runId }: Props) {
  const [spread, setSpread] = useState(200);
  const [price, setPrice] = useState(100);

  const query = useQuery({
    queryKey: qk.analysis(runId, 'loanPricing', spread, price),
    queryFn: () => getLoanPricing(runId, spread, price),
    staleTime: Infinity,
  });

  const columns: Column<LoanPricingRow>[] = [
    { key: 'repline_id', header: 'REPLINE', render: (r) => <span style={{ color: 'var(--text-accent)' }}>{r.repline_id}</span> },
    { key: 'engine', header: 'ENGINE', render: (r) => <span className="dim">{r.engine}</span> },
    { key: 'wal_months', header: 'WAL', align: 'right', render: (r) => <span className="num mono">{walMonths(r.wal_months)}</span>, sortValue: (r) => r.wal_months },
    { key: 'duration_years', header: 'DURATION', align: 'right', render: (r) => <span className="num mono">{r.duration_years != null ? `${num(r.duration_years, 2)}y` : '—'}</span>, sortValue: (r) => r.duration_years },
    { key: 'price_at_spread', header: `PRICE @ +${spread}BP`, align: 'right', render: (r) => <span className="num mono">{num(r.price_at_spread, 3)}</span>, sortValue: (r) => r.price_at_spread },
    { key: 'dm_bps_at_price', header: `DM @ ${price}`, align: 'right', render: (r) => <span className="num mono">{r.dm_bps_at_price != null ? `${num(r.dm_bps_at_price, 0)}bp` : '—'}</span>, sortValue: (r) => r.dm_bps_at_price },
    { key: 'xirr', header: 'XIRR', align: 'right', render: (r) => <span className="num mono">{pct(r.xirr)}</span>, sortValue: (r) => r.xirr },
    { key: 'moic', header: 'MOIC', align: 'right', render: (r) => <span className="num mono">{r.moic != null ? num(r.moic, 2) : '—'}</span>, sortValue: (r) => r.moic },
  ];

  return (
    <div>
      <div className="section-label">UNIT ECONOMICS (LIFETIME, PER REPLINE)</div>
      <UnitEconomicsTable runId={runId} />
      <div className="section-label" style={{ marginTop: 14 }}>WHOLE-LOAN PRICING</div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
        <div className="field-row">
          <label>discount spread (bps over index)</label>
          <input className="input num" type="number" step={25} value={spread}
            onChange={(e) => setSpread(Number(e.target.value))} />
        </div>
        <div className="field-row">
          <label>target price (for DM solve)</label>
          <input className="input num" type="number" step={0.5} value={price}
            onChange={(e) => setPrice(Number(e.target.value))} />
        </div>
      </div>
      {query.isLoading ? (
        <LoadingCursor />
      ) : (
        <DataTable
          columns={columns}
          rows={query.data ?? []}
          rowKey={(r) => `${r.engine}:${r.repline_id}`}
          emptyMessage="NO REPLINES"
        />
      )}
      <div className="dim" style={{ fontSize: 10, marginTop: 6 }}>
        Prices are % of par (100 = par), discounted at the deal's index path + spread.
        Unlevered whole-loan economics — the pool before the waterfall.
      </div>
    </div>
  );
}
