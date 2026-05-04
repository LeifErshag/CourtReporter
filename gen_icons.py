#!/usr/bin/env python3
"""
Generate PNG icons for Drachenwald Court Reporter.
Design: heater shield, per pale gules (dark red) and or (gold),
a dragon rampant counterchanged — loosely inspired by Drachenwald's arms.
No external dependencies; uses only struct and zlib.
"""
import struct, zlib, math, os

# ── colour palette ────────────────────────────────────────────────────────────
T  = (0,   0,   0,   0)    # transparent
DR = (107, 29,  29,  255)  # gules  #6b1d1d
GD = (194, 156, 57,  255)  # or     #c29c39
OL = (38,  10,  10,  255)  # outline (very dark)
WH = (255, 250, 240, 255)  # highlight

# ── PNG writer ────────────────────────────────────────────────────────────────
def write_png(path, pixels):
    H, W = len(pixels), len(pixels[0])
    def ck(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    raw = b''.join(b'\x00' + bytes(ch for px in row for ch in px) for row in pixels)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(ck(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 6, 0, 0, 0)))
        f.write(ck(b'IDAT', zlib.compress(raw, 9)))
        f.write(ck(b'IEND', b''))

# ── geometry helpers ──────────────────────────────────────────────────────────
def grid(W, H): return [[T]*W for _ in range(H)]

def in_shield(nx, ny, m=0.07):
    """True if normalised point is inside heater shield."""
    if nx < m or nx > 1-m or ny < m or ny > 0.99: return False
    if ny <= 0.63: return True
    t = (ny - 0.63) / 0.37
    hw = (0.5 - m) * (1 - t) ** 0.65
    return abs(nx - 0.5) < hw

def paint_dot(px, cx, cy, r, color, W, H, mask):
    """Fill a circle, but only where mask is True."""
    ir = int(r) + 2
    for dy in range(-ir, ir+1):
        for dx in range(-ir, ir+1):
            x, y = int(cx)+dx, int(cy)+dy
            if 0 <= x < W and 0 <= y < H and dx*dx+dy*dy <= r*r and mask[y][x]:
                px[y][x] = color

def stroke(px, pts, r, color_fn, W, H, mask, n=20):
    """Thick stroke along polyline using filled circles."""
    for i in range(len(pts)-1):
        x0,y0 = pts[i]; x1,y1 = pts[i+1]
        for k in range(n+1):
            t = k/n
            paint_dot(px, x0+(x1-x0)*t, y0+(y1-y0)*t, r,
                      color_fn(x0+(x1-x0)*t, W), W, H, mask)

def bezier(p0,p1,p2,p3,n=40):
    """Sample cubic Bézier."""
    out=[]
    for k in range(n+1):
        t=k/n; u=1-t
        out.append((u**3*p0[0]+3*u**2*t*p1[0]+3*u*t**2*p2[0]+t**3*p3[0],
                    u**3*p0[1]+3*u**2*t*p1[1]+3*u*t**2*p2[1]+t**3*p3[1]))
    return out

def cc(cx, W):
    """Counterchange colour: gold on red side, red on gold side."""
    return GD if cx/W < 0.5 else DR

# ── build shield layer ────────────────────────────────────────────────────────
def build_shield(W, H, border_frac=0.028):
    """Returns pixel array + boolean mask (True = inside shield, not border)."""
    px = grid(W, H)
    mask = [[False]*W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            nx, ny = x/W, y/H
            if in_shield(nx, ny):
                inner = in_shield(nx, ny, 0.07 + border_frac)
                if not inner:
                    px[y][x] = OL
                else:
                    px[y][x] = DR if nx < 0.5 else GD
                    mask[y][x] = True
    # per-pale dividing line (2 px wide, straddling centre)
    cx = W // 2
    for y in range(H):
        for dx in (0, -1):
            x = cx + dx
            if 0 <= x < W and in_shield(x/W, y/H):
                px[y][x] = OL
                mask[y][x] = False
    return px, mask

# ── dragon (128-space, scaled) ────────────────────────────────────────────────
def add_dragon(px, W, H, mask):
    s = W / 128

    def pts(*pairs): return [(x*s, y*s) for x,y in pairs]
    def r(base): return max(1, base*s)

    # body – S-curve rising from lower-left to upper-right
    body = bezier((56*s,96*s),(54*s,62*s),(66*s,48*s),(68*s,32*s))
    stroke(px, body, r(6.5), cc, W, H, mask)

    # neck
    neck = bezier((68*s,32*s),(70*s,24*s),(76*s,20*s),(82*s,17*s))
    stroke(px, neck, r(5), cc, W, H, mask)

    # head
    paint_dot(px, 88*s, 20*s, r(9), cc(88*s,W), W, H, mask)

    # open jaws
    jaw = pts((88,20),(96,22),(102,25))
    stroke(px, jaw, r(4), cc, W, H, mask)
    jaw2= pts((88,20),(96,17),(102,14))
    stroke(px, jaw2, r(3.5), cc, W, H, mask)

    # horn
    horn = pts((84,14),(85,8),(84,4))
    stroke(px, horn, r(2.5), cc, W, H, mask)

    # wing membrane — three edge strokes from attachment to tip
    wing_attach = (62*s, 48*s)
    wing_tip    = (30*s, 18*s)
    wing_root   = (60*s, 60*s)
    for frac in (0.0, 0.33, 0.66, 1.0):
        base_x = wing_attach[0] + (wing_root[0]-wing_attach[0])*frac
        base_y = wing_attach[1] + (wing_root[1]-wing_attach[1])*frac
        tip_bx = wing_tip[0] + frac * 10*s
        tip_by = wing_tip[1] + frac * 14*s
        stroke(px, [(base_x,base_y),(tip_bx,tip_by)], r(3.5), cc, W, H, mask)
    # trailing edge
    stroke(px, [wing_attach, wing_tip], r(4), cc, W, H, mask)

    # fore leg (raised, reaching right)
    fore = bezier((66*s,60*s),(74*s,58*s),(80*s,64*s),(82*s,72*s))
    stroke(px, fore, r(4), cc, W, H, mask)
    for dx,dy in ((4,4),(5,0),(4,-4)):
        stroke(px, [(82*s,72*s),(82*s+dx*s,72*s+dy*s)], r(2.5), cc, W, H, mask)

    # hind legs
    hind = bezier((56*s,88*s),(50*s,92*s),(44*s,98*s),(40*s,106*s))
    stroke(px, hind, r(4), cc, W, H, mask)
    for dx,dy in ((-4,4),(-1,5),(3,4)):
        stroke(px, [(40*s,106*s),(40*s+dx*s,106*s+dy*s)], r(2.5), cc, W, H, mask)

    # tail
    tail = bezier((56*s,96*s),(46*s,104*s),(34*s,108*s),(24*s,106*s))
    stroke(px, tail, r(3.5), cc, W, H, mask)
    tail_tip = pts((24,106),(18,110),(14,112))
    stroke(px, tail_tip, r(2), cc, W, H, mask)


# ── tiny 16-px charge: a simple wyvern silhouette ────────────────────────────
def add_small_charge(px, W, H, mask):
    """For 16px: a simple crown-like mark in the centre."""
    s = W / 16
    c = cc  # counterchange function

    # Three "points" of a crown above a base bar
    base_y = int(10*s)
    for x in range(int(5*s), int(12*s)):
        if 0<=x<W and 0<=base_y<H and mask[base_y][x]:
            px[base_y][x] = cc(x, W)
        if 0<=x<W and 0<=base_y+1<H and mask[base_y+1][x]:
            px[base_y+1][x] = cc(x, W)

    for cx_pt, top_y in ((int(5.5*s), int(7*s)), (int(8*s), int(6*s)), (int(10.5*s), int(7*s))):
        for y in range(top_y, base_y):
            if 0<=cx_pt<W and 0<=y<H and mask[y][cx_pt]:
                px[y][cx_pt] = cc(cx_pt, W)
            if 0<=cx_pt+1<W and 0<=y<H and mask[y][cx_pt+1]:
                px[y][cx_pt+1] = cc(cx_pt+1, W)


# ── assemble ──────────────────────────────────────────────────────────────────
os.makedirs('icons', exist_ok=True)

for size in (16, 48, 128):
    px, mask = build_shield(size, size)
    if size >= 48:
        add_dragon(px, size, size, mask)
    else:
        add_small_charge(px, size, size, mask)
    write_png(f'icons/{size}.png', px)
    print(f'  icons/{size}.png  ({size}×{size})')

print('Done.')
