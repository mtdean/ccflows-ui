// The mark book: one grid of every (deal, tranche) across the workspace with
// its mark method, stepped schedule, and holders. Edits fan out to every fund
// (funds resolve: position override > mark book > fund default). Import
// pastes a pricing run in one shot.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { client } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { apiErrorMessage, num } from '../../lib/utils';
import DataTable from '../shared/DataTable';
import type { Column } from '../shared/DataTable';
import LoadingCursor from '../shared/LoadingCursor';
import Panel from '../shared/Panel';

interface BookRow {
  deal: string;
  deal_name: string;
  tranche: string;
  floating: boolean;
  boundary_month: number;
  method: string | null;
  schedule: Record<string, number> | null;
  current_value: number | null;
  held_by: string[];
}

function scheduleText(schedule: Record<string, number> | null): string {
  if (!schedule) return '';
  return Object.entries(schedule)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([m, v]) => (m === '0' ? `${v}` : `${v} @m${m}`))
    .join(', ');
}

function parseScheduleText(text: string): Record<string, number> {
  // "200, 250 @m8, 300 @m14" -> {0: 200, 8: 250, 14: 300}
  const out: Record<string, number> = {};
  for (const token of text.split(',')) {
    const t = token.trim();
    if (!t) continue;
    const match = t.match(/^(-?[\d.]+)(?:\s*@\s*m?(\d+))?$/i);
    if (!match) continue;
    out[match[2] ?? '0'] = Number(match[1]);
  }
  return out;
}

export default function MarkBookPanel() {
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const book = useQuery({
    queryKey: qk.markBook,
    queryFn: () => client.get<{ rows: BookRow[] }>('/mark-book').then((r) => r.data),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: qk.markBook });
    queryClient.invalidateQueries({ queryKey: ['portfolioAnalytics'] });
  };

  const upsert = useMutation({
    mutationFn: (body: Record<string, unknown>) => client.put('/mark-book/entry', body),
    onSuccess: invalidate,
    onError: (err) => setMsg(apiErrorMessage(err, 'Save failed')),
  });

  const doImport = useMutation({
    mutationFn: (rows: Record<string, unknown>[]) =>
      client.post<{ applied: number; errors: string[] }>('/mark-book/import', { rows })
        .then((r) => r.data),
    onSuccess: (res) => {
      setMsg(`Applied ${res.applied} mark(s)${res.errors.length ? ` · ${res.errors.join('; ')}` : ''}`);
      setImportOpen(false);
      setImportText('');
      invalidate();
    },
    onError: (err) => setMsg(apiErrorMessage(err, 'Import failed')),
  });

  function parseImport() {
    // lines: deal, tranche, value [, month] [, method]  (comma or tab separated)
    const rows = importText.split('\n').map((line) => line.trim()).filter(Boolean)
      .map((line) => {
        const parts = line.split(/[\t,]+/).map((p) => p.trim());
        const [deal, tranche, value, month, method] = parts;
        return { deal, tranche, value: Number(value),
                 month: month ? Number(month) : 0,
                 method: method || undefined };
      })
      .filter((r) => r.deal && r.tranche && Number.isFinite(r.value));
    if (!rows.length) {
      setMsg('No parsable lines (format: deal, tranche, value [, month] [, method])');
      return;
    }
    doImport.mutate(rows);
  }

  const columns: Column<BookRow>[] = [
    { key: 'deal_name', header: 'DEAL', render: (r) => <span className="dim">{r.deal_name}</span> },
    { key: 'tranche', header: 'TRANCHE', render: (r) => <span style={{ color: 'var(--text-accent)' }}>{r.tranche}{r.floating ? ' ·FLT' : ''}</span> },
    {
      key: 'method', header: 'METHOD', sortable: false,
      render: (r) => (
        <select className="input" value={r.method ?? 'spread'}
          onChange={(e) => upsert.mutate({ deal: r.deal, tranche: r.tranche,
            method: e.target.value, schedule: r.schedule ?? {} })}>
          <option value="spread">spread bp</option>
          <option value="dm">dm bp</option>
          <option value="yield">yield dec</option>
        </select>
      ),
    },
    {
      key: 'schedule', header: 'MARK SCHEDULE (VALUE [@mN], …)', sortable: false,
      render: (r) => (
        <input
          className="input"
          style={{ width: 200 }}
          placeholder="unmarked — e.g. 200, 250 @m8"
          defaultValue={scheduleText(r.schedule)}
          key={`${r.deal}:${r.tranche}:${scheduleText(r.schedule)}`}
          onBlur={(e) => {
            const next = parseScheduleText(e.target.value);
            const current = scheduleText(r.schedule);
            if (e.target.value.trim() === current.trim()) return;
            upsert.mutate({ deal: r.deal, tranche: r.tranche,
              method: r.method ?? 'spread', schedule: next });
          }}
        />
      ),
    },
    {
      key: 'current_value', header: 'CURRENT', align: 'right', sortable: false,
      render: (r) => (
        <span className="num mono" style={{ color: r.current_value != null ? 'var(--text-accent)' : undefined }}
          title={`Value at the deal's actuals boundary (M${r.boundary_month})`}>
          {r.current_value != null ? num(r.current_value, r.method === 'yield' ? 4 : 0) : '—'}
        </span>
      ),
    },
    {
      key: 'held_by', header: 'HELD BY', sortable: false,
      render: (r) => <span className="dim" style={{ fontSize: 10 }}>{r.held_by.join(', ') || '—'}</span>,
    },
  ];

  const rows = (book.data?.rows ?? []).slice()
    .sort((a, b) => (b.held_by.length - a.held_by.length) || a.deal.localeCompare(b.deal));

  return (
    <Panel
      title="MARK BOOK"
      subtitle={
        <span className="dim">
          one mark per tranche, shared across funds — funds resolve: position override → book → fund default
        </span>
      }
      actions={
        <button className="btn" onClick={() => setImportOpen((o) => !o)}>
          <Upload size={11} /> IMPORT MARKS
        </button>
      }
    >
      {importOpen && (
        <div style={{ marginBottom: 10 }}>
          <textarea
            className="input input-wide"
            style={{ height: 80, resize: 'vertical' }}
            placeholder={'One mark per line: deal, tranche, value [, month] [, method]\ne.g.\ndemo-auto-2026, B, 325, 8\nDemo CLO 2026, A, 165, 0, dm'}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <button className="btn" style={{ marginTop: 4 }} disabled={doImport.isPending} onClick={parseImport}>
            APPLY IMPORT
          </button>
        </div>
      )}
      {msg && <div style={{ fontSize: 11, color: 'var(--text-accent)', marginBottom: 6 }}>{msg}</div>}
      {book.isLoading ? (
        <LoadingCursor />
      ) : (
        <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
          <DataTable columns={columns} rows={rows}
            rowKey={(r) => `${r.deal}:${r.tranche}`} emptyMessage="NO DEALS IN WORKSPACE" />
        </div>
      )}
      <div className="dim" style={{ fontSize: 10, marginTop: 6 }}>
        Schedules are step functions: "200, 250 @m8" marks 200 until month 8, then 250.
        CURRENT shows the value at each deal's actuals boundary. P&L statements can run
        off these schedules (MONITOR → P&L → USE MARK BOOK).
      </div>
    </Panel>
  );
}
