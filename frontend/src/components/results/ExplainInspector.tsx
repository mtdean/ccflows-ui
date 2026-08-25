// "Where did month N's cash go?" — month scrubber + the engine's prose walk.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getRunExplain } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import LoadingCursor from '../shared/LoadingCursor';

interface Props {
  runId: string;
}

export default function ExplainInspector({ runId }: Props) {
  const [month, setMonth] = useState(12);

  const query = useQuery({
    queryKey: qk.runData(runId, 'explain', month),
    queryFn: () => getRunExplain(runId, month),
    staleTime: Infinity,
    retry: false,
  });

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <button className="btn" onClick={() => setMonth((m) => Math.max(0, m - 1))}>
          <ChevronLeft size={12} />
        </button>
        <input
          type="range"
          min={0}
          max={360}
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          style={{ flex: 1, accentColor: 'var(--text-accent)' }}
        />
        <button className="btn" onClick={() => setMonth((m) => Math.min(360, m + 1))}>
          <ChevronRight size={12} />
        </button>
        <span className="mono" style={{ color: 'var(--text-accent)', width: 90 }}>
          MONTH {month}
        </span>
      </div>
      {query.isLoading ? (
        <LoadingCursor />
      ) : query.isError ? (
        <span className="dim">no cash activity at this month</span>
      ) : (
        <pre
          className="mono"
          style={{
            whiteSpace: 'pre-wrap',
            fontSize: 12,
            lineHeight: 1.6,
            background: 'var(--bg-panel-alt)',
            border: '1px solid var(--border)',
            borderRadius: 2,
            padding: 12,
            margin: 0,
          }}
        >
          {query.data}
        </pre>
      )}
    </div>
  );
}
