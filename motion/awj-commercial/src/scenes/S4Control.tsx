import React from 'react';
import { dark, light, SANS, Theme } from '../config/theme';
import { T } from '../config/timeline';
import { ease, lerp, p, track, trackLog, Key } from '../lib/motion';
import { Camera, Cam } from '../primitives/Camera';
import { Rise } from '../primitives/Mask';
import { DASH, Dashboard, DashState } from '../ui/Dashboard';
import { PosScreen } from '../ui/PosScreen';
import { InventoryScreen } from '../ui/InventoryScreen';
import { JournalScreen } from '../ui/JournalScreen';
import { InvoicesPanel, StorePanel } from '../ui/Panels';
import { CART_STEPS, fmt, SALE } from '../config/demo-data';
import { LEDGER_END } from './S3Ledger';

/**
 * SIGNATURE IV → ACT 4. The balanced point is the last point of the sales chart; the camera
 * pulls back into the dashboard, KPIs update from the one sale. The product flips to its
 * dark theme and the dashboard turns out to be one tile of a single continuous workspace
 * plane — POS, invoices, stock, journal, store — seen whole in 2.5D.
 */
const G = 120;
export const PANEL = (c: number, r: number) => ({ x: (2 - c) * (1920 + G), y: r * (1080 + G) });
const D = PANEL(0, 0);
const PLANE = { w: 3 * 1920 + 2 * G, h: 2 * 1080 + G };

const CX: Key[] = [
  [LEDGER_END - 2, D.x + DASH.endBefore.x],
  [506, D.x + DASH.endBefore.x],
  [540, D.x + 960, ease.camera],
  [550, D.x + 960],
  [576, D.x + 333, ease.heavy],
  [606, D.x + 320, ease.linear],
  [652, PANEL(1, 0).x + 560, ease.camera],
  [706, PLANE.w / 2, ease.camera],
  [740, PLANE.w / 2, ease.linear],
];
const CY: Key[] = [
  [LEDGER_END - 2, DASH.endBefore.y],
  [506, DASH.endBefore.y],
  [540, 540, ease.camera],
  [576, 540, ease.heavy],
  [652, 560, ease.camera],
  [706, PLANE.h / 2 - 20, ease.camera],
  [740, PLANE.h / 2 - 40, ease.linear],
];
const CS: Key[] = [
  [LEDGER_END - 2, 7],
  [506, 7],
  [540, 1, ease.camera],
  [550, 1],
  [576, 0.72, ease.heavy],
  [606, 0.7, ease.linear],
  [652, 0.56, ease.camera],
  [706, 0.27, ease.camera],
  [740, 0.28, ease.linear],
];
const RX: Key[] = [[652, 0], [706, 30, ease.camera], [740, 31, ease.linear]];

const Stage: React.FC<{ f: number; t: Theme; all: boolean; dash: DashState; cam: Cam }> = ({ f, t, all, dash, cam }) => {
  const shadowed = cam.s < 0.9;
  const frame = (c: number, r: number, node: React.ReactNode) => {
    const o = PANEL(c, r);
    return (
      <div
        key={`${c}-${r}`}
        style={{
          position: 'absolute',
          left: o.x,
          top: o.y,
          width: 1920,
          height: 1080,
          overflow: 'hidden',
          borderRadius: 18,
          outline: shadowed ? `2px solid ${t.border}` : undefined,
        }}
      >
        {node}
      </div>
    );
  };
  const done = CART_STEPS.length - 1;
  return (
    <Camera cam={cam} width={PLANE.w} height={PLANE.h} perspective={2200}>
      {frame(0, 0, <Dashboard t={t} s={dash} />)}
      {all && (
        <>
          {frame(
            1,
            0,
            <PosScreen
              t={t}
              s={{
                qty: 4,
                lineTotal: fmt(CART_STEPS[done]),
                subtotal: fmt(SALE.subtotal),
                vat: fmt(SALE.vat),
                total: fmt(SALE.total),
                tilePress: 0,
                tileRing: 1,
                payPress: 0,
                payDone: 1,
                cartLineIn: 1,
                payAmount: fmt(SALE.total),
              }}
            />,
          )}
          {frame(2, 0, <InvoicesPanel t={t} />)}
          {frame(0, 1, <InventoryScreen t={t} s={{ sort: 1, minus: 1, balance: 1, cost: 0, hideCost: false, rowFocus: 1 }} />)}
          {frame(1, 1, <JournalScreen t={t} s={{ costDr: true, costCr: true, sale: 1, sums: 1, lock: 1, hideSums: false, dimRest: 0 }} />)}
          {frame(2, 1, <StorePanel t={t} />)}
        </>
      )}
      {void f}
    </Camera>
  );
};

const Headline: React.FC<{ f: number; t: Theme }> = ({ f, t }) => {
  const out = p(f, 604, 618, ease.typeIn);
  const outB = p(f, T.control.collapse - 14, T.control.collapse, ease.typeIn);
  return (
    <div dir="rtl" style={{ position: 'absolute', inset: 0, fontFamily: SANS, color: t.text, pointerEvents: 'none' }}>
      {/* beside the dashboard, in the space the camera opened */}
      <div style={{ position: 'absolute', right: 1920 - 670, top: 372, fontSize: 104, fontWeight: 700, lineHeight: 1, textAlign: 'right' }}>
        <div>
          <Rise t={p(f, T.dashboard.textA, T.dashboard.textA + 16, ease.type)} out={out}>
            كل شيء متصل.
          </Rise>
        </div>
        <div style={{ marginTop: 34, color: t.primary }}>
          <Rise t={p(f, T.dashboard.textB, T.dashboard.textB + 16, ease.type)} out={out}>
            لحظة بلحظة.
          </Rise>
        </div>
      </div>
      {/* over the whole plane */}
      <div style={{ position: 'absolute', right: 150, top: 96, fontSize: 132, fontWeight: 700, lineHeight: 1, display: 'flex', gap: 40, alignItems: 'baseline' }}>
        <Rise t={p(f, T.control.textA, T.control.textA + 18, ease.type)} out={outB}>
          الصورة كاملة.
        </Rise>
        <span style={{ fontWeight: 400, color: t.muted }}>
          <Rise t={p(f, T.control.textB, T.control.textB + 18, ease.type)} out={outB}>
            والقرار <span style={{ color: t.primary, fontWeight: 700 }}>أوضح.</span>
          </Rise>
        </span>
      </div>
    </div>
  );
};

export const S4Control: React.FC<{ f: number }> = ({ f }) => {
  if (f < LEDGER_END || f >= T.control.end) return null;
  const cam: Cam = { x: track(f, CX), y: track(f, CY), s: trackLog(f, CS), rx: track(f, RX) };
  const dash: DashState = {
    rise: p(f, 496, 508, ease.snap),
    chrome: p(f, 506, 534, ease.inOut),
    kpi: p(f, 520, 548, ease.linear),
    row: p(f, 530, 548, ease.linear),
  };
  const edge = lerp(1920, 0, p(f, T.control.flip, T.control.flip + 22, ease.heavy)); // dark takes x > edge
  const ap = p(f, T.control.collapse, T.control.collapse + 20, ease.typeIn);
  const lineY = 690; // = LOCKUP.lineY — the workspace closes onto the brand's baseline
  const showLight = edge > 0;
  const showDark = edge < 1920;
  return (
    <div style={{ position: 'absolute', inset: 0, clipPath: `inset(${lineY * ap}px 0 ${(1080 - lineY) * ap}px 0)` }}>
      {showLight && (
        <div style={{ position: 'absolute', inset: 0, background: light.bg, clipPath: `inset(0 ${1920 - edge}px 0 0)` }}>
          <Stage f={f} t={light} all={false} dash={dash} cam={cam} />
          <Headline f={f} t={light} />
        </div>
      )}
      {showDark && (
        <div style={{ position: 'absolute', inset: 0, background: dark.bg, clipPath: `inset(0 0 0 ${edge}px)` }}>
          <Stage f={f} t={dark} all dash={dash} cam={cam} />
          <Headline f={f} t={dark} />
        </div>
      )}
    </div>
  );
};
