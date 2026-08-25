// Live flow diagram of the waterfall, rendered from the engine's own
// Mermaid output. Debounced on a structure hash; the stale SVG stays visible
// while a new one renders; mermaid itself is lazy-loaded (~1.5MB).

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { waterfallMermaid } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { hashOf } from '../../lib/utils';
import type { WaterfallSpec } from '../../lib/types';

let mermaidPromise: Promise<typeof import('mermaid')['default']> | null = null;
function loadMermaid() {
  mermaidPromise ??= import('mermaid').then((mod) => {
    mod.default.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'base',
      themeVariables: {
        background: '#0a0a0a',
        primaryColor: '#161616',
        primaryBorderColor: '#3a3a3a',
        primaryTextColor: '#e8e8e8',
        secondaryColor: '#1a2332',
        tertiaryColor: '#111111',
        lineColor: '#ff9900',
        fontFamily: 'IBM Plex Mono, monospace',
        fontSize: '11px',
      },
    });
    return mod.default;
  });
  return mermaidPromise;
}

let renderSeq = 0;

// The engine emits one flowchart with the capital-structure subgraph beside
// the step chain, which squeezes the waterfall. Split it into two stacked
// diagrams: the capital stack (horizontal) on top, the waterfall below at
// full width.
function splitDiagram(text: string): { capital: string | null; waterfall: string } {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim().startsWith('subgraph capital'));
  if (start === -1) return { capital: null, waterfall: text };
  let depth = 0;
  let end = start;
  for (let i = start; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('subgraph')) depth++;
    else if (t === 'end') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  const sub = lines
    .slice(start, end + 1)
    .map((l) => l.replace(/direction\s+\w+/, 'direction LR'));
  // mermaid ignores subgraph direction when nodes are edge-less — an
  // invisible chain (~~~) pins the tranches into one horizontal row
  const ids = sub.map((l) => l.trim().match(/^([A-Za-z0-9_]+)\[/)?.[1]).filter(Boolean);
  if (ids.length > 1) sub.splice(sub.length - 1, 0, `        ${ids.join(' ~~~ ')}`);
  const rest = [...lines.slice(0, start), ...lines.slice(end + 1)];
  return {
    capital: ['flowchart LR', ...sub].join('\n'),
    waterfall: rest.join('\n'),
  };
}

interface Props {
  waterfall: WaterfallSpec;
}

export default function MermaidPreview({ waterfall }: Props) {
  const [debouncedHash, setDebouncedHash] = useState<string>('');
  const hash = hashOf(waterfall);
  const capitalRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [rendering, setRendering] = useState(false);
  const lastText = useRef<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedHash(hash), 400);
    return () => clearTimeout(t);
  }, [hash]);

  const query = useQuery({
    queryKey: qk.mermaid(debouncedHash || 'init'),
    queryFn: () => waterfallMermaid(waterfall),
    enabled: debouncedHash !== '' && debouncedHash === hash,
    staleTime: Infinity,
    retry: false,
  });

  const text = query.data;

  useEffect(() => {
    if (!text || text === lastText.current) return;
    let cancelled = false;
    setRendering(true);
    void (async () => {
      try {
        const mermaid = await loadMermaid();
        const parts = splitDiagram(text);
        const [cap, wf] = await Promise.all([
          parts.capital
            ? mermaid.render(`wfcap-${++renderSeq}`, parts.capital)
            : Promise.resolve(null),
          mermaid.render(`wf-${++renderSeq}`, parts.waterfall),
        ]);
        if (!cancelled && containerRef.current) {
          if (capitalRef.current) capitalRef.current.innerHTML = cap ? cap.svg : '';
          containerRef.current.innerHTML = wf.svg;
          lastText.current = text;
        }
      } catch {
        // keep the previous diagram on a parse hiccup
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [text]);

  return (
    <div>
      {(rendering || query.isFetching) && (
        <div className="dim loading-cursor" style={{ fontSize: 10, marginBottom: 4 }}>
          RENDERING
        </div>
      )}
      <div className="mermaid-preview" ref={capitalRef}
        style={{ minHeight: 0, marginBottom: 6 }} />
      <div className="mermaid-preview" ref={containerRef}>
        {!text && <span className="dim" style={{ fontSize: 11, alignSelf: 'center' }}>
          {query.isError ? 'structure not renderable yet' : 'building diagram…'}
        </span>}
      </div>
    </div>
  );
}
