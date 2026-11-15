"""Draw the Atom Viewer icon: a water molecule seen side-on (ball-and-stick, H-O-H = 104.5 deg).

Usage: python3 tools/make_icons.py extension/icons [store/icon-512.png]
Writes icon16/32/48/128.png, and optionally a 512 px copy (used for the store promo tile).
"""

import math
import sys

from PIL import Image, ImageDraw

out = sys.argv[1] if len(sys.argv) > 1 else "extension/icons"
S = 1024  # supersampled canvas, downscaled with LANCZOS
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# background: dark rounded square so the white H atoms read on light and dark toolbars
pad = S * 0.03
d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=S * 0.22, fill=(28, 34, 48, 255))

# geometry (in units of S)
half_angle = math.radians(104.5 / 2)
o = (0.5 * S, 0.40 * S)
bond = 0.37 * S
r_o, r_h = 0.195 * S, 0.125 * S
hs = [(o[0] + s * bond * math.sin(half_angle), o[1] + bond * math.cos(half_angle)) for s in (-1, 1)]


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def ball(center, r, base, shadow, highlight):
    """Shaded sphere: concentric discs from the rim colour to a highlight offset to the upper left."""
    cx, cy = center
    steps = 60
    for k in range(steps + 1):
        t = k / steps
        rr = r * (1 - 0.82 * t)
        ox = cx - r * 0.32 * t
        oy = cy - r * 0.34 * t
        col = lerp(shadow, base, min(1, t * 2)) if t < 0.5 else lerp(base, highlight, (t - 0.5) * 2)
        d.ellipse([ox - rr, oy - rr, ox + rr, oy + rr], fill=col + (255,))


# bonds first (two-tone, like the viewer's half bonds)
bond_w = round(0.075 * S)
for h in hs:
    mid = ((o[0] + h[0]) / 2, (o[1] + h[1]) / 2)
    d.line([o, mid], fill=(214, 60, 52, 255), width=bond_w)
    d.line([mid, h], fill=(205, 210, 220, 255), width=bond_w)

for h in hs:
    ball(h, r_h, base=(226, 230, 238), shadow=(150, 158, 172), highlight=(255, 255, 255))
ball(o, r_o, base=(232, 52, 44), shadow=(150, 22, 18), highlight=(255, 170, 160))

for size in (16, 32, 48):
    img.resize((size, size), Image.LANCZOS).save(f"{out}/icon{size}.png")

# 128 px: Chrome Web Store guideline is 96x96 artwork with 16 px of transparent padding per side
icon128 = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
icon128.alpha_composite(img.resize((96, 96), Image.LANCZOS), (16, 16))
icon128.save(f"{out}/icon128.png")
if len(sys.argv) > 2:
    img.resize((512, 512), Image.LANCZOS).save(sys.argv[2])
print("wrote", out)
