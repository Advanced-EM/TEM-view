"""TEM-view specimens as 3D atomic models (ASE Atoms) for abTEM.

TEM-view describes each specimen by a recipe in its own coordinates (Å, x right, y down the image): gold
particles with positions, radii and in-plane rotations on an amorphous carbon film; the Si/SiO2 interface
x = b(y); the SrTiO3 Σ5 boundary between two grains rotated ±18.43° about [001]; graphene as an explicit atom
list. The request carries that recipe (js/abtem.js); here it becomes 3D atoms in a box of the requested field
of view, with the zone axis along z, so abTEM simulates the specimen the visitor was looking at.
"""
from __future__ import annotations

import numpy as np
from ase import Atoms

# conventional cells (Å) and fractional bases
FCC = np.array([[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]])
CRYSTALS = {
    "Au": {"a": 4.078, "basis": [("Au", p) for p in FCC]},
    "Si": {"a": 5.431, "basis": [("Si", p) for p in FCC] + [("Si", p + 0.25) for p in FCC]},
    "SrTiO3": {"a": 3.905, "basis": [("Sr", (0, 0, 0)), ("Ti", (0.5, 0.5, 0.5)),
                                     ("O", (0.5, 0.5, 0)), ("O", (0.5, 0, 0.5)), ("O", (0, 0.5, 0.5))]},
}
# lab axes (rows: x, y, z in crystal coordinates) matching TEM-view's projected cells: for [110],
# a1 = a/√2 along x ∥ [-110], a2 = a along y ∥ [001], beam along z ∥ [110] (right-handed)
ZONES = {
    "[110]": np.array([[-1, 1, 0], [0, 0, 1], [1, 1, 0]], float),
    "[001]": np.array([[1, 0, 0], [0, 1, 0], [0, 0, 1]], float),
}


def _rot_z(phi: float) -> np.ndarray:
    c, s = np.cos(phi), np.sin(phi)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def crystal_points(name: str, zone: str, half_extent: float, z_range: tuple[float, float], rot: float = 0.0,
                   origin=(0.0, 0.0)) -> tuple[list[str], np.ndarray]:
    """All atoms of a crystal with `zone` along z, rotated by `rot` in plane, within |x|,|y| ≤ half_extent of
    `origin` and z in z_range. Returns (symbols, positions)."""
    cr, R = CRYSTALS[name], ZONES[zone]
    R = R / np.linalg.norm(R, axis=1)[:, None]
    M = _rot_z(rot) @ R  # crystal → lab
    a = cr["a"]
    reach = np.hypot(half_extent * np.sqrt(2), max(abs(z_range[0]), abs(z_range[1]))) + 2 * a
    n = int(np.ceil(reach / a)) + 1
    g = np.arange(-n, n + 1)
    cells = np.stack(np.meshgrid(g, g, g, indexing="ij"), -1).reshape(-1, 3).astype(float)
    syms, pos = [], []
    for s, frac in cr["basis"]:
        p = (cells + np.asarray(frac)) * a @ M.T
        p[:, 0] += origin[0]
        p[:, 1] += origin[1]
        keep = (np.abs(p[:, 0] - origin[0]) <= half_extent) & (np.abs(p[:, 1] - origin[1]) <= half_extent) \
            & (p[:, 2] >= z_range[0]) & (p[:, 2] < z_range[1])
        pos.append(p[keep])
        syms += [s] * int(keep.sum())
    return syms, (np.concatenate(pos) if pos else np.zeros((0, 3)))


def amorphous(box_xy: tuple[float, float, float, float], z_range: tuple[float, float], density: float,
              species: list[tuple[str, float]], rng: np.random.Generator) -> tuple[list[str], np.ndarray]:
    """Amorphous solid: a jittered cubic grid at the right number density (atoms/Å³), which avoids the
    unphysically close pairs of a uniform random fill. species: [(symbol, fraction)]."""
    x0, y0, x1, y1 = box_xy
    d = density ** (-1 / 3)
    gx, gy, gz = (np.arange(a, b, d) for a, b in ((x0, x1), (y0, y1), z_range))
    p = np.stack(np.meshgrid(gx, gy, gz, indexing="ij"), -1).reshape(-1, 3)
    p += rng.uniform(-0.3 * d, 0.3 * d, p.shape)
    syms = rng.choice([s for s, _ in species], size=len(p), p=[f for _, f in species])
    return list(syms), p


def build(spec: dict, box: float, rng: np.random.Generator) -> tuple[Atoms, dict]:
    """The specimen in an abTEM-ready cell: lateral size `box` (Å) centred on the field of view, beam along z.
    spec is the request's specimen block (recipe in TEM-view coordinates). Returns (atoms, info)."""
    rid, t = spec["id"], float(spec["thickness_A"])
    cx, cy = spec["center_A"]
    half = box / 2
    win = (cx - half, cy - half, cx + half, cy + half)
    recipe = spec.get("recipe", {})
    syms: list[str] = []
    pos: list[np.ndarray] = []
    info = {"zone": spec.get("zone"), "film_A": None}

    if rid == "au":
        # amorphous carbon film (density 2.0 g/cm³ ≈ 0.100 atoms/Å³), particles resting on it
        s, p = amorphous(win, (0, t), 0.100, [("C", 1.0)], rng)
        syms += s; pos.append(p)
        info["film_A"] = t
        for part in recipe.get("particles", []):
            x, y, r, rot = part["x"], part["y"], part["r"], part["rot"]
            if x + r < win[0] or x - r > win[2] or y + r < win[1] or y - r > win[3]:
                continue
            s, p = crystal_points("Au", "[110]", r + 1, (-r - 1, r + 1), rot, (x, y))
            inside = (p[:, 0] - x) ** 2 + (p[:, 1] - y) ** 2 + p[:, 2] ** 2 < r * r
            p = p[inside]
            p[:, 2] += t + r  # sitting on the film
            syms += [q for q, k in zip(s, inside) if k]; pos.append(p)
    elif rid == "si":
        ys = np.asarray(recipe["boundary_y_A"]); xs = np.asarray(recipe["boundary_x_A"])
        b = lambda y: np.interp(y, ys, xs)
        reach = half + max(abs(cx), abs(cy)) + 4
        s, p = crystal_points("Si", "[110]", reach, (0, t), 0.0, tuple(recipe.get("origin_A", [0.3, 0.2])))
        k = p[:, 0] < b(p[:, 1])
        syms += [q for q, kk in zip(s, k) if kk]; pos.append(p[k])
        # amorphous SiO2 (2.2 g/cm³ ≈ 0.0662 atoms/Å³, Si:O = 1:2) beyond the interface
        s, p = amorphous(win, (0, t), 0.0662, [("Si", 1 / 3), ("O", 2 / 3)], rng)
        k = p[:, 0] > b(p[:, 1]) + 0.8
        syms += [q for q, kk in zip(s, k) if kk]; pos.append(p[k])
    elif rid == "sto":
        th = float(recipe.get("half_angle_rad", np.arctan(1 / 3)))
        reach = half + max(abs(cx), abs(cy)) + 4
        sa, pa = crystal_points("SrTiO3", "[001]", reach, (0, t), th)
        ka = pa[:, 0] < -0.05
        sb, pb = crystal_points("SrTiO3", "[001]", reach, (0, t), -th)
        kb = pb[:, 0] >= -0.05
        pa, sa = pa[ka], [q for q, k in zip(sa, ka) if k]
        pb, sb = pb[kb], [q for q, k in zip(sb, kb) if k]
        # remove grain-B atoms that clash with grain A at the boundary
        near_a = pa[pa[:, 0] > -3]
        if len(near_a):
            from scipy.spatial import cKDTree
            d, _ = cKDTree(near_a).query(pb)
            ok = d > 1.6
            pb, sb = pb[ok], [q for q, k in zip(sb, ok) if k]
        syms += sa + sb; pos += [pa, pb]
    elif rid == "gr":
        at = np.asarray(recipe["atoms"], float)  # x, y, z, Z: TEM-view's own atom list (layers 3.35 Å apart)
        k = (at[:, 0] >= win[0]) & (at[:, 0] < win[2]) & (at[:, 1] >= win[1]) & (at[:, 1] < win[3])
        from ase.data import chemical_symbols
        syms += [chemical_symbols[int(z)] for z in at[k, 3]]; pos.append(at[k, :3])
    else:
        raise ValueError(f"specimen {rid!r} is not supported by the abTEM bridge yet (supported: au, si, sto, gr)")

    P = np.concatenate([p for p in pos if len(p)]) if pos else np.zeros((0, 3))
    P[:, 0] -= win[0]
    P[:, 1] -= win[1]
    inside = (P[:, 0] >= 0) & (P[:, 0] < box) & (P[:, 1] >= 0) & (P[:, 1] < box)
    P, syms = P[inside], [s for s, k in zip(syms, inside) if k]
    zmin = P[:, 2].min() if len(P) else 0
    P[:, 2] -= zmin - 2.0
    height = (P[:, 2].max() if len(P) else 0) + 2.0
    atoms = Atoms(symbols=syms, positions=P, cell=[box, box, height], pbc=[True, True, False])
    info.update(n_atoms=len(atoms), height_A=round(float(height), 2))
    return atoms, info
