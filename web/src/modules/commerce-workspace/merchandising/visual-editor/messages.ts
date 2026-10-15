/**
 * AWJ-VD-H1 / VD-3 — wording of the facet visual editor (Arabic first, English twin).
 *
 * Kept apart from the workspace catalog so the editor lands without touching a file every other slice edits. Strings
 * with a `{name}`-style hole are filled by {@link fillMessage}; nothing here is built by concatenating fragments of
 * a sentence in code except the dash-joined titles («تعديل البُعد — اسمه»).
 */

export const VISUAL_EDITOR_MESSAGES = {
  ar: {
    // Titles (C6): one pattern for a dimension and a value, always with the name.
    titleFacet: 'تعديل البُعد',
    titleValue: 'تعديل القيمة',
    viewFacet: 'عرض البُعد',
    viewValue: 'عرض القيمة',
    viewAction: 'عرض',
    customizeAppearance: 'تخصيص المظهر',
    createdFacet: 'تمت إضافة البُعد «{name}». يمكنك الآن تخصيص صورته وأيقونته ومظهره.',
    createdValue: 'تمت إضافة القيمة «{name}». يمكنك الآن تخصيص صورتها وأيقونتها ومظهرها.',
    later: 'لاحقاً',

    // Tabs
    tabData: 'البيانات',
    tabImage: 'الصورة والأيقونة',
    tabAppearance: 'المظهر',
    tabHasError: 'يحتوي هذا التبويب على خطأ',
    editorTabs: 'أقسام المحرر',

    // Data tab (C7: the same labels for a dimension and a value)
    nameAr: 'الاسم بالعربية',
    nameEn: 'الاسم بالإنجليزية (اختياري)',
    status: 'الحالة',
    statusActive: 'مفعّل',
    statusInactive: 'معطّل',
    slugLabel: 'المعرّف (slug)',
    keyLabel: 'المفتاح',
    readOnlyField: 'للقراءة فقط',
    productCountLabel: 'عدد المنتجات',

    // Banners
    identityReadOnly:
      'تعديل الصورة والأيقونة والمظهر يتطلب صلاحية إدارة المتجر الإلكتروني. اطلب من مالك المؤسسة أو المسؤول منحك إياها.',
    allReadOnly: 'لا تملك صلاحية تعديل التسويق — العرض فقط.',

    // Content type
    contentTitle: 'نوع المحتوى',
    contentInherit: 'ورِّث من البُعد',
    contentImage: 'صورة',
    contentIcon: 'أيقونة',
    contentNone: 'نص فقط',
    contentNoneHelp: 'تظهر القيمة باسمها فقط، بلا صورة ولا أيقونة.',
    contentNow: 'الحالي: {value}',
    contentInheritClears: 'عند الحفظ يُزال ما خصّصته لهذه القيمة من صورة وأيقونة، فتعود إلى ما يحدده البُعد.',
    contentUnset: 'غير محدد',
    imageGated: 'مكتبة الوسائط غير مفعّلة لهذا الحساب، لذلك لا يتوفر خيار الصورة. الأيقونة والنص فقط يعملان.',
    imageNeedPick: 'اختر صورة من المكتبة. إلى أن تختارها يظهر البديل: الأيقونة ثم الاسم.',
    imageTitle: 'الصورة',
    imageDecorativeHint: 'الرابط في المتجر يحمل الاسم، فالصورة زخرفية ولا تحتاج وصفاً.',
    imageAltOptional: 'لا نص بديل لهذه اللغة — اختياري؛ يعتمد المتجر اسم القيمة.',
    imageReadOnlyAlt: 'النص البديل ({lang})',
    imageDecorativeOn: 'صورة زخرفية',
    imageNoneStored: 'لا توجد صورة محفوظة.',
    iconTitle: 'الأيقونة',
    iconFallbackTitle: 'أيقونة احتياطية',
    iconFallbackHelp: 'تظهر مكان الصورة إن تعذّر تحميلها.',
    iconGroup: 'اختيار الأيقونة',
    iconSearch: 'ابحث عن أيقونة',
    iconNoResults: 'لا توجد أيقونات مطابقة',
    iconNone: 'بلا أيقونة',
    iconColour: 'لون الأيقونة',
    backgroundColour: 'لون الخلفية',
    contrastLow: 'التباين بين الأيقونة والخلفية {ratio}:1، أقل من 3:1. سيستبدل المتجر لون الأيقونة بلون مقروء.',
    contrastGood: 'التباين بين الأيقونة والخلفية {ratio}:1.',

    // Sections of a dimension's editor
    selfSection: 'هوية البُعد نفسه',
    selfSectionHelp: 'كيف يظهر البُعد نفسه، كغلافه أو بطاقته.',
    defaultsSection: 'افتراضات القيم',
    defaultsSectionHelp: 'ما ترثه قيم هذا البُعد ما لم تُخصَّص قيمة بعينها. لا تشمل الصورة، فهي لكل قيمة على حدة.',
    valueSection: 'هذه القيمة',

    // Appearance
    shapeTitle: 'الشكل',
    sizeTitle: 'الحجم',
    sizeSm: 'صغير',
    sizeMd: 'متوسط',
    sizeLg: 'كبير',
    fitTitle: 'احتواء الصورة',
    fitCover: 'ملء الإطار',
    fitContain: 'احتواء كامل',
    focalTitle: 'نقطة التركيز',
    focalHelp: 'اختر الموضع الذي يبقى ظاهراً عند القص، أو اسحب على المعاينة.',
    focalRowTop: 'أعلى',
    focalRowMiddle: 'وسط',
    focalRowBottom: 'أسفل',
    focalColLeft: 'اليسار',
    focalColCenter: 'المنتصف',
    focalColRight: 'اليمين',
    focalCenter: 'المنتصف',
    focalCustom: 'موضع مخصّص: {x}% ، {y}%',
    zoomTitle: 'التكبير',
    showLabelTitle: 'إظهار الاسم',
    showLabelHelp: 'يبقى الاسم متاحاً لقارئ الشاشة حتى لو أُخفي بصرياً.',
    imageOnlyHint: 'الاحتواء ونقطة التركيز والتكبير تعمل مع الصور فقط. اختر صورة من تبويب «الصورة والأيقونة».',
    valueOn: 'إظهار',
    valueOff: 'إخفاء',
    valueNoIcon: 'بلا أيقونة',
    valueThemeColour: 'لون السمة',
    valueNoZoom: 'بلا تكبير',

    // Inheritance
    inheritedFromFacet: 'موروث من البُعد: {value}',
    inheritedSystem: 'الافتراضي: {value}',
    customizedValue: 'مخصَّص لهذه القيمة',
    customizedHere: 'مخصَّص',
    restoreInheritance: 'استرجاع الوراثة',
    restoreDefault: 'استرجاع الافتراضي',

    // Preview
    previewTitle: 'معاينة المتجر',
    previewStrip: 'المعاينة',
    previewLayoutGroup: 'تخطيط المعاينة (للعرض فقط ولا يُحفظ)',
    layoutGrid: 'شبكة',
    layoutCards: 'بطاقات',
    layoutRail: 'شريط',
    layoutIcons: 'أيقونات',
    layoutList: 'قائمة',
    previewEditing: 'قيد التعديل',
    previewFacetSelf: 'البُعد نفسه',
    previewFacetValues: 'قيم البُعد',
    previewDragHint: 'اسحب على الصورة لتحديد نقطة التركيز.',
    previewAlone: 'لا توجد قيم مجاورة بعد، فتظهر وحدها.',
    imageLoading: 'جارٍ تحميل معاينة الصورة…',
    imageNotReady: 'الصورة قيد المعالجة في المكتبة؛ يظهر البديل مؤقتاً (الأيقونة ثم الاسم).',
    imageDeleted: 'هذه الصورة محذوفة من المكتبة؛ يظهر البديل. اختر صورة أخرى.',
    imageFailed: 'تعذّر تحميل الصورة؛ يظهر البديل مكانها.',
    imageUnavailable: 'معاينة الصورة غير متاحة الآن (محذوفة أو قيد المعالجة)؛ يظهر البديل.',

    // Save results and errors
    saving: 'جارٍ الحفظ…',
    partData: 'البيانات',
    partVisual: 'الصورة والمظهر',
    partSaved: 'تم الحفظ',
    partFailed: 'لم يُحفظ',
    versionConflict: 'تغيّرت الهوية من مستخدم آخر. أعد التحميل لترى آخر نسخة.',
    reload: 'إعادة التحميل',
    reloadHint: 'تعيد إعادة التحميل فتح المحرر بآخر نسخة محفوظة، وتُفقد تعديلات الصورة والمظهر التي لم تُحفظ.',
    visualInvalid: 'بعض إعدادات المظهر غير صالحة. راجع الحقول المعلَّمة في التبويبات.',
    saved: 'تم حفظ التعديلات.',

    // Field error codes (422)
    err_media_not_found: 'هذه الصورة لم تعد في المكتبة. اختر صورة أخرى.',
    err_media_not_ready: 'الصورة ما زالت قيد المعالجة. انتظر اكتمالها ثم احفظ.',
    err_invalid_media_id: 'الصورة المختارة غير صالحة.',
    err_unknown_icon: 'أيقونة غير معروفة.',
    err_unknown_shape: 'شكل غير معروف.',
    err_invalid_color: 'لون غير صالح؛ استخدم صيغة #RRGGBB.',
    err_out_of_range: 'القيمة خارج النطاق المسموح.',
    err_invalid_value: 'قيمة غير صالحة.',
    err_forbidden: 'هذا الإعداد غير مسموح هنا.',
    err_unknown_field: 'حقل غير معروف.',
    err_invalid_object: 'بنية غير صالحة.',
    err_generic: 'قيمة غير مقبولة.',

    // Unsaved changes
    unsavedTitle: 'تعديلات غير محفوظة',
    unsavedMessage: 'لديك تعديلات لم تُحفظ. إن أغلقت المحرر الآن فستُفقد.',
    unsavedDiscard: 'تجاهل التعديلات',

    // List
    collapseValues: 'طيّ القيم',
    expandValues: 'عرض القيم',
    valuesCount: '{count} قيمة',
  },
  en: {
    titleFacet: 'Edit dimension',
    titleValue: 'Edit value',
    viewFacet: 'View dimension',
    viewValue: 'View value',
    viewAction: 'View',
    customizeAppearance: 'Customize appearance',
    createdFacet: 'Dimension “{name}” was added. You can now customize its image, icon and appearance.',
    createdValue: 'Value “{name}” was added. You can now customize its image, icon and appearance.',
    later: 'Later',

    tabData: 'Data',
    tabImage: 'Image & icon',
    tabAppearance: 'Appearance',
    tabHasError: 'This tab has an error',
    editorTabs: 'Editor sections',

    nameAr: 'Arabic name',
    nameEn: 'English name (optional)',
    status: 'Status',
    statusActive: 'Active',
    statusInactive: 'Inactive',
    slugLabel: 'Identifier (slug)',
    keyLabel: 'Key',
    readOnlyField: 'Read only',
    productCountLabel: 'Products',

    identityReadOnly:
      'Editing the image, icon and appearance requires the e-commerce management permission. Ask the account owner or an administrator to grant it.',
    allReadOnly: 'You do not have permission to edit merchandising — view only.',

    contentTitle: 'Content type',
    contentInherit: 'Inherit from dimension',
    contentImage: 'Image',
    contentIcon: 'Icon',
    contentNone: 'Text only',
    contentNoneHelp: 'The value shows by name only, with no image or icon.',
    contentNow: 'Currently: {value}',
    contentInheritClears: 'On save, the image and icon you set for this value are removed, so it follows the dimension again.',
    contentUnset: 'Not set',
    imageGated: 'The media library is not enabled for this account, so the image option is unavailable. Icon and text-only still work.',
    imageNeedPick: 'Choose an image from the library. Until you do, the fallback shows: the icon, then the name.',
    imageTitle: 'Image',
    imageDecorativeHint: 'The link in the store already carries the name, so the image is decorative and needs no description.',
    imageAltOptional: 'No alt text for this language — optional; the store uses the value name.',
    imageReadOnlyAlt: 'Alt text ({lang})',
    imageDecorativeOn: 'Decorative image',
    imageNoneStored: 'No image is saved.',
    iconTitle: 'Icon',
    iconFallbackTitle: 'Fallback icon',
    iconFallbackHelp: 'Shown in place of the image if it fails to load.',
    iconGroup: 'Choose an icon',
    iconSearch: 'Search icons',
    iconNoResults: 'No matching icons',
    iconNone: 'No icon',
    iconColour: 'Icon colour',
    backgroundColour: 'Background colour',
    contrastLow: 'Icon-to-background contrast is {ratio}:1, below 3:1. The store will swap the icon colour for a readable one.',
    contrastGood: 'Icon-to-background contrast is {ratio}:1.',

    selfSection: 'The dimension itself',
    selfSectionHelp: 'How the dimension itself appears, such as its cover or card.',
    defaultsSection: 'Value defaults',
    defaultsSectionHelp: 'What this dimension’s values inherit unless a value sets its own. Images are not included: each value has its own.',
    valueSection: 'This value',

    shapeTitle: 'Shape',
    sizeTitle: 'Size',
    sizeSm: 'Small',
    sizeMd: 'Medium',
    sizeLg: 'Large',
    fitTitle: 'Image fit',
    fitCover: 'Fill the frame',
    fitContain: 'Show whole image',
    focalTitle: 'Focal point',
    focalHelp: 'Pick the part that stays visible when the image is cropped, or drag on the preview.',
    focalRowTop: 'Top',
    focalRowMiddle: 'Middle',
    focalRowBottom: 'Bottom',
    focalColLeft: 'left',
    focalColCenter: 'center',
    focalColRight: 'right',
    focalCenter: 'Center',
    focalCustom: 'Custom position: {x}%, {y}%',
    zoomTitle: 'Zoom',
    showLabelTitle: 'Show the name',
    showLabelHelp: 'The name stays available to screen readers even when it is hidden visually.',
    imageOnlyHint: 'Fit, focal point and zoom apply to images only. Choose an image in the “Image & icon” tab.',
    valueOn: 'Shown',
    valueOff: 'Hidden',
    valueNoIcon: 'No icon',
    valueThemeColour: 'Theme colour',
    valueNoZoom: 'No zoom',

    inheritedFromFacet: 'Inherited from the dimension: {value}',
    inheritedSystem: 'Default: {value}',
    customizedValue: 'Customized for this value',
    customizedHere: 'Customized',
    restoreInheritance: 'Restore inheritance',
    restoreDefault: 'Restore default',

    previewTitle: 'Store preview',
    previewStrip: 'Preview',
    previewLayoutGroup: 'Preview layout (display only, not saved)',
    layoutGrid: 'Grid',
    layoutCards: 'Cards',
    layoutRail: 'Rail',
    layoutIcons: 'Icons',
    layoutList: 'List',
    previewEditing: 'Being edited',
    previewFacetSelf: 'The dimension',
    previewFacetValues: 'Dimension values',
    previewDragHint: 'Drag on the image to set the focal point.',
    previewAlone: 'There are no neighbouring values yet, so it shows alone.',
    imageLoading: 'Loading the image preview…',
    imageNotReady: 'The image is still processing in the library; the fallback shows for now (icon, then name).',
    imageDeleted: 'This image was deleted from the library; the fallback shows. Choose another image.',
    imageFailed: 'The image could not be loaded; the fallback shows in its place.',
    imageUnavailable: 'The image preview is unavailable right now (deleted or still processing); the fallback shows.',

    saving: 'Saving…',
    partData: 'Data',
    partVisual: 'Image and appearance',
    partSaved: 'Saved',
    partFailed: 'Not saved',
    versionConflict: 'The identity was changed by another user. Reload to see the latest version.',
    reload: 'Reload',
    reloadHint: 'Reloading reopens the editor on the latest saved version, and unsaved image and appearance edits are lost.',
    visualInvalid: 'Some appearance settings are invalid. Check the fields marked in the tabs.',
    saved: 'Changes saved.',

    err_media_not_found: 'This image is no longer in the library. Choose another image.',
    err_media_not_ready: 'The image is still processing. Wait for it to finish, then save.',
    err_invalid_media_id: 'The selected image is not valid.',
    err_unknown_icon: 'Unknown icon.',
    err_unknown_shape: 'Unknown shape.',
    err_invalid_color: 'Invalid colour; use the #RRGGBB format.',
    err_out_of_range: 'The value is outside the allowed range.',
    err_invalid_value: 'Invalid value.',
    err_forbidden: 'This setting is not allowed here.',
    err_unknown_field: 'Unknown field.',
    err_invalid_object: 'Invalid structure.',
    err_generic: 'This value was not accepted.',

    unsavedTitle: 'Unsaved changes',
    unsavedMessage: 'You have changes that are not saved. If you close the editor now they will be lost.',
    unsavedDiscard: 'Discard changes',

    collapseValues: 'Collapse values',
    expandValues: 'Show values',
    valuesCount: '{count} values',
  },
} as const;

export type VisualEditorMessageKey = keyof typeof VISUAL_EDITOR_MESSAGES.ar;
export type VisualEditorLocale = 'ar' | 'en';

export type VT = (key: VisualEditorMessageKey, values?: Record<string, string | number>) => string;

/** Fills `{name}` holes. An unknown hole is left visible rather than silently dropped. */
export function fillMessage(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (hole, name: string) => (name in values ? String(values[name]) : hole));
}

export function visualEditorMessage(
  locale: string | undefined,
  key: VisualEditorMessageKey,
  values?: Record<string, string | number>,
): string {
  const pack = locale?.startsWith('en') ? VISUAL_EDITOR_MESSAGES.en : VISUAL_EDITOR_MESSAGES.ar;
  return fillMessage(pack[key], values);
}

export function createVisualEditorT(locale: string | undefined): VT {
  return (key, values) => visualEditorMessage(locale, key, values);
}

/** Maps a server field-error code (`media_not_ready`, …) to its message, falling back to a generic one. */
export function fieldErrorMessage(t: VT, code: string): string {
  const key = `err_${code}` as VisualEditorMessageKey;
  return key in VISUAL_EDITOR_MESSAGES.ar ? t(key) : t('err_generic');
}
