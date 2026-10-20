<?php

namespace Tests\Feature;

use App\Services\Accounting\ZatcaInvoiceHasher;
use App\Services\Accounting\ZatcaSignedInvoiceQrMaterialExtractor;
use App\Services\Accounting\ZatcaXadesSignatureAssembler;
use App\Services\Accounting\ZatcaXadesSignedPropertiesBuilder;
use App\Services\Accounting\ZatcaXmlCanonicalizer;
use App\Services\Accounting\ZatcaXmlEcdsaSigner;
use DateTimeImmutable;
use DOMDocument;
use DOMElement;
use DOMXPath;
use InvalidArgumentException;
use RuntimeException;
use Tests\TestCase;

class ZatcaSignedInvoiceQrMaterialExtractorTest extends TestCase
{
    /** @test */
    public function it_returns_the_raw_hash_and_the_base64_texts_used_by_qr_tags_6_and_7(): void
    {
        [$privateKey, $leaf] = $this->certificate();
        $signed = $this->signedInvoice('customInvoiceReference', $privateKey, $leaf);
        $digest = app(ZatcaInvoiceHasher::class)->hash($signed);
        $material = app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($signed);

        $this->assertSame(base64_decode($digest, true), $material['invoice_hash']);
        $this->assertSame($digest, $material['invoice_digest']);
        $this->assertSame(44, strlen($material['invoice_digest']));
        $this->assertStringContainsString('<ds:SignatureValue>'.$material['signature_value'].'</ds:SignatureValue>', $signed);
        $der = base64_decode($material['signature_value'], true);
        $this->assertIsString($der);
        $this->assertSame("\x30", $der[0]);
        $this->assertSame(1, openssl_verify($material['invoice_hash'], $der, $this->publicKey($leaf), OPENSSL_ALGO_SHA256));
    }

    /** @test */
    public function line_wrapped_base64_digest_and_signature_are_normalized_for_qr(): void
    {
        $signed = $this->signedInvoice();
        $expected = app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($signed);
        $wrapped = preg_replace_callback(
            '#(<ds:Reference Id="invoiceSignedData".*?<ds:DigestValue>)([^<]+)|(<ds:SignatureValue>)([^<]+)#s',
            static fn (array $m): string => ($m[1] ?? '') !== ''
                ? $m[1].substr($m[2], 0, 20)."\n".substr($m[2], 20)
                : $m[3].substr($m[4], 0, 30)."\n ".substr($m[4], 30),
            $signed,
        );
        $this->assertNotSame($signed, $wrapped);

        $this->assertSame($expected, app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract((string) $wrapped));
    }

    /** @test */
    public function it_rejects_an_invoice_changed_after_signing(): void
    {
        $signed = str_replace('115.00', '116.00', $this->signedInvoice());

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('لا يطابق');

        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($signed);
    }

    /** @test */
    public function it_rejects_a_forged_or_pre_rem17_signature_value(): void
    {
        $signed = $this->signedInvoice();
        preg_match('#<ds:SignatureValue>([^<]+)</ds:SignatureValue>#', $signed, $match);
        $this->assertArrayHasKey(1, $match);

        $forged = str_replace($match[1], base64_encode("\x30\x06\x02\x01\x01\x02\x01\x01"), $signed);
        try {
            app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($forged);
            $this->fail('كان يجب رفض توقيع DER لا يطابق هاش الفاتورة.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('لا يطابق', $exception->getMessage());
        }

        // صيغة ما قبل REM-17: r || s خام (64 بايت) — ليست DER.
        $this->expectException(InvalidArgumentException::class);
        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract(str_replace($match[1], base64_encode(str_repeat("\x7f", 64)), $signed));
    }

    /** @test */
    public function a_signature_over_the_hash_by_another_key_is_rejected(): void
    {
        [$otherKey] = $this->certificate();

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('لا يطابق');

        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($this->resign($this->signedInvoice(), $otherKey));
    }

    /** @test */
    public function it_rejects_signed_info_that_declares_unsupported_algorithms(): void
    {
        $signed = $this->signedInvoice();
        foreach ([
            ZatcaXmlCanonicalizer::ALGORITHM,
            \App\Services\Accounting\ZatcaXmlDsigSignedInfoBuilder::ECDSA_SHA256_ALGORITHM,
        ] as $algorithm) {
            $invalid = str_replace($algorithm, 'urn:unsupported:algorithm', $signed);
            try {
                app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($invalid);
                $this->fail('كان يجب رفض خوارزمية SignedInfo غير المدعومة.');
            } catch (InvalidArgumentException $exception) {
                $this->assertStringContainsString('خوارزمية', $exception->getMessage());
            }
        }
    }

    /** @test */
    public function it_rejects_xpath_prefixes_rebound_to_non_ubl_namespaces(): void
    {
        $signed = $this->signedInvoice();
        foreach (['ext', 'cac', 'cbc'] as $prefix) {
            $invalid = $this->rebindXpathPrefix($signed, $prefix);
            try {
                app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($invalid);
                $this->fail('كان يجب رفض ربط بادئة XPath بغير مساحة UBL الرسمية.');
            } catch (InvalidArgumentException $exception) {
                $this->assertStringContainsString('بادئة', $exception->getMessage());
            }
        }
    }

    /** @test */
    public function it_rejects_a_duplicate_signed_properties_id_anywhere_in_the_document(): void
    {
        $signed = $this->signedInvoice();
        $duplicate = str_replace(
            '</ext:ExtensionContent>',
            '<xades:SignedProperties Id="xadesSignedProperties"/></ext:ExtensionContent>',
            $signed,
        );
        $this->assertNotSame($signed, $duplicate);

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('مكرر');

        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($duplicate);
    }

    /** @test */
    public function it_rejects_signed_properties_changed_after_signing(): void
    {
        $signed = $this->signedInvoice();
        $tampered = str_replace(
            'https://zatca.gov.sa/security-policy.pdf',
            'https://example.test/forged-policy.pdf',
            $signed,
        );
        $this->assertNotSame($signed, $tampered);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('SignedProperties');

        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($tampered);
    }

    /** @test */
    public function it_rejects_a_replacement_key_info_certificate_even_when_resigned(): void
    {
        $signed = $this->signedInvoice();
        [$replacementKey, $replacementDer] = $this->certificate();
        $tampered = $this->mutate($signed, function (DOMDocument $document, DOMXPath $xpath) use ($replacementDer): void {
            $certificate = $xpath->query('//ds:KeyInfo/ds:X509Data/ds:X509Certificate')?->item(0);
            $x509Data = $xpath->query('//ds:KeyInfo/ds:X509Data')?->item(0);
            $this->assertInstanceOf(DOMElement::class, $certificate);
            $this->assertInstanceOf(DOMElement::class, $x509Data);
            $original = $certificate->textContent;
            $certificate->nodeValue = base64_encode($replacementDer);
            $x509Data->appendChild($document->createElementNS(ZatcaXadesSignatureAssembler::XMLDSIG_NAMESPACE, 'ds:X509Certificate', $original));
        });

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('SigningCertificate');

        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($this->resign($tampered, $replacementKey));
    }

    /** @test */
    public function it_rejects_certificate_digests_distributed_between_certificate_entries(): void
    {
        [$privateKey, $leaf] = $this->certificate();
        [, $second] = $this->certificate();
        $signed = $this->signedInvoice('invoiceSignedData', $privateKey, $leaf, [base64_encode($leaf), base64_encode($second)]);
        $tampered = $this->reseal($this->mutate($signed, function (DOMDocument $document, DOMXPath $xpath): void {
            $entries = $xpath->query('//xades:SigningCertificate/xades:Cert');
            $this->assertSame(2, $entries?->length);
            $firstDigest = $xpath->query('./xades:CertDigest', $entries->item(0))?->item(0);
            $this->assertInstanceOf(DOMElement::class, $firstDigest);
            $entries->item(1)?->appendChild($firstDigest);
        }));

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('CertDigest');

        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($tampered);
    }

    /** @test */
    public function it_rejects_pre_rem17_certificate_digest_and_signed_properties_digest_encodings(): void
    {
        [$privateKey, $leaf] = $this->certificate();
        $signed = $this->signedInvoice('invoiceSignedData', $privateKey, $leaf);

        // بصمة الشهادة القديمة: Base64(SHA-256(DER)) الخام بدل Base64(hex(SHA-256(نص Base64))).
        $rawCertDigest = $this->reseal((string) preg_replace(
            '#(<xades:CertDigest>.*?<ds:DigestValue>)[^<]+#s',
            '${1}'.base64_encode(hash('sha256', $leaf, true)),
            $signed,
            1,
        ));
        try {
            app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($rawCertDigest);
            $this->fail('كان يجب رفض بصمة الشهادة بالصيغة الخام.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('SigningCertificate', $exception->getMessage());
        }

        // بصمة SignedProperties بصيغة البايتات الخام (مثال الخطوة 5 في الدليل) — يرفضها مدقّق SDK والعيّنات.
        preg_match('#<xades:SignedProperties\s.*?</xades:SignedProperties>#s', $signed, $properties);
        $standalone = preg_replace('#<ds:(\w+)#', '<ds:$1 xmlns:ds="'.ZatcaXadesSignatureAssembler::XMLDSIG_NAMESPACE.'"', str_replace(
            '<xades:SignedProperties ', '<xades:SignedProperties xmlns:xades="'.ZatcaXadesSignatureAssembler::XADES_NAMESPACE.'" ', $properties[0]));
        $rawPropertiesDigest = $this->replacePropertiesDigest($signed, base64_encode(hash('sha256', (string) $standalone, true)));

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('DigestValue لا يطابق SignedProperties');
        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($rawPropertiesDigest);
    }

    /** @test */
    public function it_rejects_issuer_serial_that_does_not_identify_the_key_info_certificate(): void
    {
        $tampered = $this->reseal((string) preg_replace(
            '#(<ds:X509SerialNumber>)(\d+)#',
            '${1}1${2}',
            $this->signedInvoice(),
            1,
        ));

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('IssuerSerial');

        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($tampered);
    }

    /** @test */
    public function the_signature_policy_is_covered_by_the_signed_properties_digest(): void
    {
        $tampered = (string) preg_replace(
            '#(<xades:SigPolicyHash>.*?<ds:DigestValue>)[^<]+#s',
            '${1}'.base64_encode(hash('sha256', 'another-policy', true)),
            $this->signedInvoice(),
            1,
        );

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('DigestValue لا يطابق SignedProperties');

        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($tampered);
    }

    /** @test */
    public function it_rejects_a_signature_moved_outside_the_official_ubl_extension(): void
    {
        $document = new DOMDocument();
        $document->preserveWhiteSpace = true;
        $this->assertTrue($document->loadXML($this->signedInvoice(), LIBXML_NONET));
        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('ds', ZatcaXadesSignatureAssembler::XMLDSIG_NAMESPACE);
        $xpath->registerNamespace(
            'cac',
            'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
        );
        $signature = $xpath->query('//ds:Signature')?->item(0);
        $excludedContainer = $xpath->query('//cac:Signature')?->item(0);
        $this->assertInstanceOf(DOMElement::class, $signature);
        $this->assertInstanceOf(DOMElement::class, $excludedContainer);
        $excludedContainer->appendChild($signature);
        $tampered = $document->saveXML();
        $this->assertIsString($tampered);

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('UBL');

        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($tampered);
    }

    /** @test */
    public function it_rejects_qualifying_properties_not_targeting_their_signature(): void
    {
        $signed = $this->signedInvoice();
        $tampered = str_replace('Target="#signature"', 'Target="#detachedSignature"', $signed);
        $this->assertNotSame($signed, $tampered);

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('Target');

        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($tampered);
    }

    /** @test */
    public function it_rejects_duplicate_or_conflicting_ubl_signature_discriminators(): void
    {
        foreach ([
            ['//ext:ExtensionURI', ZatcaXadesSignatureAssembler::EXT_NAMESPACE, 'ext:ExtensionURI'],
            ['//sac:SignatureInformation/cbc:ID', ZatcaXadesSignatureAssembler::CBC_NAMESPACE, 'cbc:ID'],
            ['//sac:SignatureInformation/sbc:ReferencedSignatureID', ZatcaXadesSignatureAssembler::SBC_NAMESPACE, 'sbc:ReferencedSignatureID'],
        ] as [$expression, $namespace, $qualifiedName]) {
            $document = new DOMDocument();
            $document->preserveWhiteSpace = true;
            $this->assertTrue($document->loadXML($this->signedInvoice(), LIBXML_NONET));
            $xpath = new DOMXPath($document);
            $xpath->registerNamespace('ext', ZatcaXadesSignatureAssembler::EXT_NAMESPACE);
            $xpath->registerNamespace('sac', ZatcaXadesSignatureAssembler::SAC_NAMESPACE);
            $xpath->registerNamespace('sbc', ZatcaXadesSignatureAssembler::SBC_NAMESPACE);
            $xpath->registerNamespace('cbc', ZatcaXadesSignatureAssembler::CBC_NAMESPACE);
            $original = $xpath->query($expression)?->item(0);
            $this->assertInstanceOf(DOMElement::class, $original);
            $original->parentNode?->appendChild($document->createElementNS(
                $namespace,
                $qualifiedName,
                'urn:conflicting-value',
            ));
            $tampered = $document->saveXML();
            $this->assertIsString($tampered);
            try {
                app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($tampered);
                $this->fail('كان يجب رفض حقل مميز مكرر داخل حاوية توقيع UBL.');
            } catch (InvalidArgumentException $exception) {
                $this->assertStringContainsString('UBL', $exception->getMessage());
            }
        }
    }

    /** @test */
    public function it_rejects_an_additional_direct_signed_properties_element(): void
    {
        $document = new DOMDocument();
        $document->preserveWhiteSpace = true;
        $this->assertTrue($document->loadXML($this->signedInvoice(), LIBXML_NONET));
        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('xades', ZatcaXadesSignatureAssembler::XADES_NAMESPACE);
        $qualifyingProperties = $xpath->query('//xades:QualifyingProperties')?->item(0);
        $this->assertInstanceOf(DOMElement::class, $qualifyingProperties);
        $extra = $document->createElementNS(
            ZatcaXadesSignatureAssembler::XADES_NAMESPACE,
            'xades:SignedProperties',
        );
        $extra->setAttribute('Id', 'additionalSignedProperties');
        $qualifyingProperties->appendChild($extra);
        $tampered = $document->saveXML();
        $this->assertIsString($tampered);

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('SignedProperties');

        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($tampered);
    }

    /** @test */
    public function it_rejects_multiple_root_ubl_extensions_wrappers(): void
    {
        $document = new DOMDocument();
        $document->preserveWhiteSpace = true;
        $this->assertTrue($document->loadXML($this->signedInvoice(), LIBXML_NONET));
        $root = $document->documentElement;
        $this->assertInstanceOf(DOMElement::class, $root);
        $extraWrapper = $document->createElementNS(
            ZatcaXadesSignatureAssembler::EXT_NAMESPACE,
            'ext:UBLExtensions',
        );
        $extraWrapper->appendChild($document->createElementNS(
            ZatcaXadesSignatureAssembler::EXT_NAMESPACE,
            'ext:UBLExtension',
        ));
        $root->appendChild($extraWrapper);
        $tampered = $document->saveXML();
        $this->assertIsString($tampered);

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('UBLExtensions');

        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($tampered);
    }

    /** @test */
    public function it_rejects_split_invoice_transforms_and_any_transform_on_the_signed_properties_reference(): void
    {
        $split = $this->mutate($this->signedInvoice(), function (DOMDocument $document, DOMXPath $xpath): void {
            $reference = $xpath->query("//ds:SignedInfo/ds:Reference[@URI='']")?->item(0);
            $transforms = $reference instanceof DOMElement ? $xpath->query('./ds:Transforms', $reference)?->item(0) : null;
            $this->assertInstanceOf(DOMElement::class, $transforms);
            $second = $document->createElementNS(ZatcaXadesSignatureAssembler::XMLDSIG_NAMESPACE, 'ds:Transforms');
            $second->appendChild($transforms->lastElementChild);
            $reference->insertBefore($second, $transforms->nextSibling);
        });
        $declared = $this->mutate($this->signedInvoice(), function (DOMDocument $document, DOMXPath $xpath): void {
            $reference = $xpath->query("//ds:SignedInfo/ds:Reference[@URI='#xadesSignedProperties']")?->item(0);
            $this->assertInstanceOf(DOMElement::class, $reference);
            $transforms = $document->createElementNS(ZatcaXadesSignatureAssembler::XMLDSIG_NAMESPACE, 'ds:Transforms');
            $transform = $document->createElementNS(ZatcaXadesSignatureAssembler::XMLDSIG_NAMESPACE, 'ds:Transform');
            $transform->setAttribute('Algorithm', ZatcaXmlCanonicalizer::ALGORITHM);
            $transforms->appendChild($transform);
            $reference->insertBefore($transforms, $reference->firstChild);
        });

        foreach ([$split, $declared] as $tampered) {
            try {
                app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($tampered);
                $this->fail('كان يجب رفض تحويلات Reference غير المطابقة.');
            } catch (InvalidArgumentException $exception) {
                $this->assertStringContainsString('تحويل', $exception->getMessage());
            }
        }
    }

    /** @test */
    public function it_rejects_data_object_format_detached_from_the_invoice_reference(): void
    {
        foreach (['reference_id', 'object_reference'] as $mutation) {
            $tampered = $this->signedInvoiceWithDetachedDataObjectFormat($mutation);
            try {
                app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($tampered);
                $this->fail('كان يجب رفض DataObjectFormat غير المرتبطة بمرجع الفاتورة.');
            } catch (InvalidArgumentException $exception) {
                $this->assertStringContainsString('مرجع', $exception->getMessage());
            }
        }
    }

    /** @test */
    public function it_rejects_an_invalid_invoice_data_object_mime_type(): void
    {
        $tampered = $this->signedInvoiceWithDetachedDataObjectFormat('mime_type');

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('MimeType');

        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($tampered);
    }

    /** @test */
    public function it_rejects_trailing_bytes_after_an_embedded_der_certificate(): void
    {
        $tampered = $this->signedInvoiceWithTrailingCertificateBytes();

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('DER');

        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($tampered);
    }

    /** @test */
    public function it_rejects_missing_duplicate_or_malformed_signature_material(): void
    {
        $signed = $this->signedInvoice();
        preg_match('#<ds:SignatureValue>([^<]+)</ds:SignatureValue>#', $signed, $match);
        $this->assertArrayHasKey(1, $match);

        foreach ([
            str_replace($match[0], '', $signed),
            str_replace($match[0], $match[0].$match[0], $signed),
            str_replace($match[1], 'not-base64', $signed),
            preg_replace('#(<ds:SignedInfo\b.*?</ds:SignedInfo>)#s', '$1$1', $signed, 1),
        ] as $invalid) {
            $this->assertIsString($invalid);
            try {
                app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($invalid);
                $this->fail('كان يجب رفض مادة توقيع QR المفقودة أو المكررة أو التالفة.');
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    /** @param list<string>|null $chain */
    private function signedInvoice(
        string $invoiceReferenceId = 'invoiceSignedData',
        ?string $privateKey = null,
        ?string $leaf = null,
        ?array $chain = null,
    ): string {
        if ($privateKey === null || $leaf === null) {
            [$privateKey, $leaf] = $this->certificate();
        }

        return app(ZatcaXadesSignatureAssembler::class)->assemble(
            $this->invoiceXml(),
            $chain ?? [base64_encode($leaf)],
            $privateKey,
            new DateTimeImmutable('2026-08-30T01:02:03+03:00'),
            'https://zatca.gov.sa/security-policy.pdf',
            base64_encode(hash('sha256', 'policy', true)),
            invoiceReferenceId: $invoiceReferenceId,
        );
    }

    private function rebindXpathPrefix(string $signedXml, string $prefix): string
    {
        return $this->mutate($signedXml, function (DOMDocument $document, DOMXPath $xpath) use ($prefix): void {
            $nodes = $xpath->query("//ds:SignedInfo//ds:XPath[contains(., '{$prefix}:')]");
            $this->assertNotFalse($nodes);
            $this->assertGreaterThan(0, $nodes->length);
            foreach ($nodes as $node) {
                $this->assertInstanceOf(DOMElement::class, $node);
                $node->setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:'.$prefix, 'urn:wrong:'.$prefix);
            }
        });
    }

    /** تعديل DOM ثم تسلسل؛ SignedInfo غير موقَّع في مخطط ZATCA فلا يُعاد توقيع شيء هنا. */
    private function mutate(string $signedXml, callable $change): string
    {
        $document = new DOMDocument();
        $document->preserveWhiteSpace = true;
        $this->assertTrue($document->loadXML($signedXml, LIBXML_NONET));
        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('ds', ZatcaXadesSignatureAssembler::XMLDSIG_NAMESPACE);
        $xpath->registerNamespace('xades', ZatcaXadesSignatureAssembler::XADES_NAMESPACE);
        $change($document, $xpath);
        $xml = $document->saveXML();
        $this->assertIsString($xml);

        return $xml;
    }

    /** يعيد حساب بصمة SignedProperties من نصّها بعد التلاعب (مهاجم يعيد «الختم» بلا مفتاح). */
    private function reseal(string $signedXml): string
    {
        $this->assertSame(1, preg_match('#<xades:SignedProperties\s.*?</xades:SignedProperties>#s', $signedXml, $properties));

        return $this->replacePropertiesDigest($signedXml, app(ZatcaXadesSignedPropertiesBuilder::class)->digest($properties[0]));
    }

    private function replacePropertiesDigest(string $signedXml, string $digest): string
    {
        $xml = preg_replace('#(URI="\#xadesSignedProperties">.*?<ds:DigestValue>)[^<]+#s', '${1}'.$digest, $signedXml, 1, $count);
        $this->assertSame(1, $count);

        return (string) $xml;
    }

    /** توقيع هاش الفاتورة المعلن بمفتاح آخر (التوقيع على الهاش لا على SignedInfo). */
    private function resign(string $signedXml, string $privateKey): string
    {
        $this->assertSame(1, preg_match('#<ds:Reference Id="invoiceSignedData".*?<ds:DigestValue>([^<]+)#s', $signedXml, $digest));
        $signature = app(ZatcaXmlEcdsaSigner::class)->sign((string) base64_decode($digest[1], true), $privateKey);

        return (string) preg_replace('#<ds:SignatureValue>[^<]+#', '<ds:SignatureValue>'.$signature, $signedXml, 1);
    }

    private function signedInvoiceWithDetachedDataObjectFormat(string $mutation): string
    {
        $mutated = $this->mutate($this->signedInvoice(), function (DOMDocument $document, DOMXPath $xpath) use ($mutation): void {
            $invoiceReference = $xpath->query("//ds:SignedInfo/ds:Reference[@URI='']")?->item(0);
            $dataObjectFormat = $xpath->query('//xades:SignedDataObjectProperties/xades:DataObjectFormat')?->item(0);
            $this->assertInstanceOf(DOMElement::class, $invoiceReference);
            $this->assertInstanceOf(DOMElement::class, $dataObjectFormat);
            if ($mutation === 'reference_id') {
                $invoiceReference->setAttribute('Id', 'detachedInvoiceReference');
            } elseif ($mutation === 'object_reference') {
                $dataObjectFormat->setAttribute('ObjectReference', '#detachedInvoiceReference');
            } else {
                $mimeType = $xpath->query('./xades:MimeType', $dataObjectFormat)?->item(0);
                $this->assertInstanceOf(DOMElement::class, $mimeType);
                $mimeType->nodeValue = 'application/xml';
            }
        });

        return $mutation === 'reference_id' ? $mutated : $this->reseal($mutated);
    }

    private function signedInvoiceWithTrailingCertificateBytes(): string
    {
        [$privateKey, $leaf] = $this->certificate();
        $padded = base64_encode($leaf.'trailing-bytes');

        return $this->reseal($this->mutate(
            $this->signedInvoice('invoiceSignedData', $privateKey, $leaf),
            function (DOMDocument $document, DOMXPath $xpath) use ($padded): void {
                $certificate = $xpath->query('//ds:KeyInfo/ds:X509Data/ds:X509Certificate')?->item(0);
                $certificateDigest = $xpath->query('//xades:SigningCertificate/xades:Cert/xades:CertDigest/ds:DigestValue')?->item(0);
                $this->assertInstanceOf(DOMElement::class, $certificate);
                $this->assertInstanceOf(DOMElement::class, $certificateDigest);
                $certificate->nodeValue = $padded;
                $certificateDigest->nodeValue = base64_encode(hash('sha256', $padded));
            },
        ));
    }

    private function publicKey(string $der): string
    {
        $key = openssl_pkey_get_public("-----BEGIN CERTIFICATE-----\n".chunk_split(base64_encode($der), 64, "\n")."-----END CERTIFICATE-----\n");
        $this->assertNotFalse($key);
        $details = openssl_pkey_get_details($key);
        $this->assertIsString($details['key'] ?? null);

        return $details['key'];
    }

    /** @return array{string,string} private PEM, certificate DER */
    private function certificate(): array
    {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'secp256k1']);
        $this->assertNotFalse($key);
        $request = openssl_csr_new(['commonName' => 'Signed QR Device'], $key, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($request);
        $certificate = openssl_csr_sign($request, null, $key, 1, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($certificate);
        $privateKey = '';
        $this->assertTrue(openssl_pkey_export($key, $privateKey));
        $pem = '';
        $this->assertTrue(openssl_x509_export($certificate, $pem));
        $body = preg_replace('/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/', '', $pem);
        $this->assertIsString($body);
        $der = base64_decode($body, true);
        $this->assertIsString($der);

        return [$privateKey, $der];
    }

    private function invoiceXml(): string
    {
        return <<<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
 xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
 xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
 xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
 xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2"
 xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2"
 xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2"
 xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
 xmlns:xades="http://uri.etsi.org/01903/v1.3.2#">
 <cbc:ID>INV-QR-MATERIAL-1</cbc:ID>
 <cbc:UUID>33333333-3333-4333-8333-333333333333</cbc:UUID>
 <cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">QR</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>
 <cac:Signature><cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID></cac:Signature>
 <cac:LegalMonetaryTotal><cbc:TaxInclusiveAmount currencyID="SAR">115.00</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal>
</Invoice>
XML;
    }
}
