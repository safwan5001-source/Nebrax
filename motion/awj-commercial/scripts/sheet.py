# Contact sheet of out/stills for review passes.
import glob, sys
from PIL import Image, ImageDraw
fs = sorted(glob.glob('out/stills/f*.jpg'))
w, h, cols = 480, 270, int(sys.argv[1]) if len(sys.argv) > 1 else 6
rows = (len(fs) + cols - 1) // cols
sheet = Image.new('RGB', (cols * w, rows * h), 'white')
for i, f in enumerate(fs):
    im = Image.open(f).resize((w, h))
    d = ImageDraw.Draw(im); d.rectangle([0, 0, 44, 16], fill='black'); d.text((3, 2), f[-8:-4], fill='white')
    sheet.paste(im, ((i % cols) * w, (i // cols) * h))
sheet.save('out/sheet.jpg', quality=85)
