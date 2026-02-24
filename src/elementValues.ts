interface elementData {
    name: string;
    color: number;
    valence: number;
    steric: number;
}

export const ELEMENTS: Record<string, elementData> = {
    H:  { name: 'Hydrogen',   color: 0xffffff, valence: 1, steric: 1 },
    B:  { name: 'Boron',      color: 0xffa500, valence: 3, steric: 3 },
    C:  { name: 'Carbon',     color: 0x252525, valence: 4, steric: 4 },
    N:  { name: 'Nitrogen',   color: 0x0000ff, valence: 3, steric: 4 },
    O:  { name: 'Oxygen',     color: 0xff0000, valence: 2, steric: 4 },
    F:  { name: 'Fluorine',   color: 0x00ff00, valence: 1, steric: 4 },
    Cl: { name: 'Chlorine',   color: 0x00ff00, valence: 1, steric: 4 },
    S:  { name: 'Sulfur',     color: 0xffff00, valence: 2, steric: 4 },
    P:  { name: 'Phosphorus', color: 0xff8c00, valence: 3, steric: 4 },
}

// Ideal bond lengths in angstroms.
export const BOND_LENGTHS: Record<string, number> = {
    'H-B-1': 1.2,   'B-B-1': 2,     'C-C-1': 1.5,   'Cl-Cl-1': 2.3, 'F-N-1': 1.4,
    'H-C-1': 1.1,   'B-Cl-1': 1.8,  'C-C-2': 1.3,   'Cl-N-1': 1.7,  'F-P-1': 1.5,
    'H-Cl-1': 1.3,  'B-C-1': 1.6,   'C-C-3': 1.2,   'Cl-O-1': 1.4,  'F-S-1': 1.5,
    'H-F-1': 1.0,   'B-F-1': 1.4,   'C-Cl-1': 1.8,  'Cl-P-1': 2.0,
    'H-N-1': 1.0,   'B-N-1': 1.5,   'C-F-1': 1.4,
    'H-O-1': 1.0,   'B-O-1': 1.4,   'C-H-1': 1.1,
    'H-P-1': 1.4,   'B-P-1': 1.9,   'C-N-1': 1.5,
    'H-S-1': 1.3,   'B-S-1': 1.9,   'C-N-2': 1.3,
                                    'C-N-3': 1.1,
                                    'C-O-1': 1.4,
                                    'C-O-2': 1.2,
                                    'C-P-1': 1.8,
                                    'C-S-1': 1.8,
                                    'C-S-2': 1.6,

    'N-N-1': 1.4,   'O-O-1': 1.5,   'P-P-1': 2.2,   'S-S-1': 2.0,
    'N-N-2': 1.2,   'O-P-1': 1.6,   'P-P-2': 2.0,
    'N-O-1': 1.4,   'O-P-2': 1.5,   'P-S-2': 1.9,
    'N-O-2': 1.2,   'O-S-1': 1.6,
    'N-P-1': 1.7,   'O-S-2': 1.4,
    'N-P-2': 1.6,
    'N-S-1': 1.7,
    'N-S-2': 1.5
};

export function getBondLength( element1: string, element2: string, bondOrder: number ): number {
    const key1 = `${element1}-${element2}-${bondOrder}`
    const key2 = `${element2}-${element1}-${bondOrder}`
    return BOND_LENGTHS[key1] || BOND_LENGTHS[key2] || 1.5}