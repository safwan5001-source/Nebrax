import React from 'react';
import { light } from '../config/theme';
import { SALE, fmt } from '../config/demo-data';
import { ease, lerp, p, track, trackLog, Key } from '../lib/motion';
import { Camera, Cam, project } from '../primitives/Camera';
import { Carrier, lerpPt } from '../primitives/Carrier';
import { INV, InventoryScreen } from '../ui/InventoryScreen';
import { JR, JournalScreen, MONO_W } from '../ui/JournalScreen';
import { SALE_CUT } from './S2Sale';

/**
 * SIGNATURE II + III. Out of the quantity cell: the stock movement (−4, 128 → 124,
 * cost 720.00). The cost value drags a wipe into the journal, splits into debit and
 * credit, the sale entry snaps in, both totals roll to 1,250.00 and lock — then the
 * balanced amount collapses into a single point.
 */
export const LEDGER_END = 496;
const t = light;

const INV_X: Key[] = [[SALE_CUT, INV.outCell.x + 6], [376, 960, ease.cameraOut], [398, 820, ease.heavy]];
const INV_Y: Key[] = [[SALE_CUT, INV.outCell.y], [376, 560, ease.cameraOut], [398, 600, ease.heavy]];
const INV_S: Key[] = [[SALE_CUT, 37.4], [376, 1, ease.cameraOut], [398, 1.12, ease.heavy]];

const JR_X: Key[] = [[398, 960], [466, 960], [492, JR.mid.x + 60, ease.camera]];
const JR_Y: Key[] = [[398, 540], [466, 540], [492, JR.mid.y, ease.camera]];
const JR_S: Key[] = [[398, 1], [466, 1], [492, 1.5, ease.camera]];

export const S3Ledger: React.FC<{ f: number }> = ({ f }) => {
  if (f < SALE_CUT || f >= LEDGER_END) return null;
  const invCam: Cam = { x: track(f, INV_X), y: track(f, INV_Y), s: trackLog(f, INV_S) };
  const jrCam: Cam = { x: track(f, JR_X), y: track(f, JR_Y), s: track(f, JR_S) };

  // 720.00: inventory cost cell → journal cost debit
  const k = p(f, 398, 420, ease.camera);
  const from = project({ x: INV.costLeft.x, y: INV.costLeft.y }, invCam);
  const to = project(JR.costDebit, jrCam);
  const cPt = lerpPt(from, to, k);
  const cSize = lerp(18 * invCam.s, 20 * jrCam.s, k);
  const edge = f < 398 ? 0 : f < 420 ? cPt.x + cSize * MONO_W * 6 + 40 : lerp(to.x + 20 * MONO_W * 6 + 40, 1920, p(f, 420, 434, ease.snap));

  // split copy: debit → credit
  const kc = p(f, 420, 432, ease.snap);
  const crPt = lerpPt(to, project(JR.costCredit, jrCam), kc);

  // merge: Σ debit and Σ credit meet at the centre, then become one point
  const km = p(f, 474, 488, ease.camera);
  const kd = p(f, 486, 495, ease.typeIn);
  const mergeSize = lerp(26 * jrCam.s, 46, km) * (1 - kd);
  const mw = fmt(SALE.total).length * MONO_W * mergeSize;
  const centre = { x: 960 - mw / 2, y: 540 };
  const dPt = lerpPt(project(JR.sumDebit, jrCam), centre, km);
  const cr2 = lerpPt(project(JR.sumCredit, jrCam), centre, km);

  return (
    <div style={{ position: 'absolute', inset: 0, background: t.bg }}>
      {f < 434 && (
        <Camera cam={invCam} width={1920} height={1080}>
          <InventoryScreen
            t={t}
            s={{
              sort: p(f, 348, 384, ease.linear),
              minus: p(f, 346, 356, ease.snap),
              balance: p(f, 366, 388, ease.inOut),
              cost: p(f, 384, 394, ease.snap),
              hideCost: f >= 398,
              rowFocus: 1,
            }}
          />
        </Camera>
      )}
      {f >= 398 && (
        <div style={{ position: 'absolute', inset: 0, clipPath: `inset(0 ${Math.max(0, 1920 - edge)}px 0 0)` }}>
          <Camera cam={jrCam} width={1920} height={1080}>
            <JournalScreen
              t={t}
              s={{
                costDr: f >= 420,
                costCr: f >= 432,
                sale: p(f, 426, 448, ease.linear),
                sums: p(f, 444, 462, ease.inOut),
                lock: p(f, 462, 472, ease.linear),
                hideSums: f >= 474,
                dimRest: p(f, 470, 488, ease.inOut),
              }}
            />
          </Camera>
          {f < 434 && <div style={{ position: 'absolute', left: edge - 1, top: 0, width: 1, height: 1080, background: t.border }} />}
        </div>
      )}
      {f >= 398 && f < 420 && <Carrier x={cPt.x} y={cPt.y} size={cSize} text={fmt(SALE.cost)} color={t.text} />}
      {f >= 420 && f < 432 && <Carrier x={crPt.x} y={crPt.y} size={20 * jrCam.s} text={fmt(SALE.cost)} color={t.text} />}
      {f >= 474 && mergeSize > 0.5 && (
        <>
          <Carrier x={cr2.x} y={cr2.y} size={mergeSize} text={fmt(SALE.total)} color={t.text} weight={700} opacity={1 - km} />
          <Carrier x={dPt.x} y={dPt.y} size={mergeSize} text={fmt(SALE.total)} color={km > 0.9 ? t.primary : t.text} weight={700} />
        </>
      )}
      {f >= 486 && (
        <div style={{ position: 'absolute', left: 960 - 42 * kd, top: 540 - 42 * kd, width: 84 * kd, height: 84 * kd, borderRadius: 999, background: t.primary }} />
      )}
    </div>
  );
};
