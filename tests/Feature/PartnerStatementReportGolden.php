<?php

// IMP-PS-A2b: لقطة ذهبية لكشف حساب الطرف — وُلِّدت من الخدمة قبل أي تعديل عليها. ملف PHP (لا JSON) عمداً: خطوات تجميع تطبيق الاختبار (ci.yml / setup.sh / deploy/assemble.sh)
// تنسخ tests/Feature/*.php فقط. لا يُحمَّل كاختبار (لا ينتهي بـ Test.php). إعادة التوليد (بقرار مراجعة): GOLDEN_WRITE=1 php artisan test --filter=PartnerStatementReportGoldenTest

return array (
  'unfiltered' => 
  array (
    'partner' => 
    array (
      'id' => 'U1',
      'name' => 'طرف مزدوج',
      'type' => 'both',
    ),
    'opening_balance' => 0,
    'rows' => 
    array (
      0 => 
      array (
        'date' => '2026-08-15',
        'number' => 'JE-2026-00001',
        'description' => 'رصيد افتتاحي',
        'debit' => 50000,
        'credit' => 0,
        'balance' => 50000,
        'source' => 
        array (
          'kind' => 'opening',
          'id' => 'U1',
          'label' => 'رصيد افتتاحي',
          'allocations' => 
          array (
          ),
        ),
      ),
      1 => 
      array (
        'date' => '2026-09-01',
        'number' => 'JE-2026-00002',
        'description' => 'فاتورة مبيعات INV-2026-00001',
        'debit' => 230000,
        'credit' => 0,
        'balance' => 280000,
        'source' => 
        array (
          'kind' => 'invoice',
          'id' => 'U2',
          'label' => 'فاتورة مبيعات INV-2026-00001',
          'allocations' => 
          array (
          ),
        ),
      ),
      2 => 
      array (
        'date' => '2026-09-03',
        'number' => 'JE-2026-00003',
        'description' => 'سند قبض REC-2026-00001',
        'debit' => 0,
        'credit' => 100000,
        'balance' => 180000,
        'source' => 
        array (
          'kind' => 'payment',
          'id' => 'U3',
          'label' => 'سند قبض REC-2026-00001',
          'allocations' => 
          array (
            0 => 
            array (
              'kind' => 'invoice',
              'id' => 'U2',
              'number' => 'INV-2026-00001',
              'amount' => 100000,
            ),
          ),
        ),
      ),
      3 => 
      array (
        'date' => '2026-09-05',
        'number' => 'JE-2026-00004',
        'description' => 'فاتورة مشتريات BILL-2026-00001',
        'debit' => 0,
        'credit' => 115000,
        'balance' => 65000,
        'source' => 
        array (
          'kind' => 'purchase',
          'id' => 'U4',
          'label' => 'فاتورة مشتريات BILL-2026-00001',
          'allocations' => 
          array (
          ),
        ),
      ),
      4 => 
      array (
        'date' => '2026-09-08',
        'number' => 'JE-2026-00005',
        'description' => 'سند صرف PAY-2026-00001',
        'debit' => 40000,
        'credit' => 0,
        'balance' => 105000,
        'source' => 
        array (
          'kind' => 'payment',
          'id' => 'U5',
          'label' => 'سند صرف PAY-2026-00001',
          'allocations' => 
          array (
            0 => 
            array (
              'kind' => 'purchase',
              'id' => 'U4',
              'number' => 'BILL-2026-00001',
              'amount' => 40000,
            ),
          ),
        ),
      ),
      5 => 
      array (
        'date' => '2026-09-10',
        'number' => 'JE-2026-00006',
        'description' => 'قيد يدوي',
        'debit' => 7000,
        'credit' => 0,
        'balance' => 112000,
        'source' => NULL,
      ),
    ),
    'closing_balance' => 112000,
  ),
  'period' => 
  array (
    'partner' => 
    array (
      'id' => 'U1',
      'name' => 'طرف مزدوج',
      'type' => 'both',
    ),
    'opening_balance' => 280000,
    'rows' => 
    array (
      0 => 
      array (
        'date' => '2026-09-03',
        'number' => 'JE-2026-00003',
        'description' => 'سند قبض REC-2026-00001',
        'debit' => 0,
        'credit' => 100000,
        'balance' => 180000,
        'source' => 
        array (
          'kind' => 'payment',
          'id' => 'U3',
          'label' => 'سند قبض REC-2026-00001',
          'allocations' => 
          array (
            0 => 
            array (
              'kind' => 'invoice',
              'id' => 'U2',
              'number' => 'INV-2026-00001',
              'amount' => 100000,
            ),
          ),
        ),
      ),
      1 => 
      array (
        'date' => '2026-09-05',
        'number' => 'JE-2026-00004',
        'description' => 'فاتورة مشتريات BILL-2026-00001',
        'debit' => 0,
        'credit' => 115000,
        'balance' => 65000,
        'source' => 
        array (
          'kind' => 'purchase',
          'id' => 'U4',
          'label' => 'فاتورة مشتريات BILL-2026-00001',
          'allocations' => 
          array (
          ),
        ),
      ),
      2 => 
      array (
        'date' => '2026-09-08',
        'number' => 'JE-2026-00005',
        'description' => 'سند صرف PAY-2026-00001',
        'debit' => 40000,
        'credit' => 0,
        'balance' => 105000,
        'source' => 
        array (
          'kind' => 'payment',
          'id' => 'U5',
          'label' => 'سند صرف PAY-2026-00001',
          'allocations' => 
          array (
            0 => 
            array (
              'kind' => 'purchase',
              'id' => 'U4',
              'number' => 'BILL-2026-00001',
              'amount' => 40000,
            ),
          ),
        ),
      ),
    ),
    'closing_balance' => 105000,
  ),
  'customer' => 
  array (
    'partner' => 
    array (
      'id' => 'U1',
      'name' => 'طرف مزدوج',
      'type' => 'both',
    ),
    'opening_balance' => 0,
    'rows' => 
    array (
      0 => 
      array (
        'date' => '2026-08-15',
        'number' => 'JE-2026-00001',
        'description' => 'رصيد افتتاحي',
        'debit' => 50000,
        'credit' => 0,
        'balance' => 50000,
        'source' => 
        array (
          'kind' => 'opening',
          'id' => 'U1',
          'label' => 'رصيد افتتاحي',
          'allocations' => 
          array (
          ),
        ),
      ),
      1 => 
      array (
        'date' => '2026-09-01',
        'number' => 'JE-2026-00002',
        'description' => 'فاتورة مبيعات INV-2026-00001',
        'debit' => 230000,
        'credit' => 0,
        'balance' => 280000,
        'source' => 
        array (
          'kind' => 'invoice',
          'id' => 'U2',
          'label' => 'فاتورة مبيعات INV-2026-00001',
          'allocations' => 
          array (
          ),
        ),
      ),
      2 => 
      array (
        'date' => '2026-09-03',
        'number' => 'JE-2026-00003',
        'description' => 'سند قبض REC-2026-00001',
        'debit' => 0,
        'credit' => 100000,
        'balance' => 180000,
        'source' => 
        array (
          'kind' => 'payment',
          'id' => 'U3',
          'label' => 'سند قبض REC-2026-00001',
          'allocations' => 
          array (
            0 => 
            array (
              'kind' => 'invoice',
              'id' => 'U2',
              'number' => 'INV-2026-00001',
              'amount' => 100000,
            ),
          ),
        ),
      ),
    ),
    'closing_balance' => 180000,
  ),
  'supplier' => 
  array (
    'partner' => 
    array (
      'id' => 'U1',
      'name' => 'طرف مزدوج',
      'type' => 'both',
    ),
    'opening_balance' => 0,
    'rows' => 
    array (
      0 => 
      array (
        'date' => '2026-09-05',
        'number' => 'JE-2026-00004',
        'description' => 'فاتورة مشتريات BILL-2026-00001',
        'debit' => 0,
        'credit' => 115000,
        'balance' => -115000,
        'source' => 
        array (
          'kind' => 'purchase',
          'id' => 'U4',
          'label' => 'فاتورة مشتريات BILL-2026-00001',
          'allocations' => 
          array (
          ),
        ),
      ),
      1 => 
      array (
        'date' => '2026-09-08',
        'number' => 'JE-2026-00005',
        'description' => 'سند صرف PAY-2026-00001',
        'debit' => 40000,
        'credit' => 0,
        'balance' => -75000,
        'source' => 
        array (
          'kind' => 'payment',
          'id' => 'U5',
          'label' => 'سند صرف PAY-2026-00001',
          'allocations' => 
          array (
            0 => 
            array (
              'kind' => 'purchase',
              'id' => 'U4',
              'number' => 'BILL-2026-00001',
              'amount' => 40000,
            ),
          ),
        ),
      ),
    ),
    'closing_balance' => -75000,
  ),
  'customer_period' => 
  array (
    'partner' => 
    array (
      'id' => 'U1',
      'name' => 'طرف مزدوج',
      'type' => 'both',
    ),
    'opening_balance' => 50000,
    'rows' => 
    array (
      0 => 
      array (
        'date' => '2026-09-01',
        'number' => 'JE-2026-00002',
        'description' => 'فاتورة مبيعات INV-2026-00001',
        'debit' => 230000,
        'credit' => 0,
        'balance' => 280000,
        'source' => 
        array (
          'kind' => 'invoice',
          'id' => 'U2',
          'label' => 'فاتورة مبيعات INV-2026-00001',
          'allocations' => 
          array (
          ),
        ),
      ),
      1 => 
      array (
        'date' => '2026-09-03',
        'number' => 'JE-2026-00003',
        'description' => 'سند قبض REC-2026-00001',
        'debit' => 0,
        'credit' => 100000,
        'balance' => 180000,
        'source' => 
        array (
          'kind' => 'payment',
          'id' => 'U3',
          'label' => 'سند قبض REC-2026-00001',
          'allocations' => 
          array (
            0 => 
            array (
              'kind' => 'invoice',
              'id' => 'U2',
              'number' => 'INV-2026-00001',
              'amount' => 100000,
            ),
          ),
        ),
      ),
    ),
    'closing_balance' => 180000,
  ),
  'other_branch' => 
  array (
    'partner' => 
    array (
      'id' => 'U1',
      'name' => 'طرف مزدوج',
      'type' => 'both',
    ),
    'opening_balance' => 0,
    'rows' => 
    array (
    ),
    'closing_balance' => 0,
  ),
);
