"""Builds the Liwan refinement comparison sheets from the PNGs written by liwan-previews.mjs --commit
(before-* and after-*), then deletes the PNGs so only a few webp sheets enter Git.
Each sheet: Liwan before | Liwan after | Nasaq reference (the original, captured before the refinement).
Usage: python3 design-lab/signature/tools/liwan-previews-webp.py  (needs Pillow)."""
import glob, os
from PIL import Image, ImageDraw, ImageFont

d = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'previews', 'liwan')
os.chdir(d)
bold = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
font = ImageFont.truetype(bold, 30) if os.path.exists(bold) else ImageFont.load_default()

# (sheet, shot, max height in captured px (2x), include the Nasaq reference)
SHEETS = [
    ('dashboard-phone', 'dashboard-390', 3400, True),
    ('invoice-phone', 'sales-390', 3000, True),
    ('inventory-phone', 'inventory-390', 2600, True),
    ('menu-phone', 'nav-sheet', 1700, False),
    ('sidebar-desktop', 'nav-sidebar', 2000, True),
    ('rail-tablet', 'nav-rail', 2300, False),
    ('dashboard-laptop', 'dashboard-1366', 1800, False),
]


def load(name, h):
    f = name + '.png'
    if not os.path.exists(f):
        return None
    im = Image.open(f).convert('RGB')
    im = im.crop((0, 0, im.width, min(im.height, h)))
    return im.resize((im.width // 2, im.height // 2), Image.LANCZOS)  # sheets at 1x keep Git light


for sheet, shot, h, ref in SHEETS:
    cols = [('LIWAN BEFORE', load(f'before-liwan-{shot}', h)), ('LIWAN AFTER', load(f'after-liwan-{shot}', h))]
    if ref:
        cols.append(('NASAQ (REFERENCE)', load(f'before-nasaq-{shot}', h)))
    cols = [(t, im) for t, im in cols if im is not None]
    if len(cols) < 2:
        continue
    pad, lab = 24, 64
    c = Image.new('RGB', (sum(im.width for _, im in cols) + pad * (len(cols) + 1), max(im.height for _, im in cols) + lab + pad), (246, 246, 248))
    g = ImageDraw.Draw(c)
    x = pad
    for t, im in cols:
        g.text((x, 18), t, fill=(20, 60, 160) if 'AFTER' in t else (120, 120, 130), font=font)
        c.paste(im, (x, lab))
        x += im.width + pad
    c.save(f'compare-{sheet}.webp', 'WEBP', quality=84, method=6)
for f in glob.glob('*.png'):
    os.remove(f)
print('liwan comparison sheets →', os.path.relpath(d), sorted(glob.glob('*.webp')))
