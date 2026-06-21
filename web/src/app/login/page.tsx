'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { login } from '@/lib/auth';
import { ApiError } from '@/lib/api';

const schema = z.object({
  slug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const t = useTranslations('login');
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      await login(values.slug, values.email, values.password);
      router.replace('/dashboard');
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : t('error'));
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded border border-border bg-surface p-6">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded bg-primary text-sm font-bold text-white">
            نـ
          </div>
          <div>
            <h1 className="text-lg font-semibold text-text">{t('title')}</h1>
            <p className="text-xs text-muted">{t('subtitle')}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="slug">{t('slug')}</Label>
            <Input id="slug" dir="ltr" placeholder="nibras" {...register('slug')} />
            {errors.slug && <p className="text-xs text-negative">{t('slug')}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">{t('email')}</Label>
            <Input id="email" type="email" dir="ltr" placeholder="owner@nibras.test" {...register('email')} />
            {errors.email && <p className="text-xs text-negative">{t('email')}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">{t('password')}</Label>
            <Input id="password" type="password" dir="ltr" {...register('password')} />
            {errors.password && <p className="text-xs text-negative">{t('password')}</p>}
          </div>

          {serverError && (
            <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{serverError}</p>
          )}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {t('submit')}
          </Button>
        </form>
      </div>
    </main>
  );
}
