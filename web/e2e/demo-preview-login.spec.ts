import { expect, test } from '@playwright/test';

// زر «دخول تجريبي» (NEXT_PUBLIC_DEMO_PREVIEW) — يُضبط المتغيّر على خادم Playwright نفسه، فالمواصفة تقرأه
// وتتحقق من الاتجاه الموافق: مفعَّل ⇒ دخول وخروج، غير مفعَّل ⇒ الزر غائب مطلقاً.
// شغّل مرتين: بالمتغيّر `true` وبدونه (انظر تقرير التنفيذ). لا خادم Laravel ولا بيانات إنتاج.
const enabled = process.env.NEXT_PUBLIC_DEMO_PREVIEW === 'true';
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';

test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: baseUrl }]);
});

test.describe(enabled ? 'DEMO_PREVIEW=true' : 'DEMO_PREVIEW غير مفعَّل', () => {
  test(enabled ? 'الزر ظاهر، الدخول يفتح /dashboard، والخروج يعيد /login' : 'الزر غائب من شاشة الدخول والمسار الحقيقي سليم', async ({ page }) => {
    const apiCalls: string[] = [];
    page.on('request', (request) => {
      if (/\/api\//.test(request.url()) && !request.url().startsWith(baseUrl)) apiCalls.push(request.url());
    });

    await page.goto(`${baseUrl}/login`, { waitUntil: 'load' });
    await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeVisible();

    const demo = page.getByRole('button', { name: 'دخول تجريبي' });
    if (!enabled) {
      await expect(demo).toHaveCount(0);
      await expect(page.getByText('لاستكشاف التجربة قبل ربط حسابك')).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem('demo'))).toBeNull();
      return;
    }

    await expect(demo).toBeVisible();
    await expect(page.getByText('لاستكشاف التجربة قبل ربط حسابك')).toBeVisible();

    // جلسة حقيقية سابقة (كما يكتبها login()): يجب أن تُمسح قبل المعاينة، محلياً وبلا طلب /logout.
    const logoutRequests: string[] = [];
    page.on('request', (request) => { if (/\/logout/.test(request.url())) logoutRequests.push(request.url()); });
    await page.evaluate(() => {
      localStorage.setItem('token', '41|real-sanctum-token');
      localStorage.setItem('user', JSON.stringify({ id: 'u-real', name: 'مستخدم حقيقي', email: 'owner@acme.sa', role: 'owner', permissions: ['*'], tenant_id: 'tenant-real' }));
      localStorage.setItem('nibras_active_branch', '0b9b8a4e-0000-4000-8000-000000000001');
    });
    await demo.click();

    // أول طلب لـ/dashboard على خادم dev يتضمن ترجمة المسار (> مهلة expect الافتراضية).
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 45_000 });
    await expect(page.getByText('وضع المعاينة — بيانات تجريبية، لا تتصل بأي خادم')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('demo'))).toBe('true');
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
    // مبدّل الفروع يضبط فرع المعاينة (br-1) بنفسه؛ المطلوب ألّا يبقى فرع الحساب الحقيقي.
    expect(await page.evaluate(() => localStorage.getItem('nibras_active_branch'))).not.toBe('0b9b8a4e-0000-4000-8000-000000000001');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('user') ?? '{}').id)).toBe('demo-user');

    // الخروج: قائمة المستخدم في الشريط العلوي.
    await page.getByRole('button', { name: 'الحساب', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'تسجيل الخروج' }).first().click();

    await expect(page).toHaveURL(/\/login/);
    expect(await page.evaluate(() => localStorage.getItem('demo'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('user'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull(); // لا استعادة للجلسة الحقيقية

    // بعد الخروج لا جلسة: فتح لوحة التحكم يعيد إلى الدخول.
    await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'load' });
    await expect(page).toHaveURL(/\/login/);
    expect(apiCalls).toEqual([]);
    expect(logoutRequests).toEqual([]);
  });
});
