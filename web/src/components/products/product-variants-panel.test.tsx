// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductVariantsPanel } from './product-variants-panel';

const { apiMock, toastSuccess, toastError, translate } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  // مرجعٌ ثابتٌ واحد عبر كل الاستدعاءات — لا دالّةٌ جديدة في كل عرض. `t` غير
  // مستقرّ في `useCallback`/`useEffect` كان يعيد التحميل بلا نهاية، لأن كل
  // عرضٍ يُنتج مرجعاً مختلفاً فيُعاد تشغيل التأثير الذي يعتمد عليه فوراً —
  // بخلاف next-intl الحقيقي المستقرّ عبر العروض.
  translate: Object.assign(
    (key: string, values: Record<string, unknown> = {}) =>
      Object.keys(values).length ? `${key}:${Object.values(values).join(',')}` : key,
    { raw: () => ({}), rich: (key: string) => key }
  ),
}));

vi.mock('next-intl', () => ({ useTranslations: () => translate }));

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

  it('creates a color value with canonical visual metadata without deriving it from the option name', async () => {
    const fixture = makeFixture();
    fixture.options[0]!.values = [];
    installApiMock(fixture);
    const user = userEvent.setup();
    render(<ProductVariantsPanel productId={PRODUCT_ID} variantState="variant_managed" onProductChanged={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('variants_add_value_placeholder'), 'أبيض');
    await user.selectOptions(screen.getByRole('combobox', { name: 'variants_visual_type_label' }), 'color');
    await user.type(screen.getByRole('textbox', { name: 'variants_hex_label' }), '#ffffff');
    await user.click(screen.getByRole('button', { name: 'add' }));
    await waitFor(() => {
      const call = apiMock.mock.calls.find((entry) => entry[0] === `/products/${PRODUCT_ID}/options/opt-color/values` && (entry[1] as { method?: string }).method === 'POST');
      expect((call![1] as { body: Record<string, unknown> }).body).toMatchObject({ value: 'أبيض', visual_type: 'color', color_value: '#FFFFFF' });
    });
  });

  it('edits only visual metadata and clears color when switching to none', async () => {
    const fixture = makeFixture();
    fixture.options[0]!.values[1] = { ...fixture.options[0]!.values[1]!, visual_type: 'color', color_value: '#AFC9F5' };
    installApiMock(fixture);
    const user = userEvent.setup();
    render(<ProductVariantsPanel productId={PRODUCT_ID} variantState="variant_managed" onProductChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('أبيض')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'variants_visual_edit:أبيض' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'variants_visual_type_label' }), 'none');
    await user.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => {
      const call = apiMock.mock.calls.find((entry) => entry[0] === `/products/${PRODUCT_ID}/options/opt-color/values/val-white` && (entry[1] as { method?: string }).method === 'PUT');
      expect((call![1] as { body: Record<string, unknown> }).body).toEqual({ visual_type: 'none', color_value: null });
    });
    expect(fixture.variants[0]!.id).toBe('var-black');
    expect(fixture.variants[0]!.sku).toBe('SHIRT-BLACK');
  });

});

const PRODUCT_ID = 'product-1';

type Fixture = {
  options: Array<{ id: string; name: string; name_en: string | null; is_active: boolean; values: Array<{ id: string; value: string; value_en: string | null; is_active: boolean; visual_type?: 'none' | 'color'; color_value?: string | null }> }>;
  variants: Array<{ id: string; sku: string; is_active: boolean; display_name: string; option_values: Array<{ option_id: string; option_name: string | null; value_id: string; value: string }> }>;
};

/** حالةٌ داخلية بسيطة يقرأها ويكتبها `api` المزيَّف — لا خادم حقيقي هنا. */
function makeFixture(): Fixture {
  return {
    options: [
      {
        id: 'opt-color', name: 'اللون', name_en: 'Color', is_active: true,
        values: [
          { id: 'val-black', value: 'أسود', value_en: 'Black', is_active: true, visual_type: 'none', color_value: null },
          { id: 'val-white', value: 'أبيض', value_en: 'White', is_active: true, visual_type: 'none', color_value: null },
        ],
      },
    ],
    variants: [
      {
        id: 'var-black', sku: 'SHIRT-BLACK', is_active: true, display_name: 'أسود',
        option_values: [{ option_id: 'opt-color', option_name: 'اللون', value_id: 'val-black', value: 'أسود' }],
      },
    ],
  };
}

function matrixFrom(fixture: Fixture) {
  const existingKeys = new Set(fixture.variants.map((v) => v.option_values.map((ov) => ov.value_id).sort().join(',')));
  const combinations = fixture.options.flatMap((o) => o.values).map((value) => {
    const key = [value.id].sort().join(',');
    return {
      combination_key: key,
      option_values: [{ option_id: 'opt-color', value_id: value.id, value: value.value }],
      exists: existingKeys.has(key),
      variant_id: existingKeys.has(key) ? fixture.variants.find((v) => v.option_values[0]?.value_id === value.id)?.id ?? null : null,
    };
  });

  return {
    options: fixture.options,
    total_possible: combinations.length,
    combinations,
  };
}

function installApiMock(fixture: Fixture) {
  apiMock.mockImplementation(async (path: string, options: { method?: string; body?: unknown } = {}) => {
    const method = options.method ?? 'GET';

    if (path === `/products/${PRODUCT_ID}/options` && method === 'GET') {
      return { data: fixture.options };
    }
    if (path === `/products/${PRODUCT_ID}/variants` && method === 'GET') {
      return { data: fixture.variants };
    }
    if (path === `/products/${PRODUCT_ID}/variants/combinations` && method === 'GET') {
      return matrixFrom(fixture);
    }
    if (path === `/products/${PRODUCT_ID}/options` && method === 'POST') {
      const body = options.body as { name: string };
      const option = { id: `opt-${fixture.options.length + 1}`, name: body.name, name_en: null, is_active: true, values: [] };
      fixture.options.push(option);
      return { data: option };
    }
    const valueMatch = path.match(new RegExp(`^/products/${PRODUCT_ID}/options/([^/]+)/values$`));
    if (valueMatch && method === 'POST') {
      const option = fixture.options.find((o) => o.id === valueMatch[1]);
      const body = options.body as { value: string; visual_type?: string; color_value?: string | null };
      const value = { id: `val-${Math.random().toString(36).slice(2, 8)}`, value: body.value, value_en: null, is_active: true, visual_type: body.visual_type ?? 'none', color_value: body.color_value ?? null };
      option?.values.push(value);
      return { data: value };
    }
    if (path === `/products/${PRODUCT_ID}/variants` && method === 'POST') {
      const body = options.body as { combinations: string[][] };
      const created = body.combinations.map((valueIds) => {
        const valueId = valueIds[0];
        const value = fixture.options.flatMap((o) => o.values).find((v) => v.id === valueId);
        const variant = {
          id: `var-${Math.random().toString(36).slice(2, 8)}`,
          sku: `SHIRT-${(value?.value_en ?? value?.value ?? '').toUpperCase()}`,
          is_active: true,
          display_name: value?.value ?? '',
          option_values: [{ option_id: 'opt-color', option_name: 'اللون', value_id: valueId, value: value?.value ?? '' }],
        };
        fixture.variants.push(variant);
        return variant;
      });
      return { created, duplicates: [], failed: [] };
    }
    const variantMatch = path.match(new RegExp(`^/products/${PRODUCT_ID}/variants/([^/]+)$`));
    if (variantMatch && method === 'PUT') {
      const variant = fixture.variants.find((v) => v.id === variantMatch[1]);
      const body = options.body as { is_active?: boolean; sku?: string };
      if (variant) {
        if (body.is_active !== undefined) variant.is_active = body.is_active;
        if (body.sku !== undefined) variant.sku = body.sku;
      }
      return { data: variant };
    }
    const valueUpdateMatch = path.match(new RegExp(`^/products/${PRODUCT_ID}/options/([^/]+)/values/([^/]+)$`));
    if (valueUpdateMatch && method === 'PUT') {
      const option = fixture.options.find((o) => o.id === valueUpdateMatch[1]);
      const value = option?.values.find((v) => v.id === valueUpdateMatch[2]);
      const body = options.body as { visual_type: 'none' | 'color'; color_value: string | null };
      if (value) {
        value.visual_type = body.visual_type;
        value.color_value = body.visual_type === 'color' ? body.color_value : null;
      }
      return { data: value };
    }
    if (variantMatch && method === 'DELETE') {
      fixture.variants = fixture.variants.filter((v) => v.id !== variantMatch[1]);
      return { message: 'deleted' };
    }
    if (path === `/products/${PRODUCT_ID}/variants/enable` && method === 'POST') {
      return { data: { id: PRODUCT_ID, variant_state: 'variant_managed' } };
    }

    throw new Error(`unmocked api call: ${method} ${path}`);
  });
}

beforeEach(() => {
  apiMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

afterEach(cleanup);

describe('لوحة خيارات ومتغيّرات المنتج', () => {
  it('منتجٌ بسيط يعرض نقطة الدخول المختصرة فقط', () => {
    render(<ProductVariantsPanel productId={PRODUCT_ID} variantState="simple" onProductChanged={vi.fn()} />);

    expect(screen.getByText('variants_entry_title')).toBeTruthy();
    expect(screen.getByRole('button', { name: /variants_add_options/ })).toBeTruthy();
    // لا استدعاء شبكة لخيارات/متغيّرات منتجٍ بسيط بعد — لا شيء لإدارته بعد.
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('إنشاء خيارٍ وقيمةٍ يُحدَّث الجدول فور نجاح الطلب', async () => {
    const fixture = makeFixture();
    fixture.options = [];
    installApiMock(fixture);
    const user = userEvent.setup();

    render(<ProductVariantsPanel productId={PRODUCT_ID} variantState="variant_managed" onProductChanged={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('variants_add_option_placeholder'), 'المقاس');
    await user.click(screen.getByRole('button', { name: /variants_add_option$/ }));

    await waitFor(() => expect(screen.getByText('المقاس')).toBeTruthy());

    await user.type(screen.getByPlaceholderText('variants_add_value_placeholder'), 'M');
    await user.click(screen.getByRole('button', { name: 'add' }));

    // القيمة الجديدة قد تظهر أيضاً كتركيبةٍ مقترَحة في قسم المراجعة (سطرٌ
    // مزدوَجٌ لسطح المكتب/الجوال) — الرقاقة نفسها عنصر `span` وحدها.
    await waitFor(() => expect(screen.getByText('M', { selector: 'span' })).toBeTruthy());
  });

  it('Enter داخل حقل القيمة يضيفها فوراً بلا نقر الفأرة، والتركيز يبقى جاهزاً للتالية', async () => {
    const fixture = makeFixture();
    fixture.options[0]!.values = [];
    installApiMock(fixture);
    const user = userEvent.setup();

    render(<ProductVariantsPanel productId={PRODUCT_ID} variantState="variant_managed" onProductChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('اللون')).toBeTruthy());
    const valueInput = screen.getByPlaceholderText('variants_add_value_placeholder');

    await user.type(valueInput, 'أزرق{Enter}');

    await waitFor(() => expect(screen.getByText('أزرق', { selector: 'span' })).toBeTruthy());
    // بعد إعادة الجلب يُعاد رسم نفس الحقل — التركيز يعود إليه صراحةً، جاهزاً
    // لكتابة القيمة التالية دون لمس الفأرة.
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByPlaceholderText('variants_add_value_placeholder'));
    });
  });

  it('مراجعة التركيبات لا تُنشئ متغيّرات تلقائياً — الإنشاء يحتاج نقرة صريحة', async () => {
    const fixture = makeFixture();
    fixture.variants = []; // كل التركيبات جديدة الآن
    installApiMock(fixture);

    render(<ProductVariantsPanel productId={PRODUCT_ID} variantState="variant_managed" onProductChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('variants_review_title')).toBeTruthy());

    // مجرّد توليد المصفوفة (GET) لا يستدعي مسار الإنشاء (POST) إطلاقاً.
    const createCalls = apiMock.mock.calls.filter(
      (call) => call[0] === `/products/${PRODUCT_ID}/variants` && (call[1] as { method?: string } | undefined)?.method === 'POST'
    );
    expect(createCalls).toHaveLength(0);
    expect(fixture.variants).toHaveLength(0);
  });

  it('إنشاء المتغيّرات يرسل فقط التركيبات المحدَّدة صراحةً', async () => {
    const fixture = makeFixture();
    fixture.variants = [];
    installApiMock(fixture);
    const user = userEvent.setup();

    render(<ProductVariantsPanel productId={PRODUCT_ID} variantState="variant_managed" onProductChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('variants_review_title')).toBeTruthy());

    // كلا التركيبتين محدَّدتان افتراضياً (جديدتان) — نُلغي تحديد إحداهما.
    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[1]!); // أول صندوقٍ عادةً "تحديد الكل"

    await user.click(screen.getByRole('button', { name: /variants_create_selected/ }));

    await waitFor(() => {
      const call = apiMock.mock.calls.find(
        (call) => call[0] === `/products/${PRODUCT_ID}/variants` && (call[1] as { method?: string } | undefined)?.method === 'POST'
      );
      expect(call).toBeTruthy();
      const body = (call![1] as { body?: unknown }).body as { combinations: string[][] };
      expect(body.combinations).toHaveLength(1);
    });
  });

  it('تركيبةٌ موجودة سلفاً لا تُعرض ضمن المراجعة ولا يُعاد إنشاؤها', async () => {
    const fixture = makeFixture(); // val-black مستعملة بالفعل في var-black؛ val-white جديدة وحدها
    installApiMock(fixture);

    render(<ProductVariantsPanel productId={PRODUCT_ID} variantState="variant_managed" onProductChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('variants_table_title:1')).toBeTruthy());

    // تركيبةٌ واحدة جديدة فقط (أبيض) من أصل قيمتين — أسود مستبعدةٌ لأنها
    // متغيّرٌ قائم بالفعل، لا لأن الخادم رفضها عند الإنشاء.
    expect(screen.getByText('variants_selected_of_new:1,1')).toBeTruthy();
  });

  it('قائمة المتغيّرات تعرض حالتَي نشط وغير نشط بوضوح', async () => {
    const fixture = makeFixture();
    fixture.variants.push({
      id: 'var-white', sku: 'SHIRT-WHITE', is_active: false, display_name: 'أبيض',
      option_values: [{ option_id: 'opt-color', option_name: 'اللون', value_id: 'val-white', value: 'أبيض' }],
    });
    installApiMock(fixture);

    render(<ProductVariantsPanel productId={PRODUCT_ID} variantState="variant_managed" onProductChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByText('active').length).toBeGreaterThan(0));
    expect(screen.getAllByText('inactive').length).toBeGreaterThan(0);
  });

  it('إجراء تفعيل/تعطيل من صفّ المتغيّر يستدعي الخادم بالحالة المعاكسة', async () => {
    const fixture = makeFixture(); // var-black نشط
    installApiMock(fixture);
    const user = userEvent.setup();

    render(<ProductVariantsPanel productId={PRODUCT_ID} variantState="variant_managed" onProductChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByText('SHIRT-BLACK').length).toBeGreaterThan(0));

    const deactivateButtons = screen.getAllByRole('button', { name: 'deactivate' });
    await user.click(deactivateButtons[0]!);

    await waitFor(() => {
      const call = apiMock.mock.calls.find(
        (call) =>
          call[0] === `/products/${PRODUCT_ID}/variants/var-black`
          && (call[1] as { method?: string } | undefined)?.method === 'PUT'
      );
      expect(call).toBeTruthy();
      expect(((call![1] as { body?: unknown }).body as { is_active: boolean }).is_active).toBe(false);
    });
  });

  it('يعرض كلا هيكلَي الجدول والقائمة المتجاوبين معاً في DOM (تبديل CSS لا JS)', async () => {
    const fixture = makeFixture();
    installApiMock(fixture);

    const { container } = render(
      <ProductVariantsPanel productId={PRODUCT_ID} variantState="variant_managed" onProductChanged={vi.fn()} />
    );

    await waitFor(() => expect(screen.getAllByText('SHIRT-BLACK').length).toBeGreaterThan(0));

    // جدول سطح المكتب (`hidden md:block`) وقائمة الجوال (`md:hidden`) كلاهما
    // في DOM معاً — التبديل بينهما بمقاس الشاشة، لا بحالة React.
    expect(container.querySelector('table')).toBeTruthy();
    expect(container.querySelector('ul.md\\:hidden')).toBeTruthy();
  });

  it('حقل SKU في تفاصيل المتغيّر يبقى LTR حتى ضمن واجهة عربية RTL', async () => {
    const fixture = makeFixture();
    installApiMock(fixture);
    const user = userEvent.setup();

    render(<ProductVariantsPanel productId={PRODUCT_ID} variantState="variant_managed" onProductChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByText('SHIRT-BLACK').length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole('button', { name: 'أسود' })[0]!);

    const skuInput = await screen.findByLabelText('sku');
    expect(skuInput.getAttribute('dir')).toBe('ltr');
  });

  it('ينشئ قيمة لون ببيانات بصرية معيارية دون استنتاجها من اسم الخيار', async () => {
    const fixture = makeFixture();
    fixture.options[0]!.values = [];
    installApiMock(fixture);
    const user = userEvent.setup();
    render(<ProductVariantsPanel productId={PRODUCT_ID} variantState="variant_managed" onProductChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('اللون')).toBeTruthy());
    await user.type(screen.getByPlaceholderText('variants_add_value_placeholder'), 'أبيض');
    await user.selectOptions(screen.getByRole('combobox', { name: 'variants_visual_type_label' }), 'color');
    await user.type(screen.getByRole('textbox', { name: 'variants_hex_label' }), '#ffffff');
    await user.click(screen.getByRole('button', { name: 'add' }));
    await waitFor(() => {
      const call = apiMock.mock.calls.find((entry) => entry[0] === `/products/${PRODUCT_ID}/options/opt-color/values` && (entry[1] as { method?: string }).method === 'POST');
      expect((call![1] as { body: Record<string, unknown> }).body).toMatchObject({ value: 'أبيض', visual_type: 'color', color_value: '#FFFFFF' });
    });
  });

  it('يعدل metadata فقط ويمسح اللون عند التحويل إلى None مع بقاء هوية المتغيّر', async () => {
    const fixture = makeFixture();
    fixture.options[0]!.values[1] = { ...fixture.options[0]!.values[1]!, visual_type: 'color', color_value: '#AFC9F5' };
    installApiMock(fixture);
    const user = userEvent.setup();
    render(<ProductVariantsPanel productId={PRODUCT_ID} variantState="variant_managed" onProductChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('أبيض', { selector: 'span' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'variants_visual_edit:أبيض' }));
    const visualTypeSelects = screen.getAllByRole('combobox', { name: 'variants_visual_type_label' });
    await user.selectOptions(visualTypeSelects[visualTypeSelects.length - 1]!, 'none');
    await user.click(await screen.findByRole('button', { name: 'save' }));
    await waitFor(() => {
      const call = apiMock.mock.calls.find((entry) => entry[0] === `/products/${PRODUCT_ID}/options/opt-color/values/val-white` && (entry[1] as { method?: string }).method === 'PUT');
      expect((call![1] as { body: Record<string, unknown> }).body).toEqual({ visual_type: 'none', color_value: null });
    });
    expect(fixture.variants[0]!.id).toBe('var-black');
    expect(fixture.variants[0]!.sku).toBe('SHIRT-BLACK');
  });

});
