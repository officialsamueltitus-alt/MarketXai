#!/usr/bin/env python3
"""Render the spinning MarketX ball logo as a seamless loop of PNG frames.

Used for every MarketX video: the logo always appears spinning, never static.

    python3 brand/logo-spin.py OUT_DIR [--size 1080] [--frames 120] [--transparent]

One full turn takes `--frames` frames (120 = 4 s at 30 fps), so frame N wraps to frame 0.
--transparent writes RGBA frames with only the ball (no backdrop or floor shadow), for overlays.
"""
import argparse, os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--size', type=int, default=1080)
ap.add_argument('--frames', type=int, default=120); ap.add_argument('--transparent', action='store_true'); args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)

dec = np.asarray(Image.open(os.path.join(HERE, 'marketx-logo-flat-512.png')).convert('RGBA')).astype(np.float32) / 255
yy, xx = np.mgrid[0:512, 0:512]; rr = np.hypot(xx - 256, yy - 256)
Rd = float(np.percentile(rr[dec[..., 3] > .5], 99.5))
S = args.size; c = S / 2; RB = S * (.47 if args.transparent else .352); oy = 0 if args.transparent else S * .028
Y, X = np.mgrid[0:S, 0:S].astype(np.float32); dx, dy = (X - c) / RB, (Y - c + oy) / RB
r = np.hypot(dx, dy); inside = r < 1; nz = np.sqrt(np.clip(1 - r * r, 0, 1)); nx, ny = dx, dy
L = np.array([-.5, -.6, .62]); L /= np.linalg.norm(L); lam = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
Hh = L + [0, 0, 1]; Hh /= np.linalg.norm(Hh); ndh = np.clip(nx * Hh[0] + ny * Hh[1] + nz * Hh[2], 0, 1)
shade = .48 + .72 * lam ** 1.1; fres = (1 - nz) ** 3
ex, ey = (dx + .30) / .55, (dy + .45) / .32; win = np.clip(1 - (ex ** 2 + ey ** 2), 0, 1) ** 1.5 * .42
spec = ndh ** 500 * .85 + ndh ** 60 * .12; bounce = np.clip(ny, 0, 1) ** 2 * (1 - nz) * .35
base = np.array([.05, .04, .10]); hi = np.array([.30, .26, .46]); body = base + (hi - base) * (lam ** 1.4)[..., None]
bg = np.zeros((S, S, 3), np.float32)
if not args.transparent:
    g = np.exp(-(((X - c) / (S * .65)) ** 2 + ((Y - c * .8) / (S * .56)) ** 2)); bg[:] = np.array([.02, .02, .045]) + np.array([.06, .05, .12]) * g[..., None]
    shy = (Y - (c - oy + RB + S * .031)) / (S * .043); shx = (X - c) / (RB * .85); bg *= (1 - np.clip(1 - (shx ** 2 + shy ** 2), 0, 1) ** 2 * .7)[..., None]

def sample(img, px, py):
    px = np.clip(px, 0, 510.999); py = np.clip(py, 0, 510.999); x0 = px.astype(int); y0 = py.astype(int); fx = (px - x0)[..., None]; fy = (py - y0)[..., None]
    return img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy) + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy

for f in range(args.frames):
    a = 2 * np.pi * f / args.frames; ca, sa = np.cos(a), np.sin(a)
    ox = nx * ca - nz * sa; oz = nx * sa + nz * ca
    ux = np.where(oz >= 0, ox, -ox); uy = ny                      # the mark on the front and on the back
    rad = np.hypot(ux, uy); wrap = np.where(rad > 0, (np.arcsin(np.clip(rad, 0, .9999)) / (np.pi / 2)) / np.maximum(rad, 1e-6), 1)
    wrap = 1 + (wrap - 1) * .5
    d = sample(dec, 256 + ux * wrap * Rd / .95, 256 + uy * wrap * Rd / .95); d[..., 3] *= inside
    col = d[..., :3] * shade[..., None] * d[..., 3:4] + body * (1 - d[..., 3:4])
    col = col + (win + spec + fres * .35)[..., None] * (1 - col) + bounce[..., None] * np.array([.55, .35, 1.0]) * .5
    edge = np.clip((1 - r) * RB / 1.2 + .5, 0, 1)
    if args.transparent:
        out = np.dstack([np.clip(col, 0, 1), edge]); mode = 'RGBA'
    else:
        out = np.clip(col, 0, 1) * edge[..., None] + bg * (1 - edge[..., None]); mode = 'RGB'
    Image.fromarray((out * 255).astype(np.uint8), mode).save(os.path.join(args.out, f'f{f:04d}.png'))
print(f'{args.frames} frames written to {args.out}')
