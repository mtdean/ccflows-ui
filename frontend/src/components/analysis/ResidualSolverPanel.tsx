// Residual solver: what can I pay for the collateral to hit a target residual
// yield — and the reverse, what does a given purchase price earn the residual.

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { client, getAnalysisTranches } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { apiErrorMessage, money, num, pct } from '../../lib/utils';

interface Props {
  runId: string;
}

interface SolveResult {
  mode: string;
  target_yield?: number;
  collateral_price?: number;
  collateral_cost?: number;
  equity_check?: number;
  note_proceeds?: number;
  notes?: { name: string; face: number; price: number }[];
  reserve_funded?: number;
  pool_upb?: number;
  residual_yield?: number | null;
  residual_moic?: number | null;
  warning?: string | null;
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ border: '1px solid var(--border)', padding: '6px 10px' }}>
      <div className="dim" style={{ fontSize: 10, letterSpacing: '0.08em' }}>{label}</div>
      <div className="mono" style={{ fontSize: accent ? 18 : 14, color: accent ? 'var(--text-accent)' : 'var(--text-primary)' }}>
        {value}
      </div>
    </div>
  );
}

export default function ResidualSolverPanel({ runId }: Props) {
  const [targetYield, setTargetYield] = useState('0.18');
  const [givenPrice, setGivenPrice] = useState('100');
  const [notePrices, setNotePrices] = useState<Record<string, number>>({});
  const [result, setResult] = useState<SolveResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tranches = useQuery({
    queryKey: qk.analysis(runId, 'tranches'),
    queryFn: () => getAnalysisTranches(runId),
    staleTime: Infinity,
  });
  const notes = (tranches.data?.tranches ?? []).filter((t) => t.type === 'bond');

  const solve = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      client
        .post<SolveResult>(`/runs/${runId}/analysis/solve-collateral-price`, {
          ...body,
          note_prices: notePrices,
        })
        .then((r) => r.data),
    onSuccess: (data) => {
      setResult(data);
      setError(null);
    },
    onError: (err) => setError(apiErrorMessage(err, 'Solve failed')),
  });

  return (
    <div>
      <div className="dim" style={{ fontSize: 11, marginBottom: 10 }}>
        The residual's cashflows are fixed by the run — only the equity check moves with the
        collateral purchase price (cost + reserve − note proceeds). Solve either direction.
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div>
          <div className="section-label">TARGET YIELD → MAX COLLATERAL PRICE</div>
          <div className="field-row" style={{ maxWidth: 380 }}>
            <label>target residual yield (decimal)</label>
            <span className="field-control">
              <input className="input num" type="number" step={0.01} value={targetYield}
                onChange={(e) => setTargetYield(e.target.value)} />
              <button className="btn" disabled={solve.isPending}
                onClick={() => solve.mutate({ target_yield: Number(targetYield) })}>
                <Play size={11} /> SOLVE PRICE
              </button>
            </span>
          </div>
        </div>
        <div>
          <div className="section-label">COLLATERAL PRICE → RESIDUAL YIELD</div>
          <div className="field-row" style={{ maxWidth: 380 }}>
            <label>collateral price (% of par)</label>
            <span className="field-control">
              <input className="input num" type="number" step={0.25} value={givenPrice}
                onChange={(e) => setGivenPrice(e.target.value)} />
              <button className="btn" disabled={solve.isPending}
                onClick={() => solve.mutate({ collateral_price: Number(givenPrice) })}>
                <Play size={11} /> SOLVE YIELD
              </button>
            </span>
          </div>
        </div>
      </div>

      {notes.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="section-label">NOTE PRICING ASSUMPTION (PROCEEDS AT CLOSE)</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {notes.map((n) => (
              <div key={n.name} className="field-row">
                <label>{n.name}</label>
                <input className="input num" style={{ width: 70 }} type="number" step={0.25}
                  value={notePrices[n.name] ?? 100}
                  onChange={(e) => setNotePrices((p) => ({ ...p, [n.name]: Number(e.target.value) }))} />
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <div className="field-error-msg" style={{ textAlign: 'left' }}>{error}</div>}

      {result && (
        <div style={{ marginTop: 12 }}>
          <div className="stat-grid">
            {result.mode === 'price_from_yield' ? (
              <Stat label="MAX COLLATERAL PRICE" value={num(result.collateral_price ?? 0, 3)} accent />
            ) : (
              <Stat label="RESIDUAL YIELD"
                value={result.residual_yield == null ? '> 1000% / n.m.' : pct(result.residual_yield)} accent />
            )}
            <Stat label="EQUITY CHECK" value={money(result.equity_check)} />
            <Stat label="NOTE PROCEEDS" value={money(result.note_proceeds)} />
            <Stat label="COLLATERAL COST"
              value={money(result.collateral_cost ?? ((result.collateral_price ?? 0) / 100) * (result.pool_upb ?? 0))} />
            <Stat label="RESERVE FUNDED" value={money(result.reserve_funded)} />
            <Stat label="POOL UPB" value={money(result.pool_upb)} />
            {result.residual_moic != null && (
              <Stat label="RESIDUAL MOIC" value={num(result.residual_moic, 2)} />
            )}
            {result.mode === 'price_from_yield' && result.target_yield != null && (
              <Stat label="AT TARGET YIELD" value={pct(result.target_yield)} />
            )}
          </div>
          {result.warning && (
            <div style={{ color: 'var(--warning)', fontSize: 11, marginTop: 6 }}>{result.warning}</div>
          )}
        </div>
      )}
    </div>
  );
}
