// Top-level tab navigation. Tabs other than DEALS need an open deal.

import { NavLink } from 'react-router-dom';
import { useDealDraft } from '../../lib/useDealDraft';

const TABS = [
  { to: '/collateral', label: 'COLLATERAL', needsDeal: true },
  { to: '/structure', label: 'STRUCTURE', needsDeal: true },
  { to: '/actuals', label: 'ACTUALS', needsDeal: true },
  { to: '/monitor', label: 'MONITOR', needsDeal: true },
  { to: '/scenarios', label: 'SCENARIOS', needsDeal: true },
  { to: '/results', label: 'RESULTS', needsDeal: true },
  { to: '/analysis', label: 'ANALYSIS', needsDeal: true },
  { to: '/exports', label: 'EXPORTS', needsDeal: true },
  { to: '/portfolios', label: 'PORTFOLIOS', needsDeal: false },
  { to: '/closes', label: 'CLOSES', needsDeal: false },
];

export default function TabNav() {
  const { slug } = useDealDraft();
  return (
    <nav className="tabnav">
      <NavLink to="/" end>
        DEALS
      </NavLink>
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          style={!tab.needsDeal || slug ? undefined : { opacity: 0.35, pointerEvents: 'none' }}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
