import '../actions/actions.dart';
import '../schema/schema.dart';

/// A Preview-only, honest classification of what happened to a dispatched
/// action — never a silent success and never a fabricated one
/// (MOBILE-PREVIEW-6 item 4/5: "no live cart/order/account features";
/// mirrors the Browser Preview classifier's `navigate-unsupported`/
/// `requires-live-data` outcomes from MOBILE-PREVIEW-4's
/// `action-semantics.ts`, now applied to the *actual* native dispatch path
/// instead of a web port of it).
enum PreviewActionNotice {
  /// A well-formed `navigate` target the real shipped runtime does not wire
  /// up (`RuntimeActionHandler.onNavigate`'s own narrow `home`/`cart`
  /// switch) — never invented as a richer preview-only navigation truth.
  navigateUnsupported,

  /// `openProduct`/`addToCart`/`updateCartQuantity`/`removeCartItem` — every
  /// one of them either fetches or mutates live commerce data on the real
  /// runtime, and `PreviewSession` structurally cannot reach `commerce/v1`
  /// at all (§9's data-access matrix: cart mutations, live catalog data
  /// = never).
  requiresLiveData,
}

/// The real [ActionHandler] for Preview mode — reuses the exact same
/// [AppActionDispatcher]/[decodeAction] pipeline every schema-driven tap in
/// the shipped app already goes through (`action_dispatcher.dart`), so a
/// malformed/unknown action is already a safe no-op before this class is
/// ever reached.
///
/// **Not** a second, richer runtime: `onNavigate` reuses the shipped
/// [RuntimeActionHandler]'s own narrow `home`/`cart` allowlist verbatim
/// (`app/runtime_action_handler.dart`) rather than letting Preview navigate
/// to any page merely because the Draft schema declares one — a Draft that
/// does would be no more navigable on a real device today, and Preview must
/// not claim otherwise (MOBILE-PREVIEW-4 report §2's own reasoning, applied
/// here to the native runtime instead of Browser Preview).
class PreviewActionHandler implements ActionHandler {
  final RenderableExperience experience;
  final void Function(String pageId) onPageChange;
  final void Function(PreviewActionNotice notice) onNotice;
  final Future<void> Function() onRefreshRequested;

  PreviewActionHandler({
    required this.experience,
    required this.onPageChange,
    required this.onNotice,
    required this.onRefreshRequested,
  });

  static const _supportedPageIds = {'home', 'cart'};

  @override
  Future<void> onNavigate(NavigateAction action) async {
    if (_supportedPageIds.contains(action.pageId) && experience.pages.containsKey(action.pageId)) {
      onPageChange(action.pageId);
      return;
    }
    onNotice(PreviewActionNotice.navigateUnsupported);
  }

  @override
  Future<void> onOpenProduct(OpenProductAction action) async {
    onNotice(PreviewActionNotice.requiresLiveData);
  }

  @override
  Future<void> onAddToCart(AddToCartAction action) async {
    onNotice(PreviewActionNotice.requiresLiveData);
  }

  @override
  Future<void> onUpdateCartQuantity(UpdateCartQuantityAction action) async {
    onNotice(PreviewActionNotice.requiresLiveData);
  }

  @override
  Future<void> onRemoveCartItem(RemoveCartItemAction action) async {
    onNotice(PreviewActionNotice.requiresLiveData);
  }

  /// A live re-fetch of the bound (still immutable) snapshot — always safe:
  /// it can only ever return the same content or a newly regenerated
  /// session's content, never a mutation (§5.8 — reusable within TTL).
  @override
  Future<void> onRefresh(RefreshAction action) async {
    await onRefreshRequested();
  }
}
