# Probe outputs (selected)

Outputs of the purpose-written probes cited as evidence in the findings (synthetic tenants and documents only; PHPUnit headers and secrets removed; each file capped at 150 lines). The probe sources are not part of the repository; every probe calls production services or routes with `Http::fake`.

## Stream A — VAT engine

### `A-invoice-engine.log`

```text
[A] S1 3x3.33@15 excl head                           {"subtotal":999,"discount":0,"shipping":0,"adjustment":0,"tax":150,"total":1149,"incl":false}
[A] S2 10x(1x0.10)@15 head                           {"subtotal":100,"discount":0,"shipping":0,"adjustment":0,"tax":20,"total":120,"incl":false}
[A] S2 QR tags 4/5                                   {"1":"Probe A","2":"300000000000003","3":"2026-10-10T12:36:49+00:00","4":"1.20","5":"0.20"}
[A] S2 stored VAT=20 (per-line rounding) vs document-level 15% of 1.00 = 15
[A] S2b 1x(10x0.10)@15 head                          {"subtotal":100,"discount":0,"shipping":0,"adjustment":0,"tax":15,"total":115,"incl":false}
[A] S3 incl 10000 head                               {"subtotal":8696,"discount":0,"shipping":0,"adjustment":0,"tax":1304,"total":10000,"incl":true}
[A] S3 incl 10000 lines                              [{"qty":1,"up":10000,"up_bt":8696,"rate":15,"sub":8696,"disc":0,"tax":1304,"tot":10000}]
[A] S3 incl 5 head                                   {"subtotal":4,"discount":0,"shipping":0,"adjustment":0,"tax":1,"total":5,"incl":true}
[A] S3 incl 5 lines                                  [{"qty":1,"up":5,"up_bt":4,"rate":15,"sub":4,"disc":0,"tax":1,"tot":5}]
[A] S3 incl 1 head                                   {"subtotal":1,"discount":0,"shipping":0,"adjustment":0,"tax":0,"total":1,"incl":true}
[A] S3 incl 1 lines                                  [{"qty":1,"up":1,"up_bt":1,"rate":15,"sub":1,"disc":0,"tax":0,"tot":1}]
[A] S3 incl 99999 head                               {"subtotal":86956,"discount":0,"shipping":0,"adjustment":0,"tax":13043,"total":99999,"incl":true}
[A] S3 incl 99999 lines                              [{"qty":1,"up":99999,"up_bt":86956,"rate":15,"sub":86956,"disc":0,"tax":13043,"tot":99999}]
[A] S3b incl 115 disc 11.50 head                     {"subtotal":9000,"discount":0,"shipping":0,"adjustment":0,"tax":1350,"total":10350,"incl":true}
[A] S3b incl 115 disc 11.50 lines                    [{"qty":1,"up":11500,"up_bt":10000,"rate":15,"sub":10000,"disc":1000,"tax":1350,"tot":10350}]
[A] S3b XML amounts                                  ["TaxAmount=13.50","TaxExclusiveAmount=90.00","TaxInclusiveAmount=103.50","PayableAmount=103.50","InvoicedQuantity=1","LineExtensionAmount=100.00","PriceAmount=115.00","TaxCategory=ABSENT","TaxSubtotal=ABSENT","AllowanceCharge=ABSENT"]
[A] S4 head                                          {"subtotal":15000,"discount":1500,"shipping":0,"adjustment":0,"tax":1350,"total":14850,"incl":false}
[A] S4 lines (line_tax pre-header-discount)          [{"qty":1,"up":10000,"up_bt":10000,"rate":15,"sub":10000,"disc":0,"tax":1500,"tot":11500},{"qty":1,"up":5000,"up_bt":5000,"rate":0,"sub":5000,"disc":0,"tax":0,"tot":5000}]
[A] S4 ledger                                        [["1130",14850,0],["4110",0,13500],["2120",0,1350]]
[A] S4 XML amounts                                   ["TaxAmount=13.50","TaxExclusiveAmount=150.00","TaxInclusiveAmount=148.50","PayableAmount=148.50","InvoicedQuantity=1","LineExtensionAmount=100.00","PriceAmount=100.00","InvoicedQuantity=1","LineExtensionAmount=50.00","PriceAmount=50.00","TaxCateg
[A] S4 QR                                            {"1":"Probe A","2":"300000000000003","3":"2026-10-10T12:36:50+00:00","4":"148.50","5":"13.50"}
[A] S5 head                                          {"subtotal":929,"discount":0,"shipping":0,"adjustment":0,"tax":139,"total":1068,"incl":false}
[A] S5 lines                                         [{"qty":3,"up":333,"up_bt":333,"rate":15,"sub":999,"disc":70,"tax":139,"tot":1068}]
[A] S5 XML amounts                                   ["TaxAmount=1.39","TaxExclusiveAmount=9.29","TaxInclusiveAmount=10.68","PayableAmount=10.68","InvoicedQuantity=3","LineExtensionAmount=9.99","PriceAmount=3.33","TaxCategory=ABSENT","TaxSubtotal=ABSENT","AllowanceCharge=ABSENT"]
[A] S6 0.333x1.00 head                               {"subtotal":33,"discount":0,"shipping":0,"adjustment":0,"tax":5,"total":38,"incl":false}
[A] S6 0.333x1.00 lines                              [{"qty":1,"up":100,"up_bt":100,"rate":15,"sub":33,"disc":0,"tax":5,"tot":38}]
[A] S6 0.333x1.00 XML                                ["TaxAmount=0.05","TaxExclusiveAmount=0.33","TaxInclusiveAmount=0.38","PayableAmount=0.38","InvoicedQuantity=0.333","LineExtensionAmount=0.33","PriceAmount=1.00","TaxCategory=ABSENT","TaxSubtotal=ABSENT","AllowanceCharge=ABSENT"]
[A] S6 1/3x1.00 draft head                           {"subtotal":33,"discount":0,"shipping":0,"adjustment":0,"tax":5,"total":38,"incl":false}
[A] S6 1/3 qty post FAILED: RuntimeException: مقام كمية سطر الفاتورة لا يمكن تمثيله عشرياً بدقة في ZATCA.
[A] S9 head                                          {"subtotal":30000,"discount":0,"shipping":0,"adjustment":0,"tax":1500,"total":31500,"incl":false}
[A] S9 lines                                         [{"qty":1,"up":10000,"up_bt":10000,"rate":15,"sub":10000,"disc":0,"tax":1500,"tot":11500},{"qty":1,"up":10000,"up_bt":10000,"rate":0,"sub":10000,"disc":0,"tax":0,"tot":10000},{"qty":1,"up":10000,"up_bt":10000,"rate":0,"sub":10000,"disc":0,"tax":0,
[A] S9 XML amounts/category                          ["TaxAmount=15.00","TaxExclusiveAmount=300.00","TaxInclusiveAmount=315.00","PayableAmount=315.00","InvoicedQuantity=1","LineExtensionAmount=100.00","PriceAmount=100.00","InvoicedQuantity=1","LineExtensionAmount=100.00","PriceAmount=100.00","Invoic
[A] S13 base=10 tax=2 (half-up expectation 2)
[A] S13 base=30 tax=5 (half-up expectation 5)
[A] S13 base=50 tax=8 (half-up expectation 8)
[A] S14 zero invoice FAILED: RuntimeException: القيد يجب أن يحتوي على سطرين على الأقل.
[A] S14 negative total rejected: التسوية تجعل إجمالي الفاتورة سالباً.
[A] S14 discount>subtotal rejected: الخصم لا يمكن أن يتجاوز إجمالي السطور.
[A] S14 adj=-15.00 head                              {"subtotal":10000,"discount":0,"shipping":0,"adjustment":-1500,"tax":1500,"total":10000,"incl":false}
[A] S14 adj=-15.00 QR                                {"1":"Probe A","2":"300000000000003","3":"2026-10-10T12:36:50+00:00","4":"100.00","5":"15.00"}
[A] S14 adj=-15.00 ledger                            [["1130",10000,0],["4110",0,10000],["2120",0,1500],["5170",1500,0]]
[A] S15 head                                         {"subtotal":12000,"discount":500,"shipping":1000,"adjustment":-7,"tax":1443,"total":13936,"incl":false}
[A] S15 lines                                        [{"qty":2,"up":5000,"up_bt":5000,"rate":15,"sub":10000,"disc":1000,"tax":1350,"tot":10350},{"qty":1,"up":3000,"up_bt":3000,"rate":0,"sub":3000,"disc":0,"tax":0,"tot":3000}]
[A] S15 ledger                                       [["1130",13936,0],["4110",0,11500],["4130",0,1000],["2120",0,1443],["5170",7,0]]
[A] S15 XML amounts                                  ["TaxAmount=14.43","TaxExclusiveAmount=120.00","TaxInclusiveAmount=139.36","PayableAmount=139.36","InvoicedQuantity=2","LineExtensionAmount=100.00","PriceAmount=50.00","InvoicedQuantity=1","LineExtensionAmount=30.00","PriceAmount=30.00","TaxCatego
[A] S15 QR                                           {"1":"Probe A","2":"300000000000003","3":"2026-10-10T12:36:51+00:00","4":"139.36","5":"14.43"}
[A] S15 independent: goods VAT exact 1293.75 → half-up 1294 (AWJ stores intdiv → 1293?), shipping VAT 150
[A] S16 incl 115 hdr disc 1150 head                  {"subtotal":10000,"discount":1150,"shipping":0,"adjustment":0,"tax":1327,"total":10177,"incl":true}
[A] S16 XML amounts                                  ["TaxAmount=13.27","TaxExclusiveAmount=100.00","TaxInclusiveAmount=101.77","PayableAmount=101.77","InvoicedQuantity=1","LineExtensionAmount=100.00","PriceAmount=115.00","TaxCategory=ABSENT","TaxSubtotal=ABSENT","AllowanceCharge=ABSENT"]
[A] S16 independent (discount as NET 11.50): net 8850, VAT exact 1327.5 → half-up 1328, total 10178
[A] S17 quote [869,130,999] → invoice [869,130,999]
[A] S18 default_tax_rate changed 15→5: old invoice line rate=15, new invoice line rate=5 tax=500
[A] S18 zero-rated line + shipping 10.00 head        {"subtotal":10000,"discount":0,"shipping":1000,"adjustment":0,"tax":150,"total":11150,"incl":false}
[A] S18 shipping VAT on a 0%-only invoice = 150 (hard-coded VAT_RATE=15)
   FAIL  Tests\Feature\VatInvoiceEngineProbeTest
  ✓ s1 three times 3 33                                                 12.42s  
  ✓ s2 ten lines of ten halalas                                          0.18s  
  ✓ s3 tax inclusive                                                     0.29s  
  ✓ s4 header discount mixed rates                                       0.09s  
  ✓ s5 line discount rounding edge                                       0.07s  
  ✓ s6 fractional quantity                                               0.09s  
  ⨯ s8 large amounts and overflow                                        0.05s  
  ✓ s9 mixed categories                                                  0.08s  
  ✓ s13 half way                                                         0.14s  
  ! s14 zero and negative → This test did not perform any assertions     0.14s  
  ✓ s15 xml qr ledger agreement                                          0.08s  
  ! s16 inclusive header discount → This test did not perform any asser… 0.10s  
  ✓ s17 quote vs invoice                                                 0.07s  
  ✓ s18 rate snapshot                                                    0.17s  
  ────────────────────────────────────────────────────────────────────────────  
   FAILED  Tests\Feature\VatInvoiceEngineProbeTest > s8 large amo…  TypeError   
  intdiv(): Argument #1 ($num1) must be of type int, float given
  at app/Services/Accounting/InvoiceService.php:1213
    1209▕             throw new RuntimeException('الخصم لا يمكن أن يتجاوز إجمالي السطور.');
    1210▕         }
    1211▕ 
    1212▕         $net    = $subtotal - $discount;
  ➜ 1213▕         $taxNet = $subtotal > 0 ? intdiv($taxGross * $net, $subtotal) : 0;
    1214▕ 
    1215▕         return [$discount, $taxNet, $net + $taxNet];
    1216▕     }
    1217▕
  1   app/Services/Accounting/InvoiceService.php:1213
  2   app/Services/Accounting/InvoiceService.php:625
  Duration: 13.99s
```

### `A-invoice-engine-pgsql.log`

```text
[A] S1 3x3.33@15 excl head                           {"subtotal":999,"discount":0,"shipping":0,"adjustment":0,"tax":150,"total":1149,"incl":false}
[A] S2 10x(1x0.10)@15 head                           {"subtotal":100,"discount":0,"shipping":0,"adjustment":0,"tax":20,"total":120,"incl":false}
[A] S2 QR tags 4/5                                   {"1":"Probe A","2":"300000000000003","3":"2026-10-10T12:37:56+00:00","4":"1.20","5":"0.20"}
[A] S2 stored VAT=20 (per-line rounding) vs document-level 15% of 1.00 = 15
[A] S2b 1x(10x0.10)@15 head                          {"subtotal":100,"discount":0,"shipping":0,"adjustment":0,"tax":15,"total":115,"incl":false}
[A] S3 incl 10000 head                               {"subtotal":8696,"discount":0,"shipping":0,"adjustment":0,"tax":1304,"total":10000,"incl":true}
[A] S3 incl 10000 lines                              [{"qty":1,"up":10000,"up_bt":8696,"rate":15,"sub":8696,"disc":0,"tax":1304,"tot":10000}]
[A] S3 incl 5 head                                   {"subtotal":4,"discount":0,"shipping":0,"adjustment":0,"tax":1,"total":5,"incl":true}
[A] S3 incl 5 lines                                  [{"qty":1,"up":5,"up_bt":4,"rate":15,"sub":4,"disc":0,"tax":1,"tot":5}]
[A] S3 incl 1 head                                   {"subtotal":1,"discount":0,"shipping":0,"adjustment":0,"tax":0,"total":1,"incl":true}
[A] S3 incl 1 lines                                  [{"qty":1,"up":1,"up_bt":1,"rate":15,"sub":1,"disc":0,"tax":0,"tot":1}]
[A] S3 incl 99999 head                               {"subtotal":86956,"discount":0,"shipping":0,"adjustment":0,"tax":13043,"total":99999,"incl":true}
[A] S3 incl 99999 lines                              [{"qty":1,"up":99999,"up_bt":86956,"rate":15,"sub":86956,"disc":0,"tax":13043,"tot":99999}]
[A] S3b incl 115 disc 11.50 head                     {"subtotal":9000,"discount":0,"shipping":0,"adjustment":0,"tax":1350,"total":10350,"incl":true}
[A] S3b incl 115 disc 11.50 lines                    [{"qty":1,"up":11500,"up_bt":10000,"rate":15,"sub":10000,"disc":1000,"tax":1350,"tot":10350}]
[A] S3b XML amounts                                  ["TaxAmount=13.50","TaxExclusiveAmount=90.00","TaxInclusiveAmount=103.50","PayableAmount=103.50","InvoicedQuantity=1","LineExtensionAmount=100.00","PriceAmount=115.00","TaxCategory=ABSENT","TaxSubtotal=ABSENT","AllowanceCharge=ABSENT"]
[A] S4 head                                          {"subtotal":15000,"discount":1500,"shipping":0,"adjustment":0,"tax":1350,"total":14850,"incl":false}
[A] S4 lines (line_tax pre-header-discount)          [{"qty":1,"up":10000,"up_bt":10000,"rate":15,"sub":10000,"disc":0,"tax":1500,"tot":11500},{"qty":1,"up":5000,"up_bt":5000,"rate":0,"sub":5000,"disc":0,"tax":0,"tot":5000}]
[A] S4 ledger                                        [["1130",14850,0],["4110",0,13500],["2120",0,1350]]
[A] S4 XML amounts                                   ["TaxAmount=13.50","TaxExclusiveAmount=150.00","TaxInclusiveAmount=148.50","PayableAmount=148.50","InvoicedQuantity=1","LineExtensionAmount=100.00","PriceAmount=100.00","InvoicedQuantity=1","LineExtensionAmount=50.00","PriceAmount=50.00","TaxCateg
[A] S4 QR                                            {"1":"Probe A","2":"300000000000003","3":"2026-10-10T12:37:57+00:00","4":"148.50","5":"13.50"}
[A] S5 head                                          {"subtotal":929,"discount":0,"shipping":0,"adjustment":0,"tax":139,"total":1068,"incl":false}
[A] S5 lines                                         [{"qty":3,"up":333,"up_bt":333,"rate":15,"sub":999,"disc":70,"tax":139,"tot":1068}]
[A] S5 XML amounts                                   ["TaxAmount=1.39","TaxExclusiveAmount=9.29","TaxInclusiveAmount=10.68","PayableAmount=10.68","InvoicedQuantity=3","LineExtensionAmount=9.99","PriceAmount=3.33","TaxCategory=ABSENT","TaxSubtotal=ABSENT","AllowanceCharge=ABSENT"]
[A] S6 0.333x1.00 head                               {"subtotal":33,"discount":0,"shipping":0,"adjustment":0,"tax":5,"total":38,"incl":false}
[A] S6 0.333x1.00 lines                              [{"qty":1,"up":100,"up_bt":100,"rate":15,"sub":33,"disc":0,"tax":5,"tot":38}]
[A] S6 0.333x1.00 XML                                ["TaxAmount=0.05","TaxExclusiveAmount=0.33","TaxInclusiveAmount=0.38","PayableAmount=0.38","InvoicedQuantity=0.333","LineExtensionAmount=0.33","PriceAmount=1.00","TaxCategory=ABSENT","TaxSubtotal=ABSENT","AllowanceCharge=ABSENT"]
[A] S6 1/3x1.00 draft head                           {"subtotal":33,"discount":0,"shipping":0,"adjustment":0,"tax":5,"total":38,"incl":false}
[A] S6 1/3 qty post FAILED: RuntimeException: مقام كمية سطر الفاتورة لا يمكن تمثيله عشرياً بدقة في ZATCA.
[A] S9 head                                          {"subtotal":30000,"discount":0,"shipping":0,"adjustment":0,"tax":1500,"total":31500,"incl":false}
[A] S9 lines                                         [{"qty":1,"up":10000,"up_bt":10000,"rate":15,"sub":10000,"disc":0,"tax":1500,"tot":11500},{"qty":1,"up":10000,"up_bt":10000,"rate":0,"sub":10000,"disc":0,"tax":0,"tot":10000},{"qty":1,"up":10000,"up_bt":10000,"rate":0,"sub":10000,"disc":0,"tax":0,
[A] S9 XML amounts/category                          ["TaxAmount=15.00","TaxExclusiveAmount=300.00","TaxInclusiveAmount=315.00","PayableAmount=315.00","InvoicedQuantity=1","LineExtensionAmount=100.00","PriceAmount=100.00","InvoicedQuantity=1","LineExtensionAmount=100.00","PriceAmount=100.00","Invoic
[A] S13 base=10 tax=2 (half-up expectation 2)
[A] S13 base=30 tax=5 (half-up expectation 5)
[A] S13 base=50 tax=8 (half-up expectation 8)
[A] S14 zero invoice FAILED: RuntimeException: القيد يجب أن يحتوي على سطرين على الأقل.
[A] S14 negative total rejected: التسوية تجعل إجمالي الفاتورة سالباً.
[A] S14 discount>subtotal rejected: الخصم لا يمكن أن يتجاوز إجمالي السطور.
[A] S14 adj=-15.00 head                              {"subtotal":10000,"discount":0,"shipping":0,"adjustment":-1500,"tax":1500,"total":10000,"incl":false}
[A] S14 adj=-15.00 QR                                {"1":"Probe A","2":"300000000000003","3":"2026-10-10T12:37:58+00:00","4":"100.00","5":"15.00"}
[A] S14 adj=-15.00 ledger                            [["1130",10000,0],["4110",0,10000],["2120",0,1500],["5170",1500,0]]
[A] S15 head                                         {"subtotal":12000,"discount":500,"shipping":1000,"adjustment":-7,"tax":1443,"total":13936,"incl":false}
[A] S15 lines                                        [{"qty":2,"up":5000,"up_bt":5000,"rate":15,"sub":10000,"disc":1000,"tax":1350,"tot":10350},{"qty":1,"up":3000,"up_bt":3000,"rate":0,"sub":3000,"disc":0,"tax":0,"tot":3000}]
[A] S15 ledger                                       [["1130",13936,0],["4110",0,11500],["4130",0,1000],["2120",0,1443],["5170",7,0]]
[A] S15 XML amounts                                  ["TaxAmount=14.43","TaxExclusiveAmount=120.00","TaxInclusiveAmount=139.36","PayableAmount=139.36","InvoicedQuantity=2","LineExtensionAmount=100.00","PriceAmount=50.00","InvoicedQuantity=1","LineExtensionAmount=30.00","PriceAmount=30.00","TaxCatego
[A] S15 QR                                           {"1":"Probe A","2":"300000000000003","3":"2026-10-10T12:37:59+00:00","4":"139.36","5":"14.43"}
[A] S15 independent: goods VAT exact 1293.75 → half-up 1294 (AWJ stores intdiv → 1293?), shipping VAT 150
[A] S16 incl 115 hdr disc 1150 head                  {"subtotal":10000,"discount":1150,"shipping":0,"adjustment":0,"tax":1327,"total":10177,"incl":true}
[A] S16 XML amounts                                  ["TaxAmount=13.27","TaxExclusiveAmount=100.00","TaxInclusiveAmount=101.77","PayableAmount=101.77","InvoicedQuantity=1","LineExtensionAmount=100.00","PriceAmount=115.00","TaxCategory=ABSENT","TaxSubtotal=ABSENT","AllowanceCharge=ABSENT"]
[A] S16 independent (discount as NET 11.50): net 8850, VAT exact 1327.5 → half-up 1328, total 10178
[A] S17 quote [869,130,999] → invoice [869,130,999]
[A] S18 default_tax_rate changed 15→5: old invoice line rate=15, new invoice line rate=5 tax=500
[A] S18 zero-rated line + shipping 10.00 head        {"subtotal":10000,"discount":0,"shipping":1000,"adjustment":0,"tax":150,"total":11150,"incl":false}
[A] S18 shipping VAT on a 0%-only invoice = 150 (hard-coded VAT_RATE=15)
   FAIL  Tests\Feature\VatInvoiceEngineProbeTest
  ✓ s1 three times 3 33                                                  6.41s  
  ✓ s2 ten lines of ten halalas                                          0.35s  
  ✓ s3 tax inclusive                                                     0.61s  
  ✓ s4 header discount mixed rates                                       0.27s  
  ✓ s5 line discount rounding edge                                       0.20s  
  ✓ s6 fractional quantity                                               0.31s  
  ⨯ s8 large amounts and overflow                                        0.17s  
  ✓ s9 mixed categories                                                  0.25s  
  ✓ s13 half way                                                         0.44s  
  ! s14 zero and negative → This test did not perform any assertions     0.28s  
  ✓ s15 xml qr ledger agreement                                          0.27s  
  ! s16 inclusive header discount → This test did not perform any asser… 0.27s  
  ✓ s17 quote vs invoice                                                 0.17s  
  ✓ s18 rate snapshot                                                    0.40s  
  ────────────────────────────────────────────────────────────────────────────  
   FAILED  Tests\Feature\VatInvoiceEngineProbeTest > s8 large amo…  TypeError   
  intdiv(): Argument #1 ($num1) must be of type int, float given
  at app/Services/Accounting/InvoiceService.php:1213
    1209▕             throw new RuntimeException('الخصم لا يمكن أن يتجاوز إجمالي السطور.');
    1210▕         }
    1211▕ 
    1212▕         $net    = $subtotal - $discount;
  ➜ 1213▕         $taxNet = $subtotal > 0 ? intdiv($taxGross * $net, $subtotal) : 0;
    1214▕ 
    1215▕         return [$discount, $taxNet, $net + $taxNet];
    1216▕     }
    1217▕
  1   app/Services/Accounting/InvoiceService.php:1213
  2   app/Services/Accounting/InvoiceService.php:625
  Duration: 10.44s
```

### `A-invoice-s8.log`

```text
[A] S8 create/post 9,999,999,999.99 (no discount) FAILED: TypeError: intdiv(): Argument #1 ($num1) must be of type int, float given @InvoiceService.php:1213
[A] S8 9,999,999,999.99 @0% posted                   {"subtotal":999999999999,"discount":0,"shipping":0,"adjustment":0,"tax":0,"total":999999999999,"incl":false}
[A] S8 create up=7840000000 disc=0                   {"subtotal":7840000000,"discount":0,"shipping":0,"adjustment":0,"tax":1176000000,"total":9016000000,"incl":false}
[A] S8 create up=7850000000 disc=0 FAILED: TypeError: intdiv(): Argument #1 ($num1) must be of type int, float given
[A] S8 create up=8000000000 disc=0 FAILED: TypeError: intdiv(): Argument #1 ($num1) must be of type int, float given
[A] S8 create up=7000000000 disc=0                   {"subtotal":7000000000,"discount":0,"shipping":0,"adjustment":0,"tax":1050000000,"total":8050000000,"incl":false}
[A] S8 2x25M draft head                              {"subtotal":5000000000,"discount":0,"shipping":0,"adjustment":0,"tax":750000000,"total":5750000000,"incl":false}
[A] S8 2x25M FAILED: TypeError: intdiv(): Argument #1 ($num1) must be of type int, float given
   WARN  Tests\Feature\VatInvoiceEngineProbeTest
  ! s8 large amounts and overflow → This test did not perform any asser… 8.67s  
  Duration: 8.71s
```

### `A-pos.log`

```text
[A] S12 POS invoice                                      {"subtotal":5999,"discount":0,"tax":150,"total":6149,"incl":false,"lines":[[3,333,15,999,70,139,1068],[7,10,15,70,0,11,81],[1,5000,0,5000,0,0,5000]]}
[A] S12 InvoiceService invoice                           {"subtotal":5999,"discount":0,"tax":150,"total":6149,"incl":false,"lines":[[3,333,15,999,70,139,1068],[7,10,15,70,0,11,81],[1,5000,0,5000,0,0,5000]]}
[A] S12b client tax_rate=0 on 15% product                {"subtotal":333,"discount":0,"tax":50,"total":383,"incl":false,"lines":[[1,333,15,333,0,50,383]]}
[A] S12b client tax_inclusive=true, catalog price 3.33   {"subtotal":290,"discount":0,"tax":43,"total":333,"incl":true,"lines":[[1,333,15,290,0,43,333]]}
[A] S12b client tax_inclusive=false, catalog price 3.33  {"subtotal":333,"discount":0,"tax":50,"total":383,"incl":false,"lines":[[1,333,15,333,0,50,383]]}
[A] S12b same catalog price, same product: VAT 43 (inclusive flag) vs 50 (exclusive) — flag is client-supplied
[A] R5 POS invoice 7x0.10                                {"subtotal":70,"discount":0,"tax":11,"total":81,"incl":false,"lines":[[7,10,15,70,0,11,81]]}
[A] R5 POS return qty=3                                  {"subtotal":30,"tax":4,"total":34,"incl":false}
[A] R5 POS return qty=4                                  {"subtotal":40,"tax":7,"total":47,"incl":false}
[A] R5 Σ POS returns vs invoice                         {"returns":{"sub":70,"tax":11,"total":81},"invoice":[70,11,81]}
[A] R6 POS inclusive invoice                             {"subtotal":869,"discount":0,"tax":130,"total":999,"incl":true,"lines":[[3,333,15,869,0,130,999]]}
[A] R6 POS return 1 of 3 (inclusive)                     {"subtotal":289,"tax":43,"total":332,"line":[[1,333,289,0,43,332]]}
   PASS  Tests\Feature\VatPosProbeTest
  ✓ s12 pos vs invoice service                                          15.37s  
  ✓ s12b client flags                                                    0.25s  
  ✓ r5 pos partial returns                                               0.27s  
  ✓ r6 pos return inclusive                                              0.23s  
  Duration: 16.17s
```

### `A-purchase.log`

```text
[A] P1 incl 3x3.33 head                                  {"subtotal":869,"discount":0,"shipping":0,"tax":130,"total":999,"incl":true,"lines":[[3,333,15,869,0,130,999]]}
[A] P1 ledger                                            [["5150",869,0],["1150",130,0],["2110",0,999]]
[A] P2 mixed + shipping head                             {"subtotal":20000,"discount":0,"shipping":2000,"tax":1650,"total":23650,"incl":false,"lines":[[1,10000,15,10000,0,1500,11500],[1,10000,0,10000,0,0,10000]]}
[A] P2 ledger                                            [["5150",22000,0],["1150",1650,0],["2110",0,23650]]
[A] P2 purchase VAT=1650; shipping@15% expectation 1800; blended 7.5% = 1650
[A] P2b 0%-only purchase + shipping 20.00 → VAT=0 (sales side would charge 15% on shipping = 300)
[A] P3 head                                              {"subtotal":999,"discount":100,"shipping":0,"tax":134,"total":1033,"incl":false,"lines":[[3,333,15,999,0,150,1149]]}
[A] P3 ledger                                            [["5150",899,0],["1150",134,0],["2110",0,1033]]
[A] P3 VAT stored=134; independent half-up on net 8.99 = 135
[A] P4 create up=7000000000                              {"subtotal":7000000000,"tax":1050000000,"total":8050000000}
[A] P4 create up=8000000000 FAILED: TypeError: intdiv(): Argument #1 ($num1) must be of type int, float given
[A] P5 incl + line disc head                             {"subtotal":9000,"discount":0,"shipping":0,"tax":1350,"total":10350,"incl":true,"lines":[[1,11500,15,9000,1150,1350,10350]]}
[A] E1 expense amount 115.00 @15                         {"amount":11500,"tax":1725,"total":13225}
[A] E1 ledger                                            [["5130",11500,0],["1150",1725,0],["1110",0,13225]]
[A] E1 a 115.00 VAT-inclusive receipt must be entered as 100.00 manually; no inclusive mode for expenses
   WARN  Tests\Feature\VatPurchaseExpenseProbeTest
  ✓ p1 inclusive purchase                                               11.43s  
  ! p2 shipping blended rate → This test did not perform any assertions  0.10s  
  ! p3 header discount truncation → This test did not perform any asser… 0.08s  
  ! p4 large purchase → This test did not perform any assertions         0.06s  
  ✓ p5 inclusive line discount                                           0.07s  
  ! e1 expense → This test did not perform any assertions                0.06s  
  Duration: 11.86s
```

### `A-returns.log`

```text
[A] R1 invoice head                                      {"subtotal":70,"tax":11,"total":81}
[A] R1 Σ returned VAT=14 vs invoice VAT=11; Σ returned total=84 vs invoice total=81
[A] R2 inclusive invoice head                            {"subtotal":10000,"tax":1500,"total":11500,"line_unit_price":11500,"line_up_before_tax":10000}
[A] R2 return head                                       {"tax_inclusive_flag":true,"subtotal":11500,"tax":1725,"total":13225}
[A] R2 return ledger                                     [["4110",11500,0],["2120",1725,0],["1130",0,13225]]
[A] R2 refund total 13225 vs charged 11500; VAT reversed 1725 vs charged VAT 1500
[A] R2 HTTP POST /api/returns status=201 data={"status":"draft","subtotal":"115.00","tax_amount":"17.25","total":"132.25"}
[A] R2 HTTP POST /api/returns/{id}/post status=200 data={"status":"posted","subtotal":"115.00","tax_amount":"17.25","total":"132.25"}
[A] R3 invoice head                                      {"subtotal":10000,"discount":1000,"tax":1350,"total":10350}
[A] R3 full return head                                  {"subtotal":10000,"tax":1500,"total":11500}
[A] R3 refund 11500 vs charged 10350; VAT reversed 1500 vs charged 1350
[A] R4 credit note (qty 2 > sold 1, no tax_rate given)   {"subtotal":23000,"tax":3450,"total":26450,"line_rate":15}
[A] R4 CN ledger                                         [["4110",23000,0],["2120",3450,0],["1130",0,26450]]
[A] R4 credit note total 26450 vs invoice total 11500
[A] R5 sales.default_tax_rate=0 → invoice rate=0 | return rate=15 | credit note rate=15 | recurring rate=15 | expense rate=15
   WARN  Tests\Feature\VatReturnsCreditsProbeTest
  ✓ r1 partial returns rounding drift                                    9.62s  
  ✓ r2 return against inclusive invoice                                  0.19s  
  ! r3 return against header discounted invoice → This test did not per… 0.10s  
  ! r4 credit note vs original → This test did not perform any assertio… 0.10s  
  ! r5 hardcoded default 15 → This test did not perform any assertions   0.10s  
  Duration: 10.15s
```

## Stream B — Accounting

### `B-mix.log`

```text
   WARN  Metadata found in doc-comment for method Tests\Feature\BMixedScenarioProbeTest::mixed_scenario_reconciles_and_isolates(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
[B-MIX] P1 purchase: {"number":"BILL-2026-00001","subtotal":110000,"discount":5000,"tax_amount":15750,"total":120750,"status":"posted"}
[B-MIX] I1 cash invoice: {"number":"INV-2026-00001","subtotal":100000,"tax_amount":15000,"total":115000}
[B-MIX] I2 credit invoice (0%+15%+discount+shipping): {"number":"INV-2026-00002","subtotal":150000,"discount":10000,"shipping":2000,"tax_amount":14300,"total":156300}
[B-MIX] I2 lines: [{"tax_rate":0,"line_subtotal":50000,"line_discount":0,"line_tax":0,"line_total":50000},{"tax_rate":15,"line_subtotal":100000,"line_discount":0,"line_tax":15000,"line_total":115000}]
[B-MIX] I3 inclusive invoice: {"number":"INV-2026-00003","subtotal":100000,"tax_amount":15000,"total":115000}
[B-MIX] E1 expense: {"number":"EXP-2026-00001","amount":20000,"tax_amount":3000,"total":23000}
[B-MIX] CN partial credit note: {"number":"CN-2026-00001","subtotal":20000,"tax_amount":3000,"total":23000}
[B-MIX] R1 partial sales return: {"number":"SRET-2026-00001","subtotal":50000,"tax_amount":7500,"total":57500}
[B-MIX] PR partial purchase return: {"number":"PRET-2026-00001","subtotal":50000,"tax_amount":7500,"total":57500}
[B-MIX] MJ manual VAT journal reversed: {"number":"MJE-2026-00001","status":"reversed"}
[B-MIX] TB March: {"debit":371323,"credit":371323,"balanced":true}
[B-MIX] Σ all lines: {"debit":717777,"credit":717777}
[B-MIX] AccountBalance mismatches: []
[B-MIX] 2120 output movement: {"debit":11500,"credit":45300}
[B-MIX] 1150 input movement: {"debit":19750,"credit":8500}
[B-MIX] Σ docs output VAT (inv − cn − ret): 33800
[B-MIX] Σ docs input VAT (pur + exp − pret): 11250
[B-MIX] taxReport March: {"input_vat":11250,"output_vat":33800,"net_vat":22550,"status":"payable"}
[B-MIX] taxReport 1-17 March (before CN/return): {"input_vat":18750,"output_vat":44300,"net_vat":25550,"status":"payable"}
[B-MIX] journal entries without source_type: 1
[B-MIX] journal entries by source_type: {"":1,"App\\Models\\CreditNote":1,"App\\Models\\Expense":1,"App\\Models\\Invoice":4,"App\\Models\\ManualJournal":1,"App\\Models\\Purchase":1,"App\\Models\\ReturnDocument":2}
[B-MIX] branch_id values on VAT lines: ["NULL"]
[B-MIX] CN VAT line account: {"debit":3000,"credit":0}
[B-MIX] taxReport tenant B (expects 6000/0): {"input_vat":0,"output_vat":6000,"net_vat":6000,"status":"payable"}
[B-MIX] taxReport tenant A after B activity: {"input_vat":11250,"output_vat":33800,"net_vat":22550,"status":"payable"}
[B-MIX] taxReport with NO tenant context (sum of A+B = cross-tenant aggregate): {"input_vat":11250,"output_vat":6000,"net_vat":-5250,"status":"recoverable"}
[B-MIX] trialBalance with NO tenant context rows: 15
   PASS  Tests\Feature\BMixedScenarioProbeTest
  ✓ mixed scenario reconciles and isolates                               8.98s  
  Duration: 9.02s
```

### `B-mix-pg.log`

```text
   WARN  Metadata found in doc-comment for method Tests\Feature\BMixedScenarioProbeTest::mixed_scenario_reconciles_and_isolates(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
[B-MIX] P1 purchase: {"number":"BILL-2026-00001","subtotal":110000,"discount":5000,"tax_amount":15750,"total":120750,"status":"posted"}
[B-MIX] I1 cash invoice: {"number":"INV-2026-00001","subtotal":100000,"tax_amount":15000,"total":115000}
[B-MIX] I2 credit invoice (0%+15%+discount+shipping): {"number":"INV-2026-00002","subtotal":150000,"discount":10000,"shipping":2000,"tax_amount":14300,"total":156300}
[B-MIX] I2 lines: [{"tax_rate":0,"line_subtotal":50000,"line_discount":0,"line_tax":0,"line_total":50000},{"tax_rate":15,"line_subtotal":100000,"line_discount":0,"line_tax":15000,"line_total":115000}]
[B-MIX] I3 inclusive invoice: {"number":"INV-2026-00003","subtotal":100000,"tax_amount":15000,"total":115000}
[B-MIX] E1 expense: {"number":"EXP-2026-00001","amount":20000,"tax_amount":3000,"total":23000}
[B-MIX] CN partial credit note: {"number":"CN-2026-00001","subtotal":20000,"tax_amount":3000,"total":23000}
[B-MIX] R1 partial sales return: {"number":"SRET-2026-00001","subtotal":50000,"tax_amount":7500,"total":57500}
[B-MIX] PR partial purchase return: {"number":"PRET-2026-00001","subtotal":50000,"tax_amount":7500,"total":57500}
[B-MIX] MJ manual VAT journal reversed: {"number":"MJE-2026-00001","status":"reversed"}
[B-MIX] TB March: {"debit":371323,"credit":371323,"balanced":true}
[B-MIX] Σ all lines: {"debit":717777,"credit":717777}
[B-MIX] AccountBalance mismatches: []
[B-MIX] 2120 output movement: {"debit":11500,"credit":45300}
[B-MIX] 1150 input movement: {"debit":19750,"credit":8500}
[B-MIX] Σ docs output VAT (inv − cn − ret): 33800
[B-MIX] Σ docs input VAT (pur + exp − pret): 11250
[B-MIX] taxReport March: {"input_vat":11250,"output_vat":33800,"net_vat":22550,"status":"payable"}
[B-MIX] taxReport 1-17 March (before CN/return): {"input_vat":18750,"output_vat":44300,"net_vat":25550,"status":"payable"}
[B-MIX] journal entries without source_type: 1
[B-MIX] journal entries by source_type: {"App\\Models\\CreditNote":1,"App\\Models\\Expense":1,"App\\Models\\Invoice":4,"App\\Models\\ManualJournal":1,"App\\Models\\Purchase":1,"App\\Models\\ReturnDocument":2,"":1}
[B-MIX] branch_id values on VAT lines: ["NULL"]
[B-MIX] CN VAT line account: {"debit":3000,"credit":0}
[B-MIX] taxReport tenant B (expects 6000/0): {"input_vat":0,"output_vat":6000,"net_vat":6000,"status":"payable"}
[B-MIX] taxReport tenant A after B activity: {"input_vat":11250,"output_vat":33800,"net_vat":22550,"status":"payable"}
[B-MIX] taxReport with NO tenant context (sum of A+B = cross-tenant aggregate): {"input_vat":11250,"output_vat":6000,"net_vat":-5250,"status":"recoverable"}
[B-MIX] trialBalance with NO tenant context rows: 15
   PASS  Tests\Feature\BMixedScenarioProbeTest
  ✓ mixed scenario reconciles and isolates                               6.89s  
  Duration: 6.93s
```

### `B-route.log`

```text
   WARN  Metadata found in doc-comment for method Tests\Feature\BRoutingVatProbeTest::vat_roles_can_be_mapped_to_any_posting_account_and_reports_follow_codes_not_roles(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes ins
[B-ROUTE] PUT tax_output→4110 (revenue) HTTP: 200
[B-ROUTE] invoice tax_amount: 15000
[B-ROUTE] invoice journal lines (code, dr, cr): [["1110",115000,0],["4110",0,100000],["4110",0,15000]]
[B-ROUTE] taxReport after VAT routed to revenue (invoice VAT 15000): {"input_vat":0,"output_vat":0,"net_vat":0,"status":"payable"}
[B-ROUTE] credit note journal lines: [["4110",100000,0],["2120",15000,0],["1130",0,115000]]
[B-ROUTE] taxReport after CN (output should be 0, invoice+CN net): {"input_vat":0,"output_vat":-15000,"net_vat":-15000,"status":"recoverable"}
[B-ROUTE] sales return journal lines: [["4110",10000,0],["2120",1500,0],["1130",0,11500]]
[B-ROUTE] setMapping tax_output→1150 (merge with input): 'ACCEPTED'
[B-ROUTE] setMapping tax_input→2120: 'ACCEPTED'
[B-ROUTE] setMapping tax_input→1110 (cash): 'ACCEPTED'
[B-ROUTE] purchase journal lines (tax_input mapped to 1110): [["5150",10000,0],["1110",1500,0],["2110",0,11500]]
[B-ROUTE] expense journal lines (hard-coded 1150): [["5130",10000,0],["1150",1500,0],["1120",0,11500]]
[B-ROUTE] taxReport April final: {"input_vat":1500,"output_vat":-16500,"net_vat":-18000,"status":"recoverable"}
[B-ROUTE] routing list tax_output mapping state: {"state":"mapped","account":{"id":"a2f2c510-8dbe-45e6-8f2c-5ee700799c0a","code":"1150","name":"ضريبة القيمة المضافة - مدخلات","name_en":"VAT Input","is_active":true,"is_group":false},"is_default":false}
   PASS  Tests\Feature\BRoutingVatProbeTest
  ✓ vat roles can be mapped to any posting account and reports follow c… 8.50s  
  Duration: 8.53s
```

### `B-imm.log`

```text
   WARN  Metadata found in doc-comment for method Tests\Feature\BImmutabilityProbeTest::posted_documents_and_journals_resist_or_do_not_resist_mutation(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
[B-IMM] second POST /post HTTP: '422 لا يمكن ترحيل فاتورة غير مسوّدة (draft).'
[B-IMM] PUT posted invoice HTTP: '422 لا يمكن تعديل فاتورة مرحّلة.'
[B-IMM] DELETE posted invoice HTTP: '422 لا يمكن حذف فاتورة مرحّلة.'
[B-IMM] journal entries for invoice after double post: 1
[B-IMM] service re-post: 'REJECTED: لا يمكن ترحيل فاتورة غير مسوّدة (draft).'
[B-IMM] Eloquent update of posted invoice: {"returned":true,"tax_amount":1,"total":1,"invoice_date":"2025-01-01","status":"posted"}
[B-IMM] DocumentRevision rows before/after: [2,3]
[B-IMM] Eloquent update of posted JournalLine credit→0: {"returned":true,"credit_now":0}
[B-IMM] Eloquent update of posted JournalEntry date/status: {"returned":true,"now":{"entry_date":"2025-01-01T00:00:00.000000Z","status":"draft"}}
[B-IMM] Eloquent delete of JournalEntry: {"returned":true,"lines_left":0,"invoice_status":"posted","invoice.journal_entry_id":null}
[B-IMM] AccountBalance 2120 before/after delete (stale?): [15000,15000]
[B-IMM] raw DB update on journal_lines affected rows (no trigger?): 0
[B-IMM] FinancialControlService scan: {"detected":1,"rules":["posted_source_without_journal"]}
[B-IMM] CN 10x original invoice create HTTP: 201
[B-IMM] CN 10x original invoice post HTTP: '200 total=1150.00'
[B-IMM] CN against a DRAFT (never issued) invoice create HTTP: 201
[B-IMM] CN against draft invoice post HTTP: 200
[B-IMM] CN whose partner ≠ original invoice partner create HTTP: 201
[B-IMM] B reads A account ledger HTTP: 404
[B-IMM] B reads A invoice accounting HTTP: 404
[B-IMM] B tax report (expects zeros): {"input_vat":"0.00","output_vat":"0.00","net_vat":"0.00","status":"payable"}
[B-IMM] B journal entries count: 0
[B-IMM] B reads A partner statement HTTP: 404
   PASS  Tests\Feature\BImmutabilityProbeTest
  ✓ posted documents and journals resist or do not resist mutation       9.29s  
  Duration: 9.34s
```

### `B-lock.log`

```text
   WARN  Metadata found in doc-comment for method Tests\Feature\BPeriodLockProbeTest::locks_tax_point_and_period_drift(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
[B-LOCK] Jan tax report as "filed": {"input_vat":0,"output_vat":15000,"net_vat":15000,"status":"payable"}
[B-LOCK] lock created: 'active 2026-01-01..2026-01-31'
[B-LOCK] draft inside locked period created: 'draft'
[B-LOCK] post into locked period: 'BLOCKED: ترحيل قيد بتاريخ 2026-01-15 مرفوض: الفترة المحاسبية من 2026-01-01 إلى 2026-01-31 مقفلة.'
[B-LOCK] draft status after blocked post: 'draft journal=NULL'
[B-LOCK] reversal dated inside lock: 'BLOCKED'
[B-LOCK] reversal with default date: "2026-10-10T00:00:00.000000Z"
[B-LOCK] March-dated invoice posted today: entry_date / posted_at: ["2026-03-15","2026-10-10"]
[B-LOCK] taxReport March: {"input_vat":0,"output_vat":15000,"net_vat":15000,"status":"payable"}
[B-LOCK] taxReport this month (2026-10): {"input_vat":500,"output_vat":500,"net_vat":0,"status":"payable"}
[B-LOCK] future-dated invoice (2027-06-01) post: 'ACCEPTED status=posted'
[B-LOCK] Jan tax report after back-dated CN (filed figure drifted?): {"input_vat":0,"output_vat":0,"net_vat":0,"status":"payable"}
[B-LOCK] any VAT-period/filing record model exists?: 'no'
   PASS  Tests\Feature\BPeriodLockProbeTest
  ✓ locks tax point and period drift                                     9.00s  
  Duration: 9.03s
```

### `B-pos.log`

```text
   WARN  Metadata found in doc-comment for method Tests\Feature\BPosApiProbeTest::pos_sale_return_and_close(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
[B-POS] checkout HTTP: 201
[B-POS] POS invoice: {"number":"INV-2026-00001","payment_type":"credit","status":"posted","tax_amount":3000,"total":23000,"paid_amount":23000,"payment_status":"paid","branch":"set","invoice_date":"2026-10-10"}
[B-POS] POS invoice journal: [["1130",23000,0,"branch=set"],["4110",0,20000,"branch=set"],["2120",0,3000,"branch=set"]]
[B-POS] POS payments: [["cash",10000,"posted"],["bank",13000,"posted"]]
[B-POS] payment journal cash: [["1110",10000,0,"branch=set"],["1130",0,10000,"branch=set"]]
[B-POS] payment journal bank: [["1120",13000,0,"branch=set"],["1130",0,13000,"branch=set"]]
[B-POS] replay same key: ids equal / invoices for key: [true,2]
[B-POS] POS checkout with client tax_rate=0 → invoice tax_amount: '201 tax=15.00'
[B-POS] POS return HTTP: '422 سياسة نقطة البيع تسمح برد النقد حتى المبلغ النقدي المقبوض على الفاتورة المصدر فقط.'
[B-POS] session close HTTP / new journal entries: [200,0]
[B-POS] tax report via API: {"input_vat":"0.00","output_vat":"60.00","net_vat":"60.00","status":"payable"}
   PASS  Tests\Feature\BPosApiProbeTest
  ✓ pos sale return and close                                            9.84s  
  Duration: 9.87s
```

### `B-double-post-pg.log`

```text
[B-PG] S1 invoice double-post results: ["OK posted","ERR RuntimeException: لا يمكن ترحيل فاتورة غير مسوّدة (draft).","ERR RuntimeException: لا يمكن ترحيل فاتورة غير مسوّدة (draft)."]
[B-PG] S1 journal entries for invoice: 1 | invoice status=posted
[B-PG] S2 purchase double-post results: ["ERR RuntimeException: لا يمكن ترحيل فاتورة مشتريات غير مسوّدة (draft).","OK posted","ERR RuntimeException: لا يمكن ترحيل فاتورة مشتريات غير مسوّدة (draft)."]
[B-PG] S2 journal entries for purchase: 1
[B-PG] S3 double-reverse results: ["ERR RuntimeException: لا يمكن عكس قيد غير مرحّل.","OK JE-2026-00004","ERR RuntimeException: لا يمكن عكس قيد غير مرحّل."]
[B-PG] S3 reversals of entry: 1 | original status=reversed
[B-PG] S4 lock-vs-post rounds: [{"round":0,"results":["OK lock active","ERR App\\Services\\Accounting\\AccountingPeriodLockedException: ترحيل قيد بتاريخ 2026-07-15 مرفوض: الفترة المحاسبية من 2026-07-01 إلى 2026-07-31 مقفلة."],"invoice_posted":false,"lock_active":true},{"round":1,"results":["OK lock 
[B-PG] ledger Σ debit/credit for probe tenant: 126700 / 126700
[B-PG] duplicate journal numbers: 0
[B-PG] done
```

## Stream C — ZATCA Phase 1

### `C-probe1.log`

```text
   WARN  Metadata found in doc-comment for method Tests\Feature\CPhase1QrProbeTest::qr_timestamp_is_draft_creation_time_not_invoice_date_nor_posting_time(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\CPhase1QrProbeTest::qr_timestamp_offset_follows_app_timezone(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\CPhase1QrProbeTest::tlv_length_byte_overflows_for_seller_names_longer_than_255_bytes(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\CPhase1QrProbeTest::seller_without_vat_number_still_posts_and_qr_tag2_is_empty(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\CPhase1QrProbeTest::zero_tax_and_large_totals_format_and_xml_content_inventory(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\CPhase1QrProbeTest::explicit_standard_posts_without_buyer_vat_or_address_and_vat_buyer_auto_classifies_standard(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attrib
   WARN  Metadata found in doc-comment for method Tests\Feature\CPhase1QrProbeTest::stored_qr_and_xml_survive_tenant_rename_but_qrFor_recomputes_live(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\CPhase1QrProbeTest::post_issue_mutation_guards_exist_in_service_only_not_in_model(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\CPhase1QrProbeTest::drafts_carry_a_legal_number_but_no_qr_and_credit_or_return_documents_have_no_zatca_columns(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attribu
[C-PROBE] app.timezone: UTC
[C-PROBE] invoice_date (printed date): 2026-09-15
[C-PROBE] created_at: 2026-10-01 09:00:00
[C-PROBE] QR tag3 timestamp: 2026-10-01T09:00:00+00:00
[C-PROBE] XML IssueDate/IssueTime: ["2026-10-01","09:00:00"]
[C-PROBE] journal entry_date: 2026-09-15
[C-PROBE] Asia/Riyadh: created_at raw: 2026-10-01 12:00:00
[C-PROBE] Asia/Riyadh: QR tag3: 2026-10-01T12:00:00+03:00
[C-PROBE] seller name bytes: 260
[C-PROBE] TLV tag1 length byte: 4
[C-PROBE] decoded tag1 bytes: 4
[C-PROBE] decoded tags present: [1,217,133]
[C-PROBE] decoded tag2 (expected VAT 300000000000003): null
[C-PROBE] no-VAT tenant: status: posted
[C-PROBE] no-VAT tenant: QR tag2: 
[C-PROBE] no-VAT tenant: XML CompanyID: 
[C-PROBE] standard w/o buyer VAT: status/type: ["posted","standard"]
[C-PROBE] standard w/o buyer VAT: buyer XML: <cac:Party> <cac:PartyLegalEntity><cbc:RegistrationName>عميل تجزئة</cbc:RegistrationName></cac:PartyLegalEntity> </cac:Party>
[C-PROBE] VAT buyer auto: type: standard
[C-PROBE] VAT buyer auto: XML contains buyer VAT?: false
[C-PROBE] alpha VAT partner: stored vat / type: ["ABCDEFGHIJKLMNO","simplified"]
[C-PROBE] stored QR unchanged after rename: true
[C-PROBE] stored XML unchanged after rename: true
[C-PROBE] qrFor(live) == stored: false
[C-PROBE] live tag1: اسم جديد بعد الإصدار
[C-PROBE] invoice seller/buyer snapshot columns: []
[C-PROBE] mutation guards: {"service.update":"blocked: لا يمكن تعديل فاتورة مرحّلة.","service.deleteDraft":"blocked: لا يمكن حذف فاتورة مرحّلة.","model.update(total,zatca_document_type,zatca_qr,number)":[1,"standard","TAMPERED","X-1"],"model.delete -> row exists?":false,"model.delete -> journal entr
[C-PROBE] draft number / qr / xml / icv: ["INV-2026-00001",null,null,null]
[C-PROBE] credit_notes zatca/qr columns: []
[C-PROBE] return_documents zatca/qr columns: []
[C-PROBE] invoices zatca/qr columns: ["zatca_qr","zatca_hash","zatca_uuid","zatca_icv","zatca_previous_hash","zatca_xml","zatca_document_type","zatca_cleared_xml"]
   FAIL  Tests\Feature\CPhase1QrProbeTest
  ✓ qr timestamp is draft creation time not invoice date nor posting ti… 8.56s  
  ✓ qr timestamp offset follows app timezone                             0.09s  
  ✓ tlv length byte overflows for seller names longer than 255 bytes     0.07s  
  ✓ seller without vat number still posts and qr tag2 is empty           0.08s  
  ⨯ zero tax and large totals format and xml content inventory           0.11s  
  ✓ explicit standard posts without buyer vat or address and vat buyer…  0.17s  
  ✓ stored qr and xml survive tenant rename but qr for recomputes live   0.10s  
  ✓ post issue mutation guards exist in service only not in model        0.09s  
  ⨯ drafts carry a legal number but no qr and credit or return document… 0.07s  
  ────────────────────────────────────────────────────────────────────────────  
   FAILED  Tests\Feature\CPhase1QrProbeTest > zero tax and large…   TypeError   
  intdiv(): Argument #1 ($num1) must be of type int, float given
  at app/Services/Accounting/InvoiceService.php:954
    950▕             foreach ($invoice->lines->values() as $position => $line) {
    951▕                 $lineNet = (int) $line->line_subtotal - (int) $line->line_discount;
    952▕                 $revenue = $position === $invoice->lines->count() - 1
    953▕                     ? $netSales - $lineRevenueAllocated
  ➜ 954▕                     : ($subtotal > 0 ? intdiv($lineNet * $netSales, $subtotal) : 0);
    955▕                 $lineRevenueAllocated += $revenue;
    956▕                 $acct = $line->product?->sales_account_id ?: $defaultSales;
    957▕                 foreach ($this->splitAllocatedAmount($revenue, $line->costCenterAllocations, $invoice->cost_center_id) as $allocation) {
    958▕                     $costCenterId = $allocation['cost_center_id'];
  1   app/Services/Accounting/InvoiceService.php:954
      [2m+3 vendor frames [22m
  5   app/Services/Accounting/InvoiceService.php:886
  ────────────────────────────────────────────────────────────────────────────  
   FAILED  Tests\Feature\CPhase1QrProbeTest > drafts carry…  RuntimeException   
  نوع الإشعار المستقل مطلوب.
  at app/Services/Accounting/CreditNoteOwnershipResolver.php:62
     58▕             return self::SALES;
     59▕         }
     60▕ 
     61▕         if (! in_array($type, [self::SALES, self::PURCHASE], true)) {
  ➜  62▕             throw new RuntimeException('نوع الإشعار المستقل مطلوب.');
     63▕         }
     64▕ 
     65▕         return $type;
     66▕     }
  1   app/Services/Accounting/CreditNoteOwnershipResolver.php:62
  2   app/Services/Accounting/CreditNoteOwnershipResolver.php:23
  Duration: 9.39s
   WARN  Metadata found in doc-comment for method Tests\Feature\CPhase1QrProbeTest::qr_timestamp_is_draft_creation_time_not_invoice_date_nor_posting_time(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\CPhase1QrProbeTest::qr_timestamp_offset_follows_app_timezone(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\CPhase1QrProbeTest::tlv_length_byte_overflows_for_seller_names_longer_than_255_bytes(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\CPhase1QrProbeTest::seller_without_vat_number_still_posts_and_qr_tag2_is_empty(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\CPhase1QrProbeTest::zero_tax_and_large_totals_format_and_xml_content_inventory(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\CPhase1QrProbeTest::posting_a_multi_line_invoice_above_roughly_30m_sar_overflows_integer_proration(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\CPhase1QrProbeTest::explicit_standard_posts_without_buyer_vat_or_address_and_vat_buyer_auto_classifies_standard(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attrib
   WARN  Metadata found in doc-comment for method Tests\Feature\CPhase1QrProbeTest::stored_qr_and_xml_survive_tenant_rename_but_qrFor_recomputes_live(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\CPhase1QrProbeTest::post_issue_mutation_guards_exist_in_service_only_not_in_model(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\CPhase1QrProbeTest::drafts_carry_a_legal_number_but_no_qr_and_credit_or_return_documents_have_no_zatca_columns(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attribu
[C-PROBE] zero-tax/large: subtotal,tax,total: [300000010,2,300000012]
[C-PROBE] zero-tax/large: QR tag4/tag5: ["3000000.12","0.02"]
[C-PROBE] XML cbc:ID == number: ["INV-2026-00001","INV-2026-00001"]
[C-PROBE] XML structural inventory: {"has TaxSubtotal":false,"has ClassifiedTaxCategory/line tax":false,"has seller PostalAddress":false,"has seller PartyIdentification (CRN)":false,"has buyer PartyTaxScheme":true,"has InvoiceLine TaxTotal":false,"has AllowanceCharge":false,"has Delivery/ActualDeliv
[C-PROBE] large multi-line draft created: subtotal/total: [6000000000,6900000000]
[C-PROBE] large multi-line post: TypeError: intdiv(): Argument #1 ($num1) must be of type int, float given
[C-PROBE] draft still draft after failed post?: draft
[C-PROBE] draft number / qr / xml / icv: ["INV-2026-00001",null,null,null]
[C-PROBE] credit_notes zatca/qr columns: []
[C-PROBE] return_documents zatca/qr columns: []
[C-PROBE] invoices zatca/qr columns: ["zatca_qr","zatca_hash","zatca_uuid","zatca_icv","zatca_previous_hash","zatca_xml","zatca_document_type","zatca_cleared_xml"]
[C-PROBE] credit note posted: number/original_invoice_id/reason: ["CN-2026-00001",null,null]
   FAIL  Tests\Feature\CPhase1QrProbeTest
  ⨯ zero tax and large totals format and xml content inventory          14.06s  
  ✓ posting a multi line invoice above roughly 30m sar overflows intege… 0.07s  
  ✓ drafts carry a legal number but no qr and credit or return document… 0.08s  
  ────────────────────────────────────────────────────────────────────────────  
   FAILED  Tests\Feature\CPhase1QrProbeTest > zero tax and large totals form…   
  Failed asserting that two strings are identical.
  -'0.00'
  +'0.02'
  at <audit-workspace>/probes/C/CPhase1QrProbeTest.php:174
    170▕             'ProfileID' => preg_match('#<cbc:ProfileID>([^<]+)#', $xml, $p) ? $p[1] : null,
    171▕             'InvoiceTypeCode' => preg_match('#<cbc:InvoiceTypeCode name="([^"]+)">([^<]+)#', $xml, $c) ? $c[1] . '/' . $c[2] : null,
    172▕         ];
    173▕         $this->out('XML structural inventory', $checks);
  ➜ 174▕         $this->assertSame('0.00', $fields[5] === '0.00' ? '0.00' : $fields[5]); // just print
    175▕         $this->assertSame($posted->number, $m[1]);
    176▕     }
    177▕ 
    178▕     /** @test */
  1   <audit-workspace>/probes/C/CPhase1QrProbeTest.php:174
  Duration: 14.26s
```

### `C-probe2-pg.log`

```text
   WARN  Metadata found in doc-comment for method Tests\Feature\CNumberingProbeTest::number_is_allocated_at_draft_and_gaps_appear_when_a_middle_draft_is_deleted_after_posting_neighbours(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to 
   WARN  Metadata found in doc-comment for method Tests\Feature\CNumberingProbeTest::deleting_the_last_draft_reuses_its_number_even_after_it_was_shown_or_printed(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\CNumberingProbeTest::prefix_and_suffix_changes_mid_year_start_a_new_series_and_the_old_series_remains_reachable(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attrib
   WARN  Metadata found in doc-comment for method Tests\Feature\CNumberingProbeTest::service_accepts_a_caller_supplied_number_and_db_rejects_duplicates_including_branchless_rows(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attr
   WARN  Metadata found in doc-comment for method Tests\Feature\CNumberingProbeTest::concurrent_allocation_is_serialised_by_the_tenant_anchor_lock(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
[C-NUM] driver: pgsql
[C-NUM] draft A status/number: ["draft","INV-2026-00001"]
[C-NUM] sequence after posting A,C and deleting draft B: {"A":"INV-2026-00001","B(deleted)":"INV-2026-00002","C":"INV-2026-00003","D":"INV-2026-00004","numbers in DB":["INV-2026-00001","INV-2026-00003","INV-2026-00004"]}
[C-NUM] driver: pgsql
[C-NUM] last draft deleted → next number: ["INV-2026-00002","INV-2026-00002"]
[C-NUM] driver: pgsql
[C-NUM] mid-year prefix/suffix change: ["INV-2026-00001","INV-2026-00002","FAT-2026-00001","FAT-2026-00001-JED","INV-2026-00003"]
[C-NUM] next year restarts: INV-2027-00001
[C-NUM] driver: pgsql
[C-NUM] service create with explicit number: MANUAL-7
[C-NUM] duplicate explicit number (branch_id NULL): rejected: SQLSTATE[23505]: Unique violation: 7 ERROR:  duplicate key value violates unique constraint "invoices_tenant_id_number_b
[C-NUM] invoices unique indexes (pg): ["CREATE UNIQUE INDEX invoices_pkey ON public.invoices USING btree (id)","CREATE UNIQUE INDEX invoices_tenant_id_branch_id_number_unique ON public.invoices USING btree (tenant_id, branch_id, number)","CREATE UNIQUE INDEX invoices_tenant_id_zatca_icv_unique ON pu
[C-NUM] driver: pgsql
[C-NUM] first allocation inside open tx: INV-2026-00001
[C-NUM] rival blocked on tenant anchor: false
   FAIL  Tests\Feature\CNumberingProbeTest
  ✓ number is allocated at draft and gaps appear when a middle draft is… 6.20s  
  ✓ deleting the last draft reuses its number even after it was shown o… 0.27s  
  ✓ prefix and suffix changes mid year start a new series and the old s… 0.51s  
  ✓ service accepts a caller supplied number and db rejects duplicates…  0.17s  
  ⨯ concurrent allocation is serialised by the tenant anchor lock        0.20s  
  ────────────────────────────────────────────────────────────────────────────  
   FAILED  Tests\Feature\CNumberingProbeTest > concurrent allocation is seri…   
  Failed asserting that false is true.
  at <audit-workspace>/probes/C/CNumberingProbeTest.php:146
    142▕                 $blocked = true;
    143▕             }
    144▕         });
    145▕         $this->out('rival blocked on tenant anchor', $blocked);
  ➜ 146▕         $this->assertTrue($blocked);
    147▕     }
    148▕ }
    149▕
  1   <audit-workspace>/probes/C/CNumberingProbeTest.php:146
  Duration: 7.40s
   WARN  Metadata found in doc-comment for method Tests\Feature\CNumberingProbeTest::number_is_allocated_at_draft_and_gaps_appear_when_a_middle_draft_is_deleted_after_posting_neighbours(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to 
   WARN  Metadata found in doc-comment for method Tests\Feature\CNumberingProbeTest::deleting_the_last_draft_reuses_its_number_even_after_it_was_shown_or_printed(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\CNumberingProbeTest::prefix_and_suffix_changes_mid_year_start_a_new_series_and_the_old_series_remains_reachable(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attrib
   WARN  Metadata found in doc-comment for method Tests\Feature\CNumberingProbeTest::service_accepts_a_caller_supplied_number_and_db_rejects_duplicates_including_branchless_rows(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attr
   WARN  Metadata found in doc-comment for method Tests\Feature\CNumberingProbeTest::concurrent_allocation_is_serialised_by_the_tenant_anchor_lock(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
[C-NUM] driver: pgsql
[C-NUM] first allocation inside open tx: INV-2026-00001
   FAIL  Tests\Feature\CNumberingProbeTest
  ⨯ concurrent allocation is serialised by the tenant anchor lock        7.24s  
  ────────────────────────────────────────────────────────────────────────────  
   FAILED  Tests\Feature\CNumberingProbeTest > concurrent al…  QueryException   
  SQLSTATE[55P03]: Lock not available: 7 ERROR:  canceling statement due to lock timeout
CONTEXT:  while deleting tuple (0,2) in relation "tenants" (Connection: rival, SQL: delete from "tenants" where "id" = 75a47baa-bbd3-4286-b1bd-a5f96acd523a)
  at vendor/laravel/framework/src/Illuminate/Database/Connection.php:825
    821▕                     $this->getName(), $query, $this->prepareBindings($bindings), $e
    822▕                 );
    823▕             }
    824▕ 
  ➜ 825▕             throw new QueryException(
    826▕                 $this->getName(), $query, $this->prepareBindings($bindings), $e
    827▕             );
    828▕         }
    829▕     }
      [2m+8 vendor frames [22m
  9   <audit-workspace>/probes/C/CNumberingProbeTest.php:153
  Duration: 7.29s
   WARN  Metadata found in doc-comment for method Tests\Feature\CNumberingProbeTest::number_is_allocated_at_draft_and_gaps_appear_when_a_middle_draft_is_deleted_after_posting_neighbours(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to 
   WARN  Metadata found in doc-comment for method Tests\Feature\CNumberingProbeTest::deleting_the_last_draft_reuses_its_number_even_after_it_was_shown_or_printed(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\CNumberingProbeTest::prefix_and_suffix_changes_mid_year_start_a_new_series_and_the_old_series_remains_reachable(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attrib
   WARN  Metadata found in doc-comment for method Tests\Feature\CNumberingProbeTest::service_accepts_a_caller_supplied_number_and_db_rejects_duplicates_including_branchless_rows(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attr
   WARN  Metadata found in doc-comment for method Tests\Feature\CNumberingProbeTest::concurrent_allocation_is_serialised_by_the_tenant_anchor_lock(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
[C-NUM] driver: pgsql
[C-NUM] first allocation inside open tx: INV-2026-00001
[C-NUM] rival blocked on tenant anchor: true
   PASS  Tests\Feature\CNumberingProbeTest
  ✓ concurrent allocation is serialised by the tenant anchor lock        7.18s  
  Duration: 7.21s
```

### `C-probe3.log`

```text
   WARN  Metadata found in doc-comment for method Tests\Feature\CPosApiProbeTest::pos_checkout_classification_qr_and_api_guards(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
[C-POS] POS walk-in: type/status/number/qr?: ["simplified","posted","INV-2026-00001",true]
[C-POS] POS VAT-registered buyer: type (B2B at POS): standard
[C-POS] POS QR tag3 / created_at / invoice_date: ["2026-10-10T12:35:44+00:00","2026-10-10 12:35:44","2026-10-10"]
[C-POS] POS checkout response keys exposing issue time?: []
[C-POS] zatca endpoint QR unchanged after company rename: true
[C-POS] company vat_number accepted by PUT /company (5 digits): 12345
[C-POS] next invoice QR tag1/tag2 after bad VAT saved: ["اسم تجاري جديد","12345"]
[C-POS] API guards after posting (expect 422s): {"PUT /invoices/{id}":422,"DELETE /invoices/{id}":422,"PUT /invoices/{id}/classification (default policy)":422,"POST /invoices/{id}/post again":422}
[C-POS] POST /invoices with number/status/zatca_qr/back-date: ["INV-2020-00001","draft",null,"2020-01-01"]
[C-POS] back-dated 2020-01-01 invoice: QR tag3 vs invoice_date: ["2026-10-10T12:35:44+00:00","2020-01-01"]
[C-POS] POS return status / payload keys: [422,"{\"message\":\"The original invoice id field is required.\",\"errors\":{\"original_invoice_id\":[\"The original invoice id field is required.\"]}}"]
   PASS  Tests\Feature\CPosApiProbeTest
  ✓ pos checkout classification qr and api guards                        9.90s  
  Duration: 9.94s
   WARN  Metadata found in doc-comment for method Tests\Feature\CPosApiProbeTest::pos_checkout_classification_qr_and_api_guards(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\CPosApiProbeTest::a_tenant_that_never_enabled_the_optional_zatca_app_cannot_fetch_the_qr_used_by_the_invoice_page(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attr
[C-POS] POS walk-in: type/status/number/qr?: ["simplified","posted","INV-2026-00001",true]
[C-POS] POS VAT-registered buyer: type (B2B at POS): standard
[C-POS] POS QR tag3 / created_at / invoice_date: ["2026-10-10T12:39:51+00:00","2026-10-10 12:39:51","2026-10-10"]
[C-POS] POS checkout response keys exposing issue time?: []
[C-POS] zatca endpoint QR unchanged after company rename: true
[C-POS] company vat_number accepted by PUT /company (5 digits): 12345
[C-POS] next invoice QR tag1/tag2 after bad VAT saved: ["اسم تجاري جديد","12345"]
[C-POS] API guards after posting (expect 422s): {"PUT /invoices/{id}":422,"DELETE /invoices/{id}":422,"PUT /invoices/{id}/classification (default policy)":422,"POST /invoices/{id}/post again":422}
[C-POS] POST /invoices with number/status/zatca_qr/back-date: ["INV-2020-00001","draft",null,"2020-01-01"]
[C-POS] back-dated 2020-01-01 invoice: QR tag3 vs invoice_date: ["2026-10-10T12:39:52+00:00","2020-01-01"]
[C-POS] POS return status / payload keys: [422,"{\n    \"message\": \"\\u0644\\u0627 \\u064a\\u0645\\u0643\\u0646 \\u0625\\u0631\\u062c\\u0627\\u0639 \\u0633\\u0637\\u0631 POS \\u0628\\u0644\\u0627 \\u0645\\u0646\\u062a\\u062c \\u0645\\u062b\\u0628\\u062a.\",\n    \"exception\": \"Symfony\\\\Compone
[C-POS] nav-state compliance.zatca for a fresh tenant: false
[C-POS] posted invoice has stored QR in InvoiceResource?: true
[C-POS] GET /invoices/{id}/zatca (used by the A4 invoice page) status/body: [403,"{\n    \"message\": \"\\u0647\\u0630\\u0647 \\u0627\\u0644\\u0642\\u062f\\u0631\\u0629 \\u063a\\u064a\\u0631 \\u0645\\u0641\\u0639\\u0651\\u0644\\u0629 \\u0644\\u0647\\u0630\\u0647 \\u0627\\u0644\\u0645\\u0624\\u0633\\
   PASS  Tests\Feature\CPosApiProbeTest
  ✓ pos checkout classification qr and api guards                        9.38s  
  ✓ a tenant that never enabled the optional zatca app cannot fetch the… 0.13s  
  Duration: 9.55s
```

## Stream E — Submission

### `E-probe-sqlite.txt`

```text
[E-PROBE] P01 URL=https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/invoices/clearance/single
[E-PROBE] P01 body keys=["invoiceHash","invoice"] (official body: invoiceHash, uuid, invoice) [official-ref to confirm]
[E-PROBE] P01 accept-version=["v2"] accept-language=["en"]
[E-PROBE] P01 clearance-status header present? NO
[E-PROBE] P01 content-type=["application\/json"] accept=["application\/json"]
[E-PROBE] P01 authorization scheme=Basic 
[E-PROBE] P01 DB::transactionLevel() while HTTP in flight = 2
[E-PROBE] P01 attempt status=accepted code=CLEARED http=200 payload={"clearanceStatus":"CLEARED","retryable":false}
[E-PROBE] P01 invoice snapshot unchanged? xml=true hash=true qr=true
[E-PROBE] P01 zatca_cleared_xml stored? true
[E-PROBE] P01 GET /invoices/{id}/zatca keys=["qr","hash","uuid","icv","previous_hash","xml","document_type","submission_type"] (cleared xml exposed? NO)
[E-PROBE] P01 GET /invoices/{id} zatca block={"qr":"ARbYtNix2YPYqSB6YXRjYS1wcm9iZS1lAg8zMDAwMDAwMDAwMDAwMDMDGTIwMjYtMTAtMTBUMTI6NDA6NTgrMDA6MDAEBzExNTAuMDAFBjE1MC4wMA==","hash":"2iA3s73DRxePETRUk4x0i\/z676t5e1+ANaMZucFnAnk=","uuid":"8d6b9574-d067-4377-8432-ec89e95abae9","icv":1,"document_type":"stan
[E-PROBE] P01 next invoice ICV=2 PIH==hash(prev zatca_xml)? true PIH==hash(prev cleared_xml)? false
[E-PROBE] P02 reportingStatus=NOT_REPORTED (200 json)    => status=accepted code=NOT_REPORTED retryable=false
[E-PROBE] P02 text/html body (200)                       => status=accepted code=http_200 retryable=false
[E-PROBE] P02 empty body (200)                           => status=accepted code=http_200 retryable=false
[E-PROBE] P02 json without status keys (200)             => status=accepted code=http_200 retryable=false
[E-PROBE] P02 clearance 200 html => status=failed code=invalid_clearance_response retryable=true
[E-PROBE] P02 clearance 200 NOT_CLEARED+xml => status=accepted code=NOT_CLEARED
[E-PROBE] P02 clearance 202 CLEARED without clearedInvoice => status=failed code=invalid_clearance_response retryable=true
[E-PROBE] P03 http  status    code                       retry     notif
[E-PROBE] P03 202   accepted  REPORTED                   false     0
[E-PROBE] P03 400   rejected  NOT_REPORTED               false     1
[E-PROBE] P03 401   rejected  http_401                   false     1
[E-PROBE] P03 403   rejected  http_403                   false     1
[E-PROBE] P03 404   rejected  http_404                   false     1
[E-PROBE] P03 409   rejected  http_409                   false     1
[E-PROBE] P03 413   rejected  http_413                   false     1
[E-PROBE] P03 422   rejected  http_422                   false     1
[E-PROBE] P03 429   failed    http_429                   true      1
[E-PROBE] P03 500   failed    ERROR                      true      1
[E-PROBE] P03 502   failed    http_502                   true      1
[E-PROBE] P03 503   failed    ERROR                      true      1
[E-PROBE] P04 timeout => status=failed code=connection_failed http=NULL retryable=true recorded=1
[E-PROBE] P04 attempt#2 status=accepted attempt_number=2 identical body resent? true recorded=2
[E-PROBE] P04 duplicate-after-timeout world: latest status=rejected (invoice really accepted at ZATCA, system shows rejected) [official duplicate semantics: official-ref to confirm]
[E-PROBE] P05 TLS-style RequestException => status=failed code=submission_preflight_failed retryable=false message=تعذر تجهيز محاولة ZATCA وفق الإعدادات أو اللقطة المسجلة.
[E-PROBE] P06 dispatch x2 + job handle: sent=1 status=accepted/accepted/accepted
[E-PROBE] P06 job config: tries=1 timeout=45 uniqueFor=300 failOnTimeout=true has failed() method? false middleware()? false
[E-PROBE] P07 after POST store: queue_dispatch_performed=true jobs rows=1 status=pending
[E-PROBE] P07 after 6 min re-dispatch: jobs rows=2 queue_count=2
[E-PROBE] P07 queue:work x2 exit=0/0 status=accepted code=REPORTED sent=1 jobs left=0 failed_jobs=0
[E-PROBE] P08 readiness with database queue & NO worker: {"ready":true,"enabled":true,"environment":"simulation","queue_connection":"database","blockers":[]}
[E-PROBE] P08 readiness with sync: {"ready":false,"enabled":true,"environment":"simulation","queue_connection":"sync","blockers":["unsafe_queue_connection"]}
[E-PROBE] P08 3 days later: pending attempts=1 (24h reporting window long gone; no sweep/alert)
[E-PROBE] P08 tenant-wide attempt listing route: none (404 on /api/zatca/submissions and /api/zatca-submissions)
[E-PROBE] P09 attempt created under simulation, dispatched after switch: URL=https://gw-fatoora.zatca.gov.sa/e-invoicing/core/invoices/reporting/single status=accepted
[E-PROBE] P09 after simulation acceptance, production resubmission => 409 "الفاتورة مقبولة لدى ZATCA ولا تحتاج إعادة إرسال."
[E-PROBE] P10 rejected invoice ICV=1 next ICV=2 next PIH==hash(rejected xml)? true
[E-PROBE] P10 resubmission of rejected invoice resends identical XML: true => rejected
[E-PROBE] P11 staff      GET zatca-settings                                      => 200
[E-PROBE] P11 staff      GET submissions                                         => 200
[E-PROBE] P11 staff      POST submissions                                        => 403
[E-PROBE] P11 staff      PUT zatca-settings                                      => 403
[E-PROBE] P11 staff      GET zatca-credentials                                   => 403
[E-PROBE] P11 accountant POST submissions                                        => 202
[E-PROBE] P11 accountant PUT zatca-settings                                      => 403
[E-PROBE] P11 accountant GET zatca-credentials                                   => 403
[E-PROBE] P11 staff      POST dispatch                                           => 403
[E-PROBE] P11 accountant POST dispatch (flag off)                                => 422
[E-PROBE] P11 owner      PUT active_environment=production (no prod credential)  => 200
[E-PROBE] P11 posting after env switch without credential => RuntimeException: بيانات اعتماد ZATCA لبيئة production غير مهيأة.
[E-PROBE] P12 302 then 200 html: requests=["POST https:\/\/gw-fatoora.zatca.gov.sa\/e-invoicing\/simulation\/invoices\/reporting\/single","GET https:\/\/gw-fatoora.zatca.gov.sa\/maintenance"] => status=accepted code=http_200 http=200
[E-PROBE] P13 flag=false POST store meta={"created":true,"dispatch_status":"pending","network_submission_performed":false,"queue_dispatch_performed":false,"queue_dispatch_error":null} jobs=0
[E-PROBE] P13 flag=false POST dispatch => 422 {"message":"\u0646\u0642\u0644 ZATCA \u063a\u064a\u0631 \u062c\u0627\u0647\u0632 \u0644\u0644\u062a\u0634\u063a\u064a\u0644 \u0627\u0644\u0622\u0645\u0646.","exception":"Symfony\\Component\\HttpKernel\\Exception\\HttpException","file":"\/home\/user\/nibr
[E-PROBE] P14 enqueue without credential => RuntimeException: نقل ZATCA غير جاهز للتشغيل الآمن. queue_count=0
[E-PROBE] P14 dispatcher without credential => status=failed code=submission_preflight_failed retryable=false
   PASS  Tests\Feature\ZatcaSubmissionChainProbeTest
  ✓ p01 clearance request contract as actually sent                      9.09s  
  ✓ p02 reporting acceptance is inferred from http status only           0.34s  
  ✓ p03 http status matrix and sanitized payload                         0.60s  
  ✓ p04 timeout is failed retryable and resubmission resends identical…  0.17s  
  ✓ p05 non connect transport exceptions are misclassified as preflight… 0.12s  
  ✓ p06 double dispatch and job rerun never resend                       0.13s  
  ✓ p07 real database queue roundtrip and stale job after unique lock e… 0.16s  
  ✓ p08 readiness cannot detect absent worker and pending backlog is in… 0.17s  
  ✓ p09 environment switch between create and dispatch and acceptance w… 0.22s  
  ✓ p10 rejected invoice stays in chain with no correction path          0.19s  
  ✓ p11 rbac and settings guards                                         0.21s  
  ✓ p12 redirect from gateway is followed and can be accepted            0.10s  
  ✓ p13 dispatch flag false records pending only and queue endpoint rej… 0.11s  
  ✓ p14 queue enqueue requires readiness and missing credentials block   0.13s  
  Duration: 11.75s
```

### `E-probe-pgsql.txt`

```text
[E-PROBE] P01 URL=https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/invoices/clearance/single
[E-PROBE] P01 body keys=["invoiceHash","invoice"] (official body: invoiceHash, uuid, invoice) [official-ref to confirm]
[E-PROBE] P01 accept-version=["v2"] accept-language=["en"]
[E-PROBE] P01 clearance-status header present? NO
[E-PROBE] P01 content-type=["application\/json"] accept=["application\/json"]
[E-PROBE] P01 authorization scheme=Basic 
[E-PROBE] P01 DB::transactionLevel() while HTTP in flight = 2
[E-PROBE] P01 attempt status=accepted code=CLEARED http=200 payload={"clearanceStatus":"CLEARED","retryable":false}
[E-PROBE] P01 invoice snapshot unchanged? xml=true hash=true qr=true
[E-PROBE] P01 zatca_cleared_xml stored? true
[E-PROBE] P01 GET /invoices/{id}/zatca keys=["qr","hash","uuid","icv","previous_hash","xml","document_type","submission_type"] (cleared xml exposed? NO)
[E-PROBE] P01 GET /invoices/{id} zatca block={"qr":"ARbYtNix2YPYqSB6YXRjYS1wcm9iZS1lAg8zMDAwMDAwMDAwMDAwMDMDGTIwMjYtMTAtMTBUMTI6NDI6NTkrMDA6MDAEBzExNTAuMDAFBjE1MC4wMA==","hash":"7NKIoVDFSBP1hQp\/Wm++\/+ty2a0uyqIEaTvFB14tZ4I=","uuid":"6fe845cb-16ff-41ab-b53b-991924dc8cb6","icv":1,"document_type":"sta
[E-PROBE] P01 next invoice ICV=2 PIH==hash(prev zatca_xml)? true PIH==hash(prev cleared_xml)? false
[E-PROBE] P02 reportingStatus=NOT_REPORTED (200 json)    => status=accepted code=NOT_REPORTED retryable=false
[E-PROBE] P02 text/html body (200)                       => status=accepted code=http_200 retryable=false
[E-PROBE] P02 empty body (200)                           => status=accepted code=http_200 retryable=false
[E-PROBE] P02 json without status keys (200)             => status=accepted code=http_200 retryable=false
[E-PROBE] P02 clearance 200 html => status=failed code=invalid_clearance_response retryable=true
[E-PROBE] P02 clearance 200 NOT_CLEARED+xml => status=accepted code=NOT_CLEARED
[E-PROBE] P02 clearance 202 CLEARED without clearedInvoice => status=failed code=invalid_clearance_response retryable=true
[E-PROBE] P03 http  status    code                       retry     notif
[E-PROBE] P03 202   accepted  REPORTED                   false     0
[E-PROBE] P03 400   rejected  NOT_REPORTED               false     1
[E-PROBE] P03 401   rejected  http_401                   false     1
[E-PROBE] P03 403   rejected  http_403                   false     1
[E-PROBE] P03 404   rejected  http_404                   false     1
[E-PROBE] P03 409   rejected  http_409                   false     1
[E-PROBE] P03 413   rejected  http_413                   false     1
[E-PROBE] P03 422   rejected  http_422                   false     1
[E-PROBE] P03 429   failed    http_429                   true      1
[E-PROBE] P03 500   failed    ERROR                      true      1
[E-PROBE] P03 502   failed    http_502                   true      1
[E-PROBE] P03 503   failed    ERROR                      true      1
[E-PROBE] P04 timeout => status=failed code=connection_failed http=NULL retryable=true recorded=1
[E-PROBE] P04 attempt#2 status=accepted attempt_number=2 identical body resent? true recorded=2
[E-PROBE] P04 duplicate-after-timeout world: latest status=rejected (invoice really accepted at ZATCA, system shows rejected) [official duplicate semantics: official-ref to confirm]
[E-PROBE] P05 TLS-style RequestException => status=failed code=submission_preflight_failed retryable=false message=تعذر تجهيز محاولة ZATCA وفق الإعدادات أو اللقطة المسجلة.
[E-PROBE] P06 dispatch x2 + job handle: sent=1 status=accepted/accepted/accepted
[E-PROBE] P06 job config: tries=1 timeout=45 uniqueFor=300 failOnTimeout=true has failed() method? false middleware()? false
[E-PROBE] P07 after POST store: queue_dispatch_performed=true jobs rows=1 status=pending
[E-PROBE] P07 after 6 min re-dispatch: jobs rows=2 queue_count=2
[E-PROBE] P07 queue:work x2 exit=0/0 status=accepted code=REPORTED sent=1 jobs left=0 failed_jobs=0
[E-PROBE] P08 readiness with database queue & NO worker: {"ready":true,"enabled":true,"environment":"simulation","queue_connection":"database","blockers":[]}
[E-PROBE] P08 readiness with sync: {"ready":false,"enabled":true,"environment":"simulation","queue_connection":"sync","blockers":["unsafe_queue_connection"]}
[E-PROBE] P08 3 days later: pending attempts=1 (24h reporting window long gone; no sweep/alert)
[E-PROBE] P08 tenant-wide attempt listing route: none (404 on /api/zatca/submissions and /api/zatca-submissions)
[E-PROBE] P09 attempt created under simulation, dispatched after switch: URL=https://gw-fatoora.zatca.gov.sa/e-invoicing/core/invoices/reporting/single status=accepted
[E-PROBE] P09 after simulation acceptance, production resubmission => 409 "الفاتورة مقبولة لدى ZATCA ولا تحتاج إعادة إرسال."
[E-PROBE] P10 rejected invoice ICV=1 next ICV=2 next PIH==hash(rejected xml)? true
[E-PROBE] P10 resubmission of rejected invoice resends identical XML: true => rejected
[E-PROBE] P11 staff      GET zatca-settings                                      => 200
[E-PROBE] P11 staff      GET submissions                                         => 200
[E-PROBE] P11 staff      POST submissions                                        => 403
[E-PROBE] P11 staff      PUT zatca-settings                                      => 403
[E-PROBE] P11 staff      GET zatca-credentials                                   => 403
[E-PROBE] P11 accountant POST submissions                                        => 202
[E-PROBE] P11 accountant PUT zatca-settings                                      => 403
[E-PROBE] P11 accountant GET zatca-credentials                                   => 403
[E-PROBE] P11 staff      POST dispatch                                           => 403
[E-PROBE] P11 accountant POST dispatch (flag off)                                => 422
[E-PROBE] P11 owner      PUT active_environment=production (no prod credential)  => 200
[E-PROBE] P11 posting after env switch without credential => RuntimeException: بيانات اعتماد ZATCA لبيئة production غير مهيأة.
[E-PROBE] P12 302 then 200 html: requests=["POST https:\/\/gw-fatoora.zatca.gov.sa\/e-invoicing\/simulation\/invoices\/reporting\/single","GET https:\/\/gw-fatoora.zatca.gov.sa\/maintenance"] => status=accepted code=http_200 http=200
[E-PROBE] P13 flag=false POST store meta={"created":true,"dispatch_status":"pending","network_submission_performed":false,"queue_dispatch_performed":false,"queue_dispatch_error":null} jobs=0
[E-PROBE] P13 flag=false POST dispatch => 422 {"message":"\u0646\u0642\u0644 ZATCA \u063a\u064a\u0631 \u062c\u0627\u0647\u0632 \u0644\u0644\u062a\u0634\u063a\u064a\u0644 \u0627\u0644\u0622\u0645\u0646.","exception":"Symfony\\Component\\HttpKernel\\Exception\\HttpException","file":"\/home\/user\/nibr
[E-PROBE] P15 job threw outside dispatcher: exit=0 attempt status=pending failed_jobs=1 notifications=0 Http sent=0
[E-PROBE] P14 enqueue without credential => RuntimeException: نقل ZATCA غير جاهز للتشغيل الآمن. queue_count=0
[E-PROBE] P14 dispatcher without credential => status=failed code=submission_preflight_failed retryable=false
   PASS  Tests\Feature\ZatcaSubmissionChainProbeTest
  ✓ p01 clearance request contract as actually sent                      6.42s  
  ✓ p02 reporting acceptance is inferred from http status only           0.75s  
  ✓ p03 http status matrix and sanitized payload                         1.28s  
  ✓ p04 timeout is failed retryable and resubmission resends identical…  0.41s  
  ✓ p05 non connect transport exceptions are misclassified as preflight… 0.28s  
  ✓ p06 double dispatch and job rerun never resend                       0.31s  
  ✓ p07 real database queue roundtrip and stale job after unique lock e… 0.34s  
  ✓ p08 readiness cannot detect absent worker and pending backlog is in… 0.34s  
  ✓ p09 environment switch between create and dispatch and acceptance w… 0.41s  
  ✓ p10 rejected invoice stays in chain with no correction path          0.41s  
  ✓ p11 rbac and settings guards                                         0.49s  
  ✓ p12 redirect from gateway is followed and can be accepted            0.36s  
  ✓ p13 dispatch flag false records pending only and queue endpoint rej… 0.30s  
  ✓ p15 job exception outside dispatcher leaves attempt pending and onl… 0.39s  
  ✓ p14 queue enqueue requires readiness and missing credentials block   0.31s  
  Duration: 12.84s
exit=0
```

### `E-pg-concurrency.txt`

```text
[E-PG] driver=pgsql db=audit_e version=PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0, 64-bit
[E-PG] migrate:fresh done
[E-PG] index zatca_attempt_idempotency_unique         unique=true columns=tenant_id,idempotency_key_hash
[E-PG] index zatca_attempt_invoice_number_unique      unique=true columns=invoice_id,attempt_number
[E-PG] index zatca_attempt_invoice_status_idx         unique=false columns=invoice_id,status,created_at
[E-PG] index zatca_attempt_tenant_status_idx          unique=false columns=tenant_id,status,requested_at
[E-PG] index zatca_submission_attempts_pkey           unique=true columns=id
[E-PG] invoice a2f2c7a5-0005-4d5d-ba3a-21abf979c7bd posted, icv=1
[E-PG] A child 1: CONFLICT: توجد محاولة إرسال معلقة لهذه الفاتورة.
[E-PG] A child 2: CONFLICT: توجد محاولة إرسال معلقة لهذه الفاتورة.
[E-PG] A child 3: CONFLICT: توجد محاولة إرسال معلقة لهذه الفاتورة.
[E-PG] A child 4: CONFLICT: توجد محاولة إرسال معلقة لهذه الفاتورة.
[E-PG] A child 5: CONFLICT: توجد محاولة إرسال معلقة لهذه الفاتورة.
[E-PG] A child 6: created=true attempt=a2f2c7a5-5f39-4c85-a2cf-b56b86b331c7 #1
[E-PG] A: attempts in DB = 1 (expected 1), created=1 conflicts=5
[E-PG] B child 1: created=false attempt=a2f2c7a5-8689-492c-9b0b-1d8571d26e93
[E-PG] B child 2: created=true attempt=a2f2c7a5-8689-492c-9b0b-1d8571d26e93
[E-PG] B child 3: created=false attempt=a2f2c7a5-8689-492c-9b0b-1d8571d26e93
[E-PG] B child 4: created=false attempt=a2f2c7a5-8689-492c-9b0b-1d8571d26e93
[E-PG] B child 5: created=false attempt=a2f2c7a5-8689-492c-9b0b-1d8571d26e93
[E-PG] B child 6: created=false attempt=a2f2c7a5-8689-492c-9b0b-1d8571d26e93
[E-PG] B: distinct attempt ids returned=1 rows=1 (expected 1 / 1)
[E-PG] C child 1: status=accepted sent=1
[E-PG] C child 2: status=accepted sent=0
[E-PG] C child 3: status=accepted sent=0
[E-PG] C child 4: status=accepted sent=0
[E-PG] C: total HTTP sends across 4 concurrent dispatchers = 1 (expected 1); final status=accepted
[E-PG] D: duplicate (invoice_id, attempt_number=1) raw insert => UniqueConstraintViolationException
[E-PG] D: duplicate (tenant_id, idempotency_key_hash) raw insert => UniqueConstraintViolationException
[E-PG] E: second PENDING attempt for an invoice that already has a terminal/accepted attempt (raw insert) => INSERTED (no constraint!) — "one open attempt per invoice" is enforced only by lockForUpdate in the service, not by a DB constraint
[E-PG] F: model delete => LogicException: ZATCA submission attempts are permanent audit records.
[E-PG] F: raw DB delete possible? yes (no DB-level protection)
[E-PG] DONE
script_exit=0
```

## Stream F — Security

### `F01CrossTenantZatcaProbeTest.log`

```text
[F] OK  GET /invoices/{A.posted}                                               -> 404 (expected 404)
[F] OK  GET /invoices/{A.posted}/zatca                                         -> 404 (expected 404)
[F] OK  GET /invoices/{A.posted}/zatca/submissions                             -> 404 (expected 404)
[F] OK  POST /invoices/{A.posted}/zatca/submissions                            -> 404 (expected 404)
[F] OK  POST /invoices/{A.posted}/zatca/submissions/{A.attempt}/dispatch       -> 404 (expected 404)
[F] OK  POST /invoices/{B.posted}/zatca/submissions/{A.attempt}/dispatch (attempt swap) -> 404 (expected 404)
[F] OK  GET /invoices/{A.posted}/accounting                                    -> 404 (expected 404)
[F] OK  GET /invoices/{A.posted}/payments                                      -> 404 (expected 404)
[F] OK  GET /invoices/{A.posted}/inventory                                     -> 404 (expected 404)
[F] OK  GET /invoices/{A.posted}/notes                                         -> 404 (expected 404)
[F] OK  GET /revisions/invoice/{A.posted}                                      -> 404 (expected 404)
[F] OK  PUT /invoices/{A.draft}                                                -> 404 (expected 404)
[F] OK  PUT /invoices/{A.draft}/classification                                 -> 404 (expected 404/422)
[F] OK  DELETE /invoices/{A.draft}                                             -> 404 (expected 404)
[F] OK  POST /invoices/{A.draft}/post                                          -> 404 (expected 404)
[F] OK  POST /invoices/{A.posted}/duplicate                                    -> 404 (expected 404)
[F] OK  POST /invoices/{A.posted}/notes                                        -> 404 (expected 404)
[F] OK  POST /invoices with A.partner                                          -> 404 (expected 404)
[F] OK  GET /invoices list from B contains 2 rows, none of tenant A
[F] OK  GET /zatca-credentials from B -> 0 rows (A has 1)
[F] OK  GET /zatca-settings from B -> active_environment=developer blockers=["credential_unavailable","signature_policy_unavailable"]
[F] OK  B PUT settings/credential: A settings + credential row unchanged; 2 rows, 2 tenants
[F] OK  X-Branch-Id=<A main branch> from B ignored; list still B-only
[F] OK  Eloquent under B context: A invoice/attempt invisible, 1 credential
[F] OK  Public API: A invoice 404 via B key; B invoice body has no zatca/xml/qr/icv/journal keys
[F] RESULT {"GET \/invoices\/{A.posted}":404,"GET \/invoices\/{A.posted}\/zatca":404,"GET \/invoices\/{A.posted}\/zatca\/submissions":404,"POST \/invoices\/{A.posted}\/zatca\/submissions":404,"POST \/invoices\/{A.posted}\/zatca\/submissions\/{A.attempt}\/dispatch":404,"POST \/invoices\/{B.posted}\/z
   PASS  Tests\Feature\F01CrossTenantZatcaProbeTest
  ✓ tenant b cannot reach any zatca or invoice route of tenant a         8.72s  
  Duration: 8.75s
```

### `F02RoleMatrixZatcaProbeTest.log`

```text
[F] route                                       owner        admin        accountant   staff        self_service cashier     
[F] GET invoices/{id}/zatca                     200          200          200          200          403          403         
[F] GET invoices/{id}/zatca/submissions         200          200          200          200          403          403         
[F] POST invoices/{id}/zatca/submissions        202          409          409          403          403          409         
[F] POST .../submissions/{attempt}/dispatch     404          404          404          403          403          404         
[F] GET zatca-credentials                       200          200          403          403          403          403         
[F] PUT zatca-credentials/simulation            422          422          403          403          403          403         
[F] GET zatca-settings                          200          200          200          200          403          200         
[F] PUT zatca-settings                          200          200          403          403          403          403         
[F] POST invoices/{draft}/post                  200          200          200          403          403          200         
[F] OBSERVATION cashier(invoices.manage only): POST submissions=409 dispatch=404 GET zatca=403
   PASS  Tests\Feature\F02RoleMatrixZatcaProbeTest
  ✓ role matrix for every zatca route                                    9.39s  
  Duration: 9.42s
```

### `F03SecretLeakProbeTest.log`

```text
[F] OK  no secret marker in PUT /zatca-credentials response (499 bytes)
[F] OK  no secret marker in GET /zatca-credentials response (501 bytes)
[F] OK  no secret marker in GET /zatca-settings response (483 bytes)
[F] OK  no secret marker in zatca_credentials.credentials raw column (4240 bytes)
[F] OK  422 validation response does not echo the submitted private key
[F] OK  no secret marker in POST /invoices/{id}/post response (2310 bytes)
[F] OK  no secret marker in GET /invoices/{id}/zatca response (signed XML) (10519 bytes)
[F] OK  no secret marker in GET /invoices/{id} response (2476 bytes)
[F] OK  no secret marker in GET /revisions/invoice/{id} (937 bytes)
[F] OK  document_revisions.diff holds no XML
[F] OK  no secret marker in POST .../zatca/submissions response (676 bytes)
[F] OK  no secret marker in jobs.payload (963 bytes)
[F] OK  jobs.payload = {"displayName":"App\\Jobs\\Accounting\\SendZatcaSubmission","tenantId":"a2f2ce06-7781-45c0-ada2-1efb0762f9db","branchId":"a2f2ce06-83f5-463d-a87f-df66bb221421","attemptId":"a2f2ce06-f345-4059-ac79-9bc7a40ae659","bytes":963}
[F] OK  after queue:work --once: TenantContext/BranchContext forgotten
[F] attempt after worker: status=rejected code=NOT_REPORTED msg=رفضت ZATCA طلب المستند. payload_keys=reportingStatus,validationResults,retryable
[F] OK  attempt row: secret/authorization keys stripped, no XML, no key material (echoed validation text is kept, html-stripped)
[F] OK  no secret marker in notifications table (1083 bytes)
[F] OK  job with tenant B + attempt of A failed: Illuminate\Database\Eloquent\ModelNotFoundException: No query results for model [App\Models\ZatcaSubmissionAttempt]. in 
[F] OK  no secret marker in failed_jobs row (8015 bytes)
[F] OK  no secret marker in laravel log (single channel) (18187 bytes)
[F] log bytes=18187
   PASS  Tests\Feature\F03SecretLeakProbeTest
  ✓ secrets never leave the encrypted column                             8.61s  
  Duration: 8.65s
```

### `F04MassAssignmentImmutabilityProbeTest.log`

```text
[F] OK  POST /invoices ignored hostile tenant_id/status/zatca_*/totals/journal fields (server-derived values kept)
[F] OK  PUT /invoices/{id} ignored hostile fields as well
[F] OK  posted invoice: PUT/DELETE/re-POST -> 422
[F] OBSERVATION after model-level tamper: API total=0.01 partner.name=اسم جديد بعد الإصدار | XML still says 1150.00 + original names; zatca_hash still matches stored XML => XML/live-data divergence undetected by any guard
[F] OBSERVATION Invoice model accepts direct update of zatca_xml/zatca_hash after posting (no model guard, revision log ignores zatca_xml)
[F] revision entries=4 changed fields recorded across entries: zatca_hash,subtotal,tax_amount,total,status,journal_entry_id,zatca_uuid,zatca_icv,language_frozen
[F] revision captures zatca_hash tamper=true ; captures zatca_xml=false ; captures header total tamper=true ; line tamper (InvoiceLine has no RecordsRevisions)=not recorded
   PASS  Tests\Feature\F04MassAssignmentImmutabilityProbeTest
  ✓ protected fields cannot be mass assigned through the api             8.83s  
  Duration: 8.88s
```

### `F05BranchRestrictedZatcaProbeTest.log`

```text
[F] revisions feed sample row keys: id,action,document_type,document_id,document_number,changes,user_id,user_name,created_at
[F] GET /invoices/{other.posted}                                   -> 404
[F] GET /invoices/{other.posted}/zatca                             -> 404
[F] GET /invoices/{other.posted}/zatca/submissions                 -> 404
[F] POST /invoices/{other.posted}/zatca/submissions                -> 404
[F] POST /invoices/{other.posted}/duplicate                        -> 404
[F] GET /invoices?branch=all contains other.posted                 -> no
[F] GET /invoices (X-Branch-Id: other) contains other.posted       -> no
[F] GET /revisions/invoice/{other.posted}                          -> 200
[F] GET /revisions feed exposes other-branch draft id              -> YES
[F] PUT /invoices/{other.draft}                                    -> 200
[F] PUT /invoices/{other.draft}/classification                     -> 200
[F] POST /invoices/{other.draft}/post                              -> 200
[F] DELETE /invoices/{other.draft2}                                -> 200
[F] other.draft after attack: status=posted notes=MODIFIED-BY-RESTRICTED branch=a2f2ce22-4685-42c9-bac8-0c96eda2c687 zatca_icv=2 deleted(draft2)=true
[F] WRITE-BOUNDARY update=200 post=200 delete=200
   PASS  Tests\Feature\F05BranchRestrictedZatcaProbeTest
  ✓ branch restricted user versus other branch invoices                  8.46s  
  Duration: 8.50s
```

### `F06Phase2FailClosedProbeTest.log`

```text
[F] phase-1 (no credential row)                                  => POSTED icv=1 signed=no
[F] phase-2 developer credential, active_environment=developer   => POSTED icv=2 signed=yes
[F] (a) active_environment=simulation (no credential there)      => BLOCKED RuntimeException: بيانات اعتماد ZATCA لبيئة simulation غير مهيأة. | status=draft journal=NULL
[F]     API POST /invoices/{id}/post -> 422 "بيانات اعتماد ZATCA لبيئة simulation غير مهيأة."
[F] (b) credential expired                                       => BLOCKED RuntimeException: شهادة ZATCA لبيئة developer منتهية أو بلا تاريخ صلاحية. | status=draft journal=NULL
[F]     compliance.zatca application state after disable: suspended (tenant=a2f2ce2f-ffc9-4fb6-b3eb-ce99ac8671de)
[F] (c) application disabled/suspended, credential still expired => BLOCKED RuntimeException: شهادة ZATCA لبيئة developer منتهية أو بلا تاريخ صلاحية. | status=draft journal=NULL
[F] (c2) app suspended, credential valid again                   => POSTED icv=3 signed=yes
[F]     => signing still happens regardless of application state: yes (posted, signed=true)
[F]     GET /invoices/{id}/zatca while app suspended -> 200
[F] (d) signature policy env missing                             => BLOCKED RuntimeException: سياسة توقيع ZATCA غير مهيأة في إعدادات النشر. | status=draft journal=NULL
[F] (e) last posted invoice has zatca_xml=NULL                   => BLOCKED RuntimeException: تعذر متابعة سلسلة ZATCA: XML الفاتورة السابقة غير محفوظ. | status=draft journal=NULL
[F] (f) APP_KEY rotated (credential undecryptable)               => BLOCKED Illuminate\Contracts\Encryption\DecryptException: The MAC is invalid. | status=draft journal=NULL
[F]     API POST /invoices/{id}/post after key rotation -> 422 "The MAC is invalid."
[F]     GET /zatca-credentials after key rotation -> 500
[F]     GET /zatca-settings after key rotation -> 200 blockers=["credential_unavailable"]
[F]     credential rows: 1 — no DELETE route exists in routes/api.php for zatca-credentials
[F] (g) config restored                                          => POSTED icv=4 signed=yes
   PASS  Tests\Feature\F06Phase2FailClosedProbeTest
  ✓ posting blast radius after phase two cutover                         9.16s  
  Duration: 9.20s
```

### `F07ReplayAndTokenProbeTest.log`

```text
[F] OK  same key -> same attempt (200); new key while pending -> 409; no key -> 422
[F] OBSERVATION re-dispatch of the same pending attempt after 6 min -> 202 queue_count=2
[F] OK  dispatcher idempotent (1 HTTP call); accepted invoice refuses new attempts/dispatch (409)
[F] OK  outbound: Basic auth header + {invoiceHash, invoice} body only, pinned simulation endpoint
[F] OK  role downgrade accountant->staff takes effect on next request with the same token (403)
[F] OBSERVATION user is_active=false, existing token: GET /invoices/{id}/zatca -> 200 ; GET /invoices -> 200 ; GET /me -> 200
[F] OBSERVATION user soft-deleted, existing token: GET /invoices -> 401
[F] RESULT deactivated-user-token-still-valid=true
   PASS  Tests\Feature\F07ReplayAndTokenProbeTest
  ✓ replay duplicates and token lifecycle                                8.65s  
  Duration: 8.69s
```

### `F08PlatformPlaneAndGatingProbeTest.log`

```text
[F] GET /invoices (platform token)                             -> 403
[F] GET /invoices/{id}/zatca (platform token)                  -> 403
[F] GET /zatca-credentials (platform token)                    -> 403
[F] GET /zatca-settings (platform token)                       -> 403
[F] GET /api/v1/invoices (platform token on public API)        -> 401
[F] GET /platform/tenants/{id}                                 -> 200
[F] OK  platform tenant payload (460 bytes) carries no credential material / XML; top-level keys: id,name,slug,account_number,support_number,plan,is_active,trial_ends_at,subscription_ends_at,created_at,users_count,contact,active_users_count,plan_limits,subscriptions
[F] compliance.zatca disabled: GET /invoices/{id}/zatca -> 403 ; GET /zatca-credentials -> 403 ; POST submissions -> 403 ; GET /invoices/{id} zatca.qr present=true icv=1
   PASS  Tests\Feature\F08PlatformPlaneAndGatingProbeTest
  ✓ platform token is rejected on tenant routes and tenant payload has…  7.82s  
  ✓ post cutover tenant with zatca app disabled still exposes zatca fie… 0.15s  
  Duration: 8.00s
```

### `F-pg-chain.log`

```text
=== PG F01 ===
[F] OK  B PUT settings/credential: A settings + credential row unchanged; 2 rows, 2 tenants
[F] OK  X-Branch-Id=<A main branch> from B ignored; list still B-only
[F] OK  Eloquent under B context: A invoice/attempt invisible, 1 credential
[F] OK  Public API: A invoice 404 via B key; B invoice body has no zatca/xml/qr/icv/journal keys
[F] RESULT {"GET \/invoices\/{A.posted}":404,"GET \/invoices\/{A.posted}\/zatca":404,"GET \/invoices\/{A.posted}\/zatca\/submissions":404,"POST \/invoices\/{A.posted}\/zatca\/submissions":404,"POST \/invoices\/{A.posted}\/zatca\/submissions\/{A.attempt}\/dispatch":404,"POST \/invoices\/{B.posted}\/z
   PASS  Tests\Feature\F01CrossTenantZatcaProbeTest
  ✓ tenant b cannot reach any zatca or invoice route of tenant a         6.95s  
  Duration: 6.99s
=== PG F05 ===
   WARN  Metadata found in doc-comment for method Tests\Feature\F05BranchRestrictedZatcaProbeTest::branch_restricted_user_versus_other_branch_invoices(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
[F] revisions feed sample row keys: id,action,document_type,document_id,document_number,changes,user_id,user_name,created_at
[F] GET /invoices/{other.posted}                                   -> 404
[F] GET /invoices/{other.posted}/zatca                             -> 404
[F] GET /invoices/{other.posted}/zatca/submissions                 -> 404
[F] POST /invoices/{other.posted}/zatca/submissions                -> 404
[F] POST /invoices/{other.posted}/duplicate                        -> 404
[F] GET /invoices?branch=all contains other.posted                 -> no
[F] GET /invoices (X-Branch-Id: other) contains other.posted       -> no
[F] GET /revisions/invoice/{other.posted}                          -> 200
[F] GET /revisions feed exposes other-branch draft id              -> YES
[F] PUT /invoices/{other.draft}                                    -> 200
[F] PUT /invoices/{other.draft}/classification                     -> 200
[F] POST /invoices/{other.draft}/post                              -> 200
[F] DELETE /invoices/{other.draft2}                                -> 200
[F] other.draft after attack: status=posted notes=MODIFIED-BY-RESTRICTED branch=a2f2c86a-ab6d-47a7-9208-4021a1288414 zatca_icv=2 deleted(draft2)=true
[F] WRITE-BOUNDARY update=200 post=200 delete=200
   PASS  Tests\Feature\F05BranchRestrictedZatcaProbeTest
  ✓ branch restricted user versus other branch invoices                  7.96s  
  Duration: 8.00s
=== PG existing ===
   WARN  Metadata found in doc-comment for method Tests\Feature\ZatcaXmlEcdsaSignerTest::a_different_ec_curve_is_rejected(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   PASS  Tests\Feature\ApiTenantIsolationTest
  ✓ a tenant cannot read another tenants partner even with correct id    6.51s  
  ✓ a tenant cannot update or delete another tenants partner             0.35s  
  ✓ listing returns only the callers own records                         0.41s  
  ✓ searching partners never surfaces another tenants matches            0.39s  
  ✓ a tenant cannot invoice against another tenants partner              0.33s  
   PASS  Tests\Feature\ZatcaCredentialTest
  ✓ credentials are encrypted and only safe metadata is returned         0.31s  
  ✓ omitted secrets are preserved but first configuration requires them  0.40s  
  ✓ changing credentials requires the current password                   0.32s  
  ✓ changing csid stage requires a complete new credential set           0.21s  
  ✓ credential lists are isolated between tenants                        0.42s  
  ✓ the inner application guard rejects storage after disable wins the…  0.35s  
  ✓ a same key certificate with a different subject is not counted as a… 0.32s  
  ✓ invalid or mismatched cryptographic material is rejected             0.37s  
  ✓ a client auth oid prefix is not accepted as client auth              0.25s  
  ✓ a certificate authority cannot be stored as a csid leaf              0.32s  
  ✓ invalid environment and stage are rejected                           0.36s  
   PASS  Tests\Feature\ZatcaPhase2Test
  ✓ each invoice gets a uuid and xml                                     0.21s  
  ✓ qr marker text in business data does not block posting               0.14s  
  ✓ icv counter increments per invoice                                   0.34s  
  ✓ first invoice uses the genesis previous hash                         0.21s  
  ✓ each invoice chains to the previous hash                             0.35s  
  ✓ legacy raw hash is recanonicalized at the chain boundary             0.27s  
  ✓ document hash uses the official zatca c14n11 transform               0.32s  
  ✓ genesis hash helper is sha256 of zero                                0.16s  
   PASS  Tests\Feature\ZatcaSubmissionAttemptTest
  ✓ a manual request creates one pending attempt without network submis… 0.32s  
  ✓ the same idempotency key returns the same attempt                    0.34s  
  ✓ an idempotency key cannot be reused for another invoice              0.48s  
  ✓ a parallel manual request with a different key is rejected           0.39s  
  ✓ a failed attempt can be retried manually with the next number        0.41s  
  ✓ an accepted invoice cannot be submitted again                        0.42s  
  ✓ a draft without frozen zatca xml is rejected                         0.29s  
  ✓ the idempotency header is mandatory                                  0.38s  
  Duration: 18.36s
=== PG race unsigned ===
[F-race] migrate:fresh on pgsql/audit_f …
[F-race] baseline single post: 60.5 ms (signed=false, icv=1)
[F-race] invoice   ok=true icv=2 dur=154.4ms 
[F-race] invoice   ok=true icv=3 dur=331.1ms 
[F-race] invoice   ok=true icv=4 dur=343.9ms 
[F-race] payment   ok=true icv=- dur=1436.7ms post() took 214.3ms (ledger lock wait)
[F-race] invoice   ok=false icv=- dur=1194.8ms Illuminate\Database\DeadlockException: SQLSTATE[40P01]: Deadlock detected: 7 ERROR:  deadlock detected
DETAIL:  Process 21432 waits for ShareLock on transaction 58500; blocked by process 21430.
Process 21430 waits for ShareLock on transact
[F-race] invoice   ok=false icv=- dur=1048.5ms Illuminate\Database\QueryException: SQLSTATE[40P01]: Deadlock detected: 7 ERROR:  deadlock detected
DETAIL:  Process 21434 waits for ShareLock on transaction 58496; blocked by process 21432.
Process 21432 waits for ShareLock on transact
[F-race] invoice   ok=true icv=6 dur=1358.9ms 
[F-race] invoice   ok=true icv=5 dur=1182.4ms 
[F-race] wall time for 8 concurrent posts (+1 payment): 2159.7 ms; sum of invoice durations: 5614 ms
[F-race] ICVs: 1,2,3,4,5,6
[F-race] ICV indexes on invoices: invoices_tenant_id_zatca_icv_unique(tenant_id,zatca_icv) unique=true
[F-race] process intervals overlapping (expected: many, since whole process incl. boot overlaps): 3
{"workers":8,"signed":false,"posted":6,"icv_unique":true,"icv_sequential":true,"chain_ok":true,"baseline_ms":60.5,"wall_ms":2159.7,"errors":["Illuminate\\Database\\DeadlockException: SQLSTATE[40P01]: Deadlock detected: 7 ERROR:  deadlock detected\nDETAIL:  Process 21432 waits for ShareLock on transa
[F-race] SUMMARY {"workers":8,"signed":false,"posted":6,"icv_unique":true,"icv_sequential":true,"chain_ok":true,"baseline_ms":60.5,"wall_ms":2159.7,"errors":["Illuminate\\Database\\DeadlockException: SQLSTATE[40P01]: Deadlock detected: 7 ERROR:  deadlock detected\nDETAIL:  Process 21432 waits for Sh
=== PG race signed ===
[F-race] migrate:fresh on pgsql/audit_f …
In ZatcaSignaturePolicyResolver.php line 16:
  سياسة توقيع ZATCA غير مهيأة في إعدادات النشر.  
DONE
```

### `F-pg-race2.log`

```text
=== PG race unsigned, invoices only, run 1 ===
[F-race] baseline single post: 70.4 ms (signed=false, icv=1)
[F-race] invoice   ok=true icv=2 dur=188.6ms 
[F-race] invoice   ok=true icv=3 dur=254.5ms 
[F-race] invoice   ok=true icv=6 dur=458.3ms 
[F-race] invoice   ok=true icv=4 dur=240.2ms 
[F-race] invoice   ok=true icv=7 dur=479.2ms 
[F-race] invoice   ok=true icv=5 dur=267.6ms 
[F-race] invoice   ok=true icv=8 dur=550.8ms 
[F-race] wall time for 8 concurrent posts (+1 payment): 1121.3 ms; sum of invoice durations: 2439.2 ms
[F-race] ICVs: 1,2,3,4,5,6,7,8
[F-race] ICV indexes on invoices: invoices_tenant_id_zatca_icv_unique(tenant_id,zatca_icv) unique=true
[F-race] process intervals overlapping (expected: many, since whole process incl. boot overlaps): 18
[F-race] SUMMARY {"workers":8,"signed":false,"posted":8,"icv_unique":true,"icv_sequential":true,"chain_ok":true,"baseline_ms":70.4,"wall_ms":1121.3,"errors":[]}
=== PG race unsigned, invoices only, run 2 ===
[F-race] baseline single post: 83.9 ms (signed=false, icv=1)
[F-race] invoice   ok=true icv=2 dur=274.2ms 
[F-race] invoice   ok=true icv=3 dur=239.1ms 
[F-race] invoice   ok=true icv=4 dur=323.9ms 
[F-race] invoice   ok=true icv=5 dur=424.7ms 
[F-race] invoice   ok=true icv=6 dur=489.6ms 
[F-race] invoice   ok=true icv=7 dur=450ms 
[F-race] invoice   ok=true icv=8 dur=475.4ms 
[F-race] wall time for 8 concurrent posts (+1 payment): 1257.8 ms; sum of invoice durations: 2676.9 ms
[F-race] ICVs: 1,2,3,4,5,6,7,8
[F-race] ICV indexes on invoices: invoices_tenant_id_zatca_icv_unique(tenant_id,zatca_icv) unique=true
[F-race] process intervals overlapping (expected: many, since whole process incl. boot overlaps): 19
[F-race] SUMMARY {"workers":8,"signed":false,"posted":8,"icv_unique":true,"icv_sequential":true,"chain_ok":true,"baseline_ms":83.9,"wall_ms":1257.8,"errors":[]}
=== PG race unsigned + payment ===
[F-race] baseline single post: 66.5 ms (signed=false, icv=1)
[F-race] invoice   ok=true icv=2 dur=269ms 
[F-race] invoice   ok=true icv=3 dur=340.7ms 
[F-race] invoice   ok=false icv=- dur=1134.6ms Illuminate\Database\QueryException: SQLSTATE[40P01]: Deadlock detected: 7 ERROR: deadlock detected DETAIL: Process 22765 waits for AccessExclusiveLock on tuple (0,1) of relation 311228 of database 16391; blocked by process 22767. Proc
[F-race] invoice   ok=false icv=- dur=1266ms Illuminate\Database\DeadlockException: SQLSTATE[40P01]: Deadlock detected: 7 ERROR: deadlock detected DETAIL: Process 22764 waits for ShareLock on transaction 60931; blocked by process 22771. Process 22771 waits for ShareLock on transact
[F-race] invoice   ok=false icv=- dur=1135.2ms Illuminate\Database\QueryException: SQLSTATE[40P01]: Deadlock detected: 7 ERROR: deadlock detected DETAIL: Process 22766 waits for AccessExclusiveLock on tuple (0,1) of relation 311228 of database 16391; blocked by process 22767. Proc
[F-race] invoice   ok=false icv=- dur=1085.1ms Illuminate\Database\QueryException: SQLSTATE[40P01]: Deadlock detected: 7 ERROR: deadlock detected DETAIL: Process 22768 waits for AccessExclusiveLock on tuple (0,1) of relation 311228 of database 16391; blocked by process 22767. Proc
[F-race] invoice   ok=false icv=- dur=1194.4ms Illuminate\Database\QueryException: SQLSTATE[40P01]: Deadlock detected: 7 ERROR: deadlock detected DETAIL: Process 22767 waits for ShareLock on transaction 60924; blocked by process 22764. Process 22764 waits for ShareLock on transact
[F-race] payment   ok=true icv=- dur=1148.6ms post() took 35.1ms (ledger lock wait)
[F-race] wall time for 8 concurrent posts (+1 payment): 1807.5 ms; sum of invoice durations: 6425 ms
[F-race] ICVs: 1,2,3
[F-race] ICV indexes on invoices: invoices_tenant_id_zatca_icv_unique(tenant_id,zatca_icv) unique=true
[F-race] process intervals overlapping (expected: many, since whole process incl. boot overlaps): 1
[F-race] SUMMARY {"workers":8,"signed":false,"posted":3,"icv_unique":true,"icv_sequential":true,"chain_ok":true,"baseline_ms":66.5,"wall_ms":1807.5,"errors":["Illuminate\\Database\\QueryException: SQLSTATE[40P01]: Deadlock detected: 7 ERROR: deadlock detected DETAIL: Process 22765 waits for AccessEx
=== PG race signed + payment ===
[F-race] baseline single post: 129.4 ms (signed=true, icv=1)
[F-race] invoice   ok=true icv=2 dur=352.6ms 
[F-race] invoice   ok=true icv=3 dur=551.2ms 
[F-race] invoice   ok=false icv=- dur=1579.6ms Illuminate\Database\DeadlockException: SQLSTATE[40P01]: Deadlock detected: 7 ERROR: deadlock detected DETAIL: Process 22924 waits for ShareLock on transaction 61541; blocked by process 22941. Process 22941 waits for ShareLock on transact
[F-race] invoice   ok=true icv=4 dur=528.8ms 
[F-race] invoice   ok=false icv=- dur=1531.1ms Illuminate\Database\QueryException: SQLSTATE[40P01]: Deadlock detected: 7 ERROR: deadlock detected DETAIL: Process 22926 waits for ShareLock on transaction 61534; blocked by process 22924. Process 22924 waits for ShareLock on transact
[F-race] invoice   ok=false icv=- dur=1096.6ms Illuminate\Database\QueryException: SQLSTATE[40P01]: Deadlock detected: 7 ERROR: deadlock detected DETAIL: Process 22939 waits for AccessExclusiveLock on tuple (0,1) of relation 321046 of database 16391; blocked by process 22926. Proc
[F-race] invoice   ok=false icv=- dur=1069.1ms Illuminate\Database\QueryException: SQLSTATE[40P01]: Deadlock detected: 7 ERROR: deadlock detected DETAIL: Process 22940 waits for AccessExclusiveLock on tuple (0,1) of relation 321046 of database 16391; blocked by process 22926. Proc
[F-race] payment   ok=true icv=- dur=1350.8ms post() took 49.8ms (ledger lock wait)
[F-race] wall time for 8 concurrent posts (+1 payment): 2165.8 ms; sum of invoice durations: 6709 ms
[F-race] ICVs: 1,2,3,4
[F-race] ICV indexes on invoices: invoices_tenant_id_zatca_icv_unique(tenant_id,zatca_icv) unique=true
[F-race] process intervals overlapping (expected: many, since whole process incl. boot overlaps): 3
{"workers":8,"signed":true,"posted":4,"icv_unique":true,"icv_sequential":true,"chain_ok":true,"baseline_ms":129.4,"wall_ms":2165.8,"errors":["Illuminate\\Database\\DeadlockException: SQLSTATE[40P01]: Deadlock detected: 7 ERROR: deadlock detected DETAIL: Process 22924 waits for ShareLock on transacti
[F-race] SUMMARY {"workers":8,"signed":true,"posted":4,"icv_unique":true,"icv_sequential":true,"chain_ok":true,"baseline_ms":129.4,"wall_ms":2165.8,"errors":["Illuminate\\Database\\DeadlockException: SQLSTATE[40P01]: Deadlock detected: 7 ERROR: deadlock detected DETAIL: Process 22924 waits for Share
=== PG race signed, invoices only, 4 workers ===
[F-race] baseline single post: 106.8 ms (signed=true, icv=1)
[F-race] invoice   ok=true icv=2 dur=170.5ms 
[F-race] invoice   ok=true icv=3 dur=345ms 
[F-race] invoice   ok=true icv=4 dur=487.3ms 
[F-race] wall time for 4 concurrent posts (+1 payment): 691.9 ms; sum of invoice durations: 1002.8 ms
[F-race] ICVs: 1,2,3,4
[F-race] ICV indexes on invoices: invoices_tenant_id_zatca_icv_unique(tenant_id,zatca_icv) unique=true
[F-race] process intervals overlapping (expected: many, since whole process incl. boot overlaps): 3
[F-race] SUMMARY {"workers":4,"signed":true,"posted":4,"icv_unique":true,"icv_sequential":true,"chain_ok":true,"baseline_ms":106.8,"wall_ms":691.9,"errors":[]}
DONE
```

## Stream L — Lead

### `LEAD-positive-adjustment.log`

```text
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountManagementTest::owner_creates_a_custom_account_under_a_matching_active_group(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountManagementTest::owner_can_create_a_custom_root_group_without_an_accounting_entry(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountManagementTest::duplicate_codes_and_invalid_parents_are_rejected(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountManagementTest::system_accounts_are_not_editable(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountManagementTest::an_account_with_history_keeps_its_code_type_and_parent_but_may_be_renamed_or_deactivated(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attrib
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountManagementTest::a_group_with_active_children_cannot_be_deactivated_and_an_accountant_cannot_manage_accounts(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use att
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountManagementTest::account_workspace_aggregates_descendants_and_filters_balances_by_branch(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountManagementTest::code_suggestion_uses_existing_numeric_siblings_and_cross_tenant_parent_is_rejected(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes i
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountManagementTest::account_deletion_is_protected_for_children_and_financial_history(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountManagementTest::accounts_remain_tenant_isolated(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountRoutingTest::registration_seeds_an_explicit_mapping_for_every_catalog_role(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountRoutingTest::each_default_mapping_points_at_the_catalog_legacy_code_account(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountRoutingTest::seed_defaults_is_idempotent_and_never_overwrites_an_explicit_choice(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountRoutingTest::backfill_seeds_missing_mappings_for_a_pre_existing_tenant_without_touching_existing_ones(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attribute
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountRoutingTest::tenant_a_cannot_map_or_see_tenant_b_accounts(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountRoutingTest::tenant_a_cannot_read_tenant_b_routing_state(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountRoutingTest::mapping_to_an_inactive_account_is_rejected(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountRoutingTest::mapping_to_a_group_account_is_rejected(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountRoutingTest::unknown_role_key_is_rejected_on_write_and_reset(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountRoutingTest::valid_mapping_resolves_the_selected_account(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountRoutingTest::resolver_fails_closed_when_no_explicit_mapping_exists_and_never_falls_back_to_the_legacy_code(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attr
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountRoutingTest::an_explicit_mapping_that_later_becomes_invalid_fails_closed_without_silent_fallback(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes ins
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountRoutingTest::invalid_mapping_is_surfaced_in_the_routing_list_not_silently_resolved(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountRoutingTest::reset_writes_the_default_account_as_a_new_explicit_mapping_never_deletes_the_row(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instea
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountRoutingTest::mapping_writes_create_an_immutable_audit_trail_with_before_after_snapshots(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountRoutingTest::reset_records_a_mapping_reset_audit_event(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountRoutingTest::unique_constraint_prevents_duplicate_mapping_rows_per_role(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountRoutingTest::accountant_and_staff_cannot_view_or_manage_account_routing_by_default(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountRoutingTest::owner_can_view_and_manage_account_routing_via_wildcard(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountRoutingTest::view_permission_alone_cannot_mutate_mappings(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountRoutingTest::mapping_writes_never_create_or_touch_journal_lines(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountRoutingTest::catalog_does_not_define_generic_cash_or_bank_roles(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountSettingsTest::user_can_save_only_supported_display_preferences(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountSettingsTest::app_theme_defaults_to_default_and_is_not_dropped_by_a_locale_only_save(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountSettingsTest::user_must_confirm_current_password_to_change_email_and_global_email_stays_unique(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes inste
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountSettingsTest::password_change_keeps_current_token_and_revokes_other_sessions(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountSettingsTest::company_export_is_owner_only_and_never_contains_credentials(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockConcurrencyTest::creating_a_lock_waits_for_the_tenant_anchor_held_by_another_connection(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockConcurrencyTest::the_ledger_guard_waits_on_the_same_anchor_so_a_posting_cannot_slip_past_a_landing_lock(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code t
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockConcurrencyTest::a_concurrent_overlapping_lock_is_rejected_after_the_rival_commits_never_admitted_twice(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code t
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::posting_on_an_open_date_succeeds(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::posting_on_the_first_day_of_a_lock_fails(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::posting_on_the_last_day_of_a_lock_fails(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::posting_just_before_and_just_after_the_range_succeeds(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::a_date_inside_the_range_fails_and_the_implicit_today_is_guarded_too(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::an_omitted_date_is_guarded_as_today_not_waved_through(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::draft_create_edit_and_delete_stay_allowed_inside_a_locked_period(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::a_draft_moved_to_an_open_date_posts_normally(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::an_original_inside_a_locked_period_is_reversed_into_an_open_date(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::a_reversal_dated_inside_a_lock_fails(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::the_original_entry_is_never_mutated_by_a_lock_or_a_blocked_reversal(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::reversal_copies_the_original_concrete_accounts_without_re_resolving_roles(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::overlapping_active_ranges_are_rejected(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::adjacent_ranges_are_allowed(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::a_start_date_after_the_end_date_is_rejected(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::a_released_range_stops_blocking_and_the_row_survives(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::releasing_frees_the_range_for_a_replacement_lock(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::a_lock_in_tenant_a_never_blocks_tenant_b(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::the_api_requires_the_view_permission_to_list_locks(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::the_api_requires_the_manage_permission_to_create_or_release_a_lock(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::unauthenticated_and_cross_tenant_api_attempts_are_rejected(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::there_is_no_hard_delete_route_for_a_lock(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::two_overlapping_lock_creations_never_leave_two_active_ranges(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::the_guard_and_the_lock_writer_share_one_tenant_anchor(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::a_rejected_posting_leaves_no_journal_entry_or_line_behind(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::a_rejected_invoice_posting_leaves_no_partial_operational_side_effects(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::representative_document_paths_are_all_blocked_by_the_central_guard(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::ledger_post_and_reverse_cannot_be_called_past_the_guard(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::no_code_outside_the_ledger_writes_journal_rows_directly(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::a_company_wide_lock_blocks_every_branch_including_null_branch_lines(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::an_open_period_changes_nothing_about_amounts_accounts_or_direction(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::reports_and_history_still_see_entries_inside_a_locked_period(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::creating_and_releasing_a_lock_write_immutable_audit_events(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::the_audit_trail_records_the_actor_behind_each_action(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::a_lock_requires_a_reason_on_both_create_and_release(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingPeriodLockTest::a_released_lock_cannot_be_released_twice(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingSettingsRbacTest::permission_catalog_contains_the_new_permissions(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingSettingsRbacTest::owner_and_admin_have_access_via_wildcard(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AccountingSettingsRbacTest::accountant_and_staff_do_not_have_access_by_default(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiAuthTest::the_health_endpoint_is_public_and_ok(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiAuthTest::register_creates_a_tenant_and_returns_a_token(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiAuthTest::login_returns_a_token_for_valid_credentials(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiAuthTest::login_works_by_email_only_and_resolves_the_tenant(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiAuthTest::registration_rejects_a_duplicate_email_across_tenants(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiAuthTest::login_fails_with_wrong_password(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiAuthTest::me_requires_authentication(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiAuthTest::me_returns_the_current_user_when_authenticated(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiAuthTest::me_includes_company_seller_info_for_documents(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiAuthTest::logout_revokes_the_token(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiInventoryTest::it_lists_only_tracked_products_with_computed_value(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiInventoryTest::it_lists_movements_for_a_product(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiInventoryTest::inventory_is_tenant_isolated(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiInvoiceTest::creating_and_posting_an_invoice_via_api_generates_a_balanced_entry(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiInvoiceTest::invoice_line_product_snapshots_stay_stable_in_the_api_response(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiInvoiceTest::invoice_validation_rejects_empty_items(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiInvoiceTest::duplicating_an_invoice_via_api_creates_a_clean_draft_copy(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiInvoiceTest::posting_a_paid_already_invoice_via_api_settles_it_with_a_receipt_voucher(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiInvoiceTest::invoice_auto_settlement_succeeds_when_deposit_scope_user_matches_the_authenticated_actor(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes in
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiInvoiceTest::invoice_auto_settlement_is_denied_when_deposit_scope_user_does_not_match_the_actor_with_no_partial_effect(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to 
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiInvoiceTest::direct_cash_sale_is_denied_when_deposit_scope_user_does_not_match_the_actor_with_no_partial_effect(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use att
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiInvoiceTest::direct_cash_sale_succeeds_when_deposit_scope_user_matches_the_authenticated_actor(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiPartnerTest::full_partner_crud_cycle(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiPartnerTest::partner_profile_fields_round_trip_and_credit_limit_is_returned_in_riyal(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiPartnerTest::the_partner_index_filters_by_role(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiPartnerTest::partner_index_search_is_scoped_by_role_and_matches_supported_identity_fields(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiPartnerTest::partner_index_search_treats_like_wildcards_as_literal_text_and_caps_input_length(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiPartnerTest::searching_partners_still_requires_partners_view_permission(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiPartnerTest::creating_a_partner_validates_input(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiRbacTest::unauthenticated_requests_are_rejected(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiRbacTest::staff_can_view_but_cannot_manage_partners(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiRbacTest::accountant_can_manage_partners_and_invoices(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiRbacTest::owner_has_full_access(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiReportsTest::reports_require_authentication(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiReportsTest::account_ledger_endpoint_returns_running_balance_in_riyal(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiReportsTest::aging_endpoint_returns_buckets(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiReportsTest::invalid_aging_type_returns_404(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiTenantIsolationTest::a_tenant_cannot_read_another_tenants_partner_even_with_correct_id(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiTenantIsolationTest::a_tenant_cannot_update_or_delete_another_tenants_partner(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiTenantIsolationTest::listing_returns_only_the_callers_own_records(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiTenantIsolationTest::searching_partners_never_surfaces_another_tenants_matches(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\ApiTenantIsolationTest::a_tenant_cannot_invoice_against_another_tenants_partner(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AppBuilderIntegratedProofTest::full_lifecycle_create_edit_theme_sync_pages_validate_publish_restore_revalidate_publish_again(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code 
   WARN  Metadata found in doc-comment for method Tests\Feature\AppBuilderIntegratedProofTest::full_lifecycle_denies_every_step_across_tenants(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AppBuilderIntegratedProofTest::full_lifecycle_denies_every_mutating_step_to_a_role_without_app_builder_permissions(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use att
   WARN  Metadata found in doc-comment for method Tests\Feature\AppBuilderIntegratedProofTest::integrated_proof_accepts_binding_structurally_and_now_publishes_a_shipped_resource_binding(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to 
   WARN  Metadata found in doc-comment for method Tests\Feature\AppBuilderPreviewToRuntimeIntegratedProofTest::the_canonical_fixture_round_trips_byte_identically_from_draft_through_publish_to_a_real_mobile_fetch_and_resolves_compatible(). Metadata in doc-comments is deprecated and will no longer be 
   WARN  Metadata found in doc-comment for method Tests\Feature\AppBuilderPreviewToRuntimeIntegratedProofTest::the_fixture_itself_only_uses_components_actions_and_bindings_the_current_shipped_runtime_manifest_declares(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUn
   WARN  Metadata found in doc-comment for method Tests\Feature\AppBuilderRegistryTest::it_returns_every_component_and_action_the_runtime_supports(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AppBuilderRegistryTest::a_component_definition_exposes_its_typed_props_and_children_rule(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AppBuilderRegistryTest::an_action_definition_exposes_its_typed_params_and_dispatch_status(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AppBuilderRegistryTest::it_exposes_every_bindable_resource_the_data_resource_registry_defines(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AppBuilderRegistryTest::a_component_definition_exposes_the_resources_it_may_bind_to(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AppBuilderRegistryTest::it_exposes_the_closed_visibility_signal_and_operator_vocabularies(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AppBuilderRegistryTest::a_component_and_its_props_expose_bilingual_labels_without_changing_internal_keys(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes in
   WARN  Metadata found in doc-comment for method Tests\Feature\AppBuilderRegistryTest::an_action_and_its_params_expose_bilingual_labels_without_changing_internal_keys(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes ins
   WARN  Metadata found in doc-comment for method Tests\Feature\AppBuilderRegistryTest::staff_role_without_the_permission_is_denied(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AppBuilderSameStoreProofTest::published_app_builder_experience_and_storefront_web_resolve_the_identical_commerce_core_product_data(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test
   WARN  Metadata found in doc-comment for method Tests\Feature\AppSchemaParserTest::parses_a_minimal_valid_schema(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AppSchemaParserTest::parses_required_capabilities_when_present(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AppSchemaParserTest::parses_an_action_reference_on_a_component(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AppSchemaParserTest::rejects_an_unknown_top_level_field(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AppSchemaParserTest::rejects_a_missing_schema_version(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AppSchemaParserTest::rejects_an_invalid_schema_version_format(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AppSchemaParserTest::rejects_an_unknown_component_field(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AppSchemaParserTest::rejects_a_component_missing_id(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AppSchemaParserTest::rejects_children_that_are_not_a_list(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AppSchemaParserTest::rejects_a_non_page_root_component(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AppSchemaParserTest::rejects_navigation_initial_page_id_referencing_an_undeclared_page(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AppSchemaParserTest::rejects_a_component_tree_deeper_than_the_max_depth(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
   WARN  Metadata found in doc-comment for method Tests\Feature\AppSchemaParserTest::rejects_a_component_tree_with_too_many_nodes(). Metadata in doc-comments is deprecated and will no longer be supported in PHPUnit 12. Update your test code to use attributes instead.
```
