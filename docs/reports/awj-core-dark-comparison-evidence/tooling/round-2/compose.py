import os, sys
from PIL import Image, ImageDraw, ImageFont

SRC, DST = sys.argv[1], sys.argv[2]
LIGHT_REF = sys.argv[3]  # dir holding the merged Core-Light evidence screenshots
os.makedirs(DST, exist_ok=True)

def font(size, bold=False):
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
              '/usr/share/fonts/dejavu/DejaVuSans.ttf']:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

VARS = ['INK', 'A', 'C', 'M']
LABELS = {
    'INK': ('Ink-Dark (reference)', 'shell #0E1A31 - existing theme', (14, 26, 49)),
    'A': ('A  Core-Dark current', 'shell #4F8CFF - baseline', (79, 140, 255)),
    'C': ('C  B-AA improved', 'shell #152B59 active #2D4D91 - UNAPPROVED', (21, 43, 89)),
    'M': ('M  medium-blue alt', 'shell #1E3A8A (brand-700) - UNAPPROVED', (30, 58, 138)),
}
SHORT = {'INK': ('Ink-Dark', 'ref #0E1A31'), 'A': ('A  current', '#4F8CFF'), 'C': ('C  improved', '#152B59 unapproved'), 'M': ('M  mid-blue', '#1E3A8A unapproved')}

def panel_row(files, scale, title, out, crop=None):
    ims = []
    for v in VARS:
        im = Image.open(files[v]).convert('RGB')
        if crop: im = im.crop(crop)
        if scale != 1: im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
        ims.append(im)
    gap, head = 14, 74
    W = sum(i.width for i in ims) + gap * (len(ims) + 1)
    H = max(i.height for i in ims) + head + gap * 2 + 34
    canvas = Image.new('RGB', (W, H), (24, 26, 32))
    d = ImageDraw.Draw(canvas)
    d.text((gap, 8), title, font=font(18, True), fill=(235, 238, 245))
    x = gap
    for v, im in zip(VARS, ims):
        t, sub, sw = LABELS[v]
        if im.width < 500:
            t, sub = SHORT[v]
        d.rectangle([x, 38, x + 14, 52], fill=sw, outline=(200, 205, 215))
        d.text((x + 22, 34), t, font=font(15, True), fill=(235, 238, 245))
        d.text((x + 22, 54), sub, font=font(12), fill=(170, 178, 195))
        canvas.paste(im, (x, head + gap))
        x += im.width + gap
    d.text((gap, H - 26), 'Preview only - candidates C and M are NOT approved and are not in the application. Ink-Dark and A are existing themes.', font=font(12), fill=(150, 158, 175))
    canvas.save(out, optimize=True)

def f(v, loc, view, shot):
    return os.path.join(SRC, f'{v}-dark-{loc}-{view}-{shot}.png')

jobs = []
for loc, locn in (('ar', 'Arabic RTL'), ('en', 'English LTR')):
    for shot in ('dashboard', 'invoices', 'hover', 'focus-sidebar', 'focus-search'):
        files = {v: f(v, loc, 'desktop', shot) for v in VARS}
        panel_row(files, 0.5, f'Dark - Desktop 1440x900 - {locn} - {shot}', os.path.join(DST, f'dark-desktop-{loc}-{shot}.png'))
    # legible shell crops (full resolution): sidebar column + topbar strip
    sx = (1440 - 232, 0, 1440, 900) if loc == 'ar' else (0, 0, 232, 900)
    for shot in ('invoices', 'focus-sidebar', 'hover'):
        files = {v: f(v, loc, 'desktop', shot) for v in VARS}
        panel_row(files, 1.0, f'Dark - Desktop - {locn} - sidebar crop (1:1) - {shot}', os.path.join(DST, f'dark-desktop-{loc}-sidebar-crop-{shot}.png'), crop=sx)
    files = {v: f(v, loc, 'desktop', 'focus-search') for v in VARS}
    panel_row(files, 0.5, f'Dark - Desktop - {locn} - topbar crop (0.5x) - search focus', os.path.join(DST, f'dark-desktop-{loc}-topbar-crop-focus-search.png'), crop=(0, 0, 1440, 110))
    for shot in ('dashboard-closed', 'drawer-open'):
        files = {v: f(v, loc, 'mobile', shot) for v in VARS}
        panel_row(files, 1.0, f'Dark - Mobile 390x844 - {locn} - {shot}', os.path.join(DST, f'dark-mobile-{loc}-{shot}.png'))

# Core Light reference (unchanged by this task) next to current Core Dark
for loc in ('ar', 'en'):
    lt = os.path.join(LIGHT_REF, f'core-light-{loc}-desktop-dashboard.png')
    dk = f('A', loc, 'desktop', 'dashboard')
    if os.path.exists(lt):
        a, b = Image.open(lt).convert('RGB'), Image.open(dk).convert('RGB')
        s = 0.5; a = a.resize((int(a.width*s), int(a.height*s)), Image.LANCZOS); b = b.resize((int(b.width*s), int(b.height*s)), Image.LANCZOS)
        g, head = 14, 50
        c = Image.new('RGB', (a.width + b.width + g*3, a.height + head + g*2), (24, 26, 32)); d = ImageDraw.Draw(c)
        d.text((g, 8), f'Reference - Core Light (#1E40AF, NOT changed by this task) vs current Core Dark A (#4F8CFF) - {loc.upper()} desktop', font=font(16, True), fill=(235, 238, 245))
        c.paste(a, (g, head)); c.paste(b, (a.width + g*2, head)); c.save(os.path.join(DST, f'reference-light-vs-dark-A-{loc}-desktop.png'), optimize=True)
print(len(os.listdir(DST)), 'composites')
