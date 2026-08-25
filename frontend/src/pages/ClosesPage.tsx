// CLOSES: the month-end book-close lifecycle. ABF assembles the close (every
// held deal's base-case run + marks with rationale notes), FM loads it,
// validates, and approves — which forces engine closes and becomes the
// portfolio view's FINAL/good-through anchor. The timeline color-codes months
// where assumptions moved (replines / structure / marks).

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FilePlus2, Trash2 } from 'lucide-react';
import {
  approveBookClose,
  createBookClose,
  deleteBookClose,
  getBookClose,
  listBookCloses,
} from '../lib/api';
import type { BookCloseSummary } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { apiErrorMessage, money, num, pct, walMonths } from '../lib/utils';
import EmptyState from '../components/shared/EmptyState';
import LoadingCursor from '../components/shared/LoadingCursor';
import Panel from '../components/shared/Panel';

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function ChangeChips({ c }: { c: BookCloseSummary }) {
  const chip = (label: string, deals: string[], color: string) =>
    deals.length > 0 && (
      <span className="mono" title={`${label.toLowerCase()} changed: ${deals.join(', ')}`}
        style={{ color, border: `1px solid ${color}`, padding: '0 4px', fontSize: 9, marginRight: 4 }}>
        {label} {deals.length}
      </span>
    );
  return (
    <span>
      {chip('REPLINES', c.changes.replines, 'var(--warning)')}
      {chip('STRUCTURE', c.changes.structure, 'var(--negative)')}
      {chip('MARKS', c.changes.marks, 'var(--text-accent)')}
      {c.new_deals.length > 0 && chip('NEW', c.new_deals, 'var(--positive)')}
      {!c.has_changes && <span className="dim" style={{ fontSize: 9 }}>no changes</span>}
    </span>
  );
}

function StatusChip({ status }: { status: 'abf' | 'fm_approved' }) {
  return status === 'fm_approved' ? (
    <span className="mono" style={{ color: 'var(--positive)', fontSize: 10 }}>■ FM APPROVED</span>
  ) : (
    <span className="mono" style={{ color: 'var(--warning)', fontSize: 10 }}>□ ABF — AWAITING FM</span>
  );
}

export default function ClosesPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [month, setMonth] = useState(currentMonth());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const closes = useQuery({ queryKey: qk.bookCloses, queryFn: listBookCloses });
  const ordered = [...(closes.data ?? [])].reverse(); // newest first
  const active = selected ?? ordered[0]?.month ?? null;

  const detail = useQuery({
    queryKey: active ? qk.bookClose(active) : ['bookClose', 'none'],
    queryFn: () => getBookClose(active!),
    enabled: active != null,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: qk.bookCloses });
    if (active) queryClient.invalidateQueries({ queryKey: qk.bookClose(active) });
    queryClient.invalidateQueries({ queryKey: ['fmFinal'] });
    queryClient.invalidateQueries({ queryKey: ['portfolioAnalytics'] });
  };

  const create = useMutation({
    mutationFn: (overwrite: boolean) =>
      createBookClose({ month, notes, overwrite }),
    onSuccess: (d) => {
      setSelected(d.month);
      setNotes('');
      setError(null);
      invalidate();
    },
    onError: (err) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409 &&
          window.confirm(`Close ${month} already exists. Rebuild it (overwrites the package)?`)) {
        create.mutate(true);
        return;
      }
      setError(apiErrorMessage(err, 'Close failed'));
    },
  });

  const approve = useMutation({
    mutationFn: (m: string) => {
      const approver = window.prompt('Approve as (name / team):', 'FM') ?? '';
      if (!approver) return Promise.reject(new Error('cancelled'));
      return approveBookClose(m, { approver });
    },
    onSuccess: () => { setError(null); invalidate(); },
    onError: (err) => {
      if ((err as Error).message !== 'cancelled') setError(apiErrorMessage(err, 'Approve failed'));
    },
  });

  const remove = useMutation({
    mutationFn: ({ m, force }: { m: string; force: boolean }) => deleteBookClose(m, force),
    onSuccess: () => { setSelected(null); invalidate(); },
    onError: (err) => setError(apiErrorMessage(err, 'Delete failed')),
  });

  const d = detail.data;

  return (
    <div className="stack">
      <div className="sidebar-grid">
        <Panel
          title="CLOSE TIMELINE"
          subtitle={<span className="dim">flags mark months where assumptions moved</span>}
        >
          <form
            style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}
            onSubmit={(e) => { e.preventDefault(); create.mutate(false); }}
          >
            <input className="input mono" style={{ width: 76 }} value={month}
              onChange={(e) => setMonth(e.target.value)} placeholder="YYYY-MM" />
            <input className="input" style={{ flex: 1, minWidth: 90 }} value={notes}
              onChange={(e) => setNotes(e.target.value)} placeholder="close notes…" />
            <button className="btn" type="submit" disabled={create.isPending}
              title="Assemble the month-end package: base runs + marks for every held deal">
              <FilePlus2 size={11} /> CLOSE MONTH
            </button>
          </form>
          {error && <div className="field-error-msg" style={{ textAlign: 'left' }}>{error}</div>}
          {closes.isLoading ? (
            <LoadingCursor />
          ) : ordered.length === 0 ? (
            <EmptyState message="NO CLOSES YET" />
          ) : (
            ordered.map((c) => (
              <div key={c.month}
                style={{ padding: '5px 6px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                         background: c.month === active ? 'var(--bg-selected)' : undefined }}
                onClick={() => setSelected(c.month)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span className="mono" style={{ color: c.month === active ? 'var(--text-accent)' : undefined }}>
                    {c.month}
                  </span>
                  <StatusChip status={c.status} />
                </div>
                <div style={{ marginTop: 2 }}>
                  <ChangeChips c={c} />
                </div>
                <div className="dim" style={{ fontSize: 9 }}>
                  {c.n_deals} deal{c.n_deals === 1 ? '' : 's'}
                  {c.n_skipped > 0 && <span className="neg"> · {c.n_skipped} skipped</span>}
                  {c.status === 'fm_approved' && c.approved_by && <> · approved by {c.approved_by}</>}
                </div>
              </div>
            ))
          )}
        </Panel>

        <div className="stack">
          {!active ? (
            <Panel title="CLOSE PACKAGE"><EmptyState message="CLOSE A MONTH TO BUILD THE FM PACKAGE" /></Panel>
          ) : detail.isLoading || !d ? (
            <Panel title={`CLOSE ${active}`}><LoadingCursor /></Panel>
          ) : (
            <>
              <Panel
                title={`CLOSE ${d.month}`}
                subtitle={<StatusChip status={d.status} />}
                actions={
                  <div style={{ display: 'flex', gap: 4 }}>
                    {d.status === 'abf' && (
                      <button className="btn"
                        style={{ color: 'var(--positive)', borderColor: 'var(--positive)' }}
                        disabled={approve.isPending}
                        title="FM sign-off: freezes this as the official close and forces engine closes"
                        onClick={() => approve.mutate(d.month)}>
                        <CheckCircle2 size={11} /> FM APPROVE
                      </button>
                    )}
                    <button className="btn" style={{ color: 'var(--warning)' }}
                      onClick={() => {
                        const force = d.status === 'fm_approved';
                        if (window.confirm(force
                          ? `Close ${d.month} is FM-APPROVED. Really delete it?`
                          : `Delete close ${d.month}?`)) remove.mutate({ m: d.month, force });
                      }}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                }
              >
                <div className="dim" style={{ fontSize: 10 }}>
                  created {d.created_at}
                  {d.notes && <> · “{d.notes}”</>}
                  {d.status === 'fm_approved' && <>
                    {' '}· approved by <span className="pos">{d.approved_by}</span> at {d.approved_at}
                  </>}
                </div>
                {d.engine_closes && Object.keys(d.engine_closes).length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <div className="section-label">ENGINE CLOSES (forced on approval)</div>
                    {Object.entries(d.engine_closes).map(([deal, res]) => (
                      <div key={deal} className="mono" style={{ fontSize: 10 }}>
                        <span className="dim">{deal}:</span>{' '}
                        <span className={res.startsWith('close failed') ? 'neg' : 'pos'}>{res}</span>
                      </div>
                    ))}
                  </div>
                )}
                {Object.keys(d.skipped).length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <div className="section-label">SKIPPED</div>
                    {Object.entries(d.skipped).map(([deal, why]) => (
                      <div key={deal} className="mono neg" style={{ fontSize: 10 }}>{deal}: {why}</div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="BASE-CASE RUNS" subtitle={<span className="dim">what ABF ran — frozen in the package</span>}>
                <div style={{ overflowX: 'auto' }}>
                  <table className="mono" style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr className="dim" style={{ textAlign: 'left' }}>
                        <th style={{ padding: '2px 8px 2px 0' }}>DEAL</th>
                        <th>TAPE THRU</th>
                        <th>TRANCHE</th>
                        <th style={{ textAlign: 'right' }}>WAL</th>
                        <th style={{ textAlign: 'right' }}>XIRR</th>
                        <th style={{ textAlign: 'right' }}>MOIC</th>
                        <th style={{ textAlign: 'right' }}>CE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(d.deals).flatMap(([slug, deal]) =>
                        Object.entries(deal.metrics).map(([tranche, m], i) => (
                          <tr key={`${slug}-${tranche}`} style={{ borderTop: i === 0 ? '1px solid var(--border)' : undefined }}>
                            <td className="dim" style={{ padding: '2px 8px 2px 0' }}>{i === 0 ? slug : ''}</td>
                            <td className="dim">{i === 0 ? (deal.boundary_month != null ? `m${deal.boundary_month}` : 'projection') : ''}</td>
                            <td style={{ color: 'var(--text-accent)' }}>{tranche}</td>
                            <td style={{ textAlign: 'right' }}>{m.wal != null ? walMonths(m.wal as number) : '—'}</td>
                            <td style={{ textAlign: 'right' }}>{m.xirr != null ? pct(m.xirr as number) : '—'}</td>
                            <td style={{ textAlign: 'right' }}>{m.moic != null ? num(m.moic as number, 3) : '—'}</td>
                            <td style={{ textAlign: 'right' }} className="dim">{m.credit_enhancement != null ? pct(m.credit_enhancement as number) : '—'}</td>
                          </tr>
                        )))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel title="MARKS ON THE BOOK" subtitle={<span className="dim">with the marking rationale FM validates</span>}>
                <div style={{ overflowX: 'auto' }}>
                  <table className="mono" style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr className="dim" style={{ textAlign: 'left' }}>
                        <th style={{ padding: '2px 8px 2px 0' }}>DEAL</th>
                        <th>TRANCHE</th>
                        <th>METHOD</th>
                        <th style={{ textAlign: 'right' }}>MARK</th>
                        <th style={{ paddingLeft: 12 }}>WHY (NOTE)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(d.marks).flatMap(([slug, ms]) =>
                        Object.entries(ms.tranches).map(([tranche, m], i) => (
                          <tr key={`${slug}-${tranche}`} style={{ borderTop: i === 0 ? '1px solid var(--border)' : undefined }}>
                            <td className="dim" style={{ padding: '2px 8px 2px 0' }}>{i === 0 ? slug : ''}</td>
                            <td style={{ color: 'var(--text-accent)' }}>{tranche}</td>
                            <td className="dim">{m.method ?? 'fund default'}</td>
                            <td style={{ textAlign: 'right' }}>
                              {m.value_at_boundary != null ? `${num(m.value_at_boundary, 0)}${m.method === 'yield' ? '' : 'bp'}` : '—'}
                            </td>
                            <td style={{ paddingLeft: 12, whiteSpace: 'normal', maxWidth: 380 }}
                              className={m.note ? '' : 'dim'}>
                              {m.note || '(no note)'}
                            </td>
                          </tr>
                        )))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel title="FUNDS AT CLOSE">
                {Object.entries(d.portfolios).map(([slug, p]) => {
                  const t = p.analytics?.totals;
                  return (
                    <div key={slug} className="mono" style={{ fontSize: 11, padding: '3px 0', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      <span style={{ color: 'var(--text-accent)', minWidth: 120 }}>{p.name ?? slug}</span>
                      {t ? (
                        <>
                          <span>MV {money(t.market_value)}</span>
                          <span className={t.pnl > 0 ? 'pos' : t.pnl < 0 ? 'neg' : 'dim'}>P&L {money(t.pnl)}</span>
                          <span className="dim">FACE {money(t.face)}</span>
                          {t.irr_to_live != null && <span>IRR {pct(t.irr_to_live)}</span>}
                        </>
                      ) : <span className="dim">no analytics</span>}
                    </div>
                  );
                })}
              </Panel>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
