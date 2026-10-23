<?php

namespace Tests\Feature;

use PHPUnit\Framework\AssertionFailedError;
use RuntimeException;
use Throwable;

/**
 * يتوقّع استثناءً من عملية دون أن يبتلع `fail()` نفسه.
 *
 * `AssertionFailedError` في PHPUnit يرث `RuntimeException`، فالنمط
 *   try { op(); $this->fail(); } catch (RuntimeException) { … }
 * يلتقط فشل التأكيد نفسه فيمرّ الاختبار بصمت إن لم يتحقّق شيء في الـcatch. هنا يقع `fail()` خارج أي catch،
 * وإن رمت العملية AssertionFailedError أُعيد رميه، وأي استثناء من صنف غير المتوقَّع يظهر كما هو.
 */
trait CapturesThrowable
{
    /**
     * @template T of Throwable
     *
     * @param  class-string<T>  $class
     * @return T
     */
    protected function thrown(callable $operation, string $failure, string $class = RuntimeException::class): Throwable
    {
        try {
            $operation();
        } catch (Throwable $e) {
            if ($e instanceof AssertionFailedError || ! $e instanceof $class) {
                throw $e;
            }

            return $e;
        }

        $this->fail($failure);
    }
}
