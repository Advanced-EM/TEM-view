"""Use a structure of your own as the specimen: an XYZ file (element x y z, in Å).

Here the script writes one itself, a 4 nm platinum cuboctahedron, so it runs anywhere; replace XYZ with
open("your_file.xyz").read(), or call tem.load_xyz("your_file.xyz") with a path. The structure lands on a thin
carbon support, centred under the beam. Tilting the stage (±30° for structures like this) rotates it: along a
zone axis the atoms line up into columns and HAADF shows them; ten degrees off, the columns smear out.
"""
import numpy as np

import temview as tv

a = 3.924  # Pt lattice parameter, Å
fcc = np.array([[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]])
cells = np.array(np.meshgrid(*[np.arange(-7, 8)] * 3, indexing="ij")).reshape(3, -1).T
pos = ((cells[:, None, :] + fcc[None]) * a).reshape(-1, 3)
# a cuboctahedron: {111} and {100} facets
keep = (np.abs(pos).sum(1) <= 2.0 * a * 3.2) & (np.abs(pos).max(1) <= a * 3.2)
pos = pos[keep]
XYZ = f"{len(pos)}\nPt cuboctahedron\n" + "\n".join(f"Pt {x:.4f} {y:.4f} {z:.4f}" for x, y, z in pos)

tem = tv.connect()
print(tem.load_xyz(XYZ, "pt_cuboctahedron.xyz"))
tem.set(mode="stem", detector="haadf", fov_nm=6, corrector=True)
on = tem.acquire()
tv.show(on, "HAADF along [001]: atom columns")
tem.set(tilt_x_deg=10)
off = tem.acquire()
tv.show(off, "10° off the zone axis: the columns smear")
tem.set(tilt_x_deg=0)


def lattice_directions(img):
    """How many independent directions of lattice fringes the image's power spectrum shows."""
    F = np.fft.fftshift(np.abs(np.fft.fft2(img - img.mean())) ** 2)
    n = F.shape[0]
    y, x = np.indices(F.shape) - n // 2
    r, ang = np.hypot(x, y), np.degrees(np.arctan2(y, x)) % 180
    F[(r < 6) | (r > n // 3)] = 0  # the particle outline at low frequency, noise at high
    peaks = F > 0.25 * F.max()
    return len({round(a / 20) % 9 for a in ang[peaks]})


print(f"lattice fringes in {lattice_directions(on.image)} directions on the zone axis, {lattice_directions(off.image)} at 10° tilt "
      "(about x: the planes along x stay edge-on)")
