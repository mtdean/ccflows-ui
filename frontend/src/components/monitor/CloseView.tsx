// Monthly close: sign off a month (marks + P&L + covenant/surveillance/redline
// summaries frozen with an input fingerprint), history, drift checks.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, ShieldCheck } from 'lucide-react';
import { closeDrift, closeMonth, listCloses } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { apiErrorMessage, money, num } from '../../lib/utils';
import { useDealDraft } from '../../lib/useDealDraft';
import type { TableData } from '../../lib/types';
import DataTable from '../shared/DataTable';
import type { Column } from '../shared/DataTable';
import EmptyState from '../shared/EmptyState';

type Row = Record<string, unknown>;

export default function CloseView() {
  const { slug, dirty } = useDealDraft();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState<string>('');
  const [spread, setSpread] = useState(200);
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [drift, setDrift] = useState<{ month: number; clean: boolean; rows: TableData } | null>(null);

  const closes = useQuery({
    queryKey: slug ? qk.closes(slug) : ['closes', 'none'],
    queryFn: () => listCloses(slug!),
    enabled: slug != null,
  });

  const doClose = useMutation({
    mutationFn: (body: Row) => closeMonth(slug!, body),
    onSuccess: (snap) => {
      setMessage(`Closed month ${snap.close_month} · fingerprint ${String(snap.inputs_fingerprint).slice(0, 12)}…`);
      queryClient.invalidateQueries({ queryKey: qk.closes(slug!) });
    },
    onError: (err, body) => {
      const msg = apiErrorMessage(err, 'Close failed');
      if (msg.includes('already closed') && !body.overwrite) {
        const note = window.prompt('Month already closed. To restate, enter an amendment note:');
        if (note) doClose.mutate({ ...body, overwrite: true, amendment_note: note });
        return;
      }
      setMessage(msg);
    },
  });

  const doDrift = useMutation({
    mutationFn: (m: number) => closeDrift(slug!, m).then((r) => ({ month: m, ...r })),
    onSuccess: setDrift,
    onError: (err) => setMessage(apiErrorMessage(err, 'Drift check failed')),
  });

  const historyCols: Column<Row>[] = [
    ...(closes.data?.columns ?? []).map((c): Column<Row> => ({
      key: c, header: c.replace(/_/g, ' ').toUpperCase(),
      align: c === 'closed_at' ? 'left' : 'right', sortable: false,
      render: (r) => {
        const v = r[c];
        if (typeof v !== 'number') return <span className="dim">{String(v ?? '—').slice(0, 19)}</span>;
        if (c === 'market_value' || c === 'month_pl') return <span className={`num mono ${c === 'month_pl' && v !== 0 ? (v > 0 ? 'pos' : 'neg') : ''}`}>{money(v)}</span>;
        return <span className="num mono">{num(v, 2)}</span>;
      },
    })),
    {
      key: '_drift', header: '', sortable: false, align: 'right',
      render: (r) => (
        <button className="btn" onClick={() => doDrift.mutate(Number(r.month))}>
          <ShieldCheck size={11} /> DRIFT
        </button>
      ),
    },
  ];

  return (
    <div className="stack">
      {dirty && (
        <div style={{ color: 'var(--warning)', fontSize: 11 }}>
          ⚠ Draft has unsaved changes — closes always sign off the SAVED deal. Save first.
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="field-row">
          <label>month (blank = boundary)</label>
          <input className="input num" style={{ width: 70 }} type="number" min={1} placeholder="auto"
            value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div className="field-row">
          <label>mark spread (bps)</label>
          <input className="input num" type="number" step={25} value={spread}
            onChange={(e) => setSpread(Number(e.target.value))} />
        </div>
        <div className="field-row">
          <label>notes</label>
          <input className="input" style={{ width: 220 }} value={notes}
            onChange={(e) => setNotes(e.target.value)} />
        </div>
        <button className="btn" style={{ color: 'var(--text-accent)', borderColor: 'var(--text-accent)' }}
          disabled={doClose.isPending}
          onClick={() => doClose.mutate({ month: month === '' ? null : Number(month), spreads: spread, notes })}>
          <Lock size={11} /> CLOSE MONTH
        </button>
      </div>
      {message && <div className="mono" style={{ fontSize: 11, color: 'var(--text-accent)' }}>{message}</div>}

      <div className="section-label">CLOSE HISTORY</div>
      {(closes.data?.records ?? []).length === 0 ? (
        <EmptyState message="NO CLOSED MONTHS YET" />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <DataTable columns={historyCols} rows={closes.data!.records}
            rowKey={(r) => String(r.month)} emptyMessage="—" />
        </div>
      )}

      {drift && (
        <div>
          <div className="section-label">DRIFT CHECK — MONTH {drift.month}</div>
          {drift.clean ? (
            <span className="pos mono">✓ CLEAN — current inputs reproduce the closed snapshot exactly</span>
          ) : (
            <DataTable
              columns={(drift.rows.columns ?? []).map((c): Column<Row> => ({
                key: c, header: c.toUpperCase(), sortable: false,
                render: (r) => <span className={c === 'field' ? 'neg' : 'num mono'}>{String(r[c])}</span>,
              }))}
              rows={drift.rows.records}
              rowKey={(r) => String(r.field)}
              emptyMessage="—"
            />
          )}
        </div>
      )}
    </div>
  );
}
