import type { AppSchemaActionRef } from '@/lib/app-builder';

/**
 * MOBILE-PREVIEW-4 — literal TypeScript port of `mobile/lib/actions/app_action.dart`'s
 * `decodeAction`. Both sides must decode the exact same `ActionRef`/`AppSchemaActionRef` to the
 * exact same typed result (or `null`) — enforced by the shared conformance fixture
 * `contracts/app-builder/action-navigation-conformance.v1.json` (see `action-semantics.test.ts`
 * and `mobile/test/actions/action_navigation_conformance_test.dart`).
 *
 * Like the Dart original, this never throws: a well-formed-but-nonsensical action reference
 * (e.g. `{"type":"addToCart","params":{}}`, missing `productId`) decodes to `null`, exactly as a
 * malformed action safely does nothing on the real runtime instead of crashing a tap handler.
 */
export type DecodedAppAction =
  | { kind: 'NavigateAction'; pageId: string }
  | { kind: 'OpenProductAction'; productId: string }
  | { kind: 'AddToCartAction'; productId: string; variantId: string | null; quantity: number }
  | { kind: 'UpdateCartQuantityAction'; cartItemId: string; quantity: number }
  | { kind: 'RemoveCartItemAction'; cartItemId: string }
  | { kind: 'RefreshAction' };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function decodeAppAction(ref: AppSchemaActionRef): DecodedAppAction | null {
  const params = ref.params ?? {};

  switch (ref.type) {
    case 'navigate': {
      const pageId = params.pageId;
      if (!isNonEmptyString(pageId)) return null;
      return { kind: 'NavigateAction', pageId };
    }

    case 'openProduct': {
      const productId = params.productId;
      if (!isNonEmptyString(productId)) return null;
      return { kind: 'OpenProductAction', productId };
    }

    case 'addToCart': {
      const productId = params.productId;
      if (!isNonEmptyString(productId)) return null;
      const variantIdRaw = params.variantId;
      if (variantIdRaw != null && typeof variantIdRaw !== 'string') return null;
      const quantityRaw = params.quantity;
      let quantity: number;
      if (quantityRaw == null) {
        quantity = 1;
      } else if (isPositiveInt(quantityRaw)) {
        quantity = quantityRaw;
      } else {
        return null;
      }
      return {
        kind: 'AddToCartAction',
        productId,
        variantId: typeof variantIdRaw === 'string' ? variantIdRaw : null,
        quantity,
      };
    }

    case 'updateCartQuantity': {
      const cartItemId = params.cartItemId;
      const quantityRaw = params.quantity;
      if (!isNonEmptyString(cartItemId)) return null;
      if (typeof quantityRaw !== 'number' || !Number.isInteger(quantityRaw) || quantityRaw < 0) return null;
      return { kind: 'UpdateCartQuantityAction', cartItemId, quantity: quantityRaw };
    }

    case 'removeCartItem': {
      const cartItemId = params.cartItemId;
      if (!isNonEmptyString(cartItemId)) return null;
      return { kind: 'RemoveCartItemAction', cartItemId };
    }

    case 'refresh':
      return { kind: 'RefreshAction' };

    default:
      return null;
  }
}

/**
 * The runtime's exact, real navigation-target allowlist — mirrors
 * `RuntimeActionHandler.onNavigate`'s literal `switch (action.pageId)` in
 * `mobile/lib/app/runtime_action_handler.dart`, which has cases for exactly `'home'` and
 * `'cart'` and a `default: break` for anything else ("an unrecognized pageId is a
 * schema-authoring mistake, not a runtime crash"). This is NOT a Browser Preview limitation to
 * work around — it is what the shipped app actually does today. Widening it here would make
 * Browser Preview a second, richer navigation truth than the runtime it is supposed to mirror.
 */
const RUNTIME_SUPPORTED_NAVIGATE_PAGE_IDS = new Set(['home', 'cart']);

/**
 * Browser-Preview-only classification of a decoded action's outcome. This has no Flutter
 * counterpart — the real runtime never "classifies" an action, it just dispatches it for real.
 * Preview cannot do that safely (no live commerce/auth, per the Horizon's hard boundaries), so
 * this says, for each decoded action, which of four honest things Preview should do instead of
 * either faking success or staying uselessly silent:
 *
 * - `navigate` — the runtime really does switch screens for this exact pageId; Preview may too.
 * - `navigate-unsupported` — a well-formed navigate target the runtime itself does not wire up;
 *   Preview must say so, not invent a generic page router the app doesn't have.
 * - `requires-live-data` — the action needs a real network/commerce call (`openProduct`'s
 *   destination screen fetch, or any cart mutation); Preview must say it is unavailable, never
 *   simulate a fake success.
 * - `safe-noop` — `refresh` has no live effect to simulate (mirrors the real handler, which only
 *   bumps a local counter and never touches the network — see
 *   `mobile/test/app/runtime_action_handler_test.dart`), so doing nothing here is itself honest.
 * - `inert` — `decodeAppAction` returned `null` (malformed params or an unknown type); the real
 *   dispatcher also does nothing in this case, so Preview matches it exactly.
 */
export type PreviewActionOutcome =
  | { kind: 'navigate'; pageId: 'home' | 'cart' }
  | { kind: 'navigate-unsupported'; pageId: string }
  | { kind: 'requires-live-data'; actionType: 'openProduct' | 'addToCart' | 'updateCartQuantity' | 'removeCartItem' }
  | { kind: 'safe-noop' }
  | { kind: 'inert' };

export function resolvePreviewActionOutcome(ref: AppSchemaActionRef): PreviewActionOutcome {
  const decoded = decodeAppAction(ref);
  if (!decoded) return { kind: 'inert' };

  switch (decoded.kind) {
    case 'NavigateAction':
      return RUNTIME_SUPPORTED_NAVIGATE_PAGE_IDS.has(decoded.pageId)
        ? { kind: 'navigate', pageId: decoded.pageId as 'home' | 'cart' }
        : { kind: 'navigate-unsupported', pageId: decoded.pageId };
    case 'OpenProductAction':
      return { kind: 'requires-live-data', actionType: 'openProduct' };
    case 'AddToCartAction':
      return { kind: 'requires-live-data', actionType: 'addToCart' };
    case 'UpdateCartQuantityAction':
      return { kind: 'requires-live-data', actionType: 'updateCartQuantity' };
    case 'RemoveCartItemAction':
      return { kind: 'requires-live-data', actionType: 'removeCartItem' };
    case 'RefreshAction':
      return { kind: 'safe-noop' };
  }
}
