'use client';

import { usePathname } from 'next/navigation';

export default function CommerceSectionLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isExperienceBuilder = pathname === '/commerce/appearance' || pathname?.startsWith('/commerce/appearance/');

  return (
    <div className={isExperienceBuilder ? 'flex h-full min-h-0 flex-col' : 'space-y-5'}>
      {children}
    </div>
  );
}
