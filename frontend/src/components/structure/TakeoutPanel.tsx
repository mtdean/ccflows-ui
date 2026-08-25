// Securitization takeout: season this deal's collateral to month k, spin up
// a term deal, set the takeout call here, and optionally add term positions
// to a fund. Warehouse positions are kept — the call terminates their
// cashflows with the payoff, so the fund ledger shows the whole handoff.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Plus, Trash2 } from 'lucide-react';
import { client, listPortfolios } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { apiErrorMessage, money } from '../../lib/utils';
import { useDealDraft } from '../../lib/useDealDraft';
import Panel from '../shared/Panel';

interface RollRow {
  tranche: string;
  face: number;
  cost_basis: number;
}

const STRUCTURES = [
  { key: 'abr', label: 'A/B/R' },
  { key: 'abcr', label: 'A/B/C/R' },
  { key: 'abcder', label: 'A/B/C/D/E/R' },
  { key: 'copy', label: 'COPY THIS STRUCTURE' },
];

export default function TakeoutPanel() {
  const { slug, doc, dirty, openDeal } = useDealDraft();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(12);
  const [price, setPrice] = useState(100);
  const [structure, setStructure] = useState('abcr');
  const [name, setName] = useState('');
  const [portfolio, setPortfolio] = useState('');
  const [rollRows, setRollRows] = useState<RollRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const portfolios = useQuery({ queryKey: qk.portfolios, queryFn: listPortfolios });

  const run = useMutation({
    mutationFn: () =>
      client
        .post<{ term_deal: { meta: { slug: string } }; changes: Record<string, unknown> }>(
          `/deals/${slug}/securitize`,
          {
            month,
            name: name.trim() || undefined,
            structure,
            takeout_price_pct: price,
            doc,
            roll_fund: portfolio
              ? { portfolio, retire_warehouse: false, add_positions: rollRows }
              : undefined,
          })
        .then((r) => r.data),
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: qk.deals });
      queryClient.invalidateQueries({ queryKey: qk.portfolios });
      const seasoned = Number(d.changes.seasoned_balance ?? 0);
      window.alert(
        `Term deal '${d.term_deal.meta.slug}' created — pool ${money(seasoned)} seasoned from ` +
        `${d.changes.seasoned_from}. Takeout call set here at month ${month} @ ${price}.` +
        (portfolio ? ` Fund '${portfolio}' updated.` : ''));
      openDeal(d.term_deal.meta.slug);
      navigate('/structure');
    },
    onError: (err) => setError(apiErrorMessage(err, 'Takeout failed')),
  });

  if (!doc) return null;

  return (
    <Panel
      title="SECURITIZATION TAKEOUT"
      subtitle={
        <span className="dim">
          balance-sheet / warehouse it now, securitize the seasoned pool at month k
        </span>
      }
    >
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field-row">
          <label>takeout at month</label>
          <input className="input num" style={{ width: 70 }} type="number" min={1}
            value={month} onChange={(e) => setMonth(Math.max(1, Math.trunc(Number(e.target.value))))} />
        </div>
        <div className="field-row">
          <label>takeout price (% of pool)</label>
          <input className="input num" style={{ width: 80 }} type="number" step={0.25}
            value={price} onChange={(e) => setPrice(Number(e.target.value))} />
        </div>
        <div className="field-row">
          <label>term structure</label>
          <select className="input" value={structure} onChange={(e) => setStructure(e.target.value)}>
            {STRUCTURES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        <div className="field-row">
          <label>term deal name</label>
          <input className="input" style={{ width: 200 }}
            placeholder={`${doc.meta.name} Takeout`}
            value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>

      <div className="section-label" style={{ marginTop: 8 }}>FUND ROLL (OPTIONAL)</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select className="input" value={portfolio} onChange={(e) => setPortfolio(e.target.value)}>
          <option value="">— no fund roll —</option>
          {(portfolios.data ?? []).map((p) => (
            <option key={p.slug} value={p.slug}>{p.name}</option>
          ))}
        </select>
        {portfolio && (
          <span className="dim" style={{ fontSize: 10 }}>
            existing positions on this deal are KEPT (the call pays them off at month {month});
            add the fund's term-deal positions below
          </span>
        )}
      </div>
      {portfolio && rollRows.map((r, i) => (
        <div key={i} className="field-row" style={{ maxWidth: 520 }}>
          <label>term position</label>
          <span className="field-control">
            <input className="input" style={{ width: 60 }} placeholder="A" value={r.tranche}
              onChange={(e) => setRollRows((rs) => rs.map((q, j) => j === i ? { ...q, tranche: e.target.value } : q))} />
            <span className="dim" style={{ fontSize: 10 }}>face</span>
            <input className="input num" type="number" step={1000000} value={r.face}
              onChange={(e) => setRollRows((rs) => rs.map((q, j) => j === i ? { ...q, face: Number(e.target.value) } : q))} />
            <span className="dim" style={{ fontSize: 10 }}>cost</span>
            <input className="input num" style={{ width: 70 }} type="number" step={0.25} value={r.cost_basis}
              onChange={(e) => setRollRows((rs) => rs.map((q, j) => j === i ? { ...q, cost_basis: Number(e.target.value) } : q))} />
            <button className="btn" onClick={() => setRollRows((rs) => rs.filter((_, j) => j !== i))}>
              <Trash2 size={10} />
            </button>
          </span>
        </div>
      ))}
      {portfolio && (
        <button className="btn" style={{ marginTop: 4 }}
          onClick={() => setRollRows((rs) => [...rs, { tranche: 'A', face: 10_000_000, cost_basis: 100 }])}>
          <Plus size={10} /> TERM POSITION
        </button>
      )}

      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          className="btn"
          style={{ color: 'var(--text-accent)', borderColor: 'var(--text-accent)' }}
          disabled={run.isPending}
          onClick={() => run.mutate()}
        >
          <ArrowRightLeft size={12} /> SECURITIZE AT M{month}
        </button>
        {dirty && <span className="dim" style={{ fontSize: 10 }}>uses the current draft</span>}
      </div>
      {error && <div className="field-error-msg" style={{ textAlign: 'left' }}>{error}</div>}
      <div className="dim" style={{ fontSize: 10, marginTop: 6 }}>
        Seasons the pool to month {month} (balance from actuals when the tape covers it,
        else the projection; curves re-anchored to the boundary), creates the term deal
        with its own run date, and sets the takeout call on THIS deal. The fund's cash
        ledger shows call proceeds in and term purchases out in the same calendar month.
      </div>
    </Panel>
  );
}
