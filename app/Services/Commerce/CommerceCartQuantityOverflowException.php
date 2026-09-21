<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * (Codex, PR #924, P2) `resolveCurrent()`'s merge loop must never treat a
 * quantity-overflow failure the same as "no longer purchasable" — the
 * former is data it must not silently discard, the latter is a stale line
 * safe to drop. Thrown only by `safeQuantityAdd()`/`safeAdd()`, never by
 * `purchasable()`.
 */
final class CommerceCartQuantityOverflowException extends RuntimeException {}
