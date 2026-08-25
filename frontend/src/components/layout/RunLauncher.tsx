// The persistent [RUN ▸] button: run any stress scenario (or the base case)
// from any page. Uses the current draft, so previewing never requires saving.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getStressScenarios } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { apiErrorMessage } from '../../lib/utils';
import { useRuns } from '../../lib/useRuns';

export default function RunLauncher() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { runScenario, running } = useRuns();

  const { data: scenarios } = useQuery({
    queryKey: qk.schemaScenarios,
    queryFn: getStressScenarios,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function fire(scenario: string) {
    setOpen(false);
    setError(null);
    try {
      await runScenario(scenario);
      navigate('/results');
    } catch (err) {
      setError(apiErrorMessage(err, 'Run failed'));
      window.alert(apiErrorMessage(err, 'Run failed'));
    }
  }

  const names = scenarios?.curve_scenarios.map((s) => s.name) ?? ['base'];

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="btn"
        style={{ color: running ? 'var(--warning)' : 'var(--text-accent)', borderColor: 'var(--text-accent)' }}
        onClick={() => setOpen((o) => !o)}
        disabled={running != null}
        title={error ?? 'Run the deal'}
      >
        <Play size={12} /> {running ? `RUNNING ${running.toUpperCase()}` : 'RUN'} ▾
      </button>
      {open && (
        <div className="knob-menu" style={{ right: 0, left: 'auto', minWidth: 200 }}>
          {names.map((name) => (
            <button key={name} className="knob-menu-item" onClick={() => void fire(name)}>
              <span>{name.replace(/_/g, ' ').toUpperCase()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
