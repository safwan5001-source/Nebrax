'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Plus, Pencil, Trash2, Check, X, ImagePlus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { SettingsHeader } from '@/components/inventory-settings/settings-header';
import { PosProductImage } from '@/components/pos/pos-product-image';
import { api, ApiError } from '@/lib/api';

interface CategoryImage {
  download_url: string;
  original_name?: string | null;
  mime_type?: string | null;
  size?: number | null;
}

interface Category {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  is_active: boolean;
  image: CategoryImage | null;
  /** PR-2C: `#RRGGBB` أو null — يُستهلك فقط حين يختار المستأجر وضع «لون» في POS. */
  color: string | null;
  products_count?: number;
}

/** نفس نمط `#RRGGBB` المفروض خادمياً (`ProductCategory::COLOR_REGEX`) — تحقق أولي هنا فقط. */
const CATEGORY_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const NEUTRAL_COLOR_SWATCH = '#94A3B8';

/** صفّ معروض: التصنيف ومستواه في الشجرة (يُحسب عند العرض لا يُخزَّن). */
interface Node extends Category { depth: number }

const MAX_CATEGORY_IMAGE_SIZE = 5 * 1024 * 1024;
const CATEGORY_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * تصنيفات المنتجات — شجرة متعدّدة المستويات.
 *
 * الـ API يُعيد قائمة مسطّحة بـ `parent_id`؛ الشجرة تُبنى هنا. استعلامٌ شجريّ
 * في القاعدة كان سيدفع ثمناً بلا مقابل: القائمة كلّها تُجلَب في كل الأحوال.
 */
export default function ProductCategoriesPage() {
  const t = useTranslations('inventorySettings');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { success } = useToast();
  const ui = locale === 'ar' ? {
    description: 'وصف التصنيف',
    descriptionHint: 'وصف مختصر يساعد على تعريف التصنيف واستخدامه.',
    image: 'صورة التصنيف',
    imageHint: 'JPG أو PNG أو WebP، بحد أقصى 5 MB. تظهر الصورة أيضاً في نقاط البيع.',
    removeImage: 'إزالة الصورة',
    imagePreview: 'معاينة صورة التصنيف',
    color: 'لون التصنيف',
    colorHint: 'يظهر فقط إذا اختار المالك وضع «لون» لعرض التصنيفات في إعدادات نقطة البيع.',
    colorInvalid: 'صيغة اللون غير صحيحة — استخدم لوناً من المنتقي.',
    removeColor: 'إزالة اللون',
  } : {
    description: 'Category description',
    descriptionHint: 'A short description that explains the category and its use.',
    image: 'Category image',
    imageHint: 'JPG, PNG, or WebP up to 5 MB. The image also appears in POS.',
    removeImage: 'Remove image',
    imagePreview: 'Category image preview',
    color: 'Category color',
    colorHint: 'Only shown when the owner selects the "Color" category presentation mode in POS settings.',
    colorInvalid: 'Invalid color format — use the color picker.',
    removeColor: 'Remove color',
  };

  const [rows, setRows] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState('');
  const [editing, setEditing] = useState<Category | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [color, setColor] = useState('');
  const previewUrl = useRef<string | null>(null);

  const load = useCallback(() => {
    api<{ data: Category[] }>('/product-categories')
      .then((r) => setRows(r.data))
      .catch(() => setRows([]));
  }, []);

  useEffect(() => load(), [load]);
  useEffect(() => () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
  }, []);

  /** ترتيب العرض: كل أب يتبعه فروعه مباشرةً، بعمق يُترجَم إلى إزاحة. */
  const tree = useMemo<Node[]>(() => {
    if (!rows) return [];
    const byParent = new Map<string | null, Category[]>();
    for (const row of rows) {
      const key = row.parent_id;
      byParent.set(key, [...(byParent.get(key) ?? []), row]);
    }

    const out: Node[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const row of byParent.get(parent) ?? []) {
        out.push({ ...row, depth });
        walk(row.id, depth + 1);
      }
    };
    walk(null, 0);

    // احتياط: صفّ أبوه مفقود (بيانات قديمة) يظهر جذراً بدل أن يختفي صامتاً.
    if (out.length < rows.length) {
      const seen = new Set(out.map((r) => r.id));
      for (const row of rows) if (!seen.has(row.id)) out.push({ ...row, depth: 0 });
    }
    return out;
  }, [rows]);

  /** الأب المرشَّح: أي تصنيف عدا المحرَّر نفسه (منع الدورة يُحسم في الخادم أيضاً). */
  const parentOptions = useMemo(
    () => tree.filter((r) => !editing || r.id !== editing.id),
    [tree, editing]
  );

  function clearPreview() {
    if (previewUrl.current) {
      URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;
    }
    setImagePreview(null);
  }

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!file) return;
    if (!CATEGORY_IMAGE_TYPES.includes(file.type) || file.size > MAX_CATEGORY_IMAGE_SIZE) {
      setError(ui.imageHint);
      return;
    }
    clearPreview();
    const url = URL.createObjectURL(file);
    previewUrl.current = url;
    setImagePreview(url);
    setImageFile(file);
    setRemoveImage(false);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (color && !CATEGORY_COLOR_PATTERN.test(color)) {
      setError(ui.colorInvalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('name', name.trim());
      body.append('description', description.trim());
      body.append('parent_id', parentId);
      // فارغ يتحوّل إلى null خادمياً (نفس معاملة parent_id/description) فيمسح
      // اللون المخزَّن — لا حاجة لعلم remove_color منفصل.
      body.append('color', color);
      if (imageFile) body.append('image', imageFile);
      if (removeImage) body.append('remove_image', '1');

      if (editing) {
        // POST + method override يضمن أن PHP يقرأ multipart والملف ثم يراه Laravel كـ PUT.
        body.append('_method', 'PUT');
        await api(`/product-categories/${editing.id}`, { method: 'POST', body });
      } else {
        await api('/product-categories', { method: 'POST', body });
      }
      success(tc('updated'));
      reset();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: Category) {
    setError(null);
    try {
      await api(`/product-categories/${row.id}`, { method: 'DELETE' });
      success(tc('updated'));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    }
  }

  function edit(row: Category) {
    clearPreview();
    setEditing(row);
    setName(row.name);
    setDescription(row.description ?? '');
    setParentId(row.parent_id ?? '');
    setImageFile(null);
    setRemoveImage(false);
    setColor(row.color ?? '');
  }

  function reset() {
    clearPreview();
    setEditing(null);
    setName('');
    setDescription('');
    setParentId('');
    setImageFile(null);
    setRemoveImage(false);
    setColor('');
  }

  return (
    <div className="space-y-5">
      <SettingsHeader title={t('c_categories_t')} subtitle={t('c_categories_d')} />

      <Card className="max-w-4xl">
        <CardHeader>
          <CardTitle>{editing ? t('cat_edit') : t('cat_new')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cat-name">{t('cat_name')}</Label>
                <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={255} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cat-parent">{t('cat_parent')}</Label>
                <Select id="cat-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                  <option value="">{t('cat_no_parent')}</option>
                  {parentOptions.map((row) => (
                    <option key={row.id} value={row.id}>
                      {'— '.repeat(row.depth) + row.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="cat-description">{ui.description}</Label>
                <textarea
                  id="cat-description"
                  rows={3}
                  maxLength={4000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={ui.descriptionHint}
                  className="min-h-20 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none placeholder:text-muted focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="cat-image">{ui.image}</Label>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-border bg-background">
                    {imagePreview ? (
                      <img src={imagePreview} alt={ui.imagePreview} className="h-full w-full object-cover" />
                    ) : editing?.image && !removeImage ? (
                      <PosProductImage path={editing.image.download_url} alt={editing.name} />
                    ) : (
                      <span className="grid h-full w-full place-items-center text-muted" aria-hidden>
                        <ImagePlus className="h-6 w-6" strokeWidth={1.6} />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <Input id="cat-image" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={selectImage} aria-describedby="cat-image-hint" />
                    <p id="cat-image-hint" className="text-xs leading-relaxed text-muted">{ui.imageHint}</p>
                    {(imageFile || (editing?.image && !removeImage)) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          clearPreview();
                          setImageFile(null);
                          setRemoveImage(Boolean(editing?.image));
                        }}
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                        {ui.removeImage}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="cat-color">{ui.color}</Label>
                <div className="flex items-center gap-3">
                  <input
                    id="cat-color"
                    type="color"
                    disabled={busy}
                    value={color && CATEGORY_COLOR_PATTERN.test(color) ? color : NEUTRAL_COLOR_SWATCH}
                    onChange={(e) => setColor(e.target.value)}
                    aria-describedby="cat-color-hint"
                    className="h-10 w-14 shrink-0 cursor-pointer rounded-md border border-border bg-surface p-1 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  {color && (
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setColor('')}>
                      <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                      {ui.removeColor}
                    </Button>
                  )}
                </div>
                <p id="cat-color-hint" className="text-xs leading-relaxed text-muted">{ui.colorHint}</p>
              </div>
            </div>

            {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

            <div className="flex justify-end gap-2">
              {editing && (
                <Button type="button" variant="outline" onClick={reset}>
                  <X className="h-4 w-4" strokeWidth={1.7} />
                  {t('cancel')}
                </Button>
              )}
              <Button type="submit" disabled={busy || !name.trim()}>
                {editing ? <Check className="h-4 w-4" strokeWidth={1.7} /> : <Plus className="h-4 w-4" strokeWidth={1.7} />}
                {editing ? t('cat_save') : t('cat_add')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="max-w-4xl">
        <CardHeader><CardTitle>{t('cat_list')}</CardTitle></CardHeader>
        <CardContent>
          {!rows ? (
            <Skeleton className="h-32 w-full" />
          ) : tree.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">{t('cat_empty')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {tree.map((row) => (
                <li key={row.id} className="flex items-center gap-3 py-2.5" style={{ paddingInlineStart: row.depth * 20 }}>
                  <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-border bg-background">
                    <PosProductImage path={row.image?.download_url} alt={row.name} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text">{row.name}</p>
                    {row.description && <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted">{row.description}</p>}
                  </div>
                  {!!row.products_count && (
                    <Badge tone="muted">{t('cat_products', { count: row.products_count })}</Badge>
                  )}
                  <Button variant="ghost" size="icon" aria-label={t('cat_edit')} onClick={() => edit(row)}>
                    <Pencil className="h-4 w-4" strokeWidth={1.7} />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={t('delete')} onClick={() => remove(row)}>
                    <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
