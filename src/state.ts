import * as THREE from 'three';
import { MolecularStructure } from './molecularData.js';

export const molecule = new MolecularStructure();

export const simulationSpace = new THREE.Group();

export const BOND_SCALE = 0.15; // bond radius relative to atom scale
export const BOND_SELECTION_MARGIN = 0.025;

export const atomGeometry = new THREE.SphereGeometry(1, 24, 16);
export const guidelineGeometry = new THREE.SphereGeometry(1, 12, 8);

const _inverseMatrix = new THREE.Matrix4();

export function worldToSimulationSpace(worldPos: THREE.Vector3): THREE.Vector3 {
    simulationSpace.updateMatrixWorld(true);
    _inverseMatrix.copy(simulationSpace.matrixWorld).invert();
    return worldPos.clone().applyMatrix4(_inverseMatrix);
}

export function simulationToWorldSpace(simPos: THREE.Vector3): THREE.Vector3 {
    simulationSpace.updateMatrixWorld(true);
    return simPos.clone().applyMatrix4(simulationSpace.matrixWorld);
}
