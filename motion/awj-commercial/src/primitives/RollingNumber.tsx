import React from 'react';
import { MONO } from '../config/theme';
import { clamp01, ease } from '../lib/motion';

/**
 * Mechanical per-digit roll between two formatted values. Digits are tabular (IBM Plex
 * Mono) so columns never shift; each changed digit rolls upward on its own wheel,
 * least-significant first — the way a real counter settles.
 */
export const RollingNumber: React.FC<{
  from: string;
  to: string;
  progress: number;
  stagger?: number;
  style?: React.CSSProperties;
  digitStyle?: React.CSSProperties;
}> = ({ from, to, progress, stagger = 0.08, style, digitStyle }) => {
  const len = Math.max(from.length, to.length);
  const a = from.padStart(len, ' ');
  const b = to.padStart(len, ' ');
  const chars: React.ReactNode[] = [];
  let changed = 0;
  for (let i = len - 1; i >= 0; i--) if (a[i] !== b[i]) changed++;
  const span = Math.max(0.0001, 1 - stagger * Math.max(0, changed - 1));
  let order = 0;

  for (let i = 0; i < len; i++) {
    const ca = a[i];
    const cb = b[i];
    if (ca === cb) {
      chars.push(
        <span key={i} style={{ display: 'inline-block', whiteSpace: 'pre' }}>
          {cb}
        </span>,
      );
      continue;
    }
    // index from the right among changed chars → least significant rolls first
    let rank = 0;
    for (let j = len - 1; j > i; j--) if (a[j] !== b[j]) rank++;
    order++;
    const t = ease.digit(clamp01((progress - rank * stagger) / span));
    const da = /\d/.test(ca) ? Number(ca) : null;
    const db = /\d/.test(cb) ? Number(cb) : null;
    if (da !== null && db !== null) {
      const steps = (db - da + 10) % 10;
      const pos = da + steps * t; // 0..19 on a doubled strip
      chars.push(
        <span key={i} style={{ display: 'inline-block', height: '1em', lineHeight: 1, overflow: 'hidden', verticalAlign: 'top' }}>
          <span style={{ display: 'block', transform: `translateY(${-pos}em)` }}>
            {Array.from({ length: 20 }, (_, k) => (
              <span key={k} style={{ display: 'block', height: '1em', lineHeight: 1, ...digitStyle }}>
                {k % 10}
              </span>
            ))}
          </span>
        </span>,
      );
    } else {
      // appearing / disappearing glyph (e.g. "1," growing into the thousands)
      chars.push(
        <span key={i} style={{ display: 'inline-block', position: 'relative', height: '1em', lineHeight: 1, overflow: 'hidden', verticalAlign: 'top', whiteSpace: 'pre' }}>
          <span style={{ display: 'block', opacity: 1 - t, transform: `translateY(${-t}em)` }}>{ca}</span>
          <span style={{ position: 'absolute', inset: 0, display: 'block', opacity: t, transform: `translateY(${1 - t}em)` }}>{cb}</span>
        </span>,
      );
    }
  }
  void order;
  return (
    <span
      dir="ltr"
      style={{
        fontFamily: MONO,
        fontVariantNumeric: 'tabular-nums',
        display: 'inline-flex',
        lineHeight: 1,
        whiteSpace: 'pre',
        ...style,
      }}
    >
      {chars}
    </span>
  );
};

/** Walk a sequence of values; `steps[i]` is the frame at which value i → i+1 starts. */
export const steppedRoll = (f: number, values: string[], starts: readonly number[], dur: number) => {
  let idx = 0;
  for (let i = 0; i < starts.length; i++) if (f >= starts[i]) idx = i;
  if (f < starts[0]) return { from: values[0], to: values[0], progress: 1 };
  const prog = clamp01((f - starts[idx]) / dur);
  return { from: values[idx], to: values[idx + 1], progress: prog };
};
