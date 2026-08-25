// Positions editor: add/remove tranche stakes (deal -> tranche -> face + cost
// basis) and the mark settings (method + default + per-tranche overrides).

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { getDeal } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { num } from '../../lib/utils';
import type { DealSummary, PortfolioDoc } from '../../lib/types';
import Panel from '../shared/Panel';

interface Props {
  doc: PortfolioDoc;
  deals: DealSummary[];
  onChange: (mutator: (d: PortfolioDoc) => void) => void;
  saving: boolean;
}

export default function PositionsEditor({ doc, deals, onChange, saving }: Props) {
  const [dealSlug, setDealSlug] = useState('');
  const [tranche, setTranche] = useState('');
  const [face, setFace] = useState('10000000');
  const [cost, setCost] = useState('100');

  // tranche choices for the selected deal
  const dealDoc = useQuery({
    queryKey: dealSlug ? qk.deal(dealSlug) : ['deal', 'none'],
    queryFn: () => getDeal(dealSlug),
    enabled: dealSlug !== '',
    staleTime: 60_000,
  });
  const trancheNames = (dealDoc.data?.waterfall.bonds ?? [])
    .filter((b) => b.type === 'bond')
    .map((b) => b.name);

  return (
    <Panel
      title="POSITIONS & MARKS"
      subtitle={<span className="dim">{saving ? 'saving…' : `${doc.positions.length} position${doc.positions.length === 1 ? '' : 's'}`}</span>}
    >
      {doc.positions.map((p, i) => (
        <div key={i} className="field-row">
          <label>
            {p.deal} / <span style={{ color: 'var(--text-accent)' }}>{p.tranche}</span>
          </label>
          <span className="field-control">
            <span className="dim" style={{ fontSize: 10 }}>face</span>
            <input
              className="input num"
              type="number"
              step={100000}
              value={p.face}
              onChange={(e) => onChange((d) => { d.positions[i].face = Number(e.target.value); })}
            />
            <span className="dim" style={{ fontSize: 10 }}>cost</span>
            <input
              className="input num"
              style={{ width: 70 }}
              type="number"
              step={0.125}
              value={p.cost_basis}
              onChange={(e) => onChange((d) => { d.positions[i].cost_basis = Number(e.target.value); })}
            />
            <span className="dim" style={{ fontSize: 10 }}>mark</span>
            <input
              className="input num"
              style={{ width: 70 }}
              type="number"
              step={doc.marks.method === 'yield' ? 0.005 : 25}
              placeholder={num(doc.marks.default, 0)}
              value={doc.marks.per_tranche[p.deal]?.[p.tranche] ?? ''}
              title="Per-tranche mark override (blank = fund default)"
              onChange={(e) =>
                onChange((d) => {
                  const per = (d.marks.per_tranche[p.deal] ??= {});
                  if (e.target.value === '') delete per[p.tranche];
                  else per[p.tranche] = Number(e.target.value);
                })
              }
            />
            <button className="btn" style={{ color: 'var(--warning)' }}
              onClick={() => onChange((d) => { d.positions.splice(i, 1); })}>
              <Trash2 size={10} />
            </button>
          </span>
        </div>
      ))}

      <div className="section-label" style={{ marginTop: 10 }}>ADD POSITION</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="input" value={dealSlug}
          onChange={(e) => { setDealSlug(e.target.value); setTranche(''); }}>
          <option value="">— deal —</option>
          {deals.map((d) => (
            <option key={d.slug} value={d.slug}>{d.name}</option>
          ))}
        </select>
        <select className="input" value={tranche} disabled={!dealSlug}
          onChange={(e) => setTranche(e.target.value)}>
          <option value="">— tranche —</option>
          {trancheNames.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <span className="dim" style={{ fontSize: 10 }}>face $</span>
        <input className="input num" type="number" step={100000} value={face}
          onChange={(e) => setFace(e.target.value)} />
        <span className="dim" style={{ fontSize: 10 }}>cost (% par)</span>
        <input className="input num" style={{ width: 70 }} type="number" step={0.125} value={cost}
          onChange={(e) => setCost(e.target.value)} />
        <button
          className="btn"
          disabled={!dealSlug || !tranche || Number(face) <= 0}
          onClick={() => {
            onChange((d) => {
              d.positions.push({
                deal: dealSlug, tranche, face: Number(face), cost_basis: Number(cost),
                acquired_month: 0,
              });
            });
            setTranche('');
          }}
        >
          <Plus size={11} /> ADD
        </button>
      </div>

      <div className="section-label" style={{ marginTop: 10 }}>MARK SETTINGS</div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="field-row">
          <label>method</label>
          <select className="input" value={doc.marks.method}
            onChange={(e) => onChange((d) => { d.marks.method = e.target.value as PortfolioDoc['marks']['method']; })}>
            <option value="spread">SPREAD (bps)</option>
            <option value="dm">DM (bps)</option>
            <option value="yield">YIELD (decimal)</option>
          </select>
        </div>
        <div className="field-row">
          <label>fund default</label>
          <input className="input num" type="number"
            step={doc.marks.method === 'yield' ? 0.005 : 25}
            value={doc.marks.default}
            onChange={(e) => onChange((d) => { d.marks.default = Number(e.target.value); })} />
        </div>
      </div>
      <div className="dim" style={{ fontSize: 10, marginTop: 4 }}>
        Every position marks at the fund default unless it has a per-position override above.
      </div>
    </Panel>
  );
}
