#!/usr/bin/env python3
"""Render the MarketX ball logo crisply at any size.

    python3 brand/logo-ball.py OUT.png [--size 1080] [--no-shadow]

The flat mark (brand/marketx-logo-flat-512.png) is upscaled 4x with its edges re-sharpened, then the ball is
rendered at 2x the output size and downsampled, so edges stay clean at 1080 px and above.
--no-shadow writes the ball alone, tightly cropped (used for site icons).
"""
import argparse, os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))

def hires_decal(scale=4):
    """The flat mark at 512*scale px: colours upscaled premultiplied, alpha edges re-sharpened."""
    im = np.asarray(Image.open(os.path.join(HERE, 'marketx-logo-flat-512.png')).convert('RGBA')).astype(np.float32) / 255
    n = 512 * scale
    pre = np.dstack([im[..., :3] * im[..., 3:4], im[..., 3:4]])
    up = np.dstack([np.asarray(Image.fromarray((pre[..., i] * 65535).astype(np.uint16).astype(np.int32), 'I').resize((n, n), Image.BICUBIC)).astype(np.float32) / 65535 for i in range(4)])
    a = np.clip(up[..., 3], 0, 1); rgb = np.clip(up[..., :3] / np.maximum(a, 1e-4)[..., None], 0, 1)
    a = np.clip((a - .5) / .22 + .5, 0, 1)                      # crisp, still anti-aliased edges
    return np.dstack([rgb, a]), n

def sampler(img, n):
    def sample(px, py):
        px = np.clip(px, 0, n - 1.001); py = np.clip(py, 0, n - 1.001); x0 = px.astype(int); y0 = py.astype(int); fx = (px - x0)[..., None]; fy = (py - y0)[..., None]
        return img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy) + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy
    return sample

def shading(nx, ny, nz):
    L = np.array([-.5, -.6, .62]); L /= np.linalg.norm(L); lam = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
    Hh = L + [0, 0, 1]; Hh /= np.linalg.norm(Hh); ndh = np.clip(nx * Hh[0] + ny * Hh[1] + nz * Hh[2], 0, 1)
    return lam, ndh

def render_ball(S, rot=0.0, dec=None, fill=1.0):
    """RGBA ball filling an S x S square (radius S/2), mark rotated `rot` radians about the vertical axis.
    `fill` = share of the ball face the flat mark covers (1.0: the rainbow ring is the ball's rim)."""
    if dec is None: dec = hires_decal()
    img, n = dec; sample = sampler(img, n)
    yy, xx = np.mgrid[0:512, 0:512]; flat = np.asarray(Image.open(os.path.join(HERE, 'marketx-logo-flat-512.png')).convert('RGBA'))[..., 3]
    Rd = float(np.percentile(np.hypot(xx - 256, yy - 256)[flat > 128], 99.5)) * n / 512
    c = S / 2; RB = S / 2 - 1
    Y, X = np.mgrid[0:S, 0:S].astype(np.float32); nx, ny = (X + .5 - c) / RB, (Y + .5 - c) / RB
    r = np.hypot(nx, ny); nz = np.sqrt(np.clip(1 - r * r, 0, 1)); lam, ndh = shading(nx, ny, nz)
    ca, sa = np.cos(rot), np.sin(rot); ox = nx * ca - nz * sa; oz = nx * sa + nz * ca
    ux = np.where(oz >= 0, ox, -ox); uy = ny
    rad = np.hypot(ux, uy); wrap = np.where(rad > 0, (np.arcsin(np.clip(rad, 0, .9999)) / (np.pi / 2)) / np.maximum(rad, 1e-6), 1); wrap = 1 + (wrap - 1) * .5
    d = sample(n / 2 + ux * wrap * Rd / fill, n / 2 + uy * wrap * Rd / fill); d[..., 3] *= (r < 1)
    shade = .48 + .72 * lam ** 1.1; fres = (1 - nz) ** 3
    ex, ey = (nx + .30) / .55, (ny + .45) / .32; win = np.clip(1 - (ex ** 2 + ey ** 2), 0, 1) ** 1.5 * .42
    spec = ndh ** 500 * .85 + ndh ** 60 * .12; bounce = np.clip(ny, 0, 1) ** 2 * (1 - nz) * .35
    base = np.array([.05, .04, .10]); hi = np.array([.30, .26, .46]); body = base + (hi - base) * (lam ** 1.4)[..., None]
    col = d[..., :3] * shade[..., None] * d[..., 3:4] + body * (1 - d[..., 3:4])
    col = col + (win + spec + fres * .35)[..., None] * (1 - col) + bounce[..., None] * np.array([.55, .35, 1.0]) * .5
    alpha = np.clip((1 - r) * RB + .5, 0, 1)
    return np.dstack([np.clip(col, 0, 1), alpha])

def with_shadow(ball, S):
    """Place the ball on a transparent S x S canvas with a soft floor shadow (the presentation master)."""
    B = ball.shape[0]; out = np.zeros((S, S, 4), np.float32); x0 = (S - B) // 2; y0 = int(S * .055)
    Y, X = np.mgrid[0:S, 0:S].astype(np.float32); cy = y0 + B - S * .004
    sh = np.clip(1 - (((X - S / 2) / (B * .40)) ** 2 + ((Y - cy) / (S * .045)) ** 2), 0, 1) ** 1.6 * .6
    out[..., 3] = sh
    a = ball[..., 3:4]; reg = out[y0:y0 + B, x0:x0 + B]
    reg[..., :3] = ball[..., :3] * a + reg[..., :3] * reg[..., 3:4] * (1 - a)
    reg[..., 3:4] = a + reg[..., 3:4] * (1 - a); reg[..., :3] /= np.maximum(reg[..., 3:4], 1e-6)
    return out

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--size', type=int, default=1080); ap.add_argument('--no-shadow', action='store_true'); a = ap.parse_args()
    SS = 2                                                      # supersampling
    if a.no_shadow:
        img = render_ball(a.size * SS, fill=1.003)
    else:
        img = with_shadow(render_ball(int(a.size * SS * .81), fill=1.003), a.size * SS)
    Image.fromarray((img * 255).round().astype(np.uint8), 'RGBA').resize((a.size, a.size), Image.LANCZOS).save(a.out, optimize=True)
    print('wrote', a.out)
