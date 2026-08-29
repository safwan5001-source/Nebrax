import type { PosInputModality } from '@/components/pos/interactions/pos-input-modality';

/**
 * سياسة أسلوب التفاعل في نقطة البيع — مصدر حقيقة واحد للقراءة من
 * `sales_config.pos.interaction_mode`. لا حالة سلة ولا أثر مالي.
 */

export const POS_INTERACTION_MODES = ['AUTO', 'TOUCH', 'KEYBOARD_MOUSE', 'HYBRID'] as const;

export type PosInteractionMode = (typeof POS_INTERACTION_MODES)[number];

export type PosInteractionViewport = 'phone' | 'tablet' | 'desktop';

export interface PosInteractionPolicyContext {
  viewport: PosInteractionViewport;
  lastModality: PosInputModality;
}

export interface PosInteractionPolicy {
  allowKeyboardPowerMode: boolean;
  preferTouchTargets: boolean;
  adaptiveModality: boolean;
  showShortcutHints: boolean;
  restoreKeyboardFocus: boolean;
  /** الماسح لا يُعطَّل بسبب النمط — البوابة تبقى خطوة البيع وغياب الحوار. */
  scannerEnabled: true;
}

const MODE_SET = new Set<string>(POS_INTERACTION_MODES);

/** قيمة غائبة أو قديمة أو غير صالحة → AUTO حتى لا ينكسر مستأجر قائم. */
export function parsePosInteractionMode(raw: unknown): PosInteractionMode {
  return typeof raw === 'string' && MODE_SET.has(raw) ? (raw as PosInteractionMode) : 'AUTO';
}

/** كسور PR-6 نفسها: md = 768، lg = 1024. لا نغيّر تخطيط القشرة. */
export function posInteractionViewport(width: number): PosInteractionViewport {
  if (width >= 1024) return 'desktop';
  if (width >= 768) return 'tablet';
  return 'phone';
}

export function posInteractionViewportFromMedia(minLg: boolean, minMd: boolean): PosInteractionViewport {
  if (minLg) return 'desktop';
  if (minMd) return 'tablet';
  return 'phone';
}

/**
 * يوجّه الطبقة التكيفية الحالية. AUTO يحترم عرض PR-6 (الهاتف يميل للمس).
 * HYBRID يتبع آخر وسيط إدخال حتى على العروض الضيقة.
 */
export function resolvePosInteractionPolicy(
  mode: PosInteractionMode,
  ctx: PosInteractionPolicyContext,
): PosInteractionPolicy {
  const isDesktop = ctx.viewport === 'desktop';
  const lastIsKeyboard = ctx.lastModality === 'keyboard';

  switch (mode) {
    case 'TOUCH':
      return {
        allowKeyboardPowerMode: false,
        preferTouchTargets: true,
        adaptiveModality: false,
        showShortcutHints: false,
        restoreKeyboardFocus: false,
        scannerEnabled: true,
      };
    case 'KEYBOARD_MOUSE':
      return {
        allowKeyboardPowerMode: lastIsKeyboard,
        preferTouchTargets: !isDesktop,
        adaptiveModality: false,
        showShortcutHints: isDesktop,
        restoreKeyboardFocus: lastIsKeyboard,
        scannerEnabled: true,
      };
    case 'HYBRID':
      return {
        allowKeyboardPowerMode: lastIsKeyboard,
        preferTouchTargets: !isDesktop,
        adaptiveModality: true,
        showShortcutHints: isDesktop,
        restoreKeyboardFocus: lastIsKeyboard,
        scannerEnabled: true,
      };
    case 'AUTO':
    default:
      return {
        allowKeyboardPowerMode: isDesktop && lastIsKeyboard,
        preferTouchTargets: !isDesktop,
        adaptiveModality: true,
        showShortcutHints: isDesktop,
        restoreKeyboardFocus: isDesktop && lastIsKeyboard,
        scannerEnabled: true,
      };
  }
}
