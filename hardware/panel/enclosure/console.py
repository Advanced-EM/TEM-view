#!/usr/bin/env python3
"""TEM-view Console: parametric 3D-printable enclosure for the first prototype.

    pip install manifold3d trimesh numpy
    python3 hardware/panel/enclosure/console.py   # writes stl/*.stl and assembly.glb, and checks the fit
    open viewer.html (served over HTTP) to look at the assembly in a browser

The layout matches the concept model (same control positions). Every dimension below is a parameter; check the
ones marked MEASURE against the parts you bought before printing.

Coordinates: millimeters, x to the right, y away from the user (toward the back), z up. The top plate is
modeled as it sits on the console; the script flips it face-down for printing.

Parts (stl/):
  top_plate.stl     print face down (the script already flipped it), black PETG/PLA or smoked translucent PETG
  base.stl          print upright, black PETG/PLA
  focus_dial.stl    1×, open side down; drop steel washers into the ring cavity for weight
  knob.stl          5×
  diffuser_ring.stl 1×, clear or natural PETG: sits over the LED ring around the focus dial
  light_bar.stl     1×, clear or natural PETG: the light line along the front edge
"""
import argparse
import math
import os

import numpy as np
from manifold3d import CrossSection, JoinType, Manifold, OpType, set_circular_segments

set_circular_segments(96)

# ------------------------------------------------------------------ overall
W, D, R = 210.0, 120.0, 16.0      # footprint and corner radius
WALL, FLOOR = 2.4, 2.4            # base walls and floor
BASE_H = 28.0                     # base height; the top plate sits on the walls
PLATE_T = 3.0                     # top plate thickness
CHAMFER = 1.0                     # outer edge chamfer, plate top and base bottom
LIP_H, LIP_W, FIT = 3.0, 1.6, 0.25  # plate locating lip inside the walls, and its clearance

# ------------------------------------------------------------------ control layout (same as the concept model)
DIAL = (-62.0, -4.0)
KEYS = [(x, y) for y in (14.0, -8.0) for x in (-12.0, 9.0, 30.0, 51.0)]  # back row, then front row
KNOBS = {"mag": (-8.0, -42.0), "intensity": (17.0, -42.0), "context": (42.0, -42.0), "mfX": (70.0, 32.0), "mfY": (92.0, 32.0)}
JOY = (81.0, -14.0)
OLED = (13.0, 40.0)
MICS = [(-36.0, 47.0), (56.0, 49.0)]
MIC_LED = (-35.0, 35.0)

# ------------------------------------------------------------------ parts (MEASURE: check against yours)
MX_HOLE, MX_PLATE, MX_POCKET = 14.0, 1.5, 15.6     # MX switch cut-out; the clips need a 1.5 mm plate
EC11_HOLE = 7.4                                    # EC11 encoder bushing (M7); snip or file off its locating tab
RING_R_IN, RING_R_OUT, RING_BRIDGE = 28.0, 31.0, 4.0  # slot for the diffuser over an Adafruit NeoPixel Ring 24 (LEDs at r ≈ 29.5)
JOY_HOLE = 26.0                                    # opening for the thumbstick and its travel
JOY_PCB = (26.67, 20.32)                           # MEASURE: mounting-hole spacing of the joystick module (KY-023 style)
JOY_POST_L, JOY_POST_D, JOY_INSERT = 19.0, 6.0, 3.2  # posts hanging from the plate (put the stick cap ~10 mm above the top)
OLED_WIN, OLED_GLASS, OLED_GLASS_T = (24.0, 7.0), (31.0, 12.4), 1.6  # 0.91" 128×32 module: window and glass pocket
MIC_POCKET_D, MIC_POCKET_T, MIC_HOLE_D = 14.6, 1.5, 1.2  # round INMP441 board pressed against the grille
MIC_LED_D = 3.1                                    # 3 mm red/blue LED
BOSSES = [(-95.0, 48.0), (95.0, 48.0), (-95.0, -48.0), (95.0, -48.0), (0.0, 53.0), (29.5, -51.0)]
BOSS_D, INSERT_D, INSERT_L = 7.0, 4.0, 6.0         # M3 heat-set inserts in plate bosses, screws from below
SCREW_D, CSK_D, CSK_H = 3.4, 6.6, 1.9              # M3 countersunk screws through the floor
FEET = [(-80.0, 40.0), (80.0, 40.0), (-80.0, -40.0), (80.0, -40.0)]
FOOT_D, FOOT_T = 10.5, 1.0                         # recesses for 10 mm rubber feet

# controller: Pico-format RP2350 board with USB-C (e.g. Pimoroni Pico Plus 2), USB end at the back wall
PICO = (40.0, D / 2 - WALL - 1.0 - 25.5)           # board center
PICO_HOLES = (11.4, 47.0)                          # Pico mounting-hole spacing
PICO_STANDOFF, PICO_PILOT = 5.0, 1.8               # M2 self-tapping screws
USB_CUT, USB_Z = (13.0, 7.5, 3.0), FLOOR + 5.0 + 1.0 + 1.6  # plug opening (w, h, corner r) and its center height
MUTE_CUT, MUTE_X, MUTE_Z = (9.2, 4.4), -36.0, 14.0  # SS12D00 slide switch in the back wall (cuts mic power)
LIGHT_Z, LIGHT_H, LIGHT_SEGS, LIGHT_LEN, LIGHT_GAP = BASE_H - 10.0, 2.0, 4, 40.0, 3.0  # front light slots (below the plate lip)

# knobs
DIAL_D, DIAL_H, DIAL_RIDGES = 52.0, 15.0, 60       # focus dial (the LED ring shows around it)
KNOB_D, KNOB_H, KNOB_RIDGES = 15.0, 12.0, 24
SHAFT_D, SHAFT_FLAT, BORE_L = 6.15, 4.6, 10.5      # 6 mm D-shaft (flat at 4.5 mm); EC11 with 15 mm shaft, trim to fit


# ------------------------------------------------------------------ helpers
def rrect(w, h, r, x=0.0, y=0.0):
    return CrossSection.square([w - 2 * r, h - 2 * r], center=True).offset(r, JoinType.Round).translate([x, y])


def circle(r, x=0.0, y=0.0, n=0):
    return CrossSection.circle(r, n).translate([x, y])


def ext(cs, h, z=0.0):
    return Manifold.extrude(cs, h).translate([0, 0, z])


def cyl(r, h, x=0.0, y=0.0, z=0.0, n=0):
    return Manifold.cylinder(h, r, r, n).translate([x, y, z])


def box(w, d, h, x=0.0, y=0.0, z=0.0):
    return Manifold.cube([w, d, h], True).translate([x, y, z + h / 2])


def chamfered(cs, h, c, top=True):
    """Extrude a convex outline with a chamfer on its top (or bottom) edge."""
    body = ext(cs, h - c, 0 if top else c)
    lip = ext(cs.offset(-c, JoinType.Round), 0.01, h - 0.01 if top else 0)
    return Manifold.batch_hull([body, lip])


def union(parts):
    return Manifold.batch_boolean(parts, OpType.Add) if parts else Manifold()


def knurl(d, ridges, depth=0.6):
    pts = []
    for i in range(ridges * 2):
        a = i / (ridges * 2) * 2 * math.pi
        r = d / 2 - (depth if i % 2 else 0)
        pts.append([r * math.cos(a), r * math.sin(a)])
    return CrossSection([pts])


def bridge_cuts(cx, cy, r_mid, width, length, h, z):
    """Three radial blocks at 90°, 210° and 330° (the bridges across the LED slot)."""
    out = []
    for k in range(3):
        a = 90 + 120 * k
        out.append(box(width, length, h, z=z).rotate([0, 0, a - 90]).translate(
            [cx + r_mid * math.cos(math.radians(a)), cy + r_mid * math.sin(math.radians(a)), 0]))
    return union(out)


def d_bore():
    """6 mm D-shaft bore up from the bottom of a knob: a circle with the part beyond the flat removed."""
    flat_y = SHAFT_FLAT - SHAFT_D / 2  # the flat, measured from the shaft center
    return cyl(SHAFT_D / 2, BORE_L, z=-0.01, n=48) - box(SHAFT_D, SHAFT_D, BORE_L + 1, y=flat_y + SHAFT_D / 2, z=-0.5)


# ------------------------------------------------------------------ top plate
def top_plate():
    outline = rrect(W, D, R)
    plate = chamfered(outline, PLATE_T, CHAMFER)
    # locating lip that drops inside the base walls
    lip_out = rrect(W - 2 * (WALL + FIT), D - 2 * (WALL + FIT), R - WALL)
    lip = ext(lip_out - lip_out.offset(-LIP_W, JoinType.Round), LIP_H, -LIP_H)
    # bosses with heat-set inserts, reaching down to the floor
    boss_l = BASE_H - FLOOR - 0.3
    bosses = union([cyl(BOSS_D / 2, boss_l, x, y, -boss_l) for x, y in BOSSES])
    # joystick posts
    jx, jy = JOY
    posts = union([cyl(JOY_POST_D / 2, JOY_POST_L, jx + sx * JOY_PCB[0] / 2, jy + sy * JOY_PCB[1] / 2, -JOY_POST_L)
                   for sx in (-1, 1) for sy in (-1, 1)])
    solid = plate + lip + bosses + posts

    cuts = []
    # keys: MX cut-outs with a pocket from below so the plate is 1.5 mm at the clips
    for x, y in KEYS:
        cuts.append(box(MX_HOLE, MX_HOLE, PLATE_T + 2, x, y, -1))
        cuts.append(box(MX_POCKET, MX_POCKET, PLATE_T - MX_PLATE, x, y, -0.01))
    # encoders
    for x, y in [DIAL, *KNOBS.values()]:
        cuts.append(cyl(EC11_HOLE / 2, PLATE_T + 2, x, y, -1))
    # LED slot around the dial, with three bridges holding the center
    dx, dy = DIAL
    ring = ext(circle(RING_R_OUT, dx, dy) - circle(RING_R_IN, dx, dy), PLATE_T + 2, -1)
    ring -= bridge_cuts(dx, dy, (RING_R_IN + RING_R_OUT) / 2, RING_BRIDGE, RING_R_OUT - RING_R_IN + 4, PLATE_T + 4, -2)
    cuts.append(ring)
    # joystick opening and insert holes in its posts
    cuts.append(cyl(JOY_HOLE / 2, PLATE_T + 2, jx, jy, -1))
    for sx in (-1, 1):
        for sy in (-1, 1):
            cuts.append(cyl(JOY_INSERT / 2, 8, jx + sx * JOY_PCB[0] / 2, jy + sy * JOY_PCB[1] / 2, -JOY_POST_L - 0.01))
    # display window and glass pocket
    ox, oy = OLED
    cuts.append(box(*OLED_WIN, PLATE_T + 2, ox, oy, -1))
    cuts.append(box(*OLED_GLASS, OLED_GLASS_T, ox, oy, -0.01))  # glass sits in a pocket from below
    # microphone grilles: 19 holes in a hex pattern, and a pocket for the mic board
    for mx, my in MICS:
        for r, n in ((0, 1), (1.9, 6), (3.8, 12)):
            for i in range(n):
                a = 2 * math.pi * i / n
                cuts.append(cyl(MIC_HOLE_D / 2, PLATE_T + 2, mx + r * math.cos(a), my + r * math.sin(a), -1, n=16))
        cuts.append(cyl(MIC_POCKET_D / 2, MIC_POCKET_T, mx, my, -0.01))
    cuts.append(cyl(MIC_LED_D / 2, PLATE_T + 2, *MIC_LED, -1, n=32))
    # inserts in the bosses
    for x, y in BOSSES:
        cuts.append(cyl(INSERT_D / 2, INSERT_L, x, y, -(BASE_H - FLOOR - 0.3) - 0.01))
    return solid - union(cuts)


# ------------------------------------------------------------------ base
def base():
    outline = rrect(W, D, R)
    shell = chamfered(outline, BASE_H, CHAMFER, top=False)
    inner = rrect(W - 2 * WALL, D - 2 * WALL, R - WALL)
    shell -= ext(inner, BASE_H, FLOOR)
    # Pico standoffs
    px, py = PICO
    stand = union([cyl(2.4, PICO_STANDOFF, px + sx * PICO_HOLES[0] / 2, py + sy * PICO_HOLES[1] / 2, FLOOR - 0.01)
                   for sx in (-1, 1) for sy in (-1, 1)])
    shell += stand
    cuts = [cyl(PICO_PILOT / 2, PICO_STANDOFF + 1, px + sx * PICO_HOLES[0] / 2, py + sy * PICO_HOLES[1] / 2, FLOOR)
            for sx in (-1, 1) for sy in (-1, 1)]
    # screw holes with countersinks from below
    for x, y in BOSSES:
        cuts.append(cyl(SCREW_D / 2, FLOOR + 2, x, y, -1))
        cuts.append(Manifold.cylinder(CSK_H, CSK_D / 2, SCREW_D / 2).translate([x, y, -0.001]))
    for x, y in FEET:
        cuts.append(cyl(FOOT_D / 2, FOOT_T, x, y, -0.01))
    # back wall: USB-C and mute switch
    w, h, r = USB_CUT
    usb = ext(rrect(w, h, r), WALL + 2).rotate([-90, 0, 0]).translate([px, D / 2 - WALL - 1, USB_Z])
    cuts.append(usb)
    cuts.append(box(MUTE_CUT[0], WALL + 2, MUTE_CUT[1], MUTE_X, D / 2 - WALL / 2, MUTE_Z - MUTE_CUT[1] / 2))
    # front light slots, with bridges between them
    total = LIGHT_SEGS * LIGHT_LEN + (LIGHT_SEGS - 1) * LIGHT_GAP
    for i in range(LIGHT_SEGS):
        x = -total / 2 + LIGHT_LEN / 2 + i * (LIGHT_LEN + LIGHT_GAP)
        cuts.append(box(LIGHT_LEN, WALL + 2, LIGHT_H, x, -D / 2 + WALL / 2, LIGHT_Z))
    return shell - union(cuts)


def light_bar():
    """Clear strip behind the front slots, printed flat with its ribs up; the ribs push into the slots from inside."""
    total = LIGHT_SEGS * LIGHT_LEN + (LIGHT_SEGS - 1) * LIGHT_GAP
    strip = box(total + 4, LIGHT_H + 4, 1.6)
    ribs = union([box(LIGHT_LEN - 0.4, LIGHT_H - 0.3, WALL - 0.2, -total / 2 + LIGHT_LEN / 2 + i * (LIGHT_LEN + LIGHT_GAP), 0, 1.6 - 0.01)
                  for i in range(LIGHT_SEGS)])
    return strip + ribs


def diffuser_ring():
    """Clear ring in the dial slot: flange below the plate, notches for the three bridges, top flush with the plate."""
    flange = ext(circle(RING_R_OUT + 2.5) - circle(RING_R_IN + 0.2), 1.0)
    upper = ext(circle(RING_R_OUT - 0.2) - circle(RING_R_IN + 0.2), PLATE_T, 1.0)
    upper -= bridge_cuts(0, 0, (RING_R_IN + RING_R_OUT) / 2, RING_BRIDGE + 0.5, RING_R_OUT - RING_R_IN + 4, PLATE_T + 2, 0.5)
    return flange + upper


def focus_dial():
    body = ext(knurl(DIAL_D, DIAL_RIDGES, 0.7), DIAL_H)
    body -= Manifold.sphere(400, 256).translate([0, 0, DIAL_H + 400 - 0.8])          # slightly dished top
    body -= Manifold.sphere(4.0, 48).translate([DIAL_D / 2 - 10, 0, DIAL_H + 2.6])   # finger dimple
    body -= ext(circle(DIAL_D / 2 - 3.0) - circle(9.0), 8.0, -0.01)                  # cavity for steel washers
    body -= cyl(7.5, 3.0, z=-0.01)                                                    # encoder nut clearance
    return body - d_bore()


def knob():
    body = ext(knurl(KNOB_D, KNOB_RIDGES, 0.5), KNOB_H)
    body -= box(1.0, KNOB_D / 2 - 1.5, 0.7, y=KNOB_D / 4 + 0.4, z=KNOB_H - 0.69)  # indicator groove
    body -= cyl(5.2, 2.5, z=-0.01)                                                # encoder nut clearance
    return body - d_bore()


# ------------------------------------------------------------------ assembly and fit check
def assembly(plate):
    """Parts in their assembled positions (keys and electronics left out)."""
    light = light_bar().rotate([90, 0, 0]).translate([0, -D / 2 + WALL + 1.6, LIGHT_Z + LIGHT_H / 2])
    return {
        "base": base(),
        "top_plate": plate.translate([0, 0, BASE_H]),
        "diffuser_ring": diffuser_ring().translate([DIAL[0], DIAL[1], BASE_H - 1.0]),
        "light_bar": light,
        "focus_dial": focus_dial().translate([DIAL[0], DIAL[1], BASE_H + PLATE_T + 1.0]),
        **{f"knob_{k}": knob().translate([x, y, BASE_H + PLATE_T + 1.0]) for k, (x, y) in KNOBS.items()},
    }


def fit_check(asm):
    """Every pair of parts must not overlap (the check is exact: boolean intersection of the solids)."""
    names, bad = list(asm), []
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            v = (asm[a] ^ asm[b]).volume()
            if v > 0.05:
                bad.append(f"{a} × {b}: {v:.1f} mm³")
    print("fit check:", "all parts clear" if not bad else "OVERLAPS\n  " + "\n  ".join(bad))
    return not bad


# ------------------------------------------------------------------ output
def save(man, path):
    import trimesh
    mesh = man.to_mesh()
    t = trimesh.Trimesh(vertices=np.asarray(mesh.vert_properties)[:, :3], faces=np.asarray(mesh.tri_verts), process=True)
    t.export(path)
    return t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "stl"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    plate = top_plate()
    parts = {
        "top_plate": plate.rotate([180, 0, 0]).translate([0, 0, PLATE_T]),  # face down for printing
        "base": base(),
        "focus_dial": focus_dial(),
        "knob": knob(),
        "diffuser_ring": diffuser_ring(),
        "light_bar": light_bar(),
    }
    meshes = {}
    for name, m in parts.items():
        if m.status().name != "NoError" or m.is_empty():
            raise SystemExit(f"{name}: geometry error {m.status()}")
        t = save(m, os.path.join(a.out, f"{name}.stl"))
        meshes[name] = t
        b = t.bounds
        print(f"{name:14s} {b[1][0] - b[0][0]:6.1f} × {b[1][1] - b[0][1]:6.1f} × {b[1][2] - b[0][2]:5.1f} mm  "
              f"{t.volume / 1000:6.1f} cm³  watertight={t.is_watertight}")
    asm = assembly(plate)
    ok = fit_check(asm)
    export_assembly(asm, os.path.join(os.path.dirname(a.out), "assembly.glb"))
    if not ok:
        raise SystemExit(1)


def export_assembly(asm, path):
    """Assembled console as a colored glTF (assembly.glb) for the browser viewer (viewer.html)."""
    import trimesh
    colors = {"base": (21, 24, 28), "top_plate": (38, 43, 51), "diffuser_ring": (111, 214, 255), "light_bar": (111, 214, 255)}
    scene = trimesh.Scene()
    items = dict(asm)
    for i, (x, y) in enumerate(KEYS):  # stand-in keycaps
        items[f"key_{i}"] = Manifold.cube([18, 18, 9], True).translate([x, y, BASE_H + PLATE_T + 9.5])
    for name, m in items.items():
        mesh = m.to_mesh()
        t = trimesh.Trimesh(np.asarray(mesh.vert_properties)[:, :3], np.asarray(mesh.tri_verts))
        rgb = colors.get(name, (29, 33, 39) if name.startswith("key") else (58, 63, 70))
        t.visual = trimesh.visual.ColorVisuals(t, face_colors=np.tile([*rgb, 255], (len(t.faces), 1)))
        t.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0]))  # z-up to glTF y-up
        scene.add_geometry(t, node_name=name, geom_name=name)
    scene.export(path)
    print("assembly ->", path)


if __name__ == "__main__":
    main()
