// Workspace-level libraries: named rate curves (flat / points / Pensford /
// CSV upload) and curve libraries — shared across deals.

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Papa from 'papaparse';
import { Globe, Plus, Trash2, Upload } from 'lucide-react';
import {
  buildRatesCurve,
  deleteCurveLib,
  deleteRatesCurve,
  listCurveLibs,
  listRatesCurves,
  putRatesCurve,
} from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { apiErrorMessage, num } from '../../lib/utils';
import Panel from '../shared/Panel';

export default function WorkspaceLibraries() {
  const queryClient = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'flat' | 'points' | 'pensford'>('flat');
  const [rate, setRate] = useState('0.043');
  const [points, setPoints] = useState('0: 5.25, 12: 4.10, 36: 3.50');
  const fileRef = useRef<HTMLInputElement>(null);

  const curves = useQuery({ queryKey: qk.ratesCurves, queryFn: listRatesCurves });
  const libs = useQuery({ queryKey: qk.curveLibs, queryFn: listCurveLibs });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: qk.ratesCurves });
    queryClient.invalidateQueries({ queryKey: qk.curveLibs });
  };

  const build = useMutation({
    mutationFn: (body: Record<string, unknown>) => buildRatesCurve(body),
    onSuccess: (s) => {
      setMsg(`Built ${s.slug}: ${s.columns.join(', ')} (${num(s.n_rows)} rows)`);
      invalidate();
    },
    onError: (err) => setMsg(apiErrorMessage(err, 'Build failed')),
  });

  function submitBuild() {
    if (!name.trim()) {
      setMsg('Name the curve first');
      return;
    }
    if (mode === 'flat') {
      build.mutate({ name, mode, rate: Number(rate), overwrite: true });
    } else if (mode === 'points') {
      const parsed = points.split(',').map((tok) => {
        const [m, r] = tok.split(':').map((s) => s.trim());
        return { month: Number(m), rate: Number(r) / (Number(r) > 1 ? 100 : 1) };
      }).filter((p) => Number.isFinite(p.month) && Number.isFinite(p.rate));
      build.mutate({ name, mode, points: parsed, overwrite: true });
    } else {
      build.mutate({ name, mode: 'pensford', overwrite: true });
    }
  }

  function onCsv(file: File) {
    if (!name.trim()) {
      setMsg('Name the curve first, then upload');
      return;
    }
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (res) => {
        const records = (res.data as Record<string, unknown>[])
          .filter((r) => r.date)
          .map((r) => {
            const out: Record<string, unknown> = { date: String(r.date) };
            for (const [k, v] of Object.entries(r)) {
              if (k !== 'date' && v !== '' && v != null) out[k.trim()] = Number(v);
            }
            return out;
          });
        try {
          const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
          const s = await putRatesCurve(slug, {
            meta: { name: name.trim(), source: `csv upload: ${file.name}` },
            records,
          });
          setMsg(`Uploaded ${s.slug}: ${s.columns.join(', ')} (${num(s.n_rows)} rows)`);
          invalidate();
        } catch (err) {
          setMsg(apiErrorMessage(err, 'Upload failed'));
        }
      },
    });
  }

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <Panel
        title="RATE CURVES"
        subtitle={<span className="dim">shared across deals · named-curve rates mode</span>}
      >
        {(curves.data ?? []).map((c) => (
          <div key={c.slug} className="field-row">
            <label style={{ color: 'var(--text-accent)' }}>{c.name}</label>
            <span className="field-control">
              <span className="dim" style={{ fontSize: 10 }}>
                {c.columns.join(', ')} · {num(c.n_rows)} rows
                {c.first_date && ` · ${String(c.first_date).slice(0, 7)}→${String(c.last_date).slice(0, 7)}`}
              </span>
              <button className="btn" style={{ color: 'var(--warning)' }}
                onClick={() => {
                  if (window.confirm(`Delete rate curve "${c.name}"?`)) {
                    deleteRatesCurve(c.slug).then(invalidate);
                  }
                }}>
                <Trash2 size={10} />
              </button>
            </span>
          </div>
        ))}
        <div className="section-label" style={{ marginTop: 8 }}>NEW CURVE</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input" style={{ width: 140 }} placeholder="curve name…"
            value={name} onChange={(e) => setName(e.target.value)} />
          {(['flat', 'points', 'pensford'] as const).map((m) => (
            <button key={m} className={`chip ${mode === m ? 'chip--active' : ''}`} onClick={() => setMode(m)}>
              {m === 'pensford' ? 'PENSFORD FWD' : m.toUpperCase()}
            </button>
          ))}
          {mode === 'flat' && (
            <input className="input num" style={{ width: 80 }} type="number" step={0.0025}
              value={rate} onChange={(e) => setRate(e.target.value)} />
          )}
          {mode === 'points' && (
            <input className="input" style={{ width: 240 }} title="month: rate%, comma separated"
              value={points} onChange={(e) => setPoints(e.target.value)} />
          )}
          <button className="btn" disabled={build.isPending} onClick={submitBuild}>
            {mode === 'pensford' ? <Globe size={11} /> : <Plus size={11} />} BUILD
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <Upload size={11} /> CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onCsv(f);
            }} />
        </div>
        <div className="dim" style={{ fontSize: 10, marginTop: 4 }}>
          CSV needs a <span className="mono">date</span> column + decimal rate columns.
          Points are month-offset: rate%. Pensford fetches the live SOFR forward table.
        </div>
        {msg && <div style={{ fontSize: 11, color: 'var(--text-accent)', marginTop: 4 }}>{msg}</div>}
      </Panel>

      <Panel
        title="CURVE LIBRARIES"
        subtitle={<span className="dim">reusable assumption sets · save from any repline card</span>}
      >
        {(libs.data ?? []).length === 0 && (
          <span className="dim" style={{ fontSize: 11 }}>
            None yet — open a deal, then "SAVE CURVES AS LIBRARY" on a repline card.
          </span>
        )}
        {(libs.data ?? []).map((l) => (
          <div key={l.slug} className="field-row">
            <label style={{ color: 'var(--text-accent)' }}>{l.name}</label>
            <span className="field-control">
              <span className="dim" style={{ fontSize: 10 }}>
                {l.specified.join(', ')}
                {l.vintage && ` · ${l.vintage}`}
                {l.asset_class && ` · ${l.asset_class}`}
              </span>
              <button className="btn" style={{ color: 'var(--warning)' }}
                onClick={() => {
                  if (window.confirm(`Delete curve library "${l.name}"?`)) {
                    deleteCurveLib(l.slug).then(invalidate);
                  }
                }}>
                <Trash2 size={10} />
              </button>
            </span>
          </div>
        ))}
      </Panel>
    </div>
  );
}
