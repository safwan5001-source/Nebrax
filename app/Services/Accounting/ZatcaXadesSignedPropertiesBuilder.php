<?php

namespace App\Services\Accounting;

use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;
use InvalidArgumentException;
use RuntimeException;

/**
 * يبني SignedProperties لتوقيع XAdES في ZATCA ويحسب بصمتها — REM-17.
 *
 * البنية (الدليل الفني التفصيلي، الخطوة 4، وعيّنات ZATCA الرسمية الثلاث، وXSD الخاص بـ SDK):
 *  • `SigningTime`، ثم `SigningCertificate` (الإصدار 1: XSD الخاص بـ SDK — UBL-XAdESv132 — لا يعرف SigningCertificateV2
 *    ويرفضه) بعنصر `Cert` لكل شهادة في السلسلة (leaf أولاً) يحمل `CertDigest` و`IssuerSerial`.
 *  • `SignaturePolicyIdentifier` و`DataObjectFormat` **باقيان** كما يفرضهما معيار ميزات الأمان v1.2 (§2.3.3،
 *    تعدّد 1). عيّنات SDK لا تحملهما، لكن XSD يقبلهما وبصمة SDK تغطيهما (تعديلهما يُفشل التحقق) ونتيجة SDK
 *    الإجمالية PASSED بوجودهما — فلا يُخفَّف حارس السياسة المغلق.
 *
 * الترميزات (متحقَّقة على العيّنات الرسمية):
 *  • بصمة الشهادة = Base64(hex(SHA-256(نص Base64 للشهادة))) — الخطوة 3.
 *  • X509IssuerName بصيغة Java، وX509SerialNumber عشرياً (ZatcaCertificateFields).
 *  • بصمة SignedProperties = Base64(hex(SHA-256(T))) حيث T هي العنصر نفسه **بمسافاته كما كُتب** مع إعلان
 *    `xmlns:xades` على الجذر و`xmlns:ds` على كل عنصر `ds:` — وهو ما ينتجه مُسلسِل SDK للعقدة. ليست C14N، وهي
 *    حسّاسة للمسافات: لذلك يُكتب العنصر نصاً ثابت التنسيق (تنسيق العيّنات الرسمية) ولا يُعاد تسلسله بعد ذلك.
 */
final class ZatcaXadesSignedPropertiesBuilder
{
    public const XADES_NAMESPACE = 'http://uri.etsi.org/01903/v1.3.2#';
    public const XMLDSIG_NAMESPACE = 'http://www.w3.org/2000/09/xmldsig#';
    public const SHA256_ALGORITHM = 'http://www.w3.org/2001/04/xmlenc#sha256';

    /** إزاحة أبناء SignedProperties في تنسيق العيّنات الرسمية؛ الوسم الختامي عند 32. */
    private const BASE_INDENT = 36;
    private const STEP = 4;

    public function __construct(
        private readonly ZatcaCertificateFields $certificateFields = new ZatcaCertificateFields(),
    ) {}

    /**
     * @param list<string> $certificateChain Base64 DER certificates, leaf first.
     * @return array{xml:string, digest:string} XML للتضمين كما هو، وبصمة SignedProperties الجاهزة لـ SignedInfo.
     */
    public function build(
        array $certificateChain,
        DateTimeInterface $signingTime,
        string $policyIdentifier,
        string $policyDigest,
        string $signedPropertiesId = 'xadesSignedProperties',
        string $dataObjectReference = '#invoiceSignedData',
    ): array {
        $certificates = $this->certificates($certificateChain);
        $this->assertHttpsUrl($policyIdentifier);

        $decodedPolicyDigest = base64_decode($policyDigest, true);
        if ($decodedPolicyDigest === false || strlen($decodedPolicyDigest) !== 32
            || base64_encode($decodedPolicyDigest) !== $policyDigest
        ) {
            throw new InvalidArgumentException('بصمة سياسة توقيع ZATCA يجب أن تكون SHA-256 بترميز Base64.');
        }

        $this->assertXmlId($signedPropertiesId, 'معرّف SignedProperties');
        if (! str_starts_with($dataObjectReference, '#')) {
            throw new InvalidArgumentException('مرجع بيانات الفاتورة يجب أن يبدأ بعلامة #.');
        }
        $this->assertXmlId(substr($dataObjectReference, 1), 'مرجع بيانات الفاتورة');

        $utcTime = DateTimeImmutable::createFromInterface($signingTime)
            ->setTimezone(new DateTimeZone('UTC'))
            ->format('Y-m-d\\TH:i:s\\Z');

        $lines = [[0, '<xades:SignedSignatureProperties>']];
        $lines[] = [1, '<xades:SigningTime>'.$utcTime.'</xades:SigningTime>'];
        $lines[] = [1, '<xades:SigningCertificate>'];
        foreach ($certificates as $certificate) {
            array_push(
                $lines,
                [2, '<xades:Cert>'],
                [3, '<xades:CertDigest>'],
                [4, '<ds:DigestMethod Algorithm="'.self::SHA256_ALGORITHM.'"/>'],
                [4, '<ds:DigestValue>'.$certificate['digest'].'</ds:DigestValue>'],
                [3, '</xades:CertDigest>'],
                [3, '<xades:IssuerSerial>'],
                [4, '<ds:X509IssuerName>'.$certificate['issuer_name'].'</ds:X509IssuerName>'],
                [4, '<ds:X509SerialNumber>'.$certificate['serial_number'].'</ds:X509SerialNumber>'],
                [3, '</xades:IssuerSerial>'],
                [2, '</xades:Cert>'],
            );
        }
        array_push(
            $lines,
            [1, '</xades:SigningCertificate>'],
            [1, '<xades:SignaturePolicyIdentifier>'],
            [2, '<xades:SignaturePolicyId>'],
            [3, '<xades:SigPolicyId>'],
            [4, '<xades:Identifier>'.$policyIdentifier.'</xades:Identifier>'],
            [3, '</xades:SigPolicyId>'],
            [3, '<xades:SigPolicyHash>'],
            [4, '<ds:DigestMethod Algorithm="'.self::SHA256_ALGORITHM.'"/>'],
            [4, '<ds:DigestValue>'.$policyDigest.'</ds:DigestValue>'],
            [3, '</xades:SigPolicyHash>'],
            [2, '</xades:SignaturePolicyId>'],
            [1, '</xades:SignaturePolicyIdentifier>'],
            [0, '</xades:SignedSignatureProperties>'],
            [0, '<xades:SignedDataObjectProperties>'],
            [1, '<xades:DataObjectFormat ObjectReference="'.$dataObjectReference.'">'],
            [2, '<xades:MimeType>text/xml</xades:MimeType>'],
            [1, '</xades:DataObjectFormat>'],
            [0, '</xades:SignedDataObjectProperties>'],
        );

        $xml = '<xades:SignedProperties Id="'.$signedPropertiesId.'">'."\n";
        foreach ($lines as [$depth, $line]) {
            $xml .= str_repeat(' ', self::BASE_INDENT + self::STEP * $depth).$line."\n";
        }
        $xml .= str_repeat(' ', self::BASE_INDENT - self::STEP).'</xades:SignedProperties>';

        return ['xml' => $xml, 'digest' => $this->digest($xml)];
    }

    /**
     * بصمة SignedProperties كما يحسبها SDK من نصّها المضمَّن: Base64(hex(SHA-256(T))).
     * فشل مغلق على أي بنية لا يكون تحويلها إلى T محدَّداً بلا لبس (إعلانات أسماء، كيانات، تعليقات، CR، بادئات أخرى).
     */
    public function digest(string $embeddedXml): string
    {
        if (! str_starts_with($embeddedXml, '<xades:SignedProperties ')
            || ! str_ends_with($embeddedXml, '</xades:SignedProperties>')
            || preg_match('/xmlns|&|\r|\'|<!|<\?/', $embeddedXml) === 1
        ) {
            throw new InvalidArgumentException('SignedProperties المضمّنة ليست بالصيغة المحدّدة لحساب بصمتها.');
        }
        preg_match_all('#</?([^\s/>]+)#', $embeddedXml, $tags);
        foreach ($tags[1] as $tag) {
            if (preg_match('/^(xades|ds):[A-Za-z][A-Za-z0-9]*$/D', $tag) !== 1) {
                throw new InvalidArgumentException('SignedProperties المضمّنة تحتوي عنصراً خارج xades/ds.');
            }
        }

        $standalone = preg_replace(
            '#<ds:([A-Za-z][A-Za-z0-9]*)#',
            '<ds:$1 xmlns:ds="'.self::XMLDSIG_NAMESPACE.'"',
            '<xades:SignedProperties xmlns:xades="'.self::XADES_NAMESPACE.'" '.substr($embeddedXml, strlen('<xades:SignedProperties ')),
        );
        if (! is_string($standalone)) {
            throw new RuntimeException('تعذر حساب بصمة SignedProperties.');
        }

        return base64_encode(hash('sha256', $standalone));
    }

    /**
     * @param list<string> $certificateChain
     * @return list<array{digest:string, issuer_name:string, serial_number:string}>
     */
    private function certificates(array $certificateChain): array
    {
        if ($certificateChain === [] || ! array_is_list($certificateChain)) {
            throw new InvalidArgumentException('سلسلة شهادات ZATCA يجب أن تكون قائمة غير فارغة.');
        }

        return array_map(function ($certificate, $index): array {
            if (! is_string($certificate) || $certificate === '') {
                throw new InvalidArgumentException('شهادة ZATCA في السلسلة غير صالحة.');
            }

            $der = base64_decode($certificate, true);
            if ($der === false || $der === '') {
                throw new InvalidArgumentException('شهادة ZATCA يجب أن تكون DER بترميز Base64 صالح.');
            }

            $pem = "-----BEGIN CERTIFICATE-----\n"
                .chunk_split(base64_encode($der), 64, "\n")
                ."-----END CERTIFICATE-----\n";

            $parsedCertificate = @openssl_x509_read($pem);
            if ($parsedCertificate === false) {
                throw new InvalidArgumentException(
                    'شهادة ZATCA رقم '.($index + 1).' ليست شهادة X.509 صالحة.'
                );
            }

            $normalizedPem = '';
            if (! openssl_x509_export($parsedCertificate, $normalizedPem, true)) {
                throw new InvalidArgumentException(
                    'تعذر تطبيع شهادة ZATCA رقم '.($index + 1).'.'
                );
            }

            $normalizedBody = preg_replace(
                '/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\\s+/',
                '',
                $normalizedPem
            );
            $normalizedDer = is_string($normalizedBody)
                ? base64_decode($normalizedBody, true)
                : false;

            if (! is_string($normalizedDer) || ! hash_equals($normalizedDer, $der)) {
                throw new InvalidArgumentException(
                    'شهادة ZATCA رقم '.($index + 1).' تحتوي بيانات خارج DER.'
                );
            }

            $fields = $this->certificateFields->extract($normalizedDer);

            return [
                'digest' => base64_encode(hash('sha256', base64_encode($normalizedDer))),
                'issuer_name' => $fields['issuer_name'],
                'serial_number' => $fields['serial_number'],
            ];
        }, $certificateChain, array_keys($certificateChain));
    }

    private function assertHttpsUrl(string $value): void
    {
        $parts = parse_url($value);
        if (
            filter_var($value, FILTER_VALIDATE_URL) === false
            || ! is_array($parts)
            || strtolower((string) ($parts['scheme'] ?? '')) !== 'https'
            || ($parts['host'] ?? '') === ''
        ) {
            throw new InvalidArgumentException('معرّف سياسة توقيع ZATCA يجب أن يكون رابط HTTPS مطلقاً.');
        }
        // يُكتب نصاً حرفياً داخل SignedProperties المحسوبة بصمتها على نصّها؛ لا تهريب ولا مسافات.
        if (strpbrk($value, "&<>\"' \t\r\n") !== false) {
            throw new InvalidArgumentException('معرّف سياسة توقيع ZATCA يحتوي محارف تتطلب تهريباً في XML.');
        }
    }

    private function assertXmlId(string $value, string $label): void
    {
        if (preg_match('/^[A-Za-z_][A-Za-z0-9._-]*$/D', $value) !== 1) {
            throw new InvalidArgumentException("{$label} ليس XML ID صالحاً.");
        }
    }
}
