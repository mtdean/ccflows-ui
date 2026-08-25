// Portfolios: per-fund books of tranche positions across deals, marked
// against auto-refreshed base runs. One portfolio per fund.

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  createPortfolio,
  deletePortfolio,
  getFmFinal,
  getPortfolio,
  getPortfolioAnalytics,
  listDeals,
  listPortfolios,
  putPortfolio,
} from '../lib/api';
import { qk } from '../lib/queryKeys';
import { apiErrorMessage, downloadJson, fmtTime, money, num, pct, walMonths } from '../lib/utils';
import type { DealSummary, PortfolioAnalyticsRow, PortfolioDoc } from '../lib/types';
import DataTable from '../components/shared/DataTable';
import type { Column } from '../components/shared/DataTable';
import EmptyState from '../components/shared/EmptyState';
import LoadingCursor from '../components/shared/LoadingCursor';
import Panel from '../components/shared/Panel';
import MarkBookPanel from '../components/portfolio/MarkBookPanel';
import PositionsEditor from '../components/portfolio/PositionsEditor';
import TreasuryPanel from '../components/portfolio/TreasuryPanel';

function pnlClass(v: number | null | undefined): string {
  if (v == null || v === 0) return 'dim';
  return v > 0 ? 'pos' : 'neg';
}

// Months between an FM-approved close month (YYYY-MM) and today: the mark's
// "good through" age. 0-1 fresh, 2-3 aging, 4+ stale.
function goodThroughAge(month: string | null | undefined): number | null {
  if (!month) return null;
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return null;
  const now = new Date();
  return (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
}

function goodThroughColor(age: number | null): string {
  if (age == null) return 'var(--text-dim)';
  if (age <= 1) return 'var(--positive)';
  if (age <= 3) return 'var(--warning)';
  return 'var(--negative)';
}

export default function PortfoliosPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const portfolios = useQuery({ queryKey: qk.portfolios, queryFn: listPortfolios });
  const deals = useQuery({ queryKey: qk.deals, queryFn: listDeals });

  const slug = selected && portfolios.data?.some((p) => p.slug === selected)
    ? selected
    : portfolios.data?.[0]?.slug ?? null;

  const doc = useQuery({
    queryKey: slug ? qk.portfolio(slug) : ['portfolio', 'none'],
    queryFn: () => getPortfolio(slug!),
    enabled: slug != null,
  });

  const analytics = useQuery({
    queryKey: slug ? qk.portfolioAnalytics(slug) : ['portfolioAnalytics', 'none'],
    queryFn: () => getPortfolioAnalytics(slug!),
    enabled: slug != null && (doc.data?.positions.length ?? 0) > 0,
    refetchInterval: 60_000,
    retry: false,
  });

  const create = useMutation({
    mutationFn: (n: string) => createPortfolio(n),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: qk.portfolios });
      setSelected(created.meta.slug);
      setName('');
      setError(null);
    },
    onError: (err) => setError(apiErrorMessage(err, 'Create failed')),
  });

  const save = useMutation({
    mutationFn: (next: PortfolioDoc) => putPortfolio(next.meta.slug, next),
    onSuccess: (saved) => {
      queryClient.setQueryData(qk.portfolio(saved.meta.slug), saved);
      queryClient.invalidateQueries({ queryKey: qk.portfolios });
      queryClient.invalidateQueries({ queryKey: qk.portfolioAnalytics(saved.meta.slug) });
    },
    onError: (err) => setError(apiErrorMessage(err, 'Save failed')),
  });

  const remove = useMutation({
    mutationFn: (s: string) => deletePortfolio(s),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.portfolios });
      setSelected(null);
    },
  });

  const update = (mutator: (d: PortfolioDoc) => void) => {
    if (!doc.data) return;
    const next = structuredClone(doc.data);
    mutator(next);
    save.mutate(next);
  };

  const [view, setView] = useState<'live' | 'final'>('live');
  const fmFinal = useQuery({
    queryKey: slug ? qk.fmFinal(slug) : ['fmFinal', 'none'],
    queryFn: () => getFmFinal(slug!),
    enabled: slug != null && view === 'final',
    retry: false,
  });

  const shown = view === 'final' ? fmFinal.data?.analytics : analytics.data;
  const rows = shown?.rows ?? [];
  const totals = shown?.totals;
  const markUnit = (analytics.data?.method ?? doc.data?.marks.method) === 'yield' ? '' : 'bp';

  const columns: Column<PortfolioAnalyticsRow>[] = useMemo(() => [
    { key: 'deal', header: 'DEAL', render: (r) => <span className="dim">{r.deal}</span> },
    { key: 'tranche', header: 'TRANCHE', render: (r) => <span style={{ color: 'var(--text-accent)' }}>{r.tranche}</span> },
    {
      key: 'face', header: 'FACE', align: 'right', sortValue: (r) => r.face,
      render: (r) => (
        <span className="num mono">
          {money(r.face)}
          {(r.unfunded ?? 0) > 0 && (
            <span style={{ color: 'var(--warning)', fontSize: 9 }}
              title={`Commitment ${money(r.commitment)} — ${money(r.unfunded)} committed but unfunded`}>
              {' '}+{money(r.unfunded)}u
            </span>
          )}
        </span>
      ),
    },
    { key: 'factor', header: 'FACTOR', align: 'right', render: (r) => <span className="num mono">{r.factor != null ? num(r.factor, 3) : '—'}</span> },
    {
      key: 'mark_value', header: 'MARK', align: 'right',
      render: (r) => (
        <span className="num mono dim"
          title={(r.mark_source === 'book' ? 'From the workspace mark book'
            : r.mark_source === 'override' ? 'Per-position override' : 'Fund default')
            + (r.mark_note ? `\nNote: ${r.mark_note}` : '')}>
          {r.mark_value != null ? `${num(r.mark_value, r.mark_method === 'yield' ? 3 : 0)}${r.mark_method === 'yield' ? '' : 'bp'}` : '—'}
          {r.mark_source === 'book' && <span style={{ color: 'var(--text-accent)', fontSize: 9 }}> ᴮ</span>}
          {r.mark_source === 'override' && <span style={{ color: 'var(--warning)', fontSize: 9 }}> ᴼ</span>}
          {!!r.mark_note && <span style={{ color: 'var(--text-accent)', fontSize: 9 }}> ✎</span>}
        </span>
      ),
    },
    {
      key: 'good_through', header: 'GOOD THRU', align: 'right', sortValue: (r) => r.good_through ?? '',
      render: (r) => {
        const age = goodThroughAge(r.good_through);
        return (
          <span className="num mono" style={{ color: goodThroughColor(age) }}
            title={r.good_through
              ? `Last FM-approved mark: close ${r.good_through} (approved ${r.good_through_at ?? '—'})`
              : 'No FM-approved close carries this mark yet'}>
            {r.good_through ?? '—'}
          </span>
        );
      },
    },
    { key: 'price', header: 'PRICE', align: 'right', render: (r) => <span className="num mono">{r.price != null ? num(r.price, 3) : '—'}</span>, sortValue: (r) => r.price },
    { key: 'market_value', header: 'MARKET VALUE', align: 'right', render: (r) => <span className="num mono">{money(r.market_value)}</span>, sortValue: (r) => r.market_value },
    { key: 'cost_basis', header: 'COST', align: 'right', render: (r) => <span className="num mono dim">{num(r.cost_basis, 2)}</span> },
    { key: 'pnl', header: 'P&L', align: 'right', render: (r) => <span className={`num mono ${pnlClass(r.pnl)}`}>{r.pnl != null ? money(r.pnl) : '—'}</span>, sortValue: (r) => r.pnl },
    {
      key: 'irr_to_live', header: 'IRR TO LIVE', align: 'right', sortValue: (r) => r.irr_to_live,
      render: (r) => (
        <span className="num mono" style={{ color: 'var(--text-accent)' }}
          title="Hold-to-maturity IRR: cost → actual cashflows to date → spliced projections">
          {r.irr_to_live != null ? pct(r.irr_to_live) : '—'}
        </span>
      ),
    },
    {
      key: 'fm_irr', header: 'FM IRR', align: 'right', sortValue: (r) => r.fm_irr,
      render: (r) => (
        <span className="num mono"
          title="Fair-market IRR: cost → actuals to date → sale today at the fund's mark. — until actuals exist.">
          {r.fm_irr != null ? pct(r.fm_irr) : '—'}
        </span>
      ),
    },
    { key: 'accrued', header: 'ACCRUED', align: 'right', render: (r) => <span className="num mono dim">{money(r.accrued)}</span> },
    { key: 'wal', header: 'WAL', align: 'right', render: (r) => <span className="num mono">{r.wal != null ? walMonths(r.wal) : '—'}</span> },
    { key: 'dv01', header: 'DV01', align: 'right', render: (r) => <span className="num mono dim">{r.dv01 != null ? num(r.dv01, 3) : '—'}</span> },
    { key: 'error', header: '', render: (r) => (r.error ? <span className="neg" style={{ fontSize: 10 }}>{r.error}</span> : null), sortable: false },
  ], [markUnit]);

  return (
    <div className="stack">
    <div className="sidebar-grid">
      <div className="stack">
        <Panel
          title="FUNDS"
          actions={
            <form
              style={{ display: 'flex', gap: 4 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) create.mutate(name.trim());
              }}
            >
              <input className="input" style={{ width: 110 }} placeholder="fund name…"
                value={name} onChange={(e) => setName(e.target.value)} />
              <button className="btn" type="submit" disabled={!name.trim()}>
                <Plus size={11} />
              </button>
            </form>
          }
        >
          {portfolios.isLoading ? (
            <LoadingCursor />
          ) : (portfolios.data ?? []).length === 0 ? (
            <EmptyState message="NO FUNDS YET" />
          ) : (
            (portfolios.data ?? []).map((p) => (
              <div
                key={p.slug}
                className="field-row"
                style={{ cursor: 'pointer', background: p.slug === slug ? 'var(--bg-selected)' : undefined, padding: '4px 6px' }}
                onClick={() => setSelected(p.slug)}
              >
                <label style={{ color: p.slug === slug ? 'var(--text-accent)' : undefined, cursor: 'pointer' }}>
                  {p.name}
                </label>
                <span className="dim" style={{ fontSize: 10 }}>
                  {p.n_positions} pos · {p.deals.length} deal{p.deals.length === 1 ? '' : 's'}
                </span>
              </div>
            ))
          )}
        </Panel>
      </div>

      <div className="stack">
        {!slug || !doc.data ? (
          <Panel title="PORTFOLIO">
            <EmptyState message="CREATE OR SELECT A FUND" />
          </Panel>
        ) : (
          <>
            <Panel
              title={doc.data.meta.name.toUpperCase()}
              subtitle={
                totals && (
                  <span className="mono">
                    MV {money(totals.market_value)} · P&L{' '}
                    <span className={pnlClass(totals.pnl)}>{money(totals.pnl)}</span>
                    {totals.wal != null && <> · WAL {walMonths(totals.wal)}</>}
                  </span>
                )
              }
              actions={
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn"
                    style={view === 'live' ? { color: 'var(--text-accent)', borderColor: 'var(--text-accent)' } : undefined}
                    title="Live marks against the freshest runs"
                    onClick={() => setView('live')}>
                    LIVE
                  </button>
                  <button className="btn"
                    style={view === 'final' ? { color: 'var(--positive)', borderColor: 'var(--positive)' } : undefined}
                    title="The frozen analytics from the latest FM-approved book close"
                    onClick={() => setView('final')}>
                    FM FINAL
                  </button>
                  <button className="btn" title="Refresh analytics"
                    onClick={() => queryClient.invalidateQueries({ queryKey: qk.portfolioAnalytics(slug) })}>
                    <RefreshCw size={11} /> REFRESH
                  </button>
                  <button className="btn" title="Download portfolio JSON"
                    onClick={() => downloadJson(doc.data, `${slug}.portfolio.json`)}>
                    <Download size={11} />
                  </button>
                  <button className="btn" style={{ color: 'var(--warning)' }} title="Delete fund"
                    onClick={() => {
                      if (window.confirm(`Delete portfolio "${doc.data!.meta.name}"?`)) remove.mutate(slug);
                    }}>
                    <Trash2 size={11} />
                  </button>
                </div>
              }
            >
              {error && <div className="field-error-msg" style={{ textAlign: 'left' }}>{error}</div>}
              {view === 'final' && fmFinal.isError ? (
                <EmptyState message="NO FM-APPROVED BOOK CLOSE YET — APPROVE ONE ON THE CLOSES TAB" />
              ) : view === 'final' && fmFinal.isLoading ? (
                <LoadingCursor label="LOADING FM CLOSE" />
              ) : doc.data.positions.length === 0 && view === 'live' ? (
                <EmptyState message="NO POSITIONS — ADD STAKES BELOW" />
              ) : view === 'live' && (analytics.isLoading || analytics.isFetching) ? (
                <LoadingCursor label="MARKING BOOK (re-running stale deals)" />
              ) : view === 'live' && analytics.isError ? (
                <div className="field-error-msg" style={{ textAlign: 'left' }}>
                  {apiErrorMessage(analytics.error, 'Analytics failed')}
                </div>
              ) : (
                <>
                  {view === 'final' && fmFinal.data && (
                    <div className="mono" style={{ fontSize: 11, marginBottom: 6, color: 'var(--positive)' }}>
                      ■ FINAL — close {fmFinal.data.close_month}, approved by{' '}
                      {fmFinal.data.approved_by ?? 'FM'} {fmFinal.data.approved_at ? `at ${fmFinal.data.approved_at}` : ''}
                    </div>
                  )}
                  <div style={{ overflowX: 'auto' }}>
                    <DataTable columns={columns} rows={rows} rowKey={(r) => String(r.index)} emptyMessage="—" />
                  </div>
                  {totals && (
                    <div className="mono" style={{ borderTop: '1px solid var(--border-bright)', marginTop: 4, paddingTop: 6, fontSize: 12, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                      <span>Σ FACE {money(totals.face)}</span>
                      <span>PAR {money(totals.par_value)}</span>
                      <span>MV {money(totals.market_value)}</span>
                      <span>COST {money(totals.cost_value)}</span>
                      <span className={pnlClass(totals.pnl)}>P&L {money(totals.pnl)}</span>
                      <span>ACCRUED {money(totals.accrued)}</span>
                      {totals.duration != null && <span>DUR {num(totals.duration, 2)}y</span>}
                      {totals.irr_to_live != null && (
                        <span style={{ color: 'var(--text-accent)' }}>IRR TO LIVE {pct(totals.irr_to_live)}</span>
                      )}
                      {totals.fm_irr != null && <span>FM IRR {pct(totals.fm_irr)}</span>}
                    </div>
                  )}
                  {view === 'live' && analytics.data && (
                    <div className="dim" style={{ fontSize: 10, marginTop: 6 }}>
                      {Object.entries(analytics.data.deals).map(([d, f]) => (
                        <span key={d} style={{ marginRight: 14 }}>
                          {d}:{' '}
                          {f.error ? (
                            <span className="neg">{f.error}</span>
                          ) : f.reran ? (
                            <span className="pos">reran base {fmtTime(f.run_at)}</span>
                          ) : (
                            `cached run ${fmtTime(f.run_at)}`
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Panel>
            <PositionsEditor
              doc={doc.data}
              deals={(deals.data ?? []) as DealSummary[]}
              onChange={update}
              saving={save.isPending}
            />
            <TreasuryPanel slug={slug} />
          </>
        )}
      </div>
    </div>
    <MarkBookPanel />
    </div>
  );
}
