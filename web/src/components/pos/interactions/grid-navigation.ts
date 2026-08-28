export type GridDirection = 'up' | 'down' | 'left' | 'right';

export interface GridRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function center(rect: GridRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** يقدّر ما إذا كان عنصران على صف واحد تقريباً. */
function sameRow(a: GridRect, b: GridRect): boolean {
  const tolerance = Math.min(a.height, b.height) * 0.6;
  return Math.abs(center(a).y - center(b).y) <= tolerance;
}

/**
 * يبحث الجار الهندسي التالي في شبكة responsive بلا عدّ أعمدة ثابت.
 * الاتجاه الأفقي يُعكس في RTL: «يمين» بصرياً = index أعلى في RTL.
 */
export function findGridNeighborIndex(
  rects: GridRect[],
  currentIndex: number,
  direction: GridDirection,
  rtl: boolean,
): number | null {
  if (currentIndex < 0 || currentIndex >= rects.length || rects.length === 0) return null;
  const current = rects[currentIndex];
  const currentCenter = center(current);
  let bestIndex: number | null = null;
  let bestScore = Infinity;

  for (let index = 0; index < rects.length; index += 1) {
    if (index === currentIndex) continue;
    const candidate = rects[index];
    const candidateCenter = center(candidate);
    const dx = candidateCenter.x - currentCenter.x;
    const dy = candidateCenter.y - currentCenter.y;

    let matches = false;
    if (direction === 'down') matches = dy > current.height * 0.25;
    if (direction === 'up') matches = dy < -current.height * 0.25;
    if (direction === 'right') {
      const visualRight = rtl ? dx < 0 : dx > 0;
      matches = visualRight && sameRow(current, candidate);
    }
    if (direction === 'left') {
      const visualLeft = rtl ? dx > 0 : dx < 0;
      matches = visualLeft && sameRow(current, candidate);
    }
    if (!matches) continue;

    const primary = direction === 'up' || direction === 'down' ? Math.abs(dy) : Math.abs(dx);
    const secondary = direction === 'up' || direction === 'down' ? Math.abs(dx) : Math.abs(dy);
    const score = primary * 1000 + secondary;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

/** هل العنصر الحالي على حافة الشبكة في الاتجاه الأفقي (لا جار أفقي). */
export function isHorizontalGridEdge(
  rects: GridRect[],
  currentIndex: number,
  direction: 'left' | 'right',
  rtl: boolean,
): boolean {
  return findGridNeighborIndex(rects, currentIndex, direction, rtl) === null;
}
