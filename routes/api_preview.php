<?php

use App\Http\Controllers\Api\PreviewExchangeController;
use App\Http\Controllers\Api\PreviewExperienceController;
use App\Http\Middleware\AuthenticatePreviewSession;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Preview API — v1  (MOBILE-PREVIEW-6 / MOBILE-PREVIEW-7)
|--------------------------------------------------------------------------
| Loaded via App\Providers\PreviewApiServiceProvider under prefix
| `preview/v1`, entirely outside `commerce/v1` and `api/v1` — a
| PreviewSession token carries none of their abilities and none of their
| routes accept it (see AuthenticatePreviewSession's own docblock and
| docs/plans/app-builder/MOBILE-PREVIEW-5-SECURITY-ARCHITECTURE.md §2.5/§11).
|
| Security chain: AuthenticatePreviewSession (resolves PreviewSession from
| the bearer, sets TenantContext from the session's own tenant_id, fails
| closed on expired/revoked/malformed/unknown — never a distinguishable
| response) -> throttle:preview-fetch (keyed by the resolved session, once
| authenticated).
*/
Route::middleware([
    AuthenticatePreviewSession::class,
    'throttle:preview-fetch',
])->group(function () {
    Route::get('experience', [PreviewExperienceController::class, 'show'])->name('experience.show');
});

// MOBILE-PREVIEW-7 — device-facing exchange: **no prior authentication at
// all**, since the scanning device holds nothing yet but the one-time
// reference from the QR/deep link. Rate-limited by IP only (no session to
// key on before a successful exchange); PreviewExchangeService::consume()
// itself is the sole source of truth on tenant/app scope — this route
// reads no tenant/app parameter from the request (E6/BOLA, matching
// `experience.show` above).
Route::post('exchange', [PreviewExchangeController::class, 'store'])
    ->middleware('throttle:preview-exchange')
    ->name('exchange.store');
