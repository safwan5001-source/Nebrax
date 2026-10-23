<?php

namespace App\Services;

use App\Contracts\TerminalAdapter;
use App\Models\PosPaymentTerminal;
use App\Models\PosTerminalRequest;
use App\Support\PosTerminalResult;
use Throwable;

/**
 * محوّل جهاز وهمي للاختبار والتطوير المحلي فقط (لا يُحلّ خارج local/testing). لا شبكة ولا جهاز: نتائجه مبرمجة بمعرّف الطلب.
 * الافتراضي: `start` ⇒ pending؛ `fetch` ⇒ النتيجة المبرمجة وإلا pending؛ `void` ⇒ voided ما لم يُبرمج فشل.
 */
final class FakePosTerminalAdapter implements TerminalAdapter
{
    public const PROVIDER = 'fake';

    /** @var array<string, PosTerminalResult> */
    private array $scripted = [];

    /** @var array<string, int> */
    public array $calls = ['start' => 0, 'fetch' => 0, 'cancel' => 0, 'void' => 0];

    /** @var list<string> معرّفات الطلبات التي أُلغيت موافقتها */
    public array $voided = [];

    private ?Throwable $voidFailure = null;

    private ?Throwable $startFailure = null;

    private ?Throwable $cancelFailure = null;

    /** @var (\Closure(PosTerminalRequest): void)|null يُستدعى أثناء `fetch` (قبل الرد) لمحاكاة عملية أخرى تتزامن مع نداء بطيء */
    public ?\Closure $duringFetch = null;

    /** @var (\Closure(PosTerminalRequest): void)|null يُستدعى أثناء `void` (قبل الرد) */
    public ?\Closure $duringVoid = null;

    /** رفض صريح من المزوّد للإلغاء (نتيجة قاطعة) بخلاف الاستثناء الذي هو نتيجة غامضة */
    public bool $rejectVoid = false;

    public function provider(): string
    {
        return self::PROVIDER;
    }

    public function start(PosPaymentTerminal $terminal, PosTerminalRequest $request): PosTerminalResult
    {
        $this->calls['start']++;
        if ($this->startFailure !== null) {
            throw $this->startFailure;
        }

        return $this->scripted[$request->id] ?? new PosTerminalResult(PosTerminalResult::PENDING, 'fake_term_'.$request->id);
    }

    public function fetch(PosPaymentTerminal $terminal, PosTerminalRequest $request): PosTerminalResult
    {
        $this->calls['fetch']++;
        if ($this->duringFetch !== null) {
            ($this->duringFetch)($request);
        }

        return $this->scripted[$request->id] ?? new PosTerminalResult(PosTerminalResult::PENDING, 'fake_term_'.$request->id);
    }

    public function cancel(PosPaymentTerminal $terminal, PosTerminalRequest $request): PosTerminalResult
    {
        $this->calls['cancel']++;
        if ($this->cancelFailure !== null) {
            throw $this->cancelFailure;
        }
        $this->scripted[$request->id] = new PosTerminalResult(PosTerminalResult::CANCELLED, 'fake_term_'.$request->id);

        return $this->scripted[$request->id];
    }

    public function void(PosPaymentTerminal $terminal, PosTerminalRequest $request): PosTerminalResult
    {
        $this->calls['void']++;
        if ($this->duringVoid !== null) {
            ($this->duringVoid)($request);
        }
        if ($this->voidFailure !== null) {
            throw $this->voidFailure;
        }
        if ($this->rejectVoid) {
            return new PosTerminalResult(PosTerminalResult::ERROR, 'fake_term_'.$request->id, failureCode: 'void_rejected');
        }
        $this->voided[] = $request->id;
        $this->scripted[$request->id] = new PosTerminalResult(PosTerminalResult::VOIDED, 'fake_term_'.$request->id);

        return $this->scripted[$request->id];
    }

    /** يبرمج ما سيعيده الجهاز لهذا الطلب (آخر برمجة تغلب). */
    public function script(string $requestId, string $status, ?int $amountMinor = null, ?string $failureCode = null): void
    {
        $approved = $status === PosTerminalResult::APPROVED;
        $this->scripted[$requestId] = new PosTerminalResult(
            $status,
            'fake_term_'.$requestId,
            $approved ? 'AP'.substr(md5($requestId), 0, 6) : null,
            $approved ? '4'.substr(preg_replace('/\D/', '', md5($requestId)).'000000000000', 0, 11) : null,
            $approved ? '4242' : null,
            $amountMinor,
            $failureCode,
        );
    }

    public function failVoidWith(?Throwable $failure): void
    {
        $this->voidFailure = $failure;
    }

    public function failCancelWith(?Throwable $failure): void
    {
        $this->cancelFailure = $failure;
    }

    public function failStartWith(?Throwable $failure): void
    {
        $this->startFailure = $failure;
    }
}
