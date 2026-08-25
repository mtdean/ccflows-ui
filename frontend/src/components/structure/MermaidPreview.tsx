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

interface Props {
  waterfall: WaterfallSpec;
}

export default function MermaidPreview({ waterfall }: Props) {
  const [debouncedHash, setDebouncedHash] = useState<string>('');
  const hash = hashOf(waterfall);
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
        const { svg } = await mermaid.render(`wf-${++renderSeq}`, text);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
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
      <div className="mermaid-preview" ref={containerRef}>
        {!text && <span className="dim" style={{ fontSize: 11, alignSelf: 'center' }}>
          {query.isError ? 'structure not renderable yet' : 'building diagram…'}
        </span>}
      </div>
    </div>
  );
}
