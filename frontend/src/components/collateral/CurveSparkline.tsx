// Tiny inline SVG sparkline for a curve on a repline card. Plain polyline —
// cheap enough to render dozens per page.

import { sparklinePoints } from '../../lib/curves';

interface Props {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}

export default function CurveSparkline({ values, width = 64, height = 18, color }: Props) {
  const points = sparklinePoints(values, width, height);
  if (!points) return null;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline
        points={points}
        fill="none"
        stroke={color ?? 'var(--text-accent)'}
        strokeWidth={1}
      />
    </svg>
  );
}
