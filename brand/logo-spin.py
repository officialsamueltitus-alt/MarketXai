#!/usr/bin/env python3
"""Render the spinning MarketX ball logo as a seamless loop of PNG frames.

Used for every MarketX video: the logo always appears spinning, never static.

    python3 brand/logo-spin.py OUT_DIR [--size 1080] [--frames 120] [--transparent]

One full turn takes `--frames` frames (120 = 4 s at 30 fps), so frame N wraps to frame 0.
--transparent writes RGBA frames with only the ball (no backdrop or floor shadow), for overlays.
The ball itself comes from logo-ball.py (same crisp renderer as the site logo), supersampled 2x.
"""
import argparse, os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib; LB = importlib.import_module('logo-ball')

ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--size', type=int, default=1080)
ap.add_argument('--frames', type=int, default=120); ap.add_argument('--transparent', action='store_true'); args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)
S = args.size; SS = 2; dec = LB.hires_decal()
B = int(S * SS * (.94 if args.transparent else .70))            # ball diameter, supersampled
if not args.transparent:
    Y, X = np.mgrid[0:S, 0:S].astype(np.float32); c = S / 2
    bg = np.array([.02, .02, .045]) + np.array([.06, .05, .12]) * np.exp(-(((X - c) / (S * .65)) ** 2 + ((Y - c * .8) / (S * .56)) ** 2))[..., None]
    by = c - S * .028; sh = np.clip(1 - (((X - c) / (B / SS * .43)) ** 2 + ((Y - (by + B / SS / 2 + S * .02)) / (S * .04)) ** 2), 0, 1) ** 2 * .7
    bg = bg * (1 - sh)[..., None]
for f in range(args.frames):
    ball = LB.render_ball(B, rot=2 * np.pi * f / args.frames, dec=dec, fill=.95)
    small = np.asarray(Image.fromarray((ball * 255).round().astype(np.uint8), 'RGBA').resize((B // SS, B // SS), Image.LANCZOS)).astype(np.float32) / 255
    if args.transparent:
        out = np.zeros((S, S, 4), np.float32); o = (S - small.shape[0]) // 2; out[o:o + small.shape[0], o:o + small.shape[1]] = small; mode = 'RGBA'
    else:
        out = bg.copy(); b = small.shape[0]; x0 = (S - b) // 2; y0 = int(by - b / 2); a = small[..., 3:4]
        out[y0:y0 + b, x0:x0 + b] = small[..., :3] * a + out[y0:y0 + b, x0:x0 + b] * (1 - a); mode = 'RGB'
    Image.fromarray((np.clip(out, 0, 1) * 255).round().astype(np.uint8), mode).save(os.path.join(args.out, f'f{f:04d}.png'))
print(f'{args.frames} frames written to {args.out}')
