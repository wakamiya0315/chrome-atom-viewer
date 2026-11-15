"""Generate the showcase structures in tests/samples/ (used for the store screenshots).

All structures are built from scratch with ASE; nothing is taken from other projects.

Usage:  uv run --with ase python tools/make_samples.py
"""

from pathlib import Path

import numpy as np
from ase import units
from ase.build import bulk, fcc111, surface
from ase.calculators.emt import EMT
from ase.cluster import Octahedron
from ase.io import write
from ase.md.langevin import Langevin
from ase.md.velocitydistribution import MaxwellBoltzmannDistribution

OUT = Path(__file__).resolve().parent.parent / "tests" / "samples"
OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(7)


def au38_on_mgo():
    """Au38 truncated octahedron on a 4x4 MgO(001) slab (4 atomic layers)."""
    mgo = bulk("MgO", "rocksalt", a=4.212, cubic=True)
    slab = surface(mgo, (0, 0, 1), layers=2, vacuum=0.0)
    slab = slab.repeat((4, 4, 1))
    slab.center(vacuum=0.0, axis=2)
    cluster = Octahedron("Au", length=4, cutoff=1)  # 38 atoms
    cpos = cluster.get_positions()
    cpos -= cpos.mean(axis=0)
    # sit the cluster's lowest facet 2.4 Å above the top O/Mg layer, at the slab centre
    top = slab.positions[:, 2].max()
    centre = slab.cell[:2, :2].sum(axis=0) / 2
    cpos[:, :2] += centre
    cpos[:, 2] += top + 2.4 - cpos[:, 2].min()
    cluster.positions = cpos
    system = slab + cluster
    system.cell[2, 2] = system.positions[:, 2].max() + 10.0
    system.pbc = (True, True, False)
    write(OUT / "au38_mgo001.extxyz", system, format="extxyz")
    return system


def au_adatoms_on_pt111_md():
    """Short Langevin MD (EMT, 700 K) of four Au adatoms on a Pt(111) 5x5x3 slab."""
    slab = fcc111("Pt", size=(5, 5, 3), vacuum=9.0)
    top = slab.positions[:, 2].max()
    a1, a2 = slab.cell[0, :2], slab.cell[1, :2]
    for fx, fy in [(0.2, 0.2), (0.6, 0.25), (0.3, 0.65), (0.75, 0.7)]:
        xy = fx * a1 + fy * a2
        slab.append("Au")
        slab.positions[-1] = [xy[0], xy[1], top + 2.3]
    slab.pbc = (True, True, False)
    fixed = slab.positions[:, 2] < slab.positions[:, 2].min() + 0.5
    from ase.constraints import FixAtoms

    slab.set_constraint(FixAtoms(mask=fixed))
    slab.calc = EMT()
    MaxwellBoltzmannDistribution(slab, temperature_K=700, rng=rng)
    dyn = Langevin(slab, 4 * units.fs, temperature_K=700, friction=0.02, rng=rng)
    frames = []

    def snap():
        atoms = slab.copy()
        atoms.info["energy"] = float(slab.get_potential_energy())
        atoms.info["time_fs"] = round(dyn.get_time() / units.fs, 1)
        atoms.set_constraint()
        frames.append(atoms)

    snap()
    for _ in range(40):
        dyn.run(10)
        snap()
    write(OUT / "md_au_pt111.extxyz", frames, format="extxyz")
    return frames


if __name__ == "__main__":
    s = au38_on_mgo()
    print("au38_mgo001.extxyz", len(s), "atoms", s.get_chemical_formula())
    f = au_adatoms_on_pt111_md()
    print("md_au_pt111.extxyz", len(f), "frames", len(f[0]), "atoms")
