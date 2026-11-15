// Element data: symbols, Jmol colours and covalent radii (Cordero et al., Dalton Trans. 2008, as used by ASE).

export const SYMBOLS = [
  'X',
  'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar',
  'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr',
  'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe',
  'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu',
  'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn',
  'Fr', 'Ra', 'Ac', 'Th', 'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm', 'Md', 'No', 'Lr',
  'Rf', 'Db', 'Sg', 'Bh', 'Hs', 'Mt', 'Ds', 'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og',
];

const JMOL = [
  0xff1493,
  0xffffff, 0xd9ffff, 0xcc80ff, 0xc2ff00, 0xffb5b5, 0x909090, 0x3050f8, 0xff0d0d, 0x90e050, 0xb3e3f5,
  0xab5cf2, 0x8aff00, 0xbfa6a6, 0xf0c8a0, 0xff8000, 0xffff30, 0x1ff01f, 0x80d1e3,
  0x8f40d4, 0x3dff00, 0xe6e6e6, 0xbfc2c7, 0xa6a6ab, 0x8a99c7, 0x9c7ac7, 0xe06633, 0xf090a0, 0x50d050,
  0xc88033, 0x7d80b0, 0xc28f8f, 0x668f8f, 0xbd80e3, 0xffa100, 0xa62929, 0x5cb8d1,
  0x702eb0, 0x00ff00, 0x94ffff, 0x94e0e0, 0x73c2c9, 0x54b5b5, 0x3b9e9e, 0x248f8f, 0x0a7d8c, 0x006985,
  0xc0c0c0, 0xffd98f, 0xa67573, 0x668080, 0x9e63b5, 0xd47a00, 0x940094, 0x429eb0,
  0x57178f, 0x00c900, 0x70d4ff, 0xffffc7, 0xd9ffc7, 0xc7ffc7, 0xa3ffc7, 0x8fffc7, 0x61ffc7, 0x45ffc7,
  0x30ffc7, 0x1fffc7, 0x00ff9c, 0x00e675, 0x00d452, 0x00bf38, 0x00ab24,
  0x4dc2ff, 0x4da6ff, 0x2194d6, 0x267dab, 0x266696, 0x175487, 0xd0d0e0, 0xffd123, 0xb8b8d0,
  0xa6544d, 0x575961, 0x9e4fb5, 0xab5c00, 0x754f45, 0x428296,
  0x420066, 0x007d00, 0x70abfa, 0x00baff, 0x00a1ff, 0x008fff, 0x0080ff, 0x006bff, 0x545cf2, 0x785ce3,
  0x8a4fe3, 0xa136d4, 0xb31fd4, 0xb31fba, 0xb30da6, 0xbd0d87, 0xc70066,
  0xcc0059, 0xd1004f, 0xd90045, 0xe00038, 0xe6002e, 0xeb0026,
];

const COVALENT = [
  0.2,
  0.31, 0.28, 1.28, 0.96, 0.84, 0.76, 0.71, 0.66, 0.57, 0.58, 1.66, 1.41, 1.21, 1.11, 1.07, 1.05, 1.02, 1.06,
  2.03, 1.76, 1.70, 1.60, 1.53, 1.39, 1.39, 1.32, 1.26, 1.24, 1.32, 1.22, 1.22, 1.20, 1.19, 1.20, 1.20, 1.16,
  2.20, 1.95, 1.90, 1.75, 1.64, 1.54, 1.47, 1.46, 1.42, 1.39, 1.45, 1.44, 1.42, 1.39, 1.39, 1.38, 1.39, 1.40,
  2.44, 2.15, 2.07, 2.04, 2.03, 2.01, 1.99, 1.98, 1.98, 1.96, 1.94, 1.92, 1.92, 1.89, 1.90, 1.87, 1.87,
  1.75, 1.70, 1.62, 1.51, 1.44, 1.41, 1.36, 1.36, 1.32, 1.45, 1.46, 1.48, 1.40, 1.50, 1.50,
  2.60, 2.21, 2.15, 2.06, 2.00, 1.96, 1.90, 1.87, 1.80, 1.69,
];

// Elements treated as non-metals for bond drawing (metal–metal bonds are off by default).
const NONMETALS = new Set(['H', 'He', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Si', 'P', 'S', 'Cl', 'Ar',
  'Ge', 'As', 'Se', 'Br', 'Kr', 'Sb', 'Te', 'I', 'Xe', 'At', 'Rn']);

const BY_SYMBOL = new Map(SYMBOLS.map((s, z) => [s.toLowerCase(), z]));

/** Atomic number from a symbol / label such as "Fe", "FE", "Fe2+", "O1", "Ca_sv" or "26". */
export function atomicNumber(label) {
  if (label === undefined || label === null) return 0;
  const s = String(label).trim();
  if (/^\d+$/.test(s)) {
    const z = parseInt(s, 10);
    return z > 0 && z < SYMBOLS.length ? z : 0;
  }
  const m = s.match(/^([A-Za-z])([a-z]?)/);
  if (!m) return 0;
  const two = (m[1] + m[2]).toLowerCase();
  if (m[2] && BY_SYMBOL.has(two)) return BY_SYMBOL.get(two);
  // "CA" in a PDB atom name column etc.: try a two-letter upper-case match, then one letter
  const up = s.slice(0, 2).toLowerCase();
  if (/^[A-Z]{2}/.test(s) && BY_SYMBOL.has(up)) return BY_SYMBOL.get(up);
  return BY_SYMBOL.get(m[1].toLowerCase()) ?? 0;
}

export const symbolOf = (z) => SYMBOLS[z] || 'X';
export const colorOf = (z) => JMOL[z] ?? 0xff1493;
export const covalentRadius = (z) => COVALENT[z] ?? 1.5;
export const isNonMetal = (z) => NONMETALS.has(SYMBOLS[z]);
