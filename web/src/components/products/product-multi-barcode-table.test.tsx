// @vitest-environment jsdom
import * as React from 'react';
import type { ReactNode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { ProductMultiBarcodeTable } from './product-multi-barcode-table';
import arMessages from '@/messages/ar.json';
import enMessages from '@/messages/en.json';

const { apiMock, toastSuccess, toastError } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: vi.fn(), success: toastSuccess, error: toastError }),
}));

vi.mock('lucide-react', () => {
  const iconStub = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) =>
      typeof name === 'symbol' || name === 'then' || name === '__esModule'
        ? Reflect.get(target, name)
        : iconStub,
    has: () => true,
  });
});

const PRODUCT_ID = 'product-1';

type BarcodeRow = {
  id: string;
  code: string;
  unit_name: string | null;
  default_quantity: number;
  label: string | null;
  product_variant_id: string | null;
  variant_descriptor: string | null;
};

type UnitPriceRow = { id: string; product_variant_id: string | null; unit_name: string; price: string };

// ar = en لهاتين المفتاحين (الوحدة/Unit) — نستعمل رسائل ar.json الحقيقية
// كافتراضٍ لكل الاختبارات الوظيفية، ورسائل en.json فقط في اختبار الإنجليزية.
const ar = arMessages as unknown as { products: Record<string, string> };
const en = enMessages as unknown as { products: Record<string, string> };

function wrapAr(children: ReactNode) {
  return (
    <NextIntlClientProvider locale="ar" messages={arMessages as unknown as Record<string, unknown>}>
      {children}
    </NextIntlClientProvider>
  );
}

function wrapEn(children: ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages as unknown as Record<string, unknown>}>
      {children}
    </NextIntlClientProvider>
  );
}

function makeState() {
  return {
    barcodes: [] as BarcodeRow[],
    prices: [] as UnitPriceRow[],
  };
}

function installApiMock(state: ReturnType<typeof makeState>) {
  apiMock.mockImplementation(async (path: string, options: { method?: string; body?: unknown } = {}) => {
    const method = options.method ?? 'GET';

    if (path === `/products/${PRODUCT_ID}/barcodes` && method === 'GET') {
      return { data: state.barcodes };
    }
    if (path === `/products/${PRODUCT_ID}/unit-prices` && method === 'GET') {
      return { data: state.prices };
    }
    if (path === `/products/${PRODUCT_ID}/barcodes` && method === 'POST') {
      const body = options.body as { code: string; unit_name: string | null; default_quantity: number; label: string | null; product_variant_id: string | null };
      const row: BarcodeRow = {
        id: `bc-${state.barcodes.length + 1}`,
        code: body.code,
        unit_name: body.unit_name,
        default_quantity: body.default_quantity,
        label: body.label,
        product_variant_id: body.product_variant_id,
        variant_descriptor: body.product_variant_id ? 'أسود' : null,
      };
      state.barcodes.push(row);
      return { data: row };
    }
    if (path === `/products/${PRODUCT_ID}/unit-prices` && method === 'PUT') {
      const body = options.body as { unit_name: string | null; product_variant_id: string | null; price: number };
      const unitName = body.unit_name ?? 'piece';
      const existing = state.prices.find((p) => p.unit_name === unitName && (p.product_variant_id ?? null) === (body.product_variant_id ?? null));
      if (existing) {
        existing.price = String(body.price / 100);
      } else {
        state.prices.push({ id: `price-${state.prices.length + 1}`, product_variant_id: body.product_variant_id ?? null, unit_name: unitName, price: String(body.price / 100) });
      }
      return { data: {} };
    }
    const deleteMatch = path.match(new RegExp(`^/products/${PRODUCT_ID}/barcodes/([^/]+)$`));
    if (deleteMatch && method === 'DELETE') {
      state.barcodes = state.barcodes.filter((b) => b.id !== deleteMatch[1]);
      return { message: 'deleted' };
    }

    throw new Error(`unmocked api call: ${method} ${path}`);
  });
}

beforeEach(() => {
  apiMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(cleanup);

describe('جدول الباركود المتعدد وسعر الوحدة', () => {
  it('قسم الباركود المتعدد مغلقٌ ابتداءً', () => {
    const state = makeState();
    installApiMock(state);

    render(wrapAr(<ProductMultiBarcodeTable productId={PRODUCT_ID} baseUnitName="piece" alternateUnits={[]} isVariantManaged={false} variants={[]} />));

    expect(screen.getByText(ar.products.multi_barcode_expand)).toBeTruthy();
    // القسم مطويٌّ فعلياً — جدول العمود لا يُرسَم إطلاقاً قبل التوسيع.
    expect(screen.queryByText(ar.products.multi_barcode_col_unit)).toBeNull();
  });

  it('«باركود متعدد» يوسّع نفس المساحة (بلا نافذة/مسار جديد) ويعرض عمود السعر', async () => {
    const state = makeState();
    installApiMock(state);
    const user = userEvent.setup();

    render(wrapAr(<ProductMultiBarcodeTable productId={PRODUCT_ID} baseUnitName="piece" alternateUnits={[]} isVariantManaged={false} variants={[]} />));

    await user.click(screen.getByText(ar.products.multi_barcode_expand));

    await waitFor(() => expect(screen.getAllByText(ar.products.multi_barcode_col_unit).length).toBeGreaterThan(0));
    expect(screen.getByText(ar.products.multi_barcode_collapse)).toBeTruthy();
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(`/products/${PRODUCT_ID}/barcodes`));
  });

  it('صفوفٌ موجودة تُحمَّل وتُعرض عند فتح تعديل منتج (توسيعٌ تلقائي)', async () => {
    const state = makeState();
    state.barcodes = [
      { id: 'bc-1', code: '6291234567890', unit_name: 'pack', default_quantity: 1, label: null, product_variant_id: null, variant_descriptor: null },
    ];
    state.prices = [{ id: 'price-1', product_variant_id: null, unit_name: 'pack', price: '27.00' }];
    installApiMock(state);

    render(
      wrapAr(
        <ProductMultiBarcodeTable
          productId={PRODUCT_ID}
          baseUnitName="piece"
          alternateUnits={[{ name: 'pack', factor: 6 }]}
          isVariantManaged={false}
          variants={[]}
        />
      )
    );

    await waitFor(() => expect(screen.getAllByText('6291234567890').length).toBeGreaterThan(0));
  });

  it('إضافة صفٍّ جديد: POST باركود ثم PUT سعر الوحدة إن أُدخل سعر', async () => {
    const state = makeState();
    installApiMock(state);
    const user = userEvent.setup();

    render(wrapAr(<ProductMultiBarcodeTable productId={PRODUCT_ID} baseUnitName="piece" alternateUnits={[{ name: 'pack', factor: 6 }]} isVariantManaged={false} variants={[]} />));

    await user.click(screen.getByText(ar.products.multi_barcode_expand));
    await waitFor(() => expect(screen.getAllByText(ar.products.multi_barcode_col_unit).length).toBeGreaterThan(0));

    // الحقلان (سطح المكتب والجوال) يشتركان في الحالة نفسها — الأول يكفي.
    await user.type(screen.getAllByLabelText(ar.products.barcode_code)[0]!, '111222333');
    await user.type(screen.getAllByLabelText(ar.products.multi_barcode_col_price)[0]!, '27');
    await user.click(screen.getAllByRole('button', { name: new RegExp(ar.products.add_barcode) })[0]!);

    await waitFor(() => {
      const postCall = apiMock.mock.calls.find((call) => call[0] === `/products/${PRODUCT_ID}/barcodes` && (call[1] as { method?: string } | undefined)?.method === 'POST');
      expect(postCall).toBeTruthy();
      const body = (postCall![1] as { body: { code: string } }).body;
      expect(body.code).toBe('111222333');
    });

    await waitFor(() => {
      const putCall = apiMock.mock.calls.find((call) => call[0] === `/products/${PRODUCT_ID}/unit-prices` && (call[1] as { method?: string } | undefined)?.method === 'PUT');
      expect(putCall).toBeTruthy();
      const body = (putCall![1] as { body: { price: number } }).body;
      // ٢٧ ريالاً بالضبط — لا اشتقاقاً من المعامل ×٦ (لم تُرسل ١٦٢).
      expect(body.price).toBe(2700);
    });
  });

  it('لا اشتقاق سعرٍ من المعامل: معامل ×١٢ لا يضاعف السعر المُدخل تلقائياً', async () => {
    const state = makeState();
    installApiMock(state);
    const user = userEvent.setup();

    render(wrapAr(<ProductMultiBarcodeTable productId={PRODUCT_ID} baseUnitName="piece" alternateUnits={[{ name: 'carton', factor: 12 }]} isVariantManaged={false} variants={[]} />));

    await user.click(screen.getByText(ar.products.multi_barcode_expand));
    await waitFor(() => expect(screen.getAllByText(ar.products.multi_barcode_col_unit).length).toBeGreaterThan(0));

    await user.selectOptions(screen.getAllByLabelText(ar.products.unit)[0]!, 'carton');
    await user.type(screen.getAllByLabelText(ar.products.barcode_code)[0]!, '999888777');
    await user.type(screen.getAllByLabelText(ar.products.multi_barcode_col_price)[0]!, '50');
    await user.click(screen.getAllByRole('button', { name: new RegExp(ar.products.add_barcode) })[0]!);

    await waitFor(() => {
      const putCall = apiMock.mock.calls.find((call) => call[0] === `/products/${PRODUCT_ID}/unit-prices` && (call[1] as { method?: string } | undefined)?.method === 'PUT');
      expect(putCall).toBeTruthy();
      const body = (putCall![1] as { body: { price: number; unit_name: string | null } }).body;
      expect(body.price).toBe(5000); // ٥٠ ريالاً، وليس ٥٠ × ١٢
      expect(body.unit_name).toBe('carton');
    });
  });

  it('حذف صفٍّ يستدعي DELETE بعد تأكيد المستخدم', async () => {
    const state = makeState();
    state.barcodes = [
      { id: 'bc-1', code: '111', unit_name: null, default_quantity: 1, label: null, product_variant_id: null, variant_descriptor: null },
    ];
    installApiMock(state);
    const user = userEvent.setup();

    render(wrapAr(<ProductMultiBarcodeTable productId={PRODUCT_ID} baseUnitName="piece" alternateUnits={[]} isVariantManaged={false} variants={[]} />));

    await waitFor(() => expect(screen.getAllByText('111').length).toBeGreaterThan(0));

    const deleteButtons = screen.getAllByRole('button', { name: new RegExp(`${ar.products.delete}:`) });
    await user.click(deleteButtons[0]!);

    await waitFor(() => {
      const deleteCall = apiMock.mock.calls.find((call) => call[0] === `/products/${PRODUCT_ID}/barcodes/bc-1` && (call[1] as { method?: string } | undefined)?.method === 'DELETE');
      expect(deleteCall).toBeTruthy();
    });
  });

  it('محدِّد الوحدة يعرض الوحدات البديلة من قالب الوحدات', async () => {
    const state = makeState();
    installApiMock(state);
    const user = userEvent.setup();

    render(
      wrapAr(
        <ProductMultiBarcodeTable
          productId={PRODUCT_ID}
          baseUnitName="piece"
          alternateUnits={[{ name: 'pack', factor: 6 }, { name: 'carton', factor: 12 }]}
          isVariantManaged={false}
          variants={[]}
        />
      )
    );

    await user.click(screen.getByText(ar.products.multi_barcode_expand));
    await waitFor(() => expect(screen.getAllByLabelText(ar.products.unit).length).toBeGreaterThan(0));

    const select = screen.getAllByLabelText(ar.products.unit)[0] as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toContain('pack');
    expect(optionValues).toContain('carton');
  });

  it('محدِّد المتغيّر يظهر فقط للمنتجات ذات المتغيّرات', async () => {
    const state = makeState();
    installApiMock(state);
    const user = userEvent.setup();

    const { rerender } = render(
      wrapAr(<ProductMultiBarcodeTable productId={PRODUCT_ID} baseUnitName="piece" alternateUnits={[]} isVariantManaged={false} variants={[{ id: 'v-1', descriptor: 'أسود' }]} />)
    );
    await user.click(screen.getByText(ar.products.multi_barcode_expand));
    await waitFor(() => expect(screen.getAllByText(ar.products.multi_barcode_col_unit).length).toBeGreaterThan(0));
    expect(screen.queryByLabelText(ar.products.multi_barcode_col_variant)).toBeNull();

    rerender(
      wrapAr(<ProductMultiBarcodeTable productId={PRODUCT_ID} baseUnitName="piece" alternateUnits={[]} isVariantManaged variants={[{ id: 'v-1', descriptor: 'أسود' }]} />)
    );
    await waitFor(() => expect(screen.getAllByLabelText(ar.products.multi_barcode_col_variant).length).toBeGreaterThan(0));
  });

  it('إدخال سعرٍ غير صالح في صفّ الإضافة لا يستدعي PUT', async () => {
    const state = makeState();
    installApiMock(state);
    const user = userEvent.setup();

    render(wrapAr(<ProductMultiBarcodeTable productId={PRODUCT_ID} baseUnitName="piece" alternateUnits={[]} isVariantManaged={false} variants={[]} />));

    await user.click(screen.getByText(ar.products.multi_barcode_expand));
    await waitFor(() => expect(screen.getAllByText(ar.products.multi_barcode_col_unit).length).toBeGreaterThan(0));

    await user.type(screen.getAllByLabelText(ar.products.barcode_code)[0]!, '555');
    await user.type(screen.getAllByLabelText(ar.products.multi_barcode_col_price)[0]!, 'not-a-number');
    await user.click(screen.getAllByRole('button', { name: new RegExp(ar.products.add_barcode) })[0]!);

    await waitFor(() => {
      const postCall = apiMock.mock.calls.find((call) => call[0] === `/products/${PRODUCT_ID}/barcodes` && (call[1] as { method?: string } | undefined)?.method === 'POST');
      expect(postCall).toBeTruthy();
    });
    const putCall = apiMock.mock.calls.find((call) => call[0] === `/products/${PRODUCT_ID}/unit-prices` && (call[1] as { method?: string } | undefined)?.method === 'PUT');
    expect(putCall).toBeUndefined();
  });

  it('باركودان لنفس الوحدة يعرضان نفس السعر القانوني، وتعديل أحدهما يُحدِّث كليهما', async () => {
    const state = makeState();
    state.barcodes = [
      { id: 'bc-1', code: 'AAA', unit_name: 'pack', default_quantity: 1, label: null, product_variant_id: null, variant_descriptor: null },
      { id: 'bc-2', code: 'BBB', unit_name: 'pack', default_quantity: 6, label: null, product_variant_id: null, variant_descriptor: null },
    ];
    state.prices = [{ id: 'price-1', product_variant_id: null, unit_name: 'pack', price: '27.00' }];
    installApiMock(state);
    const user = userEvent.setup();

    render(
      wrapAr(
        <ProductMultiBarcodeTable
          productId={PRODUCT_ID}
          baseUnitName="piece"
          alternateUnits={[{ name: 'pack', factor: 6 }]}
          isVariantManaged={false}
          variants={[]}
        />
      )
    );

    await waitFor(() => expect(screen.getAllByText('AAA').length).toBeGreaterThan(0));

    // صفّان × هيكلا سطح المكتب/الجوال معاً في DOM = أربعة حقول تعرض نفس القيمة القانونية.
    const priceInputs = screen.getAllByDisplayValue('27.00');
    expect(priceInputs.length).toBe(4);

    await user.clear(priceInputs[0]!);
    await user.type(priceInputs[0]!, '30');
    priceInputs[0]!.blur();

    await waitFor(() => {
      const putCall = apiMock.mock.calls.find((call) => call[0] === `/products/${PRODUCT_ID}/unit-prices` && (call[1] as { method?: string } | undefined)?.method === 'PUT');
      expect(putCall).toBeTruthy();
    });

    // بعد الحفظ يُعاد الجلب — كل الصفوف (كلا الباركودين وكلا الهيكلين) تعكس القيمة الجديدة معاً.
    await waitFor(() => {
      expect(screen.getAllByDisplayValue('30').length).toBe(4);
    });
  });

  it('عرض متجاوب: الجدول والبطاقات المتراصّة كلاهما في DOM معاً (تبديل CSS)', async () => {
    const state = makeState();
    state.barcodes = [
      { id: 'bc-1', code: '111', unit_name: null, default_quantity: 1, label: null, product_variant_id: null, variant_descriptor: null },
    ];
    installApiMock(state);

    const { container } = render(wrapAr(<ProductMultiBarcodeTable productId={PRODUCT_ID} baseUnitName="piece" alternateUnits={[]} isVariantManaged={false} variants={[]} />));

    await waitFor(() => expect(screen.getAllByText('111').length).toBeGreaterThan(0));

    expect(container.querySelector('table')).toBeTruthy();
    expect(container.querySelector('div.space-y-2.md\\:hidden')).toBeTruthy();
    // بطاقات الجوال ذات أهدافٍ لمسيّةٍ لا تقل عن ٤٤ بكسل تقريباً (h-11).
    expect(container.querySelector('.h-11')).toBeTruthy();
  });

  it('العربية: عناوين الأعمدة والوصف تُترجم من رسائل ar.json الحقيقية', async () => {
    const state = makeState();
    installApiMock(state);
    const user = userEvent.setup();

    render(wrapAr(<ProductMultiBarcodeTable productId={PRODUCT_ID} baseUnitName="piece" alternateUnits={[]} isVariantManaged={false} variants={[]} />));

    expect(screen.getByText(ar.products.multi_barcode_hint)).toBeTruthy();
    await user.click(screen.getByText(ar.products.multi_barcode_expand));
    await waitFor(() => expect(screen.getAllByText(ar.products.multi_barcode_col_price).length).toBeGreaterThan(0));
    expect(screen.getByText(ar.products.multi_barcode_col_actions)).toBeTruthy();
  });

  it('الإنجليزية: عناوين الأعمدة والوصف تُترجم من رسائل en.json الحقيقية', async () => {
    const state = makeState();
    installApiMock(state);
    const user = userEvent.setup();

    render(wrapEn(<ProductMultiBarcodeTable productId={PRODUCT_ID} baseUnitName="piece" alternateUnits={[]} isVariantManaged={false} variants={[]} />));

    expect(screen.getByText(en.products.multi_barcode_hint)).toBeTruthy();
    await user.click(screen.getByText(en.products.multi_barcode_expand));
    await waitFor(() => expect(screen.getAllByText(en.products.multi_barcode_col_price).length).toBeGreaterThan(0));
    expect(screen.getByText(en.products.multi_barcode_col_actions)).toBeTruthy();
  });
});

describe('وضع الإنشاء — بلا product_id بعد (PR-PROD-UX-2)', () => {
  it('لا نداء شبكة إطلاقاً قبل وجود product_id', async () => {
    const user = userEvent.setup();
    render(wrapAr(<ProductMultiBarcodeTable baseUnitName="piece" alternateUnits={[]} isVariantManaged={false} variants={[]} pendingRows={[]} onPendingRowsChange={vi.fn()} />));

    await user.click(screen.getByText(ar.products.multi_barcode_expand));
    await waitFor(() => expect(screen.getAllByText(ar.products.multi_barcode_col_unit).length).toBeGreaterThan(0));

    expect(apiMock).not.toHaveBeenCalled();
  });

  it('إضافة صفٍّ محلياً تستدعي onPendingRowsChange بالصف الجديد، بلا POST', async () => {
    const user = userEvent.setup();
    const onPendingRowsChange = vi.fn();
    render(wrapAr(<ProductMultiBarcodeTable baseUnitName="piece" alternateUnits={[{ name: 'pack', factor: 6 }]} isVariantManaged={false} variants={[]} pendingRows={[]} onPendingRowsChange={onPendingRowsChange} />));

    await user.click(screen.getByText(ar.products.multi_barcode_expand));
    await user.type(screen.getAllByLabelText(ar.products.barcode_code)[0]!, 'PACK-001');
    await user.type(screen.getAllByLabelText(ar.products.multi_barcode_col_price)[0]!, '27.00');
    await user.click(screen.getAllByRole('button', { name: new RegExp(ar.products.add_barcode) })[0]!);

    expect(onPendingRowsChange).toHaveBeenCalledWith([
      { code: 'PACK-001', unit_name: null, default_quantity: 1, label: null, price: '27.00' },
    ]);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('كل وحدةٍ صريحةٍ تحمل سعرها الخاص — لا اشتقاق من معامل التحويل (حبة=5، باكيت×6=27، كرتون×12=50)', async () => {
    const pending = [
      { code: 'PIECE-1', unit_name: null, default_quantity: 1, label: null, price: '5.00' },
      { code: 'PACK-1', unit_name: 'pack', default_quantity: 1, label: null, price: '27.00' },
      { code: 'CARTON-1', unit_name: 'carton', default_quantity: 1, label: null, price: '50.00' },
    ];
    render(
      wrapAr(
        <ProductMultiBarcodeTable
          baseUnitName="piece"
          alternateUnits={[{ name: 'pack', factor: 6 }, { name: 'carton', factor: 12 }]}
          isVariantManaged={false}
          variants={[]}
          pendingRows={pending}
          onPendingRowsChange={vi.fn()}
        />,
      ),
    );
    // القسم يتوسَّع تلقائياً هنا: صفوفٌ معلَّقة موجودة سلفاً عند التركيب.
    await screen.findByText(ar.products.multi_barcode_collapse);

    // ثلاثة صفوفٍ × هيكلا سطح المكتب/الجوال معاً في DOM = ستة حقول.
    const priceInputs = (await screen.findAllByDisplayValue(/5\.00|27\.00|50\.00/)) as HTMLInputElement[];
    const values = [...new Set(priceInputs.map((el) => el.value))].sort();
    // القيم الثلاث صريحةٌ ومستقلة — 27 ليست 6×5، و50 ليست 12×5.
    expect(values).toEqual(['27.00', '5.00', '50.00']);
    expect(screen.getByText('×6')).toBeTruthy();
    expect(screen.getByText('×12')).toBeTruthy();
  });

  it('حذف صفٍّ معلَّقٍ يستدعي onPendingRowsChange بالقائمة بعد الحذف', async () => {
    const user = userEvent.setup();
    const onPendingRowsChange = vi.fn();
    const pending = [
      { code: 'AAA', unit_name: null, default_quantity: 1, label: null, price: '' },
      { code: 'BBB', unit_name: null, default_quantity: 1, label: null, price: '' },
    ];
    render(wrapAr(<ProductMultiBarcodeTable baseUnitName="piece" alternateUnits={[]} isVariantManaged={false} variants={[]} pendingRows={pending} onPendingRowsChange={onPendingRowsChange} />));

    await waitFor(() => expect(screen.getAllByText('AAA').length).toBeGreaterThan(0));
    const deleteButtons = screen.getAllByRole('button', { name: /AAA/ });
    await user.click(deleteButtons[0]!);

    expect(onPendingRowsChange).toHaveBeenCalledWith([{ code: 'BBB', unit_name: null, default_quantity: 1, label: null, price: '' }]);
  });

  it('صفّان معلَّقان لنفس الوحدة يشتركان بصريّاً بنفس السعر، وتعديل أحدهما يُحدِّث كليهما محلياً', async () => {
    const user = userEvent.setup();
    const onPendingRowsChange = vi.fn();
    const pending = [
      { code: 'AAA', unit_name: 'pack', default_quantity: 1, label: null, price: '27.00' },
      { code: 'BBB', unit_name: 'pack', default_quantity: 6, label: null, price: '27.00' },
    ];
    render(
      wrapAr(
        <ProductMultiBarcodeTable
          baseUnitName="piece"
          alternateUnits={[{ name: 'pack', factor: 6 }]}
          isVariantManaged={false}
          variants={[]}
          pendingRows={pending}
          onPendingRowsChange={onPendingRowsChange}
        />,
      ),
    );
    // صفّان × هيكلا سطح المكتب/الجوال معاً في DOM = أربعة حقول تعرض نفس القيمة.
    await waitFor(() => expect(screen.getAllByDisplayValue('27.00').length).toBe(4));

    const priceInputs = screen.getAllByDisplayValue('27.00');
    await user.clear(priceInputs[0]!);
    await user.type(priceInputs[0]!, '30.00');
    await user.tab();

    expect(onPendingRowsChange).toHaveBeenCalledWith([
      { code: 'AAA', unit_name: 'pack', default_quantity: 1, label: null, price: '30.00' },
      { code: 'BBB', unit_name: 'pack', default_quantity: 6, label: null, price: '30.00' },
    ]);
  });

  it('سعرٌ غير صالح في وضع الإنشاء يمنع إضافة الصف كاملاً', async () => {
    const user = userEvent.setup();
    const onPendingRowsChange = vi.fn();
    render(wrapAr(<ProductMultiBarcodeTable baseUnitName="piece" alternateUnits={[]} isVariantManaged={false} variants={[]} pendingRows={[]} onPendingRowsChange={onPendingRowsChange} />));

    await user.click(screen.getByText(ar.products.multi_barcode_expand));
    await user.type(screen.getAllByLabelText(ar.products.barcode_code)[0]!, 'ZZZ');
    await user.type(screen.getAllByLabelText(ar.products.multi_barcode_col_price)[0]!, 'not-a-number');
    await user.click(screen.getAllByRole('button', { name: new RegExp(ar.products.add_barcode) })[0]!);

    expect(onPendingRowsChange).not.toHaveBeenCalled();
    expect(screen.getByText(ar.products.unit_price_invalid)).toBeTruthy();
  });

  it('لا عمود متغيّر في وضع الإنشاء حتى لو مُرِّر isVariantManaged', async () => {
    const user = userEvent.setup();
    render(wrapAr(<ProductMultiBarcodeTable baseUnitName="piece" alternateUnits={[]} isVariantManaged variants={[{ id: 'v-1', descriptor: 'أسود' }]} pendingRows={[]} onPendingRowsChange={vi.fn()} />));

    await user.click(screen.getByText(ar.products.multi_barcode_expand));
    await waitFor(() => expect(screen.getAllByText(ar.products.multi_barcode_col_unit).length).toBeGreaterThan(0));
    expect(screen.queryByText(ar.products.multi_barcode_col_variant)).toBeNull();
  });
});
