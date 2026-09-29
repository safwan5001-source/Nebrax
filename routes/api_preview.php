<?php

use App\Http\Controllers\Api\PreviewExperienceController;
use App\Http\Middleware\AuthenticatePreviewSession;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Preview API — v1  (MOBILE-PREVIEW-6)
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
