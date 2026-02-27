import * as THREE from 'three';
import { Atom, MolecularStructure } from './molecularData.js';


export function doBondsOverlap(a: Atom | string, b: Atom, biasFactor: number = 1.5): boolean {
    const elA = typeof a === 'string' ? a : a.element;
    const posA = typeof a === 'string' ? null : a.position;
    if (!posA) return false;

    let bias = biasFactor;

    if (bias > 1 && b.bondedAtoms.length >= b.valence) bias = 1;

    const idealLen = MolecularStructure.idealBondLength(elA, b.element, 1);
    return posA.distanceTo(b.position) < idealLen * bias;
}

export function biasedSortedBondOverlap(
    hitAtom: Atom,
    candidates: Atom[],
): Atom[] {
    return candidates
        .filter(c => c !== hitAtom && doBondsOverlap(hitAtom, c, 1.5))
        .sort((a, b) => biasedDistance(a, hitAtom.position) - biasedDistance(b, hitAtom.position))
        .slice(0, hitAtom.valence);
}

export function biasedSortedBondOverlapForNew(
    element: string,
    position: THREE.Vector3,
    candidates: Atom[],
): Atom[] {
    const tempAtom = new Atom(element, position);
    return candidates
        .filter(c => {
            let bias = 1.5;
            if (c.bondedAtoms.length >= c.valence) bias = 1;
            const idealLen = MolecularStructure.idealBondLength(element, c.element, 1);
            return position.distanceTo(c.position) < idealLen * bias;
        })
        .sort((a, b) => biasedDistance(a, position) - biasedDistance(b, position))
        .slice(0, tempAtom.valence);
}

function biasedDistance(atom: Atom, point: THREE.Vector3): number {
    const bias = atom.bondedAtoms.length >= atom.valence ? 0.5 : 1;
    return atom.position.distanceTo(point) / bias;
}


export function sortedPositionsByDistance(point: THREE.Vector3, positions: THREE.Vector3[]): number[] {
    return positions
        .map((p, i) => ({ i, d: p.distanceToSquared(point) }))
        .sort((a, b) => a.d - b.d)
        .map(x => x.i);
}
