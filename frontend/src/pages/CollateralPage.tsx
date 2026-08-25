// Collateral: repline cards grid + pool summary strip.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { getReplineSchema } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { resolveCurve } from '../lib/curves';
import { money, pct } from '../lib/utils';
import { useDealDraft } from '../lib/useDealDraft';
import { useDealValidation } from '../lib/useDealValidation';
import type { ReplineEntry } from '../lib/types';
import EmptyState from '../components/shared/EmptyState';
import LoadingCursor from '../components/shared/LoadingCursor';
import Panel from '../components/shared/Panel';
import OriginationsPanel from '../components/collateral/OriginationsPanel';
import ReplineCard from '../components/collateral/ReplineCard';

function newRepline(existing: ReplineEntry[]): ReplineEntry {
  let n = existing.length + 1;
  const ids = new Set(existing.map((e) => e.inline.repline_id));
  while (ids.has(`repline_${n}`)) n++;
  return {
    inline: {
      repline_id: `repline_${n}`,
      amortization_type: 'simple',
      upb: 10_000_000,
      gross_wac: 0.10,
      net_wac: 0.09,
      term: 60,
      age: 0,
      cdr: resolveCurve({ mode: 'flat', value: 0.02 / 12 }),
      cpr: resolveCurve({ mode: 'flat', value: 0.1 / 12 }),
    },
    curve_specs: {
      cdr: { mode: 'flat', value: 0.02 / 12 },
      cpr: { mode: 'flat', value: 0.1 / 12 },
    },
  };
}

export default function CollateralPage() {
  const { doc, update, loading } = useDealDraft();
  const validation = useDealValidation();

  const schema = useQuery({
    queryKey: qk.schemaReplines,
    queryFn: getReplineSchema,
    staleTime: Infinity,
  });

  const pool = useMemo(() => {
    const replines = doc?.run.replines ?? [];
    let upb = 0;
    let wacWeighted = 0;
    let termWeighted = 0;
    for (const r of replines) {
      const u = Number(r.inline.upb ?? 0) || 0;
      upb += u;
      wacWeighted += u * (Number(r.inline.gross_wac ?? 0) || 0);
      termWeighted += u * (Number(r.inline.term ?? 0) || 0);
    }
    return {
      upb,
      wac: upb > 0 ? wacWeighted / upb : 0,
      term: upb > 0 ? termWeighted / upb : 0,
      count: replines.length,
    };
  }, [doc]);

  if (!doc && !loading) return <EmptyState message="OPEN A DEAL FIRST" />;
  if (!doc || schema.isLoading) return <LoadingCursor />;
  if (!schema.data) return <EmptyState message="SCHEMA UNAVAILABLE — IS THE BACKEND RUNNING?" />;

  const replines = doc.run.replines;

  return (
    <div className="stack">
      <Panel
        title="COLLATERAL"
        subtitle={
          <span className="mono">
            {pool.count} repline{pool.count === 1 ? '' : 's'} · Σ {money(pool.upb)} · WA WAC{' '}
            {pct(pool.wac)} · WA TERM {pool.term.toFixed(0)}mo
          </span>
        }
        actions={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <label className="field-row" style={{ gap: 6 }}>
              <span className="dim" style={{ fontSize: 11 }}>RUN DATE</span>
              <input
                className="input"
                type="date"
                value={doc.run.run_date}
                onChange={(e) => update((d) => { d.run.run_date = e.target.value; })}
              />
            </label>
            <button
              className="btn"
              onClick={() => update((d) => { d.run.replines.push(newRepline(d.run.replines)); })}
            >
              <Plus size={12} /> ADD REPLINE
            </button>
          </div>
        }
        bodyStyle={{ padding: 0, border: 'none', background: 'transparent' }}
      >
        {replines.length === 0 ? (
          <EmptyState message="NO REPLINES — ADD ONE" />
        ) : (
          <div className="repline-grid" style={{ padding: 10 }}>
            {replines.map((entry, i) => (
              <ReplineCard
                key={i}
                entry={entry}
                index={i}
                schema={schema.data}
                errors={validation.errorsAt(['run', 'replines', i])}
                onChange={(mutator) => update((d) => mutator(d.run.replines[i]))}
                onDuplicate={() =>
                  update((d) => {
                    const clone = structuredClone(d.run.replines[i]);
                    clone.inline.repline_id = `${clone.inline.repline_id}_copy`;
                    d.run.replines.splice(i + 1, 0, clone);
                  })
                }
                onDelete={() => update((d) => { d.run.replines.splice(i, 1); })}
                canDelete={replines.length > 1}
              />
            ))}
          </div>
        )}
      </Panel>
      <OriginationsPanel />
      {validation.warnings.length > 0 && (
        <Panel title="WARNINGS">
          {validation.warnings.map((w, i) => (
            <div key={i} style={{ color: 'var(--warning)', fontSize: 11, padding: '2px 0' }}>
              {w}
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}
