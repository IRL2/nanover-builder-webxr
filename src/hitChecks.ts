import * as THREE from 'three';
import { Atom, MolecularStructure } from './molecularData.js';


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


export function distanceToSegment(
    position: THREE.Vector3,
    start: THREE.Vector3,
    end: THREE.Vector3,
): number {
    const segment = end.clone().sub(start);
    const segmentLengthSq = segment.lengthSq();
    if (segmentLengthSq <= Number.EPSILON) {
        return position.distanceTo(start);
    }

    const t = THREE.MathUtils.clamp(position.clone().sub(start).dot(segment) / segmentLengthSq, 0, 1);
    const closestPoint = start.clone().add(segment.multiplyScalar(t));
    return position.distanceTo(closestPoint);
}


export function findNearestAtom(
    position: THREE.Vector3,
    atoms: Atom[],
    maxDistance: number
): Atom | null {
    let nearest: Atom | null = null;
    let nearestDist = maxDistance;

    for (const atom of atoms) {
        const dist = position.distanceTo(atom.position);
        const effectiveDist = dist - atom.scale * 0.3;
        if (effectiveDist < nearestDist) {
            nearestDist = effectiveDist;
            nearest = atom;
        }
    }

    return nearest;
}
