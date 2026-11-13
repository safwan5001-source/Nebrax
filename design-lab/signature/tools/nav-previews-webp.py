"""Converts the committed nav previews (PNG from signature-nav-previews.mjs --commit) to webp and builds the
before/after comparison sheets. Usage: python3 design-lab/signature/tools/nav-previews-webp.py  (needs Pillow)."""
import glob, os
from PIL import Image, ImageDraw, ImageFont

d = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'previews', 'nav')
os.chdir(d)
for f in glob.glob('*.png'):
    Image.open(f).convert('RGB').save(f[:-4] + '.webp', 'WEBP', quality=88, method=6)
    os.remove(f)
bold = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
font = ImageFont.truetype(bold, 44) if os.path.exists(bold) else ImageFont.load_default()
for idn in ['nasaq', 'liwan']:
    for shot in ['mobile-sheet', 'sidebar']:
        if not (os.path.exists(f'before-{idn}-{shot}.webp') and os.path.exists(f'after-{idn}-{shot}.webp')):
            continue
        a, b = Image.open(f'before-{idn}-{shot}.webp'), Image.open(f'after-{idn}-{shot}.webp')
        if shot == 'sidebar':  # Home → HR is enough to read the change
            a, b = a.crop((0, 0, a.width, min(a.height, 2600))), b.crop((0, 0, b.width, min(b.height, 2600)))
        pad, lab = 40, 90
        c = Image.new('RGB', (a.width + b.width + pad * 3, max(a.height, b.height) + lab + pad), (246, 246, 248))
        g = ImageDraw.Draw(c)
        g.text((pad, 24), 'BEFORE', fill=(120, 120, 130), font=font)
        g.text((pad * 2 + a.width, 24), 'AFTER', fill=(20, 60, 160), font=font)
        c.paste(a, (pad, lab)); c.paste(b, (pad * 2 + a.width, lab))
        c.save(f'compare-{idn}-{shot}.webp', 'WEBP', quality=86, method=6)
print('nav previews → webp + comparison sheets in', os.path.relpath(d))
