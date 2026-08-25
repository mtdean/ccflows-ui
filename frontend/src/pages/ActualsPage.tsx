// Actuals: load remittance tapes (collateral + trustee/bond), see coverage,
// and run the model-vs-actual redline. Tapes live in the deal JSON and are
// spliced ahead of projections automatically on every run.

import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import Papa from 'papaparse';
import { Download, Play, Trash2, Upload } from 'lucide-react';
import { getActualsSchema, getCglStatus, runRedline, validateActuals } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { apiErrorMessage, downloadJson, hashOf, money, num, pct } from '../lib/utils';
import { useDealDraft } from '../lib/useDealDraft';
import type { RedlineResult, TableData } from '../lib/types';
import DataTable from '../components/shared/DataTable';
import type { Column } from '../components/shared/DataTable';
import EmptyState from '../components/shared/EmptyState';
import LoadingCursor from '../components/shared/LoadingCursor';
import Panel from '../components/shared/Panel';
import PerformanceCharts from '../components/monitor/PerformanceCharts';

type Level = 'collateral' | 'bonds';
type Row = Record<string, unknown>;

function TapePanel({ level, title }: { level: Level; title: string }) {
  const { doc, update } = useDealDraft();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const schema = useQuery({ queryKey: ['actualsSchema'], queryFn: getActualsSchema, staleTime: Infinity });
  const rows: Row[] = (doc?.actuals?.[level] ?? []) as Row[];
  const spec = schema.data?.[level];

  async function importRows(newRows: Row[]) {
    // numeric coercion + column whitelist
    const allowed = new Set([...(spec?.required ?? []), ...(spec?.optional ?? [])]);
    const idCol = level === 'collateral' ? 'repline_id' : 'tranche';
    const cleaned = newRows
      .map((r) => {
        const out: Row = {};
        for (const [k, v] of Object.entries(r)) {
          const key = k.trim();
          if (!allowed.has(key)) continue;
          out[key] = key === 'repline_id' || key === 'tranche' ? String(v).trim() : Number(v);
        }
        return out;
      })
      .filter((r) => Object.keys(r).length > 1);
    if (!cleaned.length) {
      setMsg('No usable rows — check the column headers against the template');
      return;
    }

    // append semantics: merge into the existing tape; overlapping (id, month)
    // rows replace after a confirmation
    let merged = cleaned;
    const existing = (doc?.actuals?.[level] ?? []) as Row[];
    if (existing.length) {
      const key = (r: Row) => `${r[idCol]}|${r.month}`;
      const newKeys = new Set(cleaned.map(key));
      const overlaps = existing.filter((r) => newKeys.has(key(r)));
      if (overlaps.length) {
        const months = [...new Set(overlaps.map((r) => r.month))].sort((a, b) => Number(a) - Number(b));
        if (!window.confirm(
          `${overlaps.length} existing row(s) overlap (months ${months.join(', ')}). ` +
          `Replace those months with the uploaded values?`)) {
          setMsg('Import cancelled — overlapping months left unchanged');
          return;
        }
      }
      merged = [...existing.filter((r) => !newKeys.has(key(r))), ...cleaned]
        .sort((a, b) => Number(a.month) - Number(b.month) || String(a[idCol]).localeCompare(String(b[idCol])));
    }

    try {
      const result = await validateActuals(level, merged);
      if (!result.ok) {
        setMsg(result.errors.map((e) => e.msg).join('; '));
        return;
      }
      update((d) => {
        d.actuals ??= { collateral: [], bonds: [] };
        d.actuals[level] = merged;
      });
      const appended = existing.length ? ` (+${cleaned.length} appended/updated)` : '';
      setMsg(`Tape now ${result.n_rows} rows · months ${result.months?.first}–${result.months?.last} · ${result.ids?.join(', ')}${appended}`);
    } catch (err) {
      setMsg(apiErrorMessage(err, 'Validation failed'));
    }
  }

  function onFile(file: File) {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => void importRows(res.data as Row[]),
    });
  }

  const monthCol = 'month';
  const idCol = level === 'collateral' ? 'repline_id' : 'tranche';
  const numericCols = rows.length
    ? Object.keys(rows[0]).filter((c) => c !== monthCol && c !== idCol)
    : [];
  const columns: Column<Row>[] = [
    { key: idCol, header: idCol.replace('_', ' ').toUpperCase(), render: (r) => <span style={{ color: 'var(--text-accent)' }}>{String(r[idCol])}</span> },
    { key: monthCol, header: 'M', align: 'right', render: (r) => <span className="num mono dim">{String(r[monthCol])}</span>, sortValue: (r) => Number(r[monthCol]) },
    ...numericCols.map((c): Column<Row> => ({
      key: c, header: c.replace(/_/g, ' ').toUpperCase(), align: 'right', sortable: false,
      render: (r) => <span className="num mono">{typeof r[c] === 'number' ? money(r[c] as number) : '—'}</span>,
    })),
  ];

  return (
    <Panel
      title={title}
      subtitle={<span className="dim">{rows.length ? `${rows.length} rows` : 'no tape loaded'}</span>}
      actions={
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className="btn"
            title="Download a CSV header template"
            onClick={() => {
              const headers = [...(spec?.required ?? []), ...(spec?.optional ?? [])];
              const blob = new Blob([headers.join(',') + '\n'], { type: 'text/csv' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `${level}_tape_template.csv`;
              a.click();
            }}
          >
            <Download size={11} /> TEMPLATE
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <Upload size={11} /> {rows.length ? 'APPEND CSV' : 'CSV'}
          </button>
          {rows.length > 0 && (
            <button className="btn" style={{ color: 'var(--warning)' }}
              onClick={() => {
                if (window.confirm(`Clear the ${level} tape?`)) {
                  update((d) => { if (d.actuals) d.actuals[level] = []; });
                  setMsg(null);
                }
              }}>
              <Trash2 size={11} />
            </button>
          )}
          <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onFile(f);
            }} />
        </div>
      }
    >
      {spec && !rows.length && (
        <div className="dim" style={{ fontSize: 11, marginBottom: 6 }}>
          Required columns: <span className="mono">{spec.required.join(', ')}</span>
          {Object.entries(spec.notes).map(([k, v]) => (
            <div key={k}>· <span className="mono">{k}</span>: {v}</div>
          ))}
        </div>
      )}
      {msg && <div style={{ fontSize: 11, color: 'var(--text-accent)', marginBottom: 6 }}>{msg}</div>}
      {rows.length > 0 ? (
        <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
          <DataTable columns={columns} rows={rows} rowKey={(r) => `${r[idCol]}:${r[monthCol]}`} initialSort={monthCol} initialDir="asc" emptyMessage="—" />
        </div>
      ) : (
        <EmptyState message="UPLOAD A REMITTANCE CSV" />
      )}
    </Panel>
  );
}

function RedlinePanel() {
  const { doc } = useDealDraft();
  const [result, setResult] = useState<RedlineResult | null>(null);
  const hasTape = (doc?.actuals?.collateral?.length ?? 0) > 0;

  const redline = useMutation({
    mutationFn: () => runRedline(doc!),
    onSuccess: setResult,
  });

  const summaryCols = (data: TableData): Column<Row>[] =>
    data.columns.map((c) => ({
      key: c,
      header: c.replace(/_/g, ' ').toUpperCase(),
      align: c === 'repline_id' ? 'left' : 'right',
      sortable: false,
      render: (r) => {
        const v = r[c];
        if (typeof v !== 'number') return <span style={{ color: 'var(--text-accent)' }}>{String(v ?? '—')}</span>;
        if (c.includes('variance') || c === 'hit_rate') {
          const cls = c === 'hit_rate' ? '' : Math.abs(v) > 0.05 ? 'neg' : 'pos';
          return <span className={`num mono ${cls}`}>{pct(v)}</span>;
        }
        if (c.startsWith('cum_')) return <span className="num mono">{money(v)}</span>;
        return <span className="num mono">{num(v, 2)}</span>;
      },
    }));

  return (
    <Panel
      title="REDLINE — MODEL VS ACTUAL"
      subtitle={<span className="dim">backtest the projection against the tape</span>}
      actions={
        <button className="btn" disabled={!hasTape || redline.isPending} onClick={() => redline.mutate()}>
          <Play size={11} /> RUN REDLINE
        </button>
      }
    >
      {!hasTape ? (
        <EmptyState message="LOAD A COLLATERAL TAPE FIRST" />
      ) : redline.isPending ? (
        <LoadingCursor label="BACKTESTING" />
      ) : redline.isError ? (
        <div className="field-error-msg" style={{ textAlign: 'left' }}>
          {apiErrorMessage(redline.error, 'Redline failed')}
        </div>
      ) : result ? (
        <div style={{ overflowX: 'auto' }}>
          <DataTable
            columns={summaryCols(result.summary)}
            rows={result.summary.records}
            rowKey={(r) => String(r.repline_id)}
            emptyMessage="—"
          />
          <div className="dim" style={{ fontSize: 10, marginTop: 6 }}>
            Positive loss variance = actual losses running above model. Splice happens automatically
            on every run — RESULTS shows the boundary month.
          </div>
        </div>
      ) : (
        <EmptyState message="RUN TO COMPARE" />
      )}
    </Panel>
  );
}

// CGL roll policy: for replines driven by a CGL / loss-timing curve, show
// realized vs planned losses through the tape boundary and let the user pin
// lifetime CGL (forward tail rescales) instead of the engine's default
// carry-the-original-schedule roll.
function CglRollPanel() {
  const { slug, doc, update } = useDealDraft();
  const hash = doc ? hashOf({ r: doc.run.replines, a: doc.actuals?.collateral?.length ?? 0 }) : '';
  const status = useQuery({
    queryKey: qk.cglStatus(slug ?? 'none', hash),
    queryFn: () => getCglStatus(doc!),
    enabled: doc != null,
    retry: false,
  });

  const rows = status.data ?? [];
  if (status.isError || rows.length === 0) return null; // no CGL-framework replines

  return (
    <Panel
      title="CGL ROLL POLICY"
      subtitle={<span className="dim">
        loss_timing / cumulative-gross-loss replines — what happens to lifetime CGL when actuals land
      </span>}
    >
      <div style={{ overflowX: 'auto' }}>
        <table className="mono" style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
          <thead>
            <tr className="dim" style={{ textAlign: 'left' }}>
              <th style={{ padding: '2px 8px 2px 0' }}>REPLINE</th>
              <th>FRAMEWORK</th>
              <th style={{ textAlign: 'right' }}>LIFETIME CGL</th>
              <th style={{ textAlign: 'right' }}>REALIZED</th>
              <th style={{ textAlign: 'right' }}>PLANNED THRU TAPE</th>
              <th style={{ textAlign: 'right' }}>FWD ×</th>
              <th style={{ paddingLeft: 12 }}>ON ROLL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const entryIdx = (doc!.run.replines ?? []).findIndex(
                (e) => String(e.inline.repline_id) === r.repline_id);
              const policy = doc!.run.replines[entryIdx]?.cgl_policy ?? 'curve';
              const underrun = r.realized != null && r.planned_to_boundary != null
                ? r.realized - r.planned_to_boundary : null;
              return (
                <tr key={r.repline_id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ color: 'var(--text-accent)', padding: '3px 8px 3px 0' }}>{r.repline_id}</td>
                  <td className="dim">{r.loss_type}</td>
                  <td style={{ textAlign: 'right' }}>
                    {money(r.lifetime_cgl)}
                    {r.lifetime_cgl_pct != null && <span className="dim"> ({pct(r.lifetime_cgl_pct)})</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}
                    className={underrun == null ? 'dim' : underrun < 0 ? 'pos' : underrun > 0 ? 'neg' : ''}>
                    {r.realized != null ? money(r.realized) : '— no tape —'}
                  </td>
                  <td style={{ textAlign: 'right' }} className="dim">
                    {r.planned_to_boundary != null
                      ? `${money(r.planned_to_boundary)} (m${r.boundary_month})` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', color: policy === 'hold_constant' ? 'var(--warning)' : undefined }}>
                    {policy === 'hold_constant' && r.forward_factor != null ? `×${num(r.forward_factor, 3)}` : '—'}
                  </td>
                  <td style={{ paddingLeft: 12 }}>
                    <select className="input" value={policy}
                      onChange={(e) => update((d) => {
                        if (entryIdx < 0) return;
                        if (e.target.value === 'hold_constant') d.run.replines[entryIdx].cgl_policy = 'hold_constant';
                        else delete d.run.replines[entryIdx].cgl_policy;
                      })}>
                      <option value="curve">follow curve (CGL drifts with actuals)</option>
                      <option value="hold_constant">hold CGL constant (rescale forward)</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="dim" style={{ fontSize: 10, marginTop: 6 }}>
        FOLLOW CURVE keeps the original forward loss schedule — an actual under-run permanently
        lowers projected lifetime losses. HOLD CONSTANT rescales the remaining loss curve every
        roll so lifetime gross losses stay pinned at CGL × face given whatever the tape realized.
        The applied factor shows in run warnings and updates as new months load.
      </div>
    </Panel>
  );
}

export default function ActualsPage() {
  const { doc, loading } = useDealDraft();
  if (!doc && !loading) return <EmptyState message="OPEN A DEAL FIRST" />;
  if (!doc) return <LoadingCursor />;
  return (
    <div className="stack">
      <TapePanel level="collateral" title="COLLATERAL TAPE (SERVICER REMITTANCE)" />
      <CglRollPanel />
      <PerformanceCharts />
      <RedlinePanel />
      <TapePanel level="bonds" title="BOND TAPE (TRUSTEE REMITTANCE)" />
      <Panel title="HOW ACTUALS FLOW">
        <div className="dim" style={{ fontSize: 11, lineHeight: 1.6 }}>
          Loaded months pin the deal's history: every run splices the tape ahead of the projection,
          re-anchoring assumption curves at the boundary (balances, ages, and curve positions all
          shift). Stress scenarios apply to the projected months. The tapes travel inside the base
          JSON, so an uploaded deal carries its history with it. Bond-tape months are stored for
          reference and redline today; trustee-balance seeding lands with deal-level splicing.
        </div>
        <button
          className="btn"
          style={{ marginTop: 6 }}
          onClick={() => doc && downloadJson(doc.actuals ?? { collateral: [], bonds: [] }, `${doc.meta.slug}.actuals.json`)}
        >
          <Download size={11} /> EXPORT TAPES AS JSON
        </button>
      </Panel>
    </div>
  );
}
