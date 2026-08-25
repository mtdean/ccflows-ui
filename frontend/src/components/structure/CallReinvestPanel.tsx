// Call mechanics + reinvestment (revolving) window for the deal.

import Panel from '../shared/Panel';
import { useDealDraft } from '../../lib/useDealDraft';

export default function CallReinvestPanel() {
  const { doc, update } = useDealDraft();
  if (!doc) return null;
  const call = doc.call ?? {
    enabled: false, call_month: null, nc_months: 0, call_price_pct: 100,
    clean_up_call: false, clean_up_call_pct: 0.10,
  };
  const reinvest = doc.reinvestment ?? {
    enabled: false, reinvest_months: 24, template_repline_id: null,
    purchase_price_pct: 100, reinvest_share: 1.0, max_iterations: 5,
  };
  const replines = doc.run.replines.map((r) => String(r.inline.repline_id));
  const hasReinvestStep = doc.waterfall.steps.some((s) => s.type === 'reinvest');

  return (
    <Panel
      title="CALL & REINVESTMENT"
      subtitle={
        <span className="dim">
          {call.enabled ? (call.clean_up_call ? `cleanup @ ${(call.clean_up_call_pct * 100).toFixed(0)}%` : `call @ M${call.call_month}`) : 'no call'}
          {' · '}
          {reinvest.enabled ? `revolving thru M${reinvest.reinvest_months}` : 'no reinvestment'}
        </span>
      }
    >
      <div className="grid-2">
        <div>
          <div className="section-label">CALL</div>
          <div className="field-row">
            <label>enabled</label>
            <input type="checkbox" checked={call.enabled}
              onChange={(e) => update((d) => { d.call = { ...call, enabled: e.target.checked }; })} />
          </div>
          <div className="field-row">
            <label>call month (blank = none)</label>
            <input className="input num" type="number" min={1} placeholder="—"
              value={call.call_month ?? ''}
              onChange={(e) => update((d) => {
                d.call = { ...call, call_month: e.target.value === '' ? null : Math.trunc(Number(e.target.value)) };
              })} />
          </div>
          <div className="field-row">
            <label>non-call months</label>
            <input className="input num" type="number" min={0} value={call.nc_months}
              onChange={(e) => update((d) => { d.call = { ...call, nc_months: Math.max(0, Math.trunc(Number(e.target.value))) }; })} />
          </div>
          <div className="field-row">
            <label>call price (% of par)</label>
            <input className="input num" type="number" step={0.25} value={call.call_price_pct}
              onChange={(e) => update((d) => { d.call = { ...call, call_price_pct: Number(e.target.value) }; })} />
          </div>
          <div className="field-row">
            <label>clean-up call</label>
            <span className="field-control">
              <input type="checkbox" checked={call.clean_up_call}
                onChange={(e) => update((d) => { d.call = { ...call, clean_up_call: e.target.checked }; })} />
              <span className="dim" style={{ fontSize: 10 }}>at pool factor ≤</span>
              <input className="input num" style={{ width: 60 }} type="number" step={0.01}
                value={call.clean_up_call_pct}
                onChange={(e) => update((d) => { d.call = { ...call, clean_up_call_pct: Number(e.target.value) }; })} />
            </span>
          </div>
          {call.enabled && call.call_month == null && !call.clean_up_call && (
            <div className="field-error-msg" style={{ textAlign: 'left' }}>
              A call needs a call month or the clean-up toggle.
            </div>
          )}
        </div>

        <div>
          <div className="section-label">REINVESTMENT (REVOLVING WINDOW)</div>
          <div className="field-row">
            <label>enabled</label>
            <input type="checkbox" checked={reinvest.enabled}
              onChange={(e) => update((d) => {
                d.reinvestment = { ...reinvest, enabled: e.target.checked };
                // the engine requires a Reinvest step in the waterfall
                if (e.target.checked && !d.waterfall.steps.some((s) => s.type === 'reinvest')) {
                  const idx = d.waterfall.steps.findIndex(
                    (s) => s.type === 'pay_principal' || s.type === 'if');
                  d.waterfall.steps.splice(idx < 0 ? d.waterfall.steps.length - 1 : idx, 0,
                    { name: 'reinvest', type: 'reinvest' });
                }
              })} />
          </div>
          <div className="field-row">
            <label>reinvest through month</label>
            <input className="input num" type="number" min={1} value={reinvest.reinvest_months}
              onChange={(e) => update((d) => { d.reinvestment = { ...reinvest, reinvest_months: Math.max(1, Math.trunc(Number(e.target.value))) }; })} />
          </div>
          <div className="field-row">
            <label>template repline</label>
            <select className="input" value={reinvest.template_repline_id ?? ''}
              onChange={(e) => update((d) => { d.reinvestment = { ...reinvest, template_repline_id: e.target.value || null }; })}>
              <option value="">first repline</option>
              {replines.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="field-row">
            <label>purchase price (% of face)</label>
            <input className="input num" type="number" step={0.25} value={reinvest.purchase_price_pct}
              onChange={(e) => update((d) => { d.reinvestment = { ...reinvest, purchase_price_pct: Number(e.target.value) }; })} />
          </div>
          <div className="field-row">
            <label>share of principal reinvested</label>
            <input className="input num" type="number" step={0.05} min={0} max={1}
              value={reinvest.reinvest_share}
              onChange={(e) => update((d) => { d.reinvestment = { ...reinvest, reinvest_share: Number(e.target.value) }; })} />
          </div>
          {reinvest.enabled && !hasReinvestStep && (
            <div className="field-error-msg" style={{ textAlign: 'left' }}>
              The waterfall needs a REINVEST step — re-toggle to auto-insert it.
            </div>
          )}
        </div>
      </div>
      <div className="dim" style={{ fontSize: 10, marginTop: 6 }}>
        Calls truncate the pool at the resolved month (respecting the non-call period).
        Reinvestment buys new collateral from principal collections inside the window
        (cohorts modeled off the template repline). Neither combines with actuals or
        forward-flow originations.
      </div>
    </Panel>
  );
}
