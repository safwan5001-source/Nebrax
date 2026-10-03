/** 15.00 s · 60 fps · 900 frames. All beats are absolute frames of the master. */
export const FPS = 60;
export const DURATION = 900;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const T = {
  hook: { start: 0, textA: 10, align: 40, textB: 58, collapse: 72, doors: 84, end: 98 },
  pos: { start: 84, pullBack: 96, taps: [118, 134, 150] as const, pushIn: 128, pay: 172, confirm: 180, recede: 190, end: 250 },
  receipt: { start: 188, print: 198, end: 300 },
  invoice: { morph: 238, settle: 282, whip: 292, isolate: 312, dive: 320, end: 344 },
  inventory: { start: 340, reorder: 352, balance: 366, cost: 384, end: 424 },
  journal: { wipe: 398, land: 418, sale: 426, sums: 444, lock: 462, merge: 474, dot: 490, end: 506 },
  dashboard: { start: 494, pullBack: 496, kpi: 522, row: 530, shift: 548, textA: 552, textB: 572, end: 612 },
  control: { flip: 586, track: 600, pullOut: 650, textA: 664, textB: 690, collapse: 736, end: 772 },
  brand: { start: 736, line: 740, retract: 764, word: 780, latin: 816, tag: 836, end: 900 },
} as const;
