"""Draw the example pack's three layers: a centric diatom (like Coscinodiscus), 60 µm across.

    python3 kids/packs/diatom/make_svgs.py

whole.svg   the shell, 64 µm square: rim, ribs and about 1,300 hexagonal chambers (areolae)
chambers.svg  an 8 µm patch around (8, -6) µm: each chamber's silica wall, its opening and the sieve plate inside
pores.svg   a 2 µm patch around one chamber: the sieve plate's pores, about 40 nm wide

All three use the same chamber lattice, so they line up as you zoom. Units are µm; pack.json gives each layer's
size in nm. As in a real TEM image, thick silica is darker and holes are lighter.
"""
import math, pathlib

HERE = pathlib.Path(__file__).parent
R = 30.0          # shell radius, µm
A = 1.6           # chamber spacing, µm
SILICA, RIM, HOLE, PLATE, PORE, BG = '#58b39b', '#2f6f62', '#e9fbf5', '#9ed9c7', '#f4fffb', '#eaf7ff'


def lattice(cx, cy, half):
    """chamber centres of the hexagonal lattice inside the shell and within `half` of (cx, cy)"""
    h = A * math.sqrt(3) / 2
    out = []
    for j in range(int((cy - half) / h) - 2, int((cy + half) / h) + 3):
        off = (j % 2) * A / 2
        for i in range(int((cx - half) / A) - 2, int((cx + half) / A) + 3):
            x, y = i * A + off, j * h
            if math.hypot(x, y) < R - 1.4 and abs(x - cx) < half + A and abs(y - cy) < half + A:
                out.append((round(x, 4), round(y, 4)))
    return out


def hexagon(x, y, r):
    return ' '.join(f'{x + r * math.cos(math.pi / 6 + k * math.pi / 3):.4f},{y + r * math.sin(math.pi / 6 + k * math.pi / 3):.4f}' for k in range(6))


def svg(cx, cy, size, body):
    v = f'{cx - size / 2} {cy - size / 2} {size} {size}'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{v}" width="1024" height="1024">\n<rect x="{cx - size / 2}" y="{cy - size / 2}" width="{size}" height="{size}" fill="{BG}"/>\n{body}\n</svg>\n'


def shell():
    return (f'<circle r="{R + 0.6}" fill="{RIM}"/><circle r="{R}" fill="{SILICA}"/>'
            + ''.join(f'<line x1="{2.5 * math.cos(t):.3f}" y1="{2.5 * math.sin(t):.3f}" x2="{(R - 0.5) * math.cos(t):.3f}" y2="{(R - 0.5) * math.sin(t):.3f}" stroke="{RIM}" stroke-width="0.35"/>'
                      for t in (k * math.pi / 24 for k in range(48)))
            + f'<circle r="2.2" fill="{PLATE}" stroke="{RIM}" stroke-width="0.3"/>')


# the whole shell
cells = lattice(0, 0, R)
whole = shell() + f'<g fill="{HOLE}" fill-opacity="0.85">' + ''.join(f'<polygon points="{hexagon(x, y, A * 0.42)}"/>' for x, y in cells if math.hypot(x, y) > 2.6) + '</g>'
(HERE / 'whole.svg').write_text(svg(0, 0, 64, whole))

# chambers: wall, opening, sieve plate
C2 = (8.0, -6.0)
cells = [c for c in lattice(*C2, 4.0) if math.hypot(*c) > 2.6]
body = shell() + ''.join(
    f'<polygon points="{hexagon(x, y, A * 0.46)}" fill="{HOLE}" stroke="{RIM}" stroke-width="0.06"/>'
    f'<circle cx="{x}" cy="{y}" r="{A * 0.33:.4f}" fill="{PLATE}"/><circle cx="{x}" cy="{y}" r="{A * 0.12:.4f}" fill="{HOLE}" stroke="{RIM}" stroke-width="0.03"/>'
    for x, y in cells)
(HERE / 'chambers.svg').write_text(svg(*C2, 8, body))

# pores: one chamber's sieve plate, pores 40 nm wide every 70 nm
C3 = min(cells, key=lambda c: math.hypot(c[0] - 8.3, c[1] + 5.6))
x0, y0 = C3
near = [c for c in lattice(x0, y0, 1.2) if math.hypot(*c) > 2.6]
body = shell() + ''.join(f'<polygon points="{hexagon(x, y, A * 0.46)}" fill="{HOLE}" stroke="{RIM}" stroke-width="0.03"/><circle cx="{x}" cy="{y}" r="{A * 0.33:.4f}" fill="{PLATE}"/>' for x, y in near)
pores, s = [], 0.07
for j in range(-12, 13):
    for i in range(-12, 13):
        for x, y in near:
            px, py = x + i * s + (j % 2) * s / 2, y + j * s * math.sqrt(3) / 2
            if math.hypot(px - x, py - y) < A * 0.31 and math.hypot(px - x, py - y) > A * 0.13 and abs(px - x0) < 1.1 and abs(py - y0) < 1.1:
                pores.append(f'<circle cx="{px:.4f}" cy="{py:.4f}" r="0.02"/>')
body += f'<g fill="{PORE}" stroke="{RIM}" stroke-width="0.006">' + ''.join(pores) + '</g>'
body += ''.join(f'<circle cx="{x}" cy="{y}" r="{A * 0.12:.4f}" fill="{HOLE}" stroke="{RIM}" stroke-width="0.012"/>' for x, y in near)
(HERE / 'pores.svg').write_text(svg(x0, y0, 2, body))
print('pores chamber at', C3, 'µm;', len(pores), 'pores')
