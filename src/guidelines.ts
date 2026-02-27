import * as THREE from 'three';
import { Atom, MolecularStructure } from './molecularData.js';

export interface GuidelineData {
    core: Atom;
    directions: THREE.Vector3[];
    positions: THREE.Vector3[];
}


// --- VSEPR guideline calculator ---


const _v = new THREE.Vector3();
const _cross = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3(0, 0, 1);

function axisAngle(axis: THREE.Vector3, angleDeg: number, vec: THREE.Vector3): THREE.Vector3 {
    _q.setFromAxisAngle(axis, THREE.MathUtils.degToRad(angleDeg));
    return vec.clone().applyQuaternion(_q).normalize();
}


function noHardPoints(atomPos: THREE.Vector3, pose: THREE.Vector3, steric: number): THREE.Vector3[] {
    const dirs: THREE.Vector3[] = [];
    const main = _v.copy(pose).sub(atomPos).normalize().clone();
    dirs.push(main.clone());

    _cross.crossVectors(main, _fwd).normalize();

    if (_cross.lengthSq() < 0.001) _cross.crossVectors(main, _up).normalize();
    const crossN = _cross.clone();

    switch (steric) {
        case 2:
            dirs.push(main.clone().negate());
            break;
        case 3:
            dirs.push(axisAngle(crossN, 120, main));
            dirs.push(axisAngle(crossN, -120, main));
            break;
        case 4:
            {
                const sp3A = axisAngle(crossN, 109.5, main);
                dirs.push(sp3A.clone());
                dirs.push(axisAngle(main, -120, sp3A));
                dirs.push(axisAngle(main, 120, sp3A));
            }
            break;
    }
    return dirs;
}

function oneHardPoint(atomPos: THREE.Vector3, hardPoint: THREE.Vector3, pose: THREE.Vector3, steric: number): THREE.Vector3[] {
    const dirs: THREE.Vector3[] = [];
    const ideal = _v.copy(pose).sub(atomPos).normalize();
    _cross.crossVectors(ideal, hardPoint).normalize();
    if (_cross.lengthSq() < 0.001) _cross.crossVectors(hardPoint, _up).normalize();
    const crossN = _cross.clone();

    switch (steric) {
        case 2:
            dirs.push(hardPoint.clone().negate());
            break;
        case 3:
            dirs.push(axisAngle(crossN, 120, hardPoint));
            dirs.push(axisAngle(crossN, -120, hardPoint));
            break;
        case 4:
            {
                const sp3A = axisAngle(crossN, -109.5, hardPoint);
                dirs.push(sp3A.clone());
                dirs.push(axisAngle(hardPoint, -120, sp3A));
                dirs.push(axisAngle(hardPoint, 120, sp3A));
            }
            break;
    }
    return dirs;
}


function twoHardPoints(hardPoints: THREE.Vector3[], steric: number): THREE.Vector3[] {
    const dirs: THREE.Vector3[] = [];
    const sum = hardPoints[0].clone().add(hardPoints[1]);

    switch (steric) {
        case 3:
            dirs.push(sum.clone().negate().normalize());
            break;
        case 4:
            {
                const oppSum = sum.clone().negate().normalize();
                const innerCross = _cross.crossVectors(oppSum, hardPoints[0]).normalize();
                const outerCross = _v.crossVectors(oppSum, innerCross).normalize().clone();
                dirs.push(axisAngle(outerCross, 109.5 / 2, oppSum));
                dirs.push(axisAngle(outerCross, -109.5 / 2, oppSum));
            }
            break;
    }
    return dirs;
}

function threeHardPoints(hardPoints: THREE.Vector3[], steric: number): THREE.Vector3[] {
    if (steric === 4) {
        const sum = hardPoints[0].clone().add(hardPoints[1]).add(hardPoints[2]);
        return [sum.negate().normalize()];
    }
    return [];
}

export function getGuidelineDirections(
    atom: Atom,
    hardPoints: THREE.Vector3[],
    pose: THREE.Vector3 | null,
    steric: number,
): THREE.Vector3[] {
    switch (hardPoints.length) {
        case 0:
            return noHardPoints(atom.position, pose ?? atom.position.clone().add(_up), steric);
        case 1:
            return oneHardPoint(atom.position, hardPoints[0], pose ?? atom.position.clone().add(_up), steric);
        case 2:
            return twoHardPoints(hardPoints, steric);
        case 3:
            return threeHardPoints(hardPoints, steric);
        default:
            return [];
    }
}

export function calculateGuidelines(
    cores: Atom[], // atoms to which to compute the guidelines
    newElement: string, // element symbol of the atom being placed (for bond length)
    pose: THREE.Vector3 | null,    // controlelr position
): GuidelineData[] {
    const results: GuidelineData[] = [];

    for (const core of cores) {
        const extraOrders = core.totalBondOrder - core.bondedAtoms.length;
        const realSteric = core.steric - extraOrders;

        const hardPoints = core.bondedAtoms.map(
            bonded => bonded.position.clone().sub(core.position).normalize()
        );

        const directions = getGuidelineDirections(core, hardPoints, pose, realSteric);

        const bondLen = MolecularStructure.idealBondLength(core, newElement);
        const positions = directions.map(
            d => core.position.clone().add(d.clone().multiplyScalar(bondLen))
        );

        results.push({ core, directions, positions });
    }
    return results;
}

export function emptyBondNumber(atom: Atom): number {
    return Math.max(0, atom.valence - atom.totalBondOrder);
}
