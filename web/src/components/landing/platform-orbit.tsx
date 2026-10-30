import type { ReactNode } from 'react';

interface PlatformOrbitProps {
  core: ReactNode;
  coreTitle: string;
  coreSub: string;
  nodes: string[];
  label: string;
}

const RADIUS = 38;

/** الوحدات حول دفتر أستاذ واحد. المواضع تُحسب هنا مرة واحدة فلا تعتمد على دوال CSS المثلثية. */
export function PlatformOrbit({ core, coreTitle, coreSub, nodes, label }: PlatformOrbitProps) {
  const points = nodes.map((_, index) => {
    const angle = (index / nodes.length) * 2 * Math.PI - Math.PI / 2;
    return { x: 50 + RADIUS * Math.cos(angle), y: 50 + RADIUS * Math.sin(angle) };
  });

  return (
    <div className="lp-orbit" data-loop="">
      <svg className="lp-orbit__lines" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <circle cx="50" cy="50" r={RADIUS} className="lp-orbit__ring" />
        <circle cx="50" cy="50" r={RADIUS * 0.62} className="lp-orbit__ring lp-orbit__ring--inner" />
        {points.map((point, index) => (
          <line key={index} x1="50" y1="50" x2={point.x.toFixed(2)} y2={point.y.toFixed(2)} className="lp-orbit__spoke" />
        ))}
      </svg>
      <div className="lp-orbit__core">
        {core}
        <b>{coreTitle}</b>
        <span>{coreSub}</span>
      </div>
      <ul className="lp-orbit__nodes" aria-label={label}>
        {nodes.map((node, index) => (
          <li key={node} style={{ left: `${points[index].x.toFixed(2)}%`, top: `${points[index].y.toFixed(2)}%` }}>
            {node}
          </li>
        ))}
      </ul>
    </div>
  );
}
