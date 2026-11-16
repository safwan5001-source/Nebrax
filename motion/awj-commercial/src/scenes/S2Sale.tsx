import React from 'react';
import { light } from '../config/theme';
import { CART_STEPS, SALE, fmt } from '../config/demo-data';
import { T } from '../config/timeline';
import { ease, lerp, p, track, velocity, Key } from '../lib/motion';
import { Camera, Cam, project, unproject } from '../primitives/Camera';
import { Carrier, lerpPt } from '../primitives/Carrier';
import { DirBlur } from '../primitives/Mask';
import { RollingNumber, steppedRoll } from '../primitives/RollingNumber';
import { POS, PosScreen } from '../ui/PosScreen';
import { DocMorph, QTY_CELL, totalAnchor } from '../ui/DocMorph';

/**
 * ACT 2 → SIGNATURE I. One sale: POS tap × 4 → pay → the receipt prints →
 * the receipt *becomes* the tax invoice → the camera whips to the quantity and dives in.
 * The grand total is a single carried element from the POS cart to the invoice.
 */
export const SALE_CUT = 343;

const t = light;
const bump = (d: number) => (d < 0 ? 0 : d < 3 ? d / 3 : d < 12 ? 1 - (d - 3) / 9 : 0);

const POS_X: Key[] = [[84, POS.cartLine.x], [96, POS.cartLine.x], [128, 960, ease.camera], [172, 640, ease.heavy], [214, 600, ease.heavy]];
const POS_Y: Key[] = [[84, POS.cartLine.y], [96, POS.cartLine.y], [128, 540, ease.camera], [172, 650, ease.heavy], [214, 700, ease.heavy]];
const POS_S: Key[] = [[84, 2.6], [96, 2.6], [128, 1, ease.camera], [172, 1.2, ease.heavy], [214, 1.3, ease.heavy]];

const DOC_X: Key[] = [[186, 960], [282, 960], [294, 720, ease.heavy], [310, QTY_CELL.x, ease.camera], [343, QTY_CELL.x]];
const DOC_Y: Key[] = [[186, 560], [238, 540, ease.heavy], [282, 540, ease.heavy], [294, 700, ease.heavy], [310, QTY_CELL.y, ease.camera], [343, QTY_CELL.y]];
const DOC_S: Key[] = [[186, 1.2], [238, 1.38, ease.heavy], [282, 1, ease.heavy], [294, 1.3, ease.heavy], [310, 2.1, ease.camera], [318, 2.2, ease.linear], [343, 36, ease.cameraIn]];

export const S2Sale: React.FC<{ f: number }> = ({ f }) => {
  if (f < T.hook.collapse + 4 || f >= SALE_CUT) return null;

  // ——— POS ———
  const posCam: Cam = { x: track(f, POS_X), y: track(f, POS_Y), s: track(f, POS_S) };
  const taps = T.pos.taps;
  const qty = 1 + taps.filter((tp) => f >= tp + 3).length;
  const press = Math.max(...taps.map((tp) => bump(f - tp)), bump(f - 100) * 0.7);
  const cart = CART_STEPS.map(fmt);
  const net = CART_STEPS.map((g, i) => [27174, 54348, 81522, 108696][i]).map(fmt);
  const vat = CART_STEPS.map((g, i) => g - [27174, 54348, 81522, 108696][i]).map(fmt);
  const roll = (vals: string[], size: number, weight = 600) => {
    const st = steppedRoll(f, vals, taps.map((tp) => tp + 2), 12);
    return <RollingNumber {...st} style={{ fontSize: size, fontWeight: weight }} />;
  };
  const carried = f >= 186;
  const slitH = f < 86 ? lerp(0, 230, p(f, 76, 86, ease.snap)) : lerp(230, 1080, p(f, 86, 102, ease.heavy));
  const posOpacity = 1 - p(f, 196, 222, ease.inOut);

  // ——— receipt / invoice ———
  const lift = p(f, 188, 216, ease.heavy);
  const m = p(f, T.invoice.morph, T.invoice.settle, ease.heavy);
  const docCam: Cam = { x: track(f, DOC_X), y: track(f, DOC_Y), s: track(f, DOC_S) };
  const vx = velocity(f, DOC_X) * docCam.s;
  const vy = velocity(f, DOC_Y) * docCam.s;
  const liftY = (1 - lift) * 900;

  // carried total: POS (projected) → receipt → invoice
  const k = p(f, 186, 216, ease.camera);
  // the POS total, seen on screen, re-expressed in the document camera's world
  const posPt = unproject(project(POS.totalLeft, posCam), docCam);
  const ta = totalAnchor(m);
  const target = { x: ta.x, y: ta.y + liftY };
  const cPt = lerpPt(posPt, target, k);
  const cSize = lerp((60 * posCam.s) / docCam.s, ta.size, k);

  return (
    <div style={{ position: 'absolute', inset: 0, clipPath: `inset(${(1080 - slitH) / 2}px 0 ${(1080 - slitH) / 2}px 0)`, background: t.bg }}>
      {posOpacity > 0 && (
        <div style={{ position: 'absolute', inset: 0, opacity: posOpacity }}>
          <Camera cam={posCam} width={1920} height={1080}>
            <PosScreen
              t={t}
              s={{
                qty,
                lineTotal: roll(cart, 20),
                subtotal: roll(net, 17, 500),
                vat: roll(vat, 17, 500),
                total: carried ? <span style={{ opacity: 0 }}>{fmt(SALE.total)}</span> : roll(cart, 60),
                tilePress: press,
                tileRing: p(f, 100, 108, ease.snap),
                payPress: bump(f - T.pos.pay),
                payDone: p(f, T.pos.confirm - 4, T.pos.confirm + 8, ease.snap),
                cartLineIn: 1,
                payAmount: roll(cart, 21),
              }}
            />
          </Camera>
        </div>
      )}

      {f >= 186 && (
        <DirBlur id="doc-whip" x={f >= 294 && f < 312 ? Math.min(18, Math.abs(vx) * 0.07) : 0} y={f >= 294 && f < 312 ? Math.min(18, Math.abs(vy) * 0.07) : 0}>
          <Camera cam={docCam} width={1920} height={1080}>
            <div style={{ position: 'absolute', inset: 0, transform: `translateY(${liftY}px)` }}>
              <DocMorph
                t={t}
                s={{
                  m,
                  print: p(f, 198, 238, ease.linear),
                  lift,
                  qr: p(f, 256, 290, ease.inOut),
                  iso: p(f, 302, 314, ease.inOut),
                  qtyFocus: p(f, 304, 312, ease.snap),
                }}
              />
            </div>
            {/* the carried total lives in the document world once it has landed */}
            <Carrier x={cPt.x} y={cPt.y} size={cSize} text={fmt(SALE.total)} color={t.text} weight={f < 216 ? 600 : 700} opacity={1 - 0.88 * p(f, 302, 314)} />
          </Camera>
        </DirBlur>
      )}
    </div>
  );
};
