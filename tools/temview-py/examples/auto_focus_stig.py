"""Test an automation algorithm against hidden truth: automatic focus and stigmation from Thon rings.

The challenge hides a defocus offset and two-fold astigmatism, so the knob readings are wrong. The algorithm
uses only what a real microscope gives it (the live FFT, through the CTF fit), then asks the simulator for a
score computed from the true optics. It runs unchanged headless, against an open exhibit, or in the IDE.
"""
import math

import temview as tv

tem = tv.connect()  # headless on a desktop; the exhibit itself in the IDE
GOOD_FIT = 0.4  # trust a CTF fit only if its correlation with the rings is at least this, and not too near focus


def measure():
    """Fit the CTF of the live image. Returns (defocus nm, astigmatism nm, angle deg, trustworthy?)."""
    r = tem.analyze("fit_ctf")["result"]
    ok = r["score"] >= GOOD_FIT and abs(r["defocus_nm"]) > 25  # within ~25 nm of focus there are too few rings
    return r["defocus_nm"], r["astigmatism_nm"], r["astigmatism_deg"], ok


def measure_signed(step_nm=20):
    """Thon rings alone cannot always tell over- from underfocus. Step the focus by a known amount: if the
    measured defocus moves the other way, the sign of the fit was wrong."""
    df1, a, ang, ok = measure()
    knob = tem.state()["defocus_nm"]
    tem.set(defocus_nm=knob + step_nm)
    df2, _, _, ok2 = measure()
    tem.set(defocus_nm=knob)
    if ok2 and abs((df2 - df1) + step_nm) < abs((df2 - df1) - step_nm):  # it moved by about -step: flipped
        df1 = -df1
    return df1, a, ang, ok


def find_rings():
    """Step the focus until the fit is trustworthy: near focus there are too few Thon rings."""
    start = tem.state()["defocus_nm"]
    for offset in (0, -60, 60, -120, 120):
        tem.set(defocus_nm=start + offset)
        df, a, ang, ok = measure_signed()
        if ok:
            return df, a, ang
    raise RuntimeError("no trustworthy CTF fit at any focus tried")


def correct_astigmatism(a_nm, a_deg, max_step_nm=60):
    """Subtract the measured two-fold astigmatism from the stigmator setting (vectors add at twice the angle).
    Large single steps are capped, as a cautious operator would."""
    a_nm = min(a_nm, max_step_nm)
    k = tem.state()["aberrations"]
    kx, ky = k["A1"] * math.cos(math.radians(2 * k["A1a"])), k["A1"] * math.sin(math.radians(2 * k["A1a"]))
    mx, my = a_nm * math.cos(math.radians(2 * a_deg)), a_nm * math.sin(math.radians(2 * a_deg))
    nx, ny = kx - mx, ky - my
    tem.aberrations(A1=(math.hypot(nx, ny), math.degrees(math.atan2(ny, nx)) / 2 % 180))


def move_true_defocus_to(target_nm, measured_nm):
    """The knob is off by an unknown amount, so move it by the measured error, not to the target."""
    tem.set(defocus_nm=tem.state()["defocus_nm"] + (target_nm - measured_nm))


def run(seed):
    tem.set(kV=200)  # the challenge keeps the voltage it finds; fix it so results repeat on every backend
    tem.challenge("tem-focus-stig", seed=seed)
    df, a, ang = find_rings()
    move_true_defocus_to(-80, df)  # well underfocus: many rings, a reliable fit
    last = None
    for _ in range(4):
        df, a, ang, ok = measure()
        if ok:
            last = df
            if a > 0.3:
                correct_astigmatism(a, ang)
    target = tem.state()["scherzer_defocus_nm"]
    if last is not None:
        move_true_defocus_to(target, last)  # from the last trustworthy measurement
    df, a, ang, ok = measure_signed()
    if ok:  # one check at the target, if the fit there is trustworthy
        move_true_defocus_to(target, df)
    return tem.score()


SEEDS = range(1, 4) if tv.in_browser() else range(1, 9)  # the exhibit pauses while a script runs

if __name__ == "__main__":
    print(f"{'seed':>5} {'score':>6} {'defocus error (nm)':>19} {'astigmatism left (nm)':>22}")
    for seed in SEEDS:
        s = run(seed)
        print(f"{seed:5d} {s['score']:6d} {s['df_err_nm']:19.1f} {s['A1_true_nm']:22.2f}")
    tem.end_challenge()
