import * as THREE from 'three';
import type { Atom, MolecularStructure } from '../core/molecularData.js';
import type { GuidelineData } from '../core/guidelines.js';
import { simulationSpace, atomGeometry, guidelineGeometry, simulationToWorldSpace, BOND_SCALE } from '../state.js';
import { buildBondSegmentsBicolor } from './bondMesh.js';

export const ghostGroup = new THREE.Group();
export const guidelineGroup = new THREE.Group();

export const ghostMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false });
export const guideValidMat = new THREE.MeshStandardMaterial({ color: 0x44ff44, transparent: true, opacity: 0.35, depthWrite: false });
export const guideInvalidMat = new THREE.MeshStandardMaterial({ color: 0xff4444, transparent: true, opacity: 0.35, depthWrite: false });

export function renderGhostAtomHighlight(atom: Atom): void {
    const ghostMat = ghostMaterial.clone();
    ghostMat.color = new THREE.Color(atom.color);

    const ghostMesh = new THREE.Mesh(atomGeometry, ghostMat);
    ghostMesh.position.copy(simulationToWorldSpace(atom.position));
    ghostMesh.scale.setScalar(atom.scale / 2 * simulationSpace.scale.x * 1.1);
    ghostGroup.add(ghostMesh);
}

export function renderGhostBond(
    start: THREE.Vector3,
    end: THREE.Vector3,
    startColor: number,
    endColor: number,
    baseBondRadius: number,
    order: number,
): void {
    const matA = ghostMaterial.clone();
    matA.color = new THREE.Color(startColor);
    const matB = ghostMaterial.clone();
    matB.color = new THREE.Color(endColor);
    buildBondSegmentsBicolor(ghostGroup, start, end, baseBondRadius, order, matA, matB);
}

export function renderGhostStructure(structure: MolecularStructure): void {
    const simScale = simulationSpace.scale.x;

    for (const atom of structure.atoms) {
        const ghostMat = ghostMaterial.clone();
        ghostMat.color = new THREE.Color(atom.color);

        const ghostMesh = new THREE.Mesh(atomGeometry, ghostMat);
        ghostMesh.position.copy(simulationToWorldSpace(atom.position));
        ghostMesh.scale.setScalar(atom.scale / 2 * simScale);
        ghostGroup.add(ghostMesh);
    }

    for (const bond of structure.bonds) {
        const start = simulationToWorldSpace(bond.a.position);
        const end = simulationToWorldSpace(bond.b.position);
        renderGhostBond(start, end, bond.a.color, bond.b.color, Math.max(bond.a.scale, bond.b.scale) * BOND_SCALE * simScale, bond.order);
    }
}

export function renderGuidelineSet(gd: GuidelineData, material: THREE.Material): void {
    const guideRadius = gd.core.scale * BOND_SCALE * 0.8 * simulationSpace.scale.x;
    for (const pos of gd.positions) {
        const sphere = new THREE.Mesh(guidelineGeometry, material);
        sphere.position.copy(simulationToWorldSpace(pos));
        sphere.scale.setScalar(guideRadius);
        guidelineGroup.add(sphere);
    }
}
