<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\PosSessionResource;
use App\Models\PosSession;
use App\Services\Accounting\PosSessionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PosSessionController extends ApiController
{
    public function __construct(protected PosSessionService $sessions) {}

    public function index(): JsonResponse
    {
        return PosSessionResource::collection(PosSession::orderByDesc('opened_at')->get())->response();
    }

    public function open(Request $request): JsonResponse
    {
        $data = $request->validate([
            'opening_balance' => ['required', 'integer', 'min:0'], // هللات
        ]);

        $session = $this->domain(fn () => $this->sessions->open(
            (int) $data['opening_balance'],
            $request->user()?->id,
        ));

        return (new PosSessionResource($session))->response()->setStatusCode(201);
    }

    public function close(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'closing_balance' => ['required', 'integer', 'min:0'], // هللات
        ]);

        $session = PosSession::findOrFail($id);
        $closed = $this->domain(fn () => $this->sessions->close($session, (int) $data['closing_balance']));

        return (new PosSessionResource($closed))->response();
    }
}
