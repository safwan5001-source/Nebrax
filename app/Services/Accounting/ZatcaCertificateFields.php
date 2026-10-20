<?php

namespace App\Services\Accounting;

use InvalidArgumentException;

/**
 * يقرأ من شهادة X.509 (DER) الحقول التي يحتاجها توقيع ZATCA وQR المرحلة الثانية — REM-17.
 *
 *  • `issuer_name`: اسم المُصدِر بالصيغة التي يقارن بها SDK الرسمي (`X509Certificate.getIssuerDN().getName()`
 *    في Java): الـRDN بترتيب معكوس، مفصولة بـ", "، وبكلمات Java المفتاحية. تحقّق تجريبياً (REM-17 Phase A) أنها
 *    تطابق عيّنة ZATCA الرسمية حرفياً: "CN=PRZEINVOICESCA4-CA, DC=extgazt, DC=gov, DC=local".
 *  • `serial_number`: الرقم التسلسلي عشرياً (`BigInteger` في SDK؛ الصيغة الست عشرية تُفشل XSD).
 *  • `subject_public_key_info`: بنية SPKI بترميز DER **كما هي في الشهادة** (وسم QR 8؛ 88 بايت للمفتاح غير المضغوط).
 *
 * فشل مغلق: أي سمة خارج القائمة المعروفة، أو RDN متعدد القيم، أو قيمة تحتاج تهريباً/اقتباساً في صيغة Java، تُرفض بدل
 * تخمين تمثيل قد لا يطابق ما يحسبه المتحقّق.
 */
final class ZatcaCertificateFields
{
    /** OID → كلمة Java المفتاحية (sun.security.x509.AVAKeyword) للسمات المدعومة فقط. */
    private const ISSUER_KEYWORDS = [
        '2.5.4.3' => 'CN',
        '2.5.4.6' => 'C',
        '2.5.4.7' => 'L',
        '2.5.4.8' => 'ST',
        '2.5.4.10' => 'O',
        '2.5.4.11' => 'OU',
        '0.9.2342.19200300.100.1.25' => 'DC',
    ];

    /** UTF8String، PrintableString، IA5String. */
    private const STRING_TAGS = [0x0C, 0x13, 0x16];

    private const EC_PUBLIC_KEY_ALGORITHM = "\x06\x07\x2A\x86\x48\xCE\x3D\x02\x01";
    private const SECP256K1_CURVE = "\x06\x05\x2B\x81\x04\x00\x0A";

    /** @return array{issuer_name:string, serial_number:string, subject_public_key_info:string} */
    public function extract(string $certificateDer): array
    {
        $tbs = $this->tbsFields($certificateDer);

        return [
            'issuer_name' => $this->issuerName($certificateDer, $tbs['issuer']),
            'serial_number' => $this->decimal($this->bytes($certificateDer, $tbs['serial'])),
            'subject_public_key_info' => $this->subjectPublicKeyInfoBytes($certificateDer, $tbs['spki']),
        ];
    }

    /** وسم QR 8 وحده — لا يشترط أن يكون اسم المُصدِر قابلاً للتمثيل. */
    public function subjectPublicKeyInfo(string $certificateDer): string
    {
        return $this->subjectPublicKeyInfoBytes($certificateDer, $this->tbsFields($certificateDer)['spki']);
    }

    /** @return array{serial:array{start:int,end:int}, issuer:array{start:int,end:int}, spki:array{start:int,end:int}} */
    private function tbsFields(string $certificateDer): array
    {
        $offset = 0;
        $certificate = $this->read($certificateDer, $offset, strlen($certificateDer), 0x30, 'Certificate');
        if ($offset !== strlen($certificateDer)) {
            throw new InvalidArgumentException('شهادة ZATCA تحتوي بايتات بعد بنية X.509.');
        }

        $cursor = $certificate['start'];
        $tbs = $this->read($certificateDer, $cursor, $certificate['end'], 0x30, 'TBSCertificate');

        $field = $tbs['start'];
        if ($field < $tbs['end'] && ord($certificateDer[$field]) === 0xA0) {
            $this->read($certificateDer, $field, $tbs['end'], 0xA0, 'version');
        }
        $serial = $this->read($certificateDer, $field, $tbs['end'], 0x02, 'serialNumber');
        $this->read($certificateDer, $field, $tbs['end'], 0x30, 'signature');
        $issuer = $this->read($certificateDer, $field, $tbs['end'], 0x30, 'issuer');
        $this->read($certificateDer, $field, $tbs['end'], 0x30, 'validity');
        $this->read($certificateDer, $field, $tbs['end'], 0x30, 'subject');
        $spkiStart = $field;
        $spki = $this->read($certificateDer, $field, $tbs['end'], 0x30, 'subjectPublicKeyInfo');

        return ['serial' => $serial, 'issuer' => $issuer, 'spki' => ['start' => $spkiStart, 'end' => $spki['end']]];
    }

    /** @param array{start:int,end:int} $name */
    private function issuerName(string $der, array $name): string
    {
        $parts = [];
        $offset = $name['start'];
        while ($offset < $name['end']) {
            $rdn = $this->read($der, $offset, $name['end'], 0x31, 'RDN');
            $inner = $rdn['start'];
            $attribute = $this->read($der, $inner, $rdn['end'], 0x30, 'AttributeTypeAndValue');
            if ($inner !== $rdn['end']) {
                throw new InvalidArgumentException('اسم مُصدِر شهادة ZATCA يحتوي RDN متعدد القيم غير مدعوم.');
            }

            $cursor = $attribute['start'];
            $type = $this->read($der, $cursor, $attribute['end'], 0x06, 'AttributeType');
            if ($cursor >= $attribute['end'] || ! in_array(ord($der[$cursor]), self::STRING_TAGS, true)) {
                throw new InvalidArgumentException('قيمة في اسم مُصدِر شهادة ZATCA ليست نصاً مدعوماً.');
            }
            $value = $this->read($der, $cursor, $attribute['end'], ord($der[$cursor]), 'AttributeValue');
            if ($cursor !== $attribute['end']) {
                throw new InvalidArgumentException('سمة في اسم مُصدِر شهادة ZATCA تحتوي عناصر زائدة.');
            }

            $oid = $this->oid($this->bytes($der, $type));
            $keyword = self::ISSUER_KEYWORDS[$oid] ?? null;
            if ($keyword === null) {
                throw new InvalidArgumentException("سمة اسم المُصدِر {$oid} غير مدعومة في توقيع ZATCA.");
            }

            $text = $this->bytes($der, $value);
            // مقصورة على ASCII مطبوع لا يحتاج اقتباساً في صيغة Java ولا تهريباً في XML.
            if (preg_match('/^[\x21-\x7E](?:[\x20-\x7E]*[\x21-\x7E])?$/D', $text) !== 1
                || strpbrk($text, ',+="\\<>#;&\'') !== false
            ) {
                throw new InvalidArgumentException('قيمة في اسم مُصدِر شهادة ZATCA تحتاج تهريباً غير مدعوم.');
            }

            $parts[] = $keyword.'='.$text;
        }

        if ($parts === []) {
            throw new InvalidArgumentException('اسم مُصدِر شهادة ZATCA فارغ.');
        }

        return implode(', ', array_reverse($parts));
    }

    /** @param array{start:int,end:int} $element العنصر كاملاً بوسمه وطوله */
    private function subjectPublicKeyInfoBytes(string $der, array $element): string
    {
        $spki = $this->bytes($der, $element);
        $offset = 0;
        $sequence = $this->read($spki, $offset, strlen($spki), 0x30, 'SubjectPublicKeyInfo');
        $cursor = $sequence['start'];
        $algorithm = $this->read($spki, $cursor, $sequence['end'], 0x30, 'AlgorithmIdentifier');
        $key = $this->read($spki, $cursor, $sequence['end'], 0x03, 'subjectPublicKey');
        if ($cursor !== $sequence['end']
            || $this->bytes($spki, $algorithm) !== self::EC_PUBLIC_KEY_ALGORITHM.self::SECP256K1_CURVE
        ) {
            throw new InvalidArgumentException('مفتاح شهادة ZATCA العام ليس EC على منحنى secp256k1.');
        }

        $bits = $this->bytes($spki, $key);
        $point = substr($bits, 1);
        $valid = ($bits[0] ?? null) === "\x00" && (
            (strlen($point) === 65 && $point[0] === "\x04")
            || (strlen($point) === 33 && ($point[0] === "\x02" || $point[0] === "\x03"))
        );
        if (! $valid) {
            throw new InvalidArgumentException('نقطة مفتاح شهادة ZATCA العام ليست بترميز SEC1 صالح.');
        }

        return $spki;
    }

    private function oid(string $bytes): string
    {
        if ($bytes === '' || (ord($bytes[strlen($bytes) - 1]) & 0x80) !== 0) {
            throw new InvalidArgumentException('معرّف سمة في شهادة ZATCA غير صالح.');
        }

        $arcs = [];
        $value = 0;
        foreach (str_split($bytes) as $byte) {
            if ($value === 0 && ord($byte) === 0x80) {
                throw new InvalidArgumentException('معرّف سمة في شهادة ZATCA بترميز غير قياسي.');
            }
            $value = ($value << 7) | (ord($byte) & 0x7F);
            if ($value > 0xFFFFFFFF) {
                throw new InvalidArgumentException('معرّف سمة في شهادة ZATCA خارج النطاق.');
            }
            if ((ord($byte) & 0x80) === 0) {
                $arcs[] = $value;
                $value = 0;
            }
        }

        $first = min(intdiv($arcs[0], 40), 2);
        array_splice($arcs, 0, 1, [$first, $arcs[0] - 40 * $first]);

        return implode('.', $arcs);
    }

    /** INTEGER موجب قانوني → نص عشري (بلا bcmath/gmp). */
    private function decimal(string $integer): string
    {
        $length = strlen($integer);
        if ($length === 0 || (ord($integer[0]) & 0x80) !== 0
            || ($length > 1 && $integer[0] === "\x00" && (ord($integer[1]) & 0x80) === 0)
        ) {
            throw new InvalidArgumentException('الرقم التسلسلي لشهادة ZATCA ليس INTEGER موجباً قانونياً.');
        }

        $bytes = array_values(unpack('C*', $integer));
        $digits = '';
        while ($bytes !== []) {
            $remainder = 0;
            $quotient = [];
            foreach ($bytes as $byte) {
                $current = ($remainder << 8) | $byte;
                $digit = intdiv($current, 10);
                $remainder = $current % 10;
                if ($quotient !== [] || $digit !== 0) {
                    $quotient[] = $digit;
                }
            }
            $digits = $remainder.$digits;
            $bytes = $quotient;
        }

        return ltrim($digits, '0') ?: '0';
    }

    /** @param array{start:int,end:int} $element */
    private function bytes(string $der, array $element): string
    {
        return substr($der, $element['start'], $element['end'] - $element['start']);
    }

    /** @return array{start:int,end:int} */
    private function read(string $der, int &$offset, int $limit, int $tag, string $label): array
    {
        if ($offset >= $limit || $limit > strlen($der) || ord($der[$offset]) !== $tag) {
            throw new InvalidArgumentException("شهادة ZATCA تفتقد عنصر {$label} المتوقع.");
        }
        $offset++;

        if ($offset >= $limit) {
            throw new InvalidArgumentException("طول عنصر {$label} في شهادة ZATCA مفقود.");
        }
        $length = ord($der[$offset++]);
        if ($length >= 0x80) {
            $octets = $length & 0x7F;
            if ($octets < 1 || $octets > 4 || $octets > $limit - $offset || $der[$offset] === "\x00") {
                throw new InvalidArgumentException("طول عنصر {$label} في شهادة ZATCA غير قياسي.");
            }
            $length = 0;
            for ($index = 0; $index < $octets; $index++) {
                $length = ($length << 8) | ord($der[$offset++]);
            }
            if ($length < 0x80) {
                throw new InvalidArgumentException("طول عنصر {$label} في شهادة ZATCA يستخدم الصيغة الطويلة دون حاجة.");
            }
        }
        if ($length > $limit - $offset) {
            throw new InvalidArgumentException("طول عنصر {$label} في شهادة ZATCA يتجاوز حدوده.");
        }

        $start = $offset;
        $offset += $length;

        return ['start' => $start, 'end' => $offset];
    }
}
