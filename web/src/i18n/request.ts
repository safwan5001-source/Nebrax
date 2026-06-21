import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

const SUPPORTED = ['ar', 'en'] as const;

export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get('locale')?.value;
  const locale = SUPPORTED.includes(cookieLocale as never) ? (cookieLocale as string) : 'ar';

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
