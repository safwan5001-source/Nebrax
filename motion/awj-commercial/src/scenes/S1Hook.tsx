import React from 'react';
import { dark, MONO, SANS } from '../config/theme';
import { T } from '../config/timeline';
import { ease, p, track, velocity, Key } from '../lib/motion';
import { DirBlur, Rise } from '../primitives/Mask';

/**
 * ACT 1 — fragmentation → alignment.
 * Six ticker bands of macro business data race at different speeds, then every key
 * value lands on one tab stop: the chaos resolves into a ledger column.
 */
const TAB = 1480; // the shared tab stop (screen x of every key value's right edge)

type Band = { h: number; size: number; font: 'mono' | 'sans'; key: string; fill: string[]; tone: 'hi' | 'blue' | 'lo'; from: number };
const BANDS: Band[] = [
  { h: 150, size: 104, font: 'mono', key: '12,450.00', fill: ['INV-2026-00416', '8,640.00'], tone: 'lo', from: -1500 },
  { h: 210, size: 150, font: 'sans', key: 'مؤسسة الواحة', fill: ['×4', 'عميل'], tone: 'lo', from: 1700 },
  { h: 180, size: 132, font: 'mono', key: 'INV-2026-00418', fill: ['PUR-2026-00211', 'JE-2026-01872'], tone: 'blue', from: -2100 },
  { h: 180, size: 132, font: 'sans', key: 'المخزون 128', fill: ['مدفوع', 'آجل'], tone: 'lo', from: 1900 },
  { h: 210, size: 156, font: 'mono', key: '1,250.00', fill: ['−4', '720.00'], tone: 'hi', from: -1300 },
  { h: 150, size: 104, font: 'sans', key: 'سند قبض', fill: ['163.04', '1,086.96'], tone: 'lo', from: 1600 },
];

const color = (tone: Band['tone'], key: boolean) =>
  tone === 'blue' ? (key ? dark.primary : '#2B4A86') : tone === 'hi' ? (key ? '#F3F4F6' : '#3A3F48') : key ? '#8B93A0' : '#30353D';

export const S1Hook: React.FC<{ f: number }> = ({ f }) => {
  if (f >= T.hook.end + 6) return null;
  const gap = p(f, 6, 22, ease.heavy) * 240; // bands part for the headline
  const close = p(f, T.hook.collapse - 4, T.hook.doors, ease.typeIn); // bands squeeze into the centre slit
  let y = 0;
  return (
    <div style={{ position: 'absolute', inset: 0, background: dark.bg, overflow: 'hidden' }}>
      {BANDS.map((b, i) => {
        const keys: Key[] = [
          [0, b.from],
          [T.hook.align + 8 - i * 2, 0, ease.cameraOut],
        ];
        const dx = track(f, keys);
        const v = velocity(f, keys);
        const top = y;
        y += b.h;
        const upper = i < 3;
        const shift = (upper ? -1 : 1) * gap / 2;
        const centre = top + b.h / 2 + shift;
        const squeezedCentre = centre + (540 - centre) * close;
        const scaleY = 1 - close;
        const fam = b.font === 'mono' ? MONO : SANS;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 0,
              top: squeezedCentre - b.h / 2,
              width: 1920,
              height: b.h,
              transform: `scaleY(${scaleY})`,
              borderTop: `1px solid ${dark.border}`,
              overflow: 'hidden',
            }}
          >
            <DirBlur id={`hook-b${i}`} x={Math.min(22, Math.abs(v) * 0.22)}>
              {/* key value, right edge on the tab stop */}
              <div style={{ position: 'absolute', right: 1920 - TAB - dx, top: 0, height: b.h, display: 'flex', alignItems: 'center', gap: b.size * 0.6, direction: 'ltr' }}>
                {[...b.fill, ...b.fill].map((s, k) => (
                  <span key={k} style={{ fontFamily: fam, fontSize: b.size, fontWeight: 500, color: color(b.tone, false), whiteSpace: 'nowrap', lineHeight: 1 }}>
                    {s}
                  </span>
                ))}
                <span style={{ fontFamily: fam, fontSize: b.size, fontWeight: 600, color: color(b.tone, true), whiteSpace: 'nowrap', lineHeight: 1 }}>{b.key}</span>
              </div>
              <div style={{ position: 'absolute', left: TAB + dx + b.size * 0.6, top: 0, height: b.h, display: 'flex', alignItems: 'center', gap: b.size * 0.6, direction: 'ltr' }}>
                {[...b.fill].reverse().map((s, k) => (
                  <span key={k} style={{ fontFamily: fam, fontSize: b.size, fontWeight: 500, color: color(b.tone, false), whiteSpace: 'nowrap', lineHeight: 1 }}>
                    {s}
                  </span>
                ))}
              </div>
            </DirBlur>
          </div>
        );
      })}

      {/* the tab stop itself — a hairline that the column locks against */}
      <div style={{ position: 'absolute', left: TAB + 28, top: 0, width: 1, height: 1080, background: dark.primary, opacity: p(f, T.hook.align, T.hook.align + 10) * (1 - close) * 0.8, transformOrigin: 'top', transform: `scaleY(${p(f, T.hook.align - 4, T.hook.align + 14, ease.snap)})` }} />

      {/* headline — lives in the gap the data made for it, right edge on the same tab stop */}
      <div style={{ position: 'absolute', right: 1920 - TAB, top: 540 - 110, height: 220, display: 'flex', alignItems: 'center', opacity: 1 - close, transform: `scaleY(${1 - close})` }}>
        <div dir="rtl" style={{ position: 'relative', fontFamily: SANS, fontWeight: 700, fontSize: 168, lineHeight: 1, color: '#F3F4F6', whiteSpace: 'nowrap' }}>
          <div style={{ position: 'absolute', right: 0, top: -84 }}>
            <Rise t={p(f, T.hook.textA, T.hook.textA + 14, ease.type)} out={p(f, T.hook.textB - 6, T.hook.textB + 6, ease.typeIn)}>
              أعمالك كثيرة.
            </Rise>
          </div>
          <div style={{ position: 'absolute', right: 0, top: -84 }}>
            <Rise t={p(f, T.hook.textB, T.hook.textB + 14, ease.type)}>
              لكن إدارتها <span style={{ color: dark.primary }}>واحدة.</span>
            </Rise>
          </div>
        </div>
      </div>
    </div>
  );
};

