import * as THREE from 'three';
import { ELEMENTS, getBondLength } from './elementValues.js';


export class Atom {
    element: string;
    position: THREE.Vector3;
    bonds: Bond[] = [];
    index: number;

    constructor(element: string, position: THREE.Vector3, index: number = 0) {
        this.element = element;
        this.position = position.clone();
        this.index = index;
    }

    get valence(): number {
        return ELEMENTS[this.element]?.valence ?? 4;
    }

    get steric(): number {
        return ELEMENTS[this.element]?.steric ?? 4;
    }

    get color(): number {
        return ELEMENTS[this.element]?.color ?? 0x888888;
    }

    get totalBondOrder(): number {
        return this.bonds.reduce((sum, b) => sum + b.order, 0);
    }

    get bondedAtoms(): Atom[] {
        return this.bonds.map(b => (b.a === this ? b.b : b.a));
    }

    get emptyBonds(): number {
        return Math.max(0, this.valence - this.totalBondOrder);
    }

    get scale(): number {
        return 0.7 * (ELEMENTS[this.element]?.vdwRadius ?? 0.15);
    }
}


export class Bond {
    a: Atom;
    b: Atom;
    order: number;
    index: number;

    constructor(a: Atom, b: Atom, order: number = 1, index: number = 0) {
        this.a = a;
        this.b = b;
        this.order = order;
        this.index = index;
    }

    matches(other: Bond): boolean {
        return (this.a === other.a && this.b === other.b) ||
               (this.a === other.b && this.b === other.a);
    }

    findIdenticalIn(bonds: Bond[]): Bond | undefined {
        return bonds.find(b => this.matches(b));
    }
}


export class MolecularStructure {
    atoms: Atom[] = [];
    bonds: Bond[] = [];

    addAtom(element: string, position: THREE.Vector3): Atom {
        const atom = new Atom(element, position, this.atoms.length);
        this.atoms.push(atom);
        return atom;
    }

    addBond(a: Atom, b: Atom, order: number = 1): Bond {
        // check for existing bond
        const existing = this.bonds.find(
            bond => (bond.a === a && bond.b === b) || (bond.a === b && bond.b === a)
        );
        if (existing) {
            if (existing.order < 3) existing.order++;
            return existing;
        }
        const bond = new Bond(a, b, order, this.bonds.length);
        bond.a.bonds.push(bond);
        bond.b.bonds.push(bond);
        this.bonds.push(bond);
        return bond;
    }

    // not used
    removeAtom(atom: Atom): void {
        // remove bonds first
        const bondsToRemove = [...atom.bonds];
        for (const bond of bondsToRemove) {
            this.removeBond(bond);
        }
        const idx = this.atoms.indexOf(atom);
        if (idx >= 0) this.atoms.splice(idx, 1);
        this.reindex();
    }

    removeBond(bond: Bond): void {
        bond.a.bonds = bond.a.bonds.filter(b => b !== bond);
        bond.b.bonds = bond.b.bonds.filter(b => b !== bond);
        const idx = this.bonds.indexOf(bond);
        if (idx >= 0) this.bonds.splice(idx, 1);
    }

    reindex(): void {
        this.atoms.forEach((a, i) => a.index = i);
        this.bonds.forEach((b, i) => b.index = i);
    }

    static idealBondLength(a: Atom | string, b: Atom | string, order: number = 1): number {
        const elA = typeof a === 'string' ? a : a.element;
        const elB = typeof b === 'string' ? b : b.element;
        return getBondLength(elA, elB, order) * 0.1; // convert from angstroms to nanometers
    }
}
