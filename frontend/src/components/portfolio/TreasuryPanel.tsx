// Fund treasury: capital settings + events, the Excel-like monthly cash
// ledger with dry powder, and the aggregated fund P&L statement.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Plus, Save, Trash2 } from 'lucide-react';
import { client } from '../../lib/api';
import { COLORS } from '../../lib/colors';
import { apiErrorMessage, money, moneyFull, pct } from '../../lib/utils';
import DataTable from '../shared/DataTable';
import type { Column } from '../shared/DataTable';
import EmptyState from '../shared/EmptyState';
import LoadingCursor from '../shared/LoadingCursor';
import Panel from '../shared/Panel';
import RangeToggle from '../shared/RangeToggle';

type Row = Record<string, unknown>;

interface TreasuryEvent {
  month: string;
  type: 'contribution' | 'distribution' | 'draw' | 'repay';
  amount: number;
  note: string;
}

interface Ledger {
  rows: Row[];
  snapshot: Row | null;
  deal_errors: Record<string, string>;
  treasury: {
    opening_cash: number;
    credit_line: { limit: number; rate: number };
    events: TreasuryEvent[];
  };
}

const LEDGER_COLS: [string, string][] = [
  ['opening_cash', 'OPEN'], ['contributions', '+CONTRIB'], ['distributions', '−DISTRIB'],
  ['credit_draws', '+DRAW'], ['credit_repayments', '−REPAY'], ['credit_interest', '−INT'],
  ['purchases', '−PURCHASES'], ['deal_receipts', '+RECEIPTS'],
  ['net_cash_flow', 'NET'], ['closing_cash', 'CLOSE'],
  ['credit_drawn', 'DRAWN'], ['dry_powder', 'DRY POWDER'], ['dry_powder_net', 'NET OF CMT'],
];

export default function TreasuryPanel({ slug }: { slug: string }) {
  const queryClient = useQueryClient();
  const [horizon, setHorizon] = useState<'12' | '24' | '36' | '60'>('24');
  const [draft, setDraft] = useState<Ledger['treasury'] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pnlFreq, setPnlFreq] = useState<'M' | 'Q' | 'A'>('Q');
  const [showPnl, setShowPnl] = useState(false);

  const ledger = useQuery({
    queryKey: ['treasury', slug, horizon],
    queryFn: () =>
      client.get<Ledger>(`/portfolios/${slug}/treasury?horizon_months=${horizon}`).then((r) => r.data),
  });

  const pnl = useQuery({
    queryKey: ['fundPnl', slug, pnlFreq],
    queryFn: () =>
      client
        .get<{ rows: Row[]; skipped: { position: string; reason: string }[] }>(
          `/portfolios/${slug}/pnl?freq=${pnlFreq}`)
        .then((r) => r.data),
    enabled: showPnl,
  });

  const save = useMutation({
    mutationFn: (treasury: Ledger['treasury']) =>
      client.put(`/portfolios/${slug}/treasury`, treasury),
    onSuccess: () => {
      setDraft(null);
      setMsg('Saved');
      queryClient.invalidateQueries({ queryKey: ['treasury', slug] });
    },
    onError: (err) => setMsg(apiErrorMessage(err, 'Save failed')),
  });

  const treasury = draft ?? ledger.data?.treasury ?? {
    opening_cash: 0, credit_line: { limit: 0, rate: 0 }, events: [],
  };
  const edit = (mutator: (t: Ledger['treasury']) => void) => {
    const next = structuredClone(treasury);
    mutator(next);
    setDraft(next);
  };

  const snap = ledger.data?.snapshot;
  const chartData = (ledger.data?.rows ?? []).map((r) => ({
    period: String(r.period),
    cash: Number(r.closing_cash),
    dry: Number(r.dry_powder),
    drawn: Number(r.credit_drawn),
  }));
  const actualThrough = (ledger.data?.rows ?? []).filter((r) => r.is_actual).length;

  const cols: Column<Row>[] = [
    {
      key: 'period', header: 'MONTH', sortable: false,
      render: (r) => (
        <span className={`mono ${r.is_actual ? '' : 'dim'}`}
          style={r.is_actual ? { color: 'var(--text-accent)' } : undefined}>
          {String(r.period)}{r.is_actual ? '' : ' ᵖ'}
        </span>
      ),
    },
    ...LEDGER_COLS.filter(([key]) =>
      key !== 'dry_powder_net' || Number(snap?.unfunded_commitments ?? 0) > 0,
    ).map(([key, header]): Column<Row> => ({
      key, header, align: 'right', sortable: false,
      render: (r) => {
        const v = Number(r[key] ?? 0);
        if (v === 0 && key !== 'closing_cash' && key !== 'dry_powder' && key !== 'opening_cash') {
          return <span className="dim">—</span>;
        }
        const cls = key === 'dry_powder' ? 'pos'
          : key === 'dry_powder_net' ? (v >= 0 ? '' : 'neg')
          : key === 'net_cash_flow' ? (v >= 0 ? 'pos' : 'neg')
          : key === 'closing_cash' && v < 0 ? 'neg' : '';
        return <span className={`num mono ${cls}`}>{moneyFull(v)}</span>;
      },
    })),
    {
      key: 'notes', header: '', sortable: false,
      render: (r) => (r.notes ? <span className="neg" style={{ fontSize: 10 }}>{String(r.notes)}</span> : null),
    },
  ];

  const pnlCols: Column<Row>[] = [
    { key: 'period', header: 'PERIOD', sortable: false,
      render: (r) => <span className={`mono ${r.is_actual ? '' : 'dim'}`}>{String(r.period)}{r.is_actual ? '' : ' ᵖ'}</span> },
    ...(['beginning_mv', 'interest_income', 'realized_pl', 'unrealized_pl', 'cash_received', 'total_pl', 'ending_mv'] as const)
      .map((key): Column<Row> => ({
        key, header: key.replace(/_/g, ' ').toUpperCase(), align: 'right', sortable: false,
        render: (r) => {
          const v = Number(r[key] ?? 0);
          const cls = (key === 'realized_pl' || key === 'unrealized_pl' || key === 'total_pl') && v !== 0
            ? (v > 0 ? 'pos' : 'neg') : '';
          return <span className={`num mono ${cls}`}>{moneyFull(v)}</span>;
        },
      })),
  ];

  return (
    <Panel
      title="TREASURY & CASH"
      subtitle={
        snap ? (
          <span className="mono">
            as of {String(snap.as_of)} · cash {money(Number(snap.cash))} · drawn {money(Number(snap.credit_drawn))} ·{' '}
            <span className="pos">dry powder {money(Number(snap.dry_powder))}</span>
            {Number(snap.unfunded_commitments ?? 0) > 0 && (
              <span style={{ color: 'var(--warning)' }}
                title="Committed to positions but not yet funded — callable against your cash">
                {' '}· net of {money(Number(snap.unfunded_commitments))} unfunded cmt ={' '}
                {money(Number(snap.dry_powder_net))}
              </span>
            )}
          </span>
        ) : (
          <span className="dim">monthly cash ledger — receipts land by each deal's calendar</span>
        )
      }
      actions={
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <RangeToggle options={['12', '24', '36', '60'] as const} value={horizon} onChange={setHorizon} />
          <button className={`chip ${showPnl ? 'chip--active' : ''}`} onClick={() => setShowPnl((s) => !s)}>
            FUND P&L
          </button>
        </div>
      }
    >
      {/* capital settings + events */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field-row">
          <label>opening cash</label>
          <input className="input num" type="number" step={100000} value={treasury.opening_cash}
            onChange={(e) => edit((t) => { t.opening_cash = Number(e.target.value); })} />
        </div>
        <div className="field-row">
          <label>credit line limit</label>
          <input className="input num" type="number" step={1000000} value={treasury.credit_line.limit}
            onChange={(e) => edit((t) => { t.credit_line.limit = Number(e.target.value); })} />
        </div>
        <div className="field-row">
          <label>line rate (annual, decimal)</label>
          <input className="input num" type="number" step={0.0025} value={treasury.credit_line.rate}
            onChange={(e) => edit((t) => { t.credit_line.rate = Number(e.target.value); })} />
        </div>
        {draft && (
          <button className="btn" style={{ color: 'var(--text-accent)', borderColor: 'var(--text-accent)' }}
            disabled={save.isPending} onClick={() => save.mutate(draft)}>
            <Save size={11} /> SAVE
          </button>
        )}
        {msg && <span className="dim" style={{ fontSize: 11 }}>{msg}</span>}
      </div>

      <div className="section-label" style={{ marginTop: 8 }}>CAPITAL EVENTS</div>
      {treasury.events.map((e, i) => (
        <div key={i} className="field-row" style={{ maxWidth: 640 }}>
          <label className="mono">{e.month}</label>
          <span className="field-control">
            <input className="input" type="month" value={e.month}
              onChange={(ev) => edit((t) => { t.events[i].month = ev.target.value; })} />
            <select className="input" value={e.type}
              onChange={(ev) => edit((t) => { t.events[i].type = ev.target.value as TreasuryEvent['type']; })}>
              <option value="contribution">contribution</option>
              <option value="distribution">distribution</option>
              <option value="draw">credit draw</option>
              <option value="repay">credit repay</option>
            </select>
            <input className="input num" type="number" step={100000} value={e.amount}
              onChange={(ev) => edit((t) => { t.events[i].amount = Number(ev.target.value); })} />
            <input className="input" style={{ width: 140 }} placeholder="note…" value={e.note}
              onChange={(ev) => edit((t) => { t.events[i].note = ev.target.value; })} />
            <button className="btn" style={{ color: 'var(--warning)' }}
              onClick={() => edit((t) => { t.events.splice(i, 1); })}>
              <Trash2 size={10} />
            </button>
          </span>
        </div>
      ))}
      <button className="btn" style={{ marginTop: 4 }}
        onClick={() => edit((t) => {
          t.events.push({ month: new Date().toISOString().slice(0, 7),
                          type: 'contribution', amount: 1_000_000, note: '' });
        })}>
        <Plus size={11} /> EVENT
      </button>

      {/* chart + ledger */}
      {ledger.isLoading ? (
        <LoadingCursor />
      ) : (ledger.data?.rows ?? []).length === 0 ? (
        <EmptyState message="ADD POSITIONS OR EVENTS TO BUILD THE LEDGER" />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={COLORS.border} vertical={false} />
              <XAxis dataKey="period" tick={{ fill: COLORS.axis, fontSize: 9 }} minTickGap={40} stroke={COLORS.axis} />
              <YAxis tick={{ fill: COLORS.axis, fontSize: 10 }} width={60} stroke={COLORS.axis}
                tickFormatter={(v: number) => money(v)} />
              {actualThrough > 0 && chartData[actualThrough - 1] && (
                <ReferenceLine x={chartData[actualThrough - 1].period} stroke={COLORS.borderBright}
                  strokeDasharray="3 3" />
              )}
              <ReferenceLine y={0} stroke={COLORS.borderBright} />
              <Tooltip content={({ active, payload, label }) => active && payload?.length ? (
                <div style={{ background: COLORS.bgPanel, border: `1px solid ${COLORS.borderBright}`,
                              padding: '6px 10px', fontSize: 11 }}>
                  <div style={{ color: COLORS.textSecondary }}>{String(label)}</div>
                  {payload.map((p) => (
                    <div key={String(p.name)} style={{ color: String(p.color) }}>
                      {String(p.name)} {money(Number(p.value))}
                    </div>
                  ))}
                </div>
              ) : null} cursor={{ stroke: COLORS.borderBright }} />
              <Area dataKey="dry" name="dry powder" stroke="#00c176" strokeWidth={1}
                fill="#00c176" fillOpacity={0.08} isAnimationActive={false} />
              <Line dataKey="cash" name="cash" stroke={COLORS.chartPrimary} strokeWidth={1.5}
                dot={false} isAnimationActive={false} />
              <Line dataKey="drawn" name="drawn" stroke="#ff6b6b" strokeWidth={1} strokeDasharray="4 3"
                dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
          {Object.entries(ledger.data?.deal_errors ?? {}).map(([d, e]) => (
            <div key={d} className="neg" style={{ fontSize: 11 }}>{d}: {e}</div>
          ))}
          <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
            <DataTable columns={cols} rows={ledger.data!.rows} rowKey={(r) => String(r.period)}
              emptyMessage="—" />
          </div>
          <div className="dim" style={{ fontSize: 10, marginTop: 4 }}>
            ᵖ = projected months (beyond the latest remittance boundary). Credit interest accrues
            monthly at {pct(treasury.credit_line.rate)} on the drawn balance.
          </div>
        </>
      )}

      {/* fund P&L */}
      {showPnl && (
        <div style={{ marginTop: 14 }}>
          <div className="section-label" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            FUND P&L (AGGREGATED POSITION STATEMENTS)
            <RangeToggle options={['M', 'Q', 'A'] as const} value={pnlFreq} onChange={setPnlFreq} />
          </div>
          {pnl.isLoading ? (
            <LoadingCursor label="MARKING EVERY POSITION EVERY MONTH" />
          ) : (pnl.data?.rows ?? []).length === 0 ? (
            <EmptyState message="NO POSITIONS ON DEALS WITH ACTUALS" />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <DataTable columns={pnlCols} rows={pnl.data!.rows} rowKey={(r) => String(r.period)}
                emptyMessage="—" />
            </div>
          )}
          {(pnl.data?.skipped ?? []).map((s, i) => (
            <div key={i} className="dim" style={{ fontSize: 10 }}>skipped {s.position}: {s.reason}</div>
          ))}
        </div>
      )}
    </Panel>
  );
}
