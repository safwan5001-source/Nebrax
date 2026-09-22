<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * (Codex, PR #924, P2, fifth round) The *only* exception `resolveCurrent()`'s
 * merge loop may treat as "drop this line, keep merging" — thrown
 * exclusively by `purchasable()`'s own eligibility checks (inactive
 * product, unpublished listing, no resolved price). Distinguishing this
 * from a plain `RuntimeException` matters because `add()`'s own return
 * value calls `serialize()` internally, which can throw a plain
 * `RuntimeException` from `safeMultiply()`/`safeAdd()` for a *different*,
 * already-in-the-cart line's live price becoming unrepresentable — that
 * failure has nothing to do with the line being merged and must abort the
 * whole merge, never be silently swallowed as "not purchasable".
 */
final class CommerceCartLineNotPurchasableException extends RuntimeException {}
