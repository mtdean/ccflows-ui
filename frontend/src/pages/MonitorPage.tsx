// Monitor: the deal-surveillance workstation — status board, covenants,
// surveillance flags, spliced tranche series, P&L, monthly close.

import * as Tabs from '@radix-ui/react-tabs';
import { monitorOverview, monitorSurveillance } from '../lib/api';
import { apiErrorMessage, money, num, pct } from '../lib/utils';
import { useDealDraft } from '../lib/useDealDraft';
import { hasActuals, useMonitorQuery } from '../lib/useMonitor';
import DataTable from '../components/shared/DataTable';
import type { Column } from '../components/shared/DataTable';
import EmptyState from '../components/shared/EmptyState';
import LoadingCursor from '../components/shared/LoadingCursor';
import Panel from '../components/shared/Panel';
import CloseView from '../components/monitor/CloseView';
import CovenantsView from '../components/monitor/CovenantsView';
import PnlView from '../components/monitor/PnlView';
import TrancheSeriesView from '../components/monitor/TrancheSeriesView';

type Row = Record<string, unknown>;

const BOND_STATUS_COLOR: Record<string, string> = {
  performing: 'var(--positive)', shortfall: 'var(--negative)',
  'off model': 'var(--warning)', retired: 'var(--text-dim)', 'no data': 'var(--text-dim)',
};
const SEV_COLOR: Record<string, string> = {
  watch: 'var(--warning)', alert: 'var(--warning)', breach: 'var(--negative)',
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ border: '1px solid var(--border)', padding: '6px 10px' }}>
      <div className="dim" style={{ fontSize: 10, letterSpacing: '0.08em' }}>{label}</div>
      <div className="mono" style={{ fontSize: 15, color: tone ?? 'var(--text-accent)' }}>{value}</div>
    </div>
  );
}

function StatusView() {
  const overview = useMonitorQuery('overview', monitorOverview);
  if (overview.isLoading) return <LoadingCursor />;
  if (overview.isError) {
    return <div className="field-error-msg" style={{ textAlign: 'left' }}>{apiErrorMessage(overview.error, 'Monitor failed')}</div>;
  }
  if (!overview.data) return null;
  const s = overview.data.status;
  const realized = overview.data.realized;

  const cols: Column<Row>[] = (overview.data.bond_status.columns ?? []).map((c) => ({
    key: c, header: c.replace(/_/g, ' ').toUpperCase(),
    align: c === 'tranche' || c === 'status' ? 'left' : 'right', sortable: false,
    render: (r) => {
      const v = r[c];
      if (c === 'tranche') return <span style={{ color: 'var(--text-accent)' }}>{String(v)}</span>;
      if (c === 'status') return <span style={{ color: BOND_STATUS_COLOR[String(v)] }}>{String(v).toUpperCase()}</span>;
      if (typeof v !== 'number') return <span className="dim">—</span>;
      if (c.includes('factor') || c.includes('ratio')) return <span className="num mono">{num(v, 3)}</span>;
      if (c.includes('variance')) return <span className={`num mono ${Math.abs(v) > 1 ? 'neg' : 'dim'}`}>{money(v)}</span>;
      return <span className="num mono">{money(v)}</span>;
    },
  }));

  return (
    <div className="stack">
      <div className="stat-grid">
        <Stat label="ACTUALS THRU" value={s.boundary_month != null && Number(s.boundary_month) > 0 ? `M${s.boundary_month}` : 'NONE'} />
        <Stat label="COVENANTS" value={String(s.covenants ?? '—')}
          tone={String(s.covenants) === 'COMPLIANT' ? 'var(--positive)' : 'var(--negative)'} />
        <Stat label="SURVEILLANCE" value={String(s.surveillance ?? '—').toUpperCase()}
          tone={String(s.surveillance) === 'clear' ? 'var(--positive)' : 'var(--warning)'} />
        <Stat label="REALIZED CDR / CPR"
          value={realized ? `${pct(realized.realized_cdr as number)} / ${pct(realized.realized_cpr as number)}` : '—'} />
      </div>
      {realized && (
        <div className="mono dim" style={{ fontSize: 11 }}>
          realized XIRR {pct(realized.realized_xirr as number)} · cum loss {pct(realized.cum_loss_pct as number)} ·
          cum collections {money(realized.cum_collections as number)}
        </div>
      )}
      <div className="section-label">BOND STATUS BOARD</div>
      {overview.data.bond_status.records.length === 0 ? (
        <EmptyState message="NO TRUSTEE TAPE — BOND BOARD NEEDS BOND ACTUALS" />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <DataTable columns={cols} rows={overview.data.bond_status.records}
            rowKey={(r) => String(r.tranche)} emptyMessage="—" />
        </div>
      )}
    </div>
  );
}

function SurveillanceView() {
  const { doc } = useDealDraft();
  const data = useMonitorQuery('surveillance', monitorSurveillance, hasActuals(doc));
  if (!hasActuals(doc)) return <EmptyState message="SURVEILLANCE NEEDS ACTUALS — LOAD A TAPE" />;
  if (data.isLoading) return <LoadingCursor />;
  if (data.isError) {
    return <div className="field-error-msg" style={{ textAlign: 'left' }}>{apiErrorMessage(data.error, 'Surveillance failed')}</div>;
  }
  if (!data.data) return null;
  const flagCols: Column<Row>[] = (data.data.flags.columns ?? []).map((c) => ({
    key: c, header: c.replace(/_/g, ' ').toUpperCase(),
    align: c === 'observed' || c === 'threshold' || c === 'month_triggered' ? 'right' : 'left',
    sortable: false,
    render: (r) => {
      const v = r[c];
      if (c === 'severity') return <span className="chip" style={{ color: SEV_COLOR[String(v)], borderColor: SEV_COLOR[String(v)] }}>{String(v)}</span>;
      if (typeof v === 'number') return <span className="num mono">{num(v, 3)}</span>;
      return <span className={c === 'rule' ? '' : 'dim'} style={c === 'rule' ? { color: 'var(--text-accent)' } : undefined}>{String(v)}</span>;
    },
  }));
  return (
    <div className="stack">
      {data.data.all_clear ? (
        <span className="pos mono">✓ ALL CLEAR — no surveillance rules triggered</span>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <DataTable columns={flagCols} rows={data.data.flags.records}
            rowKey={(r) => `${r.repline_id}:${r.rule}`} emptyMessage="—" />
        </div>
      )}
      <div className="dim" style={{ fontSize: 10 }}>
        Rules: CDR/CPR realized-vs-assumed (1.25×/1.5× watch/alert, 40% fast/slow), DQ trends,
        collections −10%, factor deviation — plus OC/IC/factor/shortfall checks when a bond tape is loaded.
      </div>
    </div>
  );
}

export default function MonitorPage() {
  const { doc, loading } = useDealDraft();
  if (!doc && !loading) return <EmptyState message="OPEN A DEAL FIRST" />;
  if (!doc) return <LoadingCursor />;

  return (
    <div className="stack">
      <Panel
        title="MONITOR"
        subtitle={
          hasActuals(doc) ? (
            <span className="dim">live against {doc.actuals?.collateral?.length ?? 0} collateral + {doc.actuals?.bonds?.length ?? 0} bond tape rows</span>
          ) : (
            <span className="dim">no actuals loaded — most views need a tape (ACTUALS tab)</span>
          )
        }
        bodyStyle={{ padding: 0, background: 'transparent', border: 'none' }}
      >
        <Tabs.Root defaultValue="status">
          <Tabs.List className="subtabs" style={{ padding: '0 10px' }}>
            <Tabs.Trigger value="status">STATUS</Tabs.Trigger>
            <Tabs.Trigger value="covenants">COVENANTS</Tabs.Trigger>
            <Tabs.Trigger value="surveillance">SURVEILLANCE</Tabs.Trigger>
            <Tabs.Trigger value="tranches">TRANCHES</Tabs.Trigger>
            <Tabs.Trigger value="pnl">P&L</Tabs.Trigger>
            <Tabs.Trigger value="close">CLOSE</Tabs.Trigger>
          </Tabs.List>
          <div style={{ padding: 10 }}>
            <Tabs.Content value="status"><StatusView /></Tabs.Content>
            <Tabs.Content value="covenants"><CovenantsView /></Tabs.Content>
            <Tabs.Content value="surveillance"><SurveillanceView /></Tabs.Content>
            <Tabs.Content value="tranches"><TrancheSeriesView /></Tabs.Content>
            <Tabs.Content value="pnl">
              {hasActuals(doc) ? <PnlView /> : <EmptyState message="P&L NEEDS ACTUALS — LOAD A TAPE" />}
            </Tabs.Content>
            <Tabs.Content value="close"><CloseView /></Tabs.Content>
          </div>
        </Tabs.Root>
      </Panel>
    </div>
  );
}
