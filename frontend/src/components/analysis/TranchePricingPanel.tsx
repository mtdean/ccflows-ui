// Tranche pricing: pick a tranche, price it at a manual yield / DM / spread /
// custom zero (swap) curve; full mark card + yield & price tables.

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Play, Plus, X } from 'lucide-react';
import {
  getAnalysisTranches,
  getPriceTable,
  getYieldTable,
  priceTranche,
} from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { apiErrorMessage, money, num, pct, walMonths } from '../../lib/utils';
import type { PriceMethod, TrancheMark } from '../../lib/types';
import DataTable from '../shared/DataTable';
import type { Column } from '../shared/DataTable';
import LoadingCursor from '../shared/LoadingCursor';

interface Props {
  runId: string;
}

const METHODS: { key: PriceMethod; label: string; hint: string }[] = [
  { key: 'yield', label: 'YIELD', hint: 'Flat annual yield, decimal (0.085 = 8.5%)' },
  { key: 'dm', label: 'DM', hint: 'Discount margin in bps over the deal index (floating only)' },
  { key: 'spread', label: 'SPREAD', hint: 'Spread in bps over the deal index path' },
  { key: 'zero_curve', label: 'CUSTOM CURVE', hint: 'Your own zero / swap curve nodes' },
];

function MarkCard({ mark }: { mark: TrancheMark }) {
  const items: [string, string][] = [
    ['PRICE', mark.price != null ? num(mark.price, 3) : '—'],
    ['DIRTY', mark.dirty_price != null ? num(mark.dirty_price, 3) : '—'],
    ['MARKET VALUE', money(mark.market_value as number)],
    ['PAR', money(mark.par_value as number)],
    ['ACCRUED', money(mark.accrued_interest as number)],
    ['WAL', mark.wal_remaining != null ? walMonths(mark.wal_remaining as number) : '—'],
    ['MOD DURATION', mark.modified_duration != null ? `${num(mark.modified_duration as number, 2)}y` : '—'],
    ['SPREAD DV01', mark.spread_dv01 != null ? num(mark.spread_dv01 as number, 4) : '—'],
  ];
  return (
    <div>
      <div className="stat-grid" style={{ marginTop: 10 }}>
        {items.map(([label, value]) => (
          <div key={label} style={{ border: '1px solid var(--border)', padding: '6px 10px' }}>
            <div className="dim" style={{ fontSize: 10, letterSpacing: '0.08em' }}>{label}</div>
            <div className="mono" style={{ fontSize: 15, color: 'var(--text-accent)' }}>{value}</div>
          </div>
        ))}
      </div>
      {mark.note && (
        <div style={{ color: 'var(--warning)', fontSize: 11, marginTop: 6 }}>{mark.note}</div>
      )}
    </div>
  );
}

export default function TranchePricingPanel({ runId }: Props) {
  const [tranche, setTranche] = useState<string | null>(null);
  const [method, setMethod] = useState<PriceMethod>('yield');
  const [value, setValue] = useState('0.08');
  const [nodes, setNodes] = useState<{ date: string; rate: number }[]>([
    { date: new Date().toISOString().slice(0, 10), rate: 0.045 },
  ]);
  const [mark, setMark] = useState<TrancheMark | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tranches = useQuery({
    queryKey: qk.analysis(runId, 'tranches'),
    queryFn: () => getAnalysisTranches(runId),
    staleTime: Infinity,
  });

  const priceable = useMemo(
    () => (tranches.data?.tranches ?? []).filter((t) => t.priceable),
    [tranches.data],
  );
  const active = tranche && priceable.some((t) => t.name === tranche) ? tranche : priceable[0]?.name ?? null;
  const activeSpec = priceable.find((t) => t.name === active);

  const price = useMutation({
    mutationFn: () =>
      priceTranche(runId, {
        tranche: active!,
        method,
        ...(method === 'zero_curve' ? { nodes } : { value: Number(value) }),
      }),
    onSuccess: (m) => {
      setMark(m);
      setError(null);
    },
    onError: (err) => setError(apiErrorMessage(err, 'Pricing failed')),
  });

  const yieldTable = useQuery({
    queryKey: qk.analysis(runId, 'yieldTable', active ?? ''),
    queryFn: () => getYieldTable(runId, active!),
    enabled: active != null,
    staleTime: Infinity,
  });
  const priceTable = useQuery({
    queryKey: qk.analysis(runId, 'priceTable', active ?? ''),
    queryFn: () => getPriceTable(runId, active!),
    enabled: active != null,
    staleTime: Infinity,
  });

  if (tranches.isLoading) return <LoadingCursor />;
  if (!active) return <span className="dim">no priceable tranches</span>;

  type Row = Record<string, unknown>;
  const tableCols = (columns: string[]): Column<Row>[] =>
    columns.map((c) => ({
      key: c,
      header: c.replace(/_/g, ' ').toUpperCase(),
      align: 'right',
      sortable: false,
      render: (r) => {
        const v = r[c];
        if (typeof v !== 'number') return <span className="dim">—</span>;
        if (c === 'xirr' || c === 'yield') return <span className="num mono">{pct(v)}</span>;
        return <span className="num mono">{num(v, 2)}</span>;
      },
    }));

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {priceable.map((t) => (
          <button
            key={t.name}
            className={`chip ${t.name === active ? 'chip--active' : ''}`}
            title={t.floating ? `floating, margin ${pct(Number(t.margin))}` : `fixed, coupon ${pct(Number(t.coupon))}`}
            onClick={() => {
              setTranche(t.name);
              setMark(null);
            }}
          >
            {t.name} {t.floating ? '·FLT' : '·FXD'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {METHODS.map((m) => (
          <button
            key={m.key}
            className={`chip ${m.key === method ? 'chip--active' : ''}`}
            title={m.hint}
            onClick={() => {
              setMethod(m.key);
              setMark(null);
              if (m.key === 'yield') setValue('0.08');
              if (m.key === 'dm' || m.key === 'spread') setValue('200');
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {method !== 'zero_curve' ? (
        <div className="field-row" style={{ maxWidth: 420 }}>
          <label>{method === 'yield' ? 'annual yield (decimal)' : `${method} (bps)`}</label>
          <span className="field-control">
            <input
              className="input num"
              type="number"
              step={method === 'yield' ? 0.0025 : 5}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <button className="btn" disabled={price.isPending} onClick={() => price.mutate()}>
              <Play size={11} /> PRICE
            </button>
          </span>
        </div>
      ) : (
        <div style={{ maxWidth: 460 }}>
          <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>
            Zero/swap curve nodes (annual decimal rates); linear interp, flat extrapolation.
          </div>
          {nodes.map((n, i) => (
            <div key={i} className="ramp-point-row" style={{ marginBottom: 4 }}>
              <input
                className="input"
                type="date"
                value={n.date}
                onChange={(e) => setNodes((ns) => ns.map((q, j) => (j === i ? { ...q, date: e.target.value } : q)))}
              />
              <input
                className="input num"
                type="number"
                step={0.0025}
                value={n.rate}
                onChange={(e) => setNodes((ns) => ns.map((q, j) => (j === i ? { ...q, rate: Number(e.target.value) } : q)))}
              />
              <button className="btn" disabled={nodes.length <= 1} onClick={() => setNodes((ns) => ns.filter((_, j) => j !== i))}>
                <X size={10} />
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn"
              onClick={() =>
                setNodes((ns) => {
                  const last = ns[ns.length - 1];
                  const d = new Date(last?.date ?? Date.now());
                  d.setFullYear(d.getFullYear() + 1);
                  return [...ns, { date: d.toISOString().slice(0, 10), rate: last?.rate ?? 0.045 }];
                })
              }
            >
              <Plus size={10} /> NODE
            </button>
            <button className="btn" disabled={price.isPending} onClick={() => price.mutate()}>
              <Play size={11} /> PRICE
            </button>
          </div>
        </div>
      )}

      {error && <div className="field-error-msg" style={{ textAlign: 'left' }}>{error}</div>}
      {price.isPending && <LoadingCursor label="PRICING" />}
      {mark && <MarkCard mark={mark} />}

      <div className="grid-2" style={{ marginTop: 14 }}>
        <div>
          <div className="section-label">
            YIELD TABLE — {active}
            {yieldTable.data?.attrs?.wal_months != null &&
              ` · WAL ${walMonths(Number(yieldTable.data.attrs.wal_months))}`}
          </div>
          {yieldTable.data && (
            <DataTable
              columns={tableCols(yieldTable.data.columns)}
              rows={yieldTable.data.records}
              rowKey={(r) => String(r.price)}
              emptyMessage="—"
            />
          )}
        </div>
        <div>
          <div className="section-label">
            PRICE TABLE — {active} · axis {priceTable.data?.axis === 'dm_bps' ? 'DM (bps)' : 'yield'}
          </div>
          {priceTable.data && (
            <DataTable
              columns={tableCols(priceTable.data.columns)}
              rows={priceTable.data.records}
              rowKey={(r) => String(r[priceTable.data!.axis] ?? Math.random())}
              emptyMessage="—"
            />
          )}
        </div>
      </div>
      {activeSpec && !activeSpec.floating && method === 'dm' && (
        <div style={{ color: 'var(--warning)', fontSize: 11, marginTop: 6 }}>
          {active} is fixed-rate — DM pricing is undefined for it; use YIELD or SPREAD.
        </div>
      )}
    </div>
  );
}
